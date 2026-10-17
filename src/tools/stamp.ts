import type { App } from '../app';
import type { Camera } from '../core/camera';
import { inkGlyph } from '../core/ink';
import { drawGlyph, inkWidth, seededRandom } from '../valheim/glyphs';
import type { Cursor, Tool, ToolEvent } from './tool';

const newSeed = () => Math.floor(Math.random() * 2 ** 32);

/**
 * Click to ink one symbol (tree, rock, cave, tower, ship, skull…) centered on
 * the pointer, in the current color and at the Size setting. A ghost of the
 * exact symbol (same hand-drawn wobble) follows the pointer.
 */
export class StampTool implements Tool {
  readonly id = 'stamp';
  /** Wobble seed for the next stamp, shared by the preview and the real thing. */
  private seed = newSeed();

  constructor(private app: App) {}

  onDown(e: ToolEvent): void {
    if (!this.app.canPaint()) return;
    const { stamp, glyphSize, color } = this.app.state;
    const edit = this.app.history.begin();
    inkGlyph(edit, stamp, e.wx, e.wy, glyphSize, inkWidth(glyphSize), color, seededRandom(this.seed));
    this.app.history.commit(edit);
    this.seed = newSeed();
    this.app.requestRender();
  }

  onMove(): void {}
  onUp(): void {}

  drawOverlay(ctx: CanvasRenderingContext2D, cursor: Cursor | null, cam: Camera): void {
    if (!cursor) return;
    const { stamp, glyphSize, color } = this.app.state;
    const px = glyphSize * cam.zoom;
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = ctx.fillStyle = color;
    drawGlyph(ctx, stamp, cursor.sx, cursor.sy, Math.max(px, 12), Math.max(1, inkWidth(glyphSize) * cam.zoom), seededRandom(this.seed));
    ctx.restore();
  }
}
