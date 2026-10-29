import type { App } from '../app';
import type { Camera } from '../core/camera';
import { newLabelId } from '../core/labels';
import { strokePath, type Point } from '../core/paint';
import { strokeTwoTone, type Cursor, type Tool, type ToolEvent } from './tool';

export function formatLength(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 10_000 ? 1 : 2)} km` : `${Math.round(m)} m`;
}

/**
 * Drag to measure a distance against the grid. The measurement is only an
 * overlay: it stays until the next measurement, Esc or a tool change, and
 * nothing is added to the map unless you choose "Draw on map" (Enter), which
 * paints the line and adds a length label as one undo step.
 */
export class RulerTool implements Tool {
  readonly id = 'ruler';
  private a: Point | null = null;
  private b: Point | null = null;
  private dragging = false;
  private listeners = new Set<() => void>();

  constructor(private app: App) {}

  /** The finished measurement, if any. */
  get measurement(): { a: Point; b: Point; length: number } | null {
    if (!this.a || !this.b || this.dragging) return null;
    const length = Math.hypot(this.b.x - this.a.x, this.b.y - this.a.y);
    return length >= 1 ? { a: this.a, b: this.b, length } : null;
  }

  /** Fires when a measurement appears or goes away. */
  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  onDown(e: ToolEvent): void {
    this.a = { x: e.wx, y: e.wy };
    this.b = this.a;
    this.dragging = true;
    this.emit();
  }

  onMove(e: ToolEvent): void {
    if (!this.dragging || !this.a) return;
    this.b = snap(this.a, { x: e.wx, y: e.wy }, e.shiftKey);
    this.app.requestRender();
  }

  onUp(): void {
    this.dragging = false;
    if (!this.measurement) this.clear();
    this.emit();
  }

  onKey(e: KeyboardEvent): boolean {
    if (!this.measurement) return false;
    if (e.key === 'Escape') this.clear();
    else if (e.key === 'Enter') this.keep();
    else return false;
    return true;
  }

  deactivate(): void {
    this.clear();
  }

  /** Paint the measured line into the active layer and label it with its length. */
  keep(): void {
    const m = this.measurement;
    if (!m || !this.app.canPaint()) return;
    const { state, history } = this.app;
    const edit = history.begin();
    const center = (p: Point) => ({ x: Math.floor(p.x) + 0.5, y: Math.floor(p.y) + 0.5 });
    strokePath(edit, [center(m.a), center(m.b)], Math.floor(state.size / 2), state.color, false, state.lineStyle);

    // Label along the line, kept upright, sitting just above it.
    let angle = Math.atan2(m.b.y - m.a.y, m.b.x - m.a.x);
    if (angle > Math.PI / 2) angle -= Math.PI;
    if (angle <= -Math.PI / 2) angle += Math.PI;
    const lift = state.labelSize * 0.75 + state.size / 2;
    const label = {
      id: newLabelId(),
      layer: this.app.activeLayer.id,
      text: formatLength(m.length),
      x: (m.a.x + m.b.x) / 2 + Math.sin(angle) * lift,
      y: (m.a.y + m.b.y) / 2 - Math.cos(angle) * lift,
      size: state.labelSize,
      color: state.color,
      rotation: angle,
      curve: 0,
      font: state.labelFont,
    };
    history.commit(edit, { before: null, after: label });
    this.clear();
  }

  drawOverlay(ctx: CanvasRenderingContext2D, cursor: Cursor | null, cam: Camera): void {
    if (this.a && this.b) {
      const ax = cam.toScreenX(this.a.x);
      const ay = cam.toScreenY(this.a.y);
      const bx = cam.toScreenX(this.b.x);
      const by = cam.toScreenY(this.b.y);
      const len = Math.hypot(bx - ax, by - ay);
      const p = new Path2D();
      p.moveTo(ax, ay);
      p.lineTo(bx, by);
      if (len > 0) {
        // End ticks across the line.
        const nx = (-(by - ay) / len) * 6;
        const ny = ((bx - ax) / len) * 6;
        p.moveTo(ax - nx, ay - ny);
        p.lineTo(ax + nx, ay + ny);
        p.moveTo(bx - nx, by - ny);
        p.lineTo(bx + nx, by + ny);
      }
      strokeTwoTone(ctx, p);

      const meters = Math.hypot(this.b.x - this.a.x, this.b.y - this.a.y);
      const cells = meters / this.app.state.gridSize;
      const text = `${formatLength(meters)}  ·  ${cells < 10 ? cells.toFixed(1) : Math.round(cells)} × ${this.app.state.gridSize} m`;
      ctx.font = '600 12px system-ui, sans-serif';
      const w = ctx.measureText(text).width + 12;
      const tx = (ax + bx) / 2 - w / 2;
      const ty = (ay + by) / 2 - 30;
      ctx.fillStyle = 'rgba(42, 36, 29, 0.92)';
      ctx.beginPath();
      ctx.roundRect(tx, ty, w, 20, 4);
      ctx.fill();
      ctx.fillStyle = '#ece0c6';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(text, tx + 6, ty + 10);
    }
    if (!cursor) return;
    const c = new Path2D();
    c.moveTo(cursor.sx - 7, cursor.sy);
    c.lineTo(cursor.sx + 7, cursor.sy);
    c.moveTo(cursor.sx, cursor.sy - 7);
    c.lineTo(cursor.sx, cursor.sy + 7);
    strokeTwoTone(ctx, c);
  }

  private clear(): void {
    this.a = this.b = null;
    this.dragging = false;
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
    this.app.requestRender();
  }
}

/** With Shift, snap the direction from a to b to the nearest 45°. */
function snap(a: Point, b: Point, shift: boolean): Point {
  if (!shift) return b;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const len = dx * Math.cos(angle) + dy * Math.sin(angle);
  return { x: a.x + len * Math.cos(angle), y: a.y + len * Math.sin(angle) };
}
