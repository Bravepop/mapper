import type { App } from '../app';
import type { Camera } from '../core/camera';
import type { Edit } from '../core/history';
import { PathPainter, type LineStyle, type Point } from '../core/paint';
import { strokeTwoTone, type Cursor, type Tool, type ToolEvent } from './tool';

type Mode = 'pencil' | 'brush' | 'eraser';

/** Screen pixels of stabilizer "string" per step of the Smoothing setting. */
export const SMOOTHING_PX_PER_STEP = 6;

/**
 * Pencil (1 m hard line), brush (sized), and eraser all paint by stamping
 * circles. Pencil and brush can draw dashed or dotted lines.
 *
 * With Smoothing on, the paint point trails the pointer on a string: it only
 * moves once the pointer pulls the string tight, which irons out hand wobble.
 * When the button is released the line catches up to the pointer.
 */
export class StrokeTool implements Tool {
  private edit: Edit | null = null;
  private painter: PathPainter | null = null;
  /** Last painted point; kept between strokes so Shift+click draws a straight line from it. */
  private last: Point | null = null;
  /** Where the pointer is during a stroke (the paint point trails it when smoothing). */
  private pointer: Point | null = null;

  constructor(
    private app: App,
    readonly id: Mode,
  ) {}

  private get radius(): number {
    return this.id === 'pencil' ? 0 : Math.floor(this.app.state.size / 2);
  }

  private get color(): string | null {
    return this.id === 'eraser' ? null : this.app.state.color;
  }

  private get style(): LineStyle {
    return this.id === 'eraser' ? 'solid' : this.app.state.lineStyle;
  }

  /** Stabilizer string length in meters at the current zoom; 0 when smoothing is off. */
  private get stringLength(): number {
    return (this.app.state.smoothing * SMOOTHING_PX_PER_STEP) / this.app.camera.zoom;
  }

  onDown(e: ToolEvent): void {
    if (!this.app.canPaint()) return;
    this.edit = this.app.history.begin();
    this.painter = new PathPainter(this.edit, this.radius, this.color, this.style);
    if (e.shiftKey && this.last) {
      this.painter.moveTo(this.last.x, this.last.y);
      this.painter.lineTo(e.wx, e.wy);
    } else {
      this.painter.moveTo(e.wx, e.wy);
    }
    this.last = { x: e.wx, y: e.wy };
    this.pointer = { x: e.wx, y: e.wy };
    this.app.requestRender();
  }

  onMove(e: ToolEvent): void {
    if (!this.painter || !this.last) return;
    this.pointer = { x: e.wx, y: e.wy };
    const dx = e.wx - this.last.x;
    const dy = e.wy - this.last.y;
    const d = Math.hypot(dx, dy);
    const slack = this.stringLength;
    if (d <= slack) return;
    // Pull the paint point toward the pointer until the string is just tight.
    const k = (d - slack) / d;
    this.last = { x: this.last.x + dx * k, y: this.last.y + dy * k };
    this.painter.lineTo(this.last.x, this.last.y);
    this.app.requestRender();
  }

  onUp(): void {
    if (!this.edit || !this.painter) return;
    if (this.pointer && this.last && this.stringLength > 0) {
      this.painter.lineTo(this.pointer.x, this.pointer.y);
      this.last = this.pointer;
    }
    this.app.history.commit(this.edit);
    this.edit = null;
    this.painter = null;
    this.pointer = null;
  }

  drawOverlay(ctx: CanvasRenderingContext2D, cursor: Cursor | null, cam: Camera): void {
    if (!cursor) return;
    // While smoothing a stroke, the brush outline sits on the paint point with a string to the pointer.
    const smoothing = this.painter && this.last && this.stringLength > 0;
    const at = smoothing ? this.last! : { x: cursor.wx, y: cursor.wy };
    const cx = cam.toScreenX(Math.floor(at.x) + 0.5);
    const cy = cam.toScreenY(Math.floor(at.y) + 0.5);
    const path = new Path2D();
    if (smoothing) {
      path.moveTo(cx, cy);
      path.lineTo(cursor.sx, cursor.sy);
    }
    const radiusPx = (this.radius + 0.5) * cam.zoom;
    if (radiusPx >= 4) {
      if (this.id === 'pencil') path.rect(cx - radiusPx, cy - radiusPx, radiusPx * 2, radiusPx * 2);
      else {
        path.moveTo(cx + radiusPx, cy);
        path.arc(cx, cy, radiusPx, 0, Math.PI * 2);
      }
    } else {
      // Too small to see: draw crosshairs instead.
      path.moveTo(cx - 6, cy);
      path.lineTo(cx + 6, cy);
      path.moveTo(cx, cy - 6);
      path.lineTo(cx, cy + 6);
    }
    strokeTwoTone(ctx, path);
  }
}
