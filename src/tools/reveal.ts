import type { App } from '../app';
import type { Camera } from '../core/camera';
import type { Edit } from '../core/history';
import { PathPainter } from '../core/paint';
import { strokeTwoTone, type Cursor, type Tool, type ToolEvent } from './tool';

/**
 * Fog of war: paint to reveal explored land (or, in Hide mode, to fog it
 * again). It paints into the separate fog mask, never into the map layers,
 * and only shows when Fog of war is switched on.
 */
export class RevealTool implements Tool {
  readonly id = 'reveal';
  private edit: Edit | null = null;
  private painter: PathPainter | null = null;

  constructor(private app: App) {}

  private get radius(): number {
    return Math.floor(this.app.state.revealSize / 2);
  }

  onDown(e: ToolEvent): void {
    if (!this.app.state.fog) this.app.notice('Fog of war is off. Turn it on in the Paper panel to see what you reveal.');
    this.edit = this.app.history.begin(this.app.fog);
    // Any opaque color marks "revealed"; erasing (null) fogs it again.
    this.painter = new PathPainter(this.edit, this.radius, this.app.state.revealMode === 'reveal' ? '#000000' : null);
    this.painter.moveTo(e.wx, e.wy);
    this.app.requestRender();
  }

  onMove(e: ToolEvent): void {
    if (!this.painter) return;
    this.painter.lineTo(e.wx, e.wy);
    this.app.requestRender();
  }

  onUp(): void {
    if (!this.edit) return;
    this.app.history.commit(this.edit);
    this.edit = null;
    this.painter = null;
  }

  drawOverlay(ctx: CanvasRenderingContext2D, cursor: Cursor | null, cam: Camera): void {
    if (!cursor) return;
    const p = new Path2D();
    const r = (this.radius + 0.5) * cam.zoom;
    if (r >= 4) p.arc(cursor.sx, cursor.sy, r, 0, Math.PI * 2);
    p.moveTo(cursor.sx - 5, cursor.sy);
    p.lineTo(cursor.sx + 5, cursor.sy);
    if (this.app.state.revealMode === 'reveal') {
      p.moveTo(cursor.sx, cursor.sy - 5);
      p.lineTo(cursor.sx, cursor.sy + 5);
    }
    strokeTwoTone(ctx, p);
  }
}
