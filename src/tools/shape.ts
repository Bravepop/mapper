import type { App } from '../app';
import type { Camera } from '../core/camera';
import { fillPolygon, strokePath, type Point } from '../core/paint';
import { strokeTwoTone, type Cursor, type ShapeKind, type Tool, type ToolEvent } from './tool';

/** Two clicks this close in time (ms) and space (screen px) count as a double-click. */
const DOUBLE_CLICK_MS = 400;
const DOUBLE_CLICK_PX = 6;
/** Clicking this close (screen px) to a polyline's first point closes it. */
const CLOSE_PX = 8;

/**
 * Line, polyline, rectangle and ellipse. Shapes are previewed as vectors while
 * you draw, then rasterized hard-edged into the active layer (like the brush),
 * so the fill bucket stops cleanly at them.
 *
 * - Line / rectangle / ellipse: drag. Shift snaps lines to 45° and makes
 *   squares and circles.
 * - Polyline: click to add points; double-click or Enter finishes, clicking the
 *   first point closes it, Backspace or Ctrl+Z removes the last point, Esc
 *   cancels. Shift snaps each leg to 45°.
 */
/** The center of the pixel containing `p`. */
const center = (p: Point): Point => ({ x: Math.floor(p.x) + 0.5, y: Math.floor(p.y) + 0.5 });

export class ShapeTool implements Tool {
  /** Drag shapes: the press point. Polyline: the placed points. */
  private points: Point[] = [];
  /** Where the shape currently ends (pointer position, snapped if Shift is held). */
  private end: Point | null = null;
  private dragging = false;
  private lastDown = { t: 0, x: 0, y: 0 };

  constructor(
    private app: App,
    readonly id: ShapeKind,
  ) {}

  private get radius(): number {
    return Math.floor(this.app.state.size / 2);
  }

  /** Rectangles, ellipses and closed polylines can be filled; lines never are. */
  private get filled(): boolean {
    return this.app.state.shapeFill && this.id !== 'line';
  }

  hasPending(): boolean {
    return this.id === 'polyline' && this.points.length > 0;
  }

  onDown(e: ToolEvent): void {
    const p = { x: e.wx, y: e.wy };
    if (this.id !== 'polyline') {
      if (!this.app.canPaint()) return;
      this.points = [p];
      this.end = p;
      this.dragging = true;
      this.app.requestRender();
      return;
    }

    const cam = this.app.camera;
    const now = performance.now();
    const sx = cam.toScreenX(p.x);
    const sy = cam.toScreenY(p.y);
    const isDouble = now - this.lastDown.t < DOUBLE_CLICK_MS && Math.hypot(sx - this.lastDown.x, sy - this.lastDown.y) < DOUBLE_CLICK_PX;
    this.lastDown = { t: now, x: sx, y: sy };

    if (this.points.length === 0) {
      if (!this.app.canPaint()) return;
      this.points = [p];
    } else if (isDouble) {
      this.finish(false);
      return;
    } else {
      const first = this.points[0];
      if (this.points.length >= 3 && Math.hypot(sx - cam.toScreenX(first.x), sy - cam.toScreenY(first.y)) < CLOSE_PX) {
        this.finish(true);
        return;
      }
      this.points.push(this.snapped(e));
    }
    this.end = this.points[this.points.length - 1];
    this.app.requestRender();
  }

  onMove(e: ToolEvent): void {
    if (!this.dragging) return;
    this.end = this.snapped(e);
    this.app.requestRender();
  }

  onHover(e: ToolEvent): void {
    if (this.hasPending()) this.end = this.snapped(e);
  }

