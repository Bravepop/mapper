import { Camera } from './core/camera';
import { History } from './core/history';
import { LayerStack, type MapLayer } from './core/layers';
import { Renderer } from './render/renderer';
import { EyedropperTool } from './tools/eyedropper';
import { FillTool } from './tools/fill';
import { StrokeTool } from './tools/stroke';
import type { Cursor, Tool, ToolEvent, ToolId } from './tools/tool';

export interface AppState {
  tool: ToolId;
  color: string;
  /** Brush/eraser diameter in meters. */
  size: number;
  /** Fill bucket color tolerance, 0–255 per channel. */
  tolerance: number;
  /** What the fill bucket treats as boundaries: the active layer only, or every visible layer. */
  fillSample: 'layer' | 'visible';
  /** Grid cell size in meters. */
  gridSize: number;
  showGrid: boolean;
}

export const DEFAULT_STATE: AppState = {
  tool: 'brush',
  color: '#7fa650',
  size: 8,
  tolerance: 32,
  fillSample: 'layer',
  gridSize: 25,
  showGrid: true,
};

export const MIN_SIZE = 1;
export const MAX_SIZE = 200;

export class App {
  readonly camera = new Camera();
  readonly layers = new LayerStack();
  readonly history = new History(() => this.layers.active.tiles);
  readonly renderer: Renderer;
  readonly tools: { [K in ToolId]: Tool };
  readonly eyedropper: EyedropperTool;

  state: AppState = { ...DEFAULT_STATE };
  cursor: Cursor | null = null;

