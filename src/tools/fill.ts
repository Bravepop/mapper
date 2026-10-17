import type { App } from '../app';
import { PAINT_LIMIT, TILE_SIZE } from '../core/constants';
import { hexToRgb } from '../core/paint';
import { strokeTwoTone, type Cursor, type Tool, type ToolEvent } from './tool';

/** Maximum distance (m) a fill can spread from the click, to keep it fast on a huge empty world. */
const MAX_REACH = 1024;

interface Mask {
  mask: Uint8Array;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Paint-bucket fill. The area searched is the visible part of the map (capped
 * at MAX_REACH from the click), so filling an open, unpainted area stops at the
 * screen edge instead of flooding the whole world.
 */
export class FillTool implements Tool {
  readonly id = 'fill';

  constructor(private app: App) {}

  onDown(e: ToolEvent): void {
    const { camera, layer, history, state } = this.app;
    const px = Math.floor(e.wx);
    const py = Math.floor(e.wy);
    const view = camera.visibleRect();
    const x0 = Math.max(Math.floor(view.x0), px - MAX_REACH, -PAINT_LIMIT);
    const y0 = Math.max(Math.floor(view.y0), py - MAX_REACH, -PAINT_LIMIT);
    const x1 = Math.min(Math.ceil(view.x1), px + MAX_REACH, PAINT_LIMIT);
    const y1 = Math.min(Math.ceil(view.y1), py + MAX_REACH, PAINT_LIMIT);
    if (px < x0 || px >= x1 || py < y0 || py >= y1) return;
    const w = x1 - x0;
    const h = y1 - y0;

    // Composite the existing tiles into one region image.
    const region = document.createElement('canvas');
    region.width = w;
    region.height = h;
    const rctx = region.getContext('2d', { willReadFrequently: true })!;
    const tx0 = Math.floor(x0 / TILE_SIZE);
    const tx1 = Math.floor((x1 - 1) / TILE_SIZE);
    const ty0 = Math.floor(y0 / TILE_SIZE);
    const ty1 = Math.floor((y1 - 1) / TILE_SIZE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const tile = layer.get(tx, ty);
        if (tile) rctx.drawImage(tile.canvas, tx * TILE_SIZE - x0, ty * TILE_SIZE - y0);
      }
    }
    const pixels = rctx.getImageData(0, 0, w, h).data;
    const [fr, fg, fb] = hexToRgb(state.color);

    const start = ((py - y0) * w + (px - x0)) * 4;
    if (pixels[start + 3] === 255 && pixels[start] === fr && pixels[start + 1] === fg && pixels[start + 2] === fb) return;

    const m = floodMask(pixels, w, h, px - x0, py - y0, state.tolerance);

    // Write the fill color into every tile the mask covers.
    const edit = history.begin();
    for (let ty = Math.floor((m.minY + y0) / TILE_SIZE); ty <= Math.floor((m.maxY + y0) / TILE_SIZE); ty++) {
      for (let tx = Math.floor((m.minX + x0) / TILE_SIZE); tx <= Math.floor((m.maxX + x0) / TILE_SIZE); tx++) {
        const ox = tx * TILE_SIZE - x0;
        const oy = ty * TILE_SIZE - y0;
        const ax = Math.max(0, ox, m.minX);
        const ay = Math.max(0, oy, m.minY);
        const bx = Math.min(ox + TILE_SIZE - 1, m.maxX);
        const by = Math.min(oy + TILE_SIZE - 1, m.maxY);
        if (!anyMasked(m.mask, w, ax, ay, bx, by)) continue;

        const tile = edit.touch(tx, ty);
        const img = tile.ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
        const d = img.data;
        for (let y = ay; y <= by; y++) {
          for (let x = ax; x <= bx; x++) {
            if (!m.mask[y * w + x]) continue;
            const i = ((y - oy) * TILE_SIZE + (x - ox)) * 4;
            d[i] = fr;
            d[i + 1] = fg;
            d[i + 2] = fb;
            d[i + 3] = 255;
          }
        }
        tile.ctx.putImageData(img, 0, 0);
      }
    }
    history.commit(edit);
    this.app.requestRender();
  }

  onMove(): void {}
  onUp(): void {}

  drawOverlay(ctx: CanvasRenderingContext2D, cursor: Cursor): void {
    // A small bucket-ish marker: a diamond at the hotspot.
    const p = new Path2D();
    const { sx: x, sy: y } = cursor;
    p.moveTo(x, y - 6);
    p.lineTo(x + 6, y);
    p.lineTo(x, y + 6);
    p.lineTo(x - 6, y);
    p.closePath();
    strokeTwoTone(ctx, p);
  }
}

function anyMasked(mask: Uint8Array, w: number, ax: number, ay: number, bx: number, by: number): boolean {
  for (let y = ay; y <= by; y++) {
    for (let x = ax; x <= bx; x++) if (mask[y * w + x]) return true;
  }
  return false;
}

/** Scanline flood fill. Returns a mask of the filled pixels and its bounding box. */
function floodMask(d: Uint8ClampedArray, w: number, h: number, sx: number, sy: number, tol: number): Mask {
  const s = (sy * w + sx) * 4;
  const tr = d[s];
  const tg = d[s + 1];
  const tb = d[s + 2];
  const ta = d[s + 3];
  const mask = new Uint8Array(w * h);

  const matches = (idx: number): boolean => {
    const i = idx * 4;
    const a = d[i + 3];
    // Any two fully transparent pixels count as the same "unpainted" color.
    if (ta === 0 && a === 0) return true;
    return (
      Math.abs(a - ta) <= tol &&
      Math.abs(d[i] - tr) <= tol &&
      Math.abs(d[i + 1] - tg) <= tol &&
      Math.abs(d[i + 2] - tb) <= tol
    );
  };
  const open = (idx: number) => !mask[idx] && matches(idx);

  let minX = sx;
  let maxX = sx;
  let minY = sy;
  let maxY = sy;
  const stack: number[] = [sx, sy];
  while (stack.length) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    const row = y * w;
    if (!open(row + x)) continue;

    let lx = x;
    while (lx > 0 && open(row + lx - 1)) lx--;
    let rx = x;
    while (rx < w - 1 && open(row + rx + 1)) rx++;
    mask.fill(1, row + lx, row + rx + 1);
    if (lx < minX) minX = lx;
    if (rx > maxX) maxX = rx;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;

    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= h) continue;
      const nrow = ny * w;
      let inSpan = false;
      for (let i = lx; i <= rx; i++) {
        if (open(nrow + i)) {
          if (!inSpan) {
            stack.push(i, ny);
            inSpan = true;
          }
        } else {
          inSpan = false;
        }
      }
    }
  }
  return { mask, minX, minY, maxX, maxY };
}
