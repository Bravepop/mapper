import type { App } from '../app';
import type { Camera } from '../core/camera';
import type { Edit } from '../core/history';
import { stamp, strokeSegment } from '../core/paint';
import { strokeTwoTone, type Cursor, type Tool, type ToolEvent } from './tool';

type Mode = 'pencil' | 'brush' | 'eraser';

/** Pencil (1 m hard line), brush (sized), and eraser all paint by stamping circles. */
export class StrokeTool implements Tool {
  private edit: Edit | null = null;
  /** Last painted point; kept between strokes so Shift+click draws a straight line from it. */
  private last: { x: number; y: number } | null = null;

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

  onDown(e: ToolEvent): void {
    if (!this.app.canPaint()) return;
    this.edit = this.app.history.begin();
    if (e.shiftKey && this.last) {
      strokeSegment(this.edit, this.last.x, this.last.y, e.wx, e.wy, this.radius, this.color);
    } else {
      stamp(this.edit, e.wx, e.wy, this.radius, this.color);
    }
    this.last = { x: e.wx, y: e.wy };
    this.app.requestRender();
  }

  onMove(e: ToolEvent): void {
    if (!this.edit || !this.last) return;
    strokeSegment(this.edit, this.last.x, this.last.y, e.wx, e.wy, this.radius, this.color);
    this.last = { x: e.wx, y: e.wy };
    this.app.requestRender();
  }

  onUp(): void {
    if (!this.edit) return;
    this.app.history.commit(this.edit);
    this.edit = null;
  }

  drawOverlay(ctx: CanvasRenderingContext2D, cursor: Cursor, cam: Camera): void {
    const cx = cam.toScreenX(Math.floor(cursor.wx) + 0.5);
    const cy = cam.toScreenY(Math.floor(cursor.wy) + 0.5);
    const path = new Path2D();
    const radiusPx = (this.radius + 0.5) * cam.zoom;
    if (radiusPx >= 4) {
      if (this.id === 'pencil') path.rect(cx - radiusPx, cy - radiusPx, radiusPx * 2, radiusPx * 2);
      else path.arc(cx, cy, radiusPx, 0, Math.PI * 2);
    } else {
      // Too small to see: draw crosshairs instead.
      path.moveTo(cursor.sx - 6, cursor.sy);
      path.lineTo(cursor.sx + 6, cursor.sy);
      path.moveTo(cursor.sx, cursor.sy - 6);
      path.lineTo(cursor.sx, cursor.sy + 6);
    }
    strokeTwoTone(ctx, path);
  }
}
