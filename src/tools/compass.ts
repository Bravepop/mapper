import type { App } from '../app';
import type { Camera } from '../core/camera';
import { drawCompass, hitCompass } from '../render/compass';
import { strokeTwoTone, type Cursor, type Tool, type ToolEvent } from './tool';

/**
 * Place the map's compass rose: click to put it down (or move it there),
 * drag it to adjust, Delete to remove it. While this tool is active the top
 * bar controls and the color palette restyle it.
 */
export class CompassTool implements Tool {
  readonly id = 'compass';
  private drag: { ox: number; oy: number } | null = null;

  constructor(private app: App) {}

  onDown(e: ToolEvent): void {
    const c = this.app.compass.get();
    if (c && hitCompass(c, e.wx, e.wy)) {
      this.drag = { ox: e.wx - c.x, oy: e.wy - c.y };
      return;
    }
    const s = this.app.state;
    this.app.setCompass(
      c ? { ...c, x: e.wx, y: e.wy } : { x: e.wx, y: e.wy, size: s.compassSize, color: s.color, style: s.compassStyle },
    );
  }

  onMove(e: ToolEvent): void {
    if (!this.drag) return;
    this.app.editCompass({ x: e.wx - this.drag.ox, y: e.wy - this.drag.oy });
  }

  onUp(): void {
    if (!this.drag) return;
    this.drag = null;
    this.app.flushCompassEdit();
  }

  onKey(e: KeyboardEvent): boolean {
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.app.compass.get()) {
      this.app.setCompass(null);
      return true;
    }
    return false;
  }

  drawOverlay(ctx: CanvasRenderingContext2D, cursor: Cursor | null, cam: Camera): void {
    const c = this.app.compass.get();
    if (c) {
      // Mark the placed compass as the thing this tool works on.
      const p = new Path2D();
      p.arc(cam.toScreenX(c.x), cam.toScreenY(c.y), c.size * 0.6 * cam.zoom, 0, Math.PI * 2);
      ctx.save();
      ctx.setLineDash([5, 4]);
      strokeTwoTone(ctx, p);
      ctx.restore();
    }
    if (!cursor) return;
    if (!c) {
      // Ghost of the rose that a click will place.
      const s = this.app.state;
      ctx.save();
      ctx.globalAlpha = 0.45;
      drawCompass(ctx, { x: cursor.wx, y: cursor.wy, size: s.compassSize, color: s.color, style: s.compassStyle }, cam);
      ctx.restore();
    }
    const p = new Path2D();
    p.moveTo(cursor.sx - 6, cursor.sy);
    p.lineTo(cursor.sx + 6, cursor.sy);
    p.moveTo(cursor.sx, cursor.sy - 6);
    p.lineTo(cursor.sx, cursor.sy + 6);
    strokeTwoTone(ctx, p);
  }
}
