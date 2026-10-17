import type { App } from '../app';
import type { Camera } from '../core/camera';
import { inkGlyph } from '../core/ink';
import { MIN_LABEL_SIZE, newLabelId } from '../core/labels';
import { drawGlyph, inkWidth, seededRandom } from '../valheim/glyphs';
import type { LabelEditor } from './label';
import type { Cursor, Tool, ToolEvent } from './tool';

const newSeed = () => Math.floor(Math.random() * 2 ** 32);

/**
 * Click to ink one symbol (tree, rock, cave, portal, crypt…) centered on the
 * pointer, in the current color and at the Size setting. A ghost of the exact
 * symbol (same hand-drawn wobble) follows the pointer.
 *
 * With "Add a label" on, a text box opens under the symbol for a name or note
 * (a portal tag, "iron here"); the symbol and its label are one undo step.
 * Leaving the box empty or pressing Esc keeps just the symbol.
 */
export class StampTool implements Tool {
  readonly id = 'stamp';
  /** Wobble seed for the next stamp, shared by the preview and the real thing. */
  private seed = newSeed();

  constructor(
    private app: App,
    private editor: LabelEditor,
  ) {}

  onDown(e: ToolEvent): void {
    if (!this.app.canPaint()) return;
    const { stamp, glyphSize, color, stampLabel } = this.app.state;
    const { history } = this.app;
    const edit = history.begin();
    inkGlyph(edit, stamp, e.wx, e.wy, glyphSize, inkWidth(glyphSize), color, seededRandom(this.seed));
    this.seed = newSeed();
    this.app.requestRender();
    if (!stampLabel) {
      history.commit(edit);
      return;
    }
    // Lettering in proportion to the symbol, just below it.
    const labelSize = Math.max(MIN_LABEL_SIZE, Math.round(glyphSize * 0.6));
    const label = {
      id: newLabelId(),
      layer: this.app.activeLayer.id,
      text: '',
      x: e.wx,
      y: e.wy + glyphSize * 0.55 + labelSize * 0.6,
      size: labelSize,
      color,
      rotation: 0,
      curve: 0,
    };
    this.editor.open(label, true, (l) => (l ? history.commit(edit, { before: null, after: l }) : history.commit(edit)));
  }

  deactivate(): void {
    this.editor.commit();
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