  onUp(): void {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.end) this.rasterize(this.outline(center(this.points[0]), center(this.end)), this.id !== 'line');
    this.reset();
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.key === 'Escape' && (this.dragging || this.hasPending())) {
      // A drag in progress still gets its pointerup; with no points it commits nothing.
      this.dragging = false;
      this.reset();
      return true;
    }
    if (!this.hasPending()) return false;
    if (e.key === 'Enter') this.finish(false);
    else if (e.key === 'Backspace') this.undoStep();
    else return false;
    return true;
  }

  undoStep(): boolean {
    if (!this.hasPending()) return false;
    this.points.pop();
    if (this.points.length === 0) this.reset();
    this.app.requestRender();
    return true;
  }

  deactivate(): void {
    if (this.hasPending()) this.finish(false);
  }

  drawOverlay(ctx: CanvasRenderingContext2D, cursor: Cursor | null, cam: Camera): void {
    const shape = this.previewPoints();
    if (shape) {
      const path = new Path2D();
      shape.pts.forEach((p, i) => (i ? path.lineTo : path.moveTo).call(path, cam.toScreenX(p.x), cam.toScreenY(p.y)));
      if (shape.closed) path.closePath();
      ctx.save();
      ctx.lineCap = ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = ctx.strokeStyle = this.app.state.color;
      if (this.filled && shape.closed) ctx.fill(path);
      const w = 2 * this.radius + 1;
      ctx.lineWidth = Math.max(1, w * cam.zoom);
      // Approximate the painted dash pattern (see PathPainter).
      const style = this.app.state.lineStyle;
      if (style === 'dashed') ctx.setLineDash([(4 * w + 2) * cam.zoom, (3 * w + 1) * cam.zoom]);
      else if (style === 'dotted') ctx.setLineDash([0.01, Math.max(3, 2.5 * w) * cam.zoom]);
      ctx.stroke(path);
      ctx.restore();
      if (this.id === 'polyline') this.drawVertices(ctx, cam);
    }
    if (!cursor) return;
    const c = new Path2D();
    c.moveTo(cursor.sx - 7, cursor.sy);
    c.lineTo(cursor.sx + 7, cursor.sy);
    c.moveTo(cursor.sx, cursor.sy - 7);
    c.lineTo(cursor.sx, cursor.sy + 7);
    strokeTwoTone(ctx, c);
  }

  private drawVertices(ctx: CanvasRenderingContext2D, cam: Camera): void {
    const path = new Path2D();
    for (const p of this.points) {
      const x = cam.toScreenX(p.x);
      const y = cam.toScreenY(p.y);
      path.moveTo(x + 3, y);
      path.arc(x, y, 3, 0, Math.PI * 2);
    }
    strokeTwoTone(ctx, path);
  }

  /** The shape as it would be committed right now, for the preview. */
  private previewPoints(): { pts: Point[]; closed: boolean } | null {
    if (!this.end || this.points.length === 0) return null;
    if (this.id === 'polyline') {
      const pts = [...this.points, this.end];
      return { pts, closed: this.filled && pts.length > 2 };
    }
    if (!this.dragging) return null;
    return { pts: this.outline(center(this.points[0]), center(this.end)), closed: this.id !== 'line' };
  }

  private finish(closed: boolean): void {
    const pts = this.points;
    if (pts.length >= 2) this.rasterize(pts.map(center), closed || (this.filled && pts.length > 2));
    this.reset();
  }

  private reset(): void {
    this.points = [];
    this.end = null;
    this.app.requestRender();
  }

  /**
   * Paint the outline (and the inside, if filled) into the active layer as one
   * undo step. `pts` are in pixel-center space; curve points are rounded to the
   * nearest pixel center so the fill and the outline line up exactly.
   */
  private rasterize(pts: Point[], closed: boolean): void {
    const edit = this.app.history.begin();
    const px = pts.map((p) => ({ x: Math.round(p.x - 0.5) + 0.5, y: Math.round(p.y - 0.5) + 0.5 }));
    const color = this.app.state.color;
    if (closed && this.filled) fillPolygon(edit, px, color);
    strokePath(edit, px, this.radius, color, closed, this.app.state.lineStyle);
    this.app.history.commit(edit);
    this.app.requestRender();
  }

  /** Points of a drag shape between pixel centers `a` and `b`. */
  private outline(a: Point, b: Point): Point[] {
    if (this.id === 'line') return [a, b];
    const x0 = Math.min(a.x, b.x);
    const x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const y1 = Math.max(a.y, b.y);
    if (this.id === 'rect') {
      return [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ];
    }
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const rx = (x1 - x0) / 2;
    const ry = (y1 - y0) / 2;
    // Enough points that each side is about a meter, so the outline reads as a smooth curve.
    // A multiple of 4 so the extreme points land exactly on the box edges.
    const n = 4 * Math.max(4, Math.ceil((Math.PI * (rx + ry)) / 4));
    const pts: Point[] = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      pts.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
    }
    return pts;
  }

  /** The pointer position, constrained when Shift is held. */
  private snapped(e: ToolEvent): Point {
    const p = { x: e.wx, y: e.wy };
    const from = this.id === 'polyline' ? this.points[this.points.length - 1] : this.points[0];
    if (!e.shiftKey || !from) return p;
    const dx = p.x - from.x;
    const dy = p.y - from.y;
    if (this.id === 'rect' || this.id === 'ellipse') {
      // Square / circle.
      const s = Math.max(Math.abs(dx), Math.abs(dy));
      return { x: from.x + Math.sign(dx || 1) * s, y: from.y + Math.sign(dy || 1) * s };
    }
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const len = dx * Math.cos(angle) + dy * Math.sin(angle);
    return { x: from.x + len * Math.cos(angle), y: from.y + len * Math.sin(angle) };
  }
}
