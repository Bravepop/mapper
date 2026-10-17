import { Camera } from './core/camera';
import { History } from './core/history';
import { CompassStore, type Compass, type CompassStyle } from './core/compass';
import { LabelStore, type Label } from './core/labels';
import { LayerStack, type MapLayer } from './core/layers';
import { Renderer } from './render/renderer';
import { CompassTool } from './tools/compass';
import { EyedropperTool } from './tools/eyedropper';
import { FillTool } from './tools/fill';
import { LabelEditor, LabelTool } from './tools/label';
import { ShapeTool } from './tools/shape';
import { StampTool } from './tools/stamp';
import { TextureTool } from './tools/texture';
import { StrokeTool } from './tools/stroke';
import type { LineStyle } from './core/paint';
import type { Cursor, Tool, ToolEvent, ToolId } from './tools/tool';
import type { GlyphId, TextureId } from './valheim/glyphs';

export interface AppState {
  tool: ToolId;
  color: string;
  /** Brush/eraser diameter in meters. */
  size: number;
  /** Fill bucket color tolerance, 0–255 per channel. */
  tolerance: number;
  /** What the fill bucket treats as boundaries: the active layer only, or every visible layer. */
  fillSample: 'layer' | 'visible';
  /** Line style for pencil, brush and shape outlines. */
  lineStyle: LineStyle;
  /** Freehand stabilizer strength, 0 (off) to MAX_SMOOTHING. */
  smoothing: number;
  /** Rectangles, ellipses and closed polylines are filled (true) or outlined (false). */
  shapeFill: boolean;
  /** Texture brush pattern and Stamp symbol. */
  texture: TextureId;
  stamp: GlyphId;
  /** Symbol height in meters for the texture brush and stamps. */
  glyphSize: number;
  /** Defaults for new labels: letter height (m), rotation (degrees), curve (-100..100). */
  labelSize: number;
  labelRotation: number;
  labelCurve: number;
  /** Paper look: grain texture, darkened edges, sepia ink. Display only. */
  paperGrain: boolean;
  agedEdges: boolean;
  sepia: boolean;
  /** Style and diameter (m) for a newly placed compass rose. */
  compassStyle: CompassStyle;
  compassSize: number;
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
  shapeFill: false,
  lineStyle: 'solid',
  smoothing: 0,
  texture: 'forest',
  stamp: 'tree',
  glyphSize: 16,
  paperGrain: true,
  agedEdges: true,
  sepia: false,
  compassStyle: 'ornate',
  compassSize: 150,
  labelSize: 20,
  labelRotation: 0,
  labelCurve: 0,
  gridSize: 25,
  showGrid: true,
};

export const MIN_SIZE = 1;
export const MAX_SIZE = 200;
export const MAX_SMOOTHING = 10;
export const MIN_GLYPH_SIZE = 4;
export const MAX_GLYPH_SIZE = 200;
/** Restyling a selected label becomes one undo step once the controls are idle this long (ms). */
const LABEL_EDIT_IDLE_MS = 500;

export class App {
  readonly camera = new Camera();
  readonly layers = new LayerStack();
  readonly labels = new LabelStore();
  readonly compass = new CompassStore();
  readonly history = new History(() => this.layers.active.tiles, this.labels, this.compass);
  readonly renderer: Renderer;
  readonly tools: { [K in ToolId]: Tool };
  readonly eyedropper: EyedropperTool;

  state: AppState = { ...DEFAULT_STATE };
  cursor: Cursor | null = null;
  /** The label the Select/Text tools are working on. */
  selectedLabel: string | null = null;
  /** The label whose text is open in the editor (hidden on the map meanwhile). */
  editingLabel: string | null = null;