  private stateListeners = new Set<() => void>();
  private noticeListeners = new Set<(msg: string) => void>();
  private viewListeners = new Set<() => void>();
  private pan: { id: number; x: number; y: number } | null = null;
  private drawingId: number | null = null;
  private spaceDown = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas, this);
    this.eyedropper = new EyedropperTool(this);
    this.tools = {
      pencil: new StrokeTool(this, 'pencil'),
      brush: new StrokeTool(this, 'brush'),
      eraser: new StrokeTool(this, 'eraser'),
      fill: new FillTool(this),
      eyedropper: this.eyedropper,
    };
    this.layers.onTiles(() => this.requestRender());
    this.layers.onChange(() => this.requestRender());
    this.bindInput();

    const stage = canvas.parentElement!;
    new ResizeObserver(() => this.renderer.resize(stage.clientWidth, stage.clientHeight)).observe(stage);
  }

  get tool(): Tool {
    return this.tools[this.state.tool];
  }

  get activeLayer(): MapLayer {
    return this.layers.active;
  }

  /**
   * Tools call this before editing. Locked or hidden layers can't be painted
   * on; the user gets a short notice explaining why.
   */
  canPaint(): boolean {
    const layer = this.activeLayer;
    if (layer.locked) this.notice(`“${layer.name}” is locked. Unlock it in the Layers panel to paint on it.`);
    else if (!layer.visible) this.notice(`“${layer.name}” is hidden. Show it in the Layers panel to paint on it.`);
    else return true;
    return false;
  }

  notice(msg: string): void {
    for (const fn of this.noticeListeners) fn(msg);
  }

  onNotice(fn: (msg: string) => void): void {
    this.noticeListeners.add(fn);
  }

  get isPanning(): boolean {
    return this.pan !== null;
  }

  get isDrawing(): boolean {
    return this.drawingId !== null;
  }

  update(patch: Partial<AppState>): void {
    if (patch.tool && this.isDrawing) delete patch.tool;
    if (patch.size !== undefined) patch.size = Math.round(Math.min(MAX_SIZE, Math.max(MIN_SIZE, patch.size)));
    Object.assign(this.state, patch);
    for (const fn of this.stateListeners) fn();
    this.requestRender();
  }

  onState(fn: () => void): void {
    this.stateListeners.add(fn);
  }

  /** Fires when the camera moves or the cursor moves. */
  onView(fn: () => void): void {
    this.viewListeners.add(fn);
  }

  viewChanged(): void {
    for (const fn of this.viewListeners) fn();
    this.requestRender();
  }

  requestRender(): void {
    this.renderer.request();
  }

  undo(): void {
    if (!this.isDrawing) this.history.undo();
  }

  redo(): void {
    if (!this.isDrawing) this.history.redo();
  }

  zoomBy(factor: number): void {
    this.camera.zoomAt(this.camera.width / 2, this.camera.height / 2, factor);
    this.viewChanged();
  }

  centerOnSpawn(): void {
    this.camera.centerOn(0, 0);
    this.viewChanged();
  }

  /** Wipe the map (used by New and before loading a file). */
  resetDocument(): void {
    this.layers.reset();
    this.history.clear();
    this.requestRender();
  }

  private toolEvent(e: PointerEvent): ToolEvent {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    return { wx: this.camera.toWorldX(sx), wy: this.camera.toWorldY(sy), shiftKey: e.shiftKey };
  }

  private updateCursor(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    this.cursor = { sx, sy, wx: this.camera.toWorldX(sx), wy: this.camera.toWorldY(sy) };
  }

  private setCanvasCursor(): void {
    this.canvas.style.cursor = this.pan ? 'grabbing' : this.spaceDown ? 'grab' : 'none';
  }

  private bindInput(): void {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    c.addEventListener('pointerdown', (e) => {
      c.focus();
      // Middle or right drag (or Space + left drag) pans the map.
      if (e.button === 1 || e.button === 2 || (e.button === 0 && this.spaceDown)) {
        if (this.pan || this.isDrawing) return;
        e.preventDefault();
        c.setPointerCapture(e.pointerId);
        this.pan = { id: e.pointerId, x: e.clientX, y: e.clientY };
        this.setCanvasCursor();
        this.requestRender();
        return;
      }
      if (e.button !== 0 || this.isDrawing || this.pan) return;
      const ev = this.toolEvent(e);
      // Alt+click: quick color pick without switching tools.
      if (e.altKey) {
        e.preventDefault();
        this.eyedropper.pick(ev);
        return;
      }
      c.setPointerCapture(e.pointerId);
      this.drawingId = e.pointerId;
      this.tool.onDown(ev);
    });

    c.addEventListener('pointermove', (e) => {
      this.updateCursor(e);
      if (this.pan && e.pointerId === this.pan.id) {
        this.camera.panBy(e.clientX - this.pan.x, e.clientY - this.pan.y);
        this.pan.x = e.clientX;
        this.pan.y = e.clientY;
      } else if (this.drawingId === e.pointerId) {
        const events = e.getCoalescedEvents?.() ?? [];
        for (const ce of events.length ? events : [e]) this.tool.onMove(this.toolEvent(ce));
      }
      this.viewChanged();
    });

    const end = (e: PointerEvent) => {
      if (this.pan && e.pointerId === this.pan.id) {
        this.pan = null;
        this.setCanvasCursor();
        this.requestRender();
      }
      if (this.drawingId === e.pointerId) {
        this.drawingId = null;
        this.tool.onUp();
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => {
      if (this.isDrawing || this.pan) return;
      this.cursor = null;
      this.viewChanged();
    });

    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const rect = c.getBoundingClientRect();
        const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
        this.camera.zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-delta * 0.0015));
        this.updateCursor(e);
        this.viewChanged();
      },
      { passive: false },
    );

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !isTextInput(e.target)) {
        e.preventDefault();
        if (!this.spaceDown) {
          this.spaceDown = true;
          this.setCanvasCursor();
        }
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.spaceDown = false;
        this.setCanvasCursor();
      }
    });
    window.addEventListener('blur', () => {
      this.spaceDown = false;
      this.setCanvasCursor();
    });
    this.setCanvasCursor();
  }
}

export function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) return !['range', 'checkbox', 'color', 'button'].includes(target.type);
  return target instanceof HTMLTextAreaElement || target.isContentEditable;
}
