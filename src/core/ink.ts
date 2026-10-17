import { drawGlyph, type GlyphId, type Rand } from '../valheim/glyphs';
import { PAINT_LIMIT, TILE_SIZE } from './constants';
import type { Edit } from './history';
import { tileIndex } from './layer';
import { hexToRgb } from './paint';

/** Coverage (0–255) at which an anti-aliased glyph pixel becomes solid ink. */
const INK_THRESHOLD = 90;

let scratch: CanvasRenderingContext2D | null = null;

function scratchCtx(size: number): CanvasRenderingContext2D {
  if (!scratch) {
    const canvas = document.createElement('canvas');
    scratch = canvas.getContext('2d', { willReadFrequently: true })!;
  }
  const c = scratch.canvas;
  if (c.width < size || c.height < size) {
    c.width = Math.max(c.width, size);
    c.height = Math.max(c.height, size);
  }
  scratch.setTransform(1, 0, 0, 1, 0, 0);
  scratch.clearRect(0, 0, size, size);
  return scratch;
}

/**
 * Paint an ink glyph `size` meters tall, centered on (x, y), into the edit's
 * layer. The glyph is drawn with canvas strokes, then thresholded to solid
 * pixels so it stays hard-edged like the brush and the fill bucket stops at it.
 */
export function inkGlyph(edit: Edit, glyph: GlyphId, x: number, y: number, size: number, penPx: number, color: string, rand: Rand): void {
  if (Math.abs(x) > PAINT_LIMIT || Math.abs(y) > PAINT_LIMIT) return;
  // Glyphs stay inside their unit box apart from pen width and wobble.
  const half = Math.ceil(size * 0.6 + penPx) + 1;
  const span = 2 * half;
  const ox = Math.floor(x) - half;
  const oy = Math.floor(y) - half;
  const ctx = scratchCtx(span);
  ctx.strokeStyle = ctx.fillStyle = '#000';
  drawGlyph(ctx, glyph, x - ox, y - oy, size, penPx, rand);
  const mask = ctx.getImageData(0, 0, span, span).data;
  const [r, g, b] = hexToRgb(color);

  for (let ty = tileIndex(oy); ty <= tileIndex(oy + span - 1); ty++) {
    for (let tx = tileIndex(ox); tx <= tileIndex(ox + span - 1); tx++) {
      // Overlap of the glyph box with this tile, in world pixels.
      const x0 = Math.max(ox, tx * TILE_SIZE);
      const y0 = Math.max(oy, ty * TILE_SIZE);
      const x1 = Math.min(ox + span, (tx + 1) * TILE_SIZE);
      const y1 = Math.min(oy + span, (ty + 1) * TILE_SIZE);
      let any = false;
      for (let py = y0; py < y1 && !any; py++) {
        for (let px = x0; px < x1; px++) {
          if (mask[((py - oy) * span + (px - ox)) * 4 + 3] >= INK_THRESHOLD) {
            any = true;
            break;
          }
        }
      }
      if (!any) continue;

      const tile = edit.touch(tx, ty);
      const img = tile.ctx.getImageData(x0 - tx * TILE_SIZE, y0 - ty * TILE_SIZE, x1 - x0, y1 - y0);
      const d = img.data;
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          if (mask[((py - oy) * span + (px - ox)) * 4 + 3] < INK_THRESHOLD) continue;
          const i = ((py - y0) * (x1 - x0) + (px - x0)) * 4;
          d[i] = r;
          d[i + 1] = g;
          d[i + 2] = b;
          d[i + 3] = 255;
        }
      }
      tile.ctx.putImageData(img, x0 - tx * TILE_SIZE, y0 - ty * TILE_SIZE);
    }
  }
}