  private stateListeners = new Set<() => void>();
  private noticeListeners = new Set<(msg: string) => void>();
  private viewListeners = new Set<() => void>();
  private pan: { id: number; x: number; y: number } | null = null;
  private drawingId: number | null = null;
  private spaceDown = false;
  /** A selected label's state before the current run of restyling. */
  private labelEditBefore: Label | null = null;
  private labelEditTimer = 0;
  /** The compass before the current run of restyling/moving. */
  private compassEditBefore: Compass | null | undefined = undefined;
  private compassEditTimer = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas, this);
    this.eyedropper = new EyedropperTool(this);
    const labelEditor = new LabelEditor(this);
    this.tools = {
      pencil: new StrokeTool(this, 'pencil'),
      brush: new StrokeTool(this, 'brush'),
      eraser: new StrokeTool(this, 'eraser'),
      fill: new FillTool(this),
      eyedropper: this.eyedropper,
      line: new ShapeTool(this, 'line'),
      polyline: new ShapeTool(this, 'polyline'),
      rect: new ShapeTool(this, 'rect'),
      ellipse: new ShapeTool(this, 'ellipse'),
      texture: new TextureTool(this),
      stamp: new StampTool(this),
      compass: new CompassTool(this),
      text: new LabelTool(this, 'text', labelEditor),
      select: new LabelTool(this, 'select', labelEditor),
    };
    this.layers.onTiles(() => this.requestRender());
    this.layers.onChange(() => this.requestRender());
    this.compass.onChange(() => this.requestRender());
    this.labels.onChange(() => {
      // Undo can remove the selected label.
      if (this.selectedLabel && !this.labels.get(this.selectedLabel)) this.selectLabel(null);
      this.requestRender();
    });
    this.bindInput();

    const stage = canvas.parentElement!;
    new ResizeObserver(() => this.renderer.resize(stage.clientWidth, stage.clientHeight)).observe(stage);
  }

  get tool(): Tool {
    return this.tools[this.state.tool];
  }

  get selected(): Label | undefined {
    return this.selectedLabel ? this.labels.get(this.selectedLabel) : undefined;
  }

  get isLabelTool(): boolean {
    return this.state.tool === 'text' || this.state.tool === 'select';
  }

  /** Restyle the selected label live; the change is recorded for undo once the controls go idle. */
  editLabel(patch: Partial<Pick<Label, 'size' | 'color' | 'rotation' | 'curve'>>): void {
    const label = this.selected;
    if (!label) return;
    this.labelEditBefore ??= { ...label };
    this.labels.put({ ...label, ...patch });
    clearTimeout(this.labelEditTimer);
    this.labelEditTimer = window.setTimeout(() => this.flushLabelEdit(), LABEL_EDIT_IDLE_MS);
  }

  /** Change the compass live; recorded for undo once changes go idle (or on flush). */
  editCompass(patch: Partial<Compass>): void {
    const c = this.compass.get();
    if (!c) return;
    if (this.compassEditBefore === undefined) this.compassEditBefore = c;
    this.compass.set({ ...c, ...patch });
    clearTimeout(this.compassEditTimer);
    this.compassEditTimer = window.setTimeout(() => this.flushCompassEdit(), LABEL_EDIT_IDLE_MS);
  }

  flushCompassEdit(): void {
    clearTimeout(this.compassEditTimer);
    if (this.compassEditBefore === undefined) return;
    const before = this.compassEditBefore;
    this.compassEditBefore = undefined;
    this.history.recordCompass(before, this.compass.get());
  }

  /** Place, replace or remove the compass as one undo step. */
  setCompass(c: Compass | null): void {
    this.flushCompassEdit();
    const before = this.compass.get();
    this.compass.set(c);
    this.history.recordCompass(before, c);
  }

  /** Record any pending label restyle as an undo step now. */
  flushLabelEdit(): void {
    clearTimeout(this.labelEditTimer);
    const before = this.labelEditBefore;
    if (!before) return;
    this.labelEditBefore = null;
    this.history.recordLabels({ before, after: this.labels.get(before.id) ?? null });
  }

  selectLabel(id: string | null): void {
    if (id === this.selectedLabel) return;
    this.flushLabelEdit();
    this.selectedLabel = id;
    for (const fn of this.stateListeners) fn();
    this.requestRender();
  }

  /** Labels can be selected and edited when their layer is shown and unlocked. */
  isLabelEditable(label: Label): boolean {
    const layer = this.layers.get(label.layer);
    return layer.visible && !layer.locked;
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
    if (patch.tool && patch.tool !== this.state.tool) this.tool.deactivate?.();
    // Picking a color while a label is selected recolors it; likewise the compass with the Compass tool.
    if (patch.color && this.isLabelTool && this.selected) this.editLabel({ color: patch.color });
    if (patch.color && this.state.tool === 'compass' && this.compass.get()) this.editCompass({ color: patch.color });
    if (patch.smoothing !== undefined) patch.smoothing = Math.round(Math.min(MAX_SMOOTHING, Math.max(0, patch.smoothing)));
    if (patch.glyphSize !== undefined) patch.glyphSize = Math.round(Math.min(MAX_GLYPH_SIZE, Math.max(MIN_GLYPH_SIZE, patch.glyphSize)));
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
    if (this.isDrawing || this.tool.undoStep?.()) return;
    this.flushLabelEdit();
    this.flushCompassEdit();
    this.history.undo();
  }

  redo(): void {
    if (this.isDrawing || this.tool.hasPending?.()) return;
    this.flushLabelEdit();
    this.flushCompassEdit();
    this.history.redo();
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
    this.tool.deactivate?.();
    this.selectLabel(null);
    this.labelEditBefore = null;
    clearTimeout(this.compassEditTimer);
    this.compassEditBefore = undefined;
    this.compass.set(null);
    this.layers.reset();
    this.labels.clear();
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
      } else if (!this.pan && !this.isDrawing) {
        this.tool.onHover?.(this.toolEvent(e));
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
