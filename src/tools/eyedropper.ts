import type { App } from '../app';
import { TILE_SIZE } from '../core/constants';
import { tileIndex } from '../core/layer';
import { rgbToHex } from '../core/paint';
import { strokeTwoTone, type Cursor, type Tool, type ToolEvent } from './tool';

export class EyedropperTool implements Tool {
  readonly id = 'eyedropper';

  constructor(private app: App) {}

  /**
   * Pick the painted color under the pointer from the topmost visible layer
   * that has paint there. Unpainted parchment is ignored.
   */
  pick(e: ToolEvent): void {
    const px = Math.floor(e.wx);
    const py = Math.floor(e.wy);
    const layers = this.app.layers.all;
    for (let i = layers.length - 1; i >= 0; i--) {
      if (!layers[i].visible) continue;
      const tile = layers[i].tiles.get(tileIndex(px), tileIndex(py));
      if (!tile) continue;
      const [r, g, b, a] = tile.ctx.getImageData(px - tile.tx * TILE_SIZE, py - tile.ty * TILE_SIZE, 1, 1).data;
      if (a > 0) {
        this.app.update({ color: rgbToHex(r, g, b) });
        return;
      }
    }
  }

  onDown(e: ToolEvent): void {
    this.pick(e);
  }

  onMove(e: ToolEvent): void {
    this.pick(e);
  }

  onUp(): void {}

  drawOverlay(ctx: CanvasRenderingContext2D, cursor: Cursor | null): void {
    if (!cursor) return;
    const p = new Path2D();
    p.arc(cursor.sx, cursor.sy, 7, 0, Math.PI * 2);
    strokeTwoTone(ctx, p);
    ctx.fillStyle = this.app.state.color;
    ctx.beginPath();
    ctx.arc(cursor.sx, cursor.sy, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}
