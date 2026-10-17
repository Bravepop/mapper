import { PAINT_LIMIT, TILE_SIZE } from './constants';
import type { Edit } from './history';
import { tileIndex } from './layer';

const spanCache = new Map<number, Int32Array>();

/** Half-widths of each row of a pixel circle of radius r, for dy = -r..r. */
function circleSpans(r: number): Int32Array {
  let spans = spanCache.get(r);
  if (!spans) {
    spans = new Int32Array(2 * r + 1);
    const rr = (r + 0.5) ** 2;
    for (let dy = -r; dy <= r; dy++) spans[dy + r] = Math.floor(Math.sqrt(Math.max(0, rr - dy * dy)));
    spanCache.set(r, spans);
  }
  return spans;
}

/**
 * Stamp a hard-edged pixel circle. Edges are not anti-aliased on purpose, so
 * the fill bucket can cleanly fill up to a drawn line, like in Paint.
 * Pass `color = null` to erase.
 */
export function stamp(edit: Edit, x: number, y: number, r: number, color: string | null): void {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (Math.abs(cx) > PAINT_LIMIT || Math.abs(cy) > PAINT_LIMIT) return;
  const spans = circleSpans(r);

  for (let ty = tileIndex(cy - r); ty <= tileIndex(cy + r); ty++) {
    for (let tx = tileIndex(cx - r); tx <= tileIndex(cx + r); tx++) {
      const tile = color ? edit.touch(tx, ty) : edit.touchExisting(tx, ty);
      if (!tile) continue;
      const ox = tx * TILE_SIZE;
      const oy = ty * TILE_SIZE;
      const ctx = tile.ctx;
      if (color) ctx.fillStyle = color;
      for (let dy = -r; dy <= r; dy++) {
        const py = cy + dy - oy;
        if (py < 0 || py >= TILE_SIZE) continue;
        const hw = spans[dy + r];
        if (color) ctx.fillRect(cx - hw - ox, py, 2 * hw + 1, 1);
        else ctx.clearRect(cx - hw - ox, py, 2 * hw + 1, 1);
      }
    }
  }
}

/** Stamp along a segment, excluding the start point (already stamped by the previous segment). */
export function strokeSegment(
  edit: Edit,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
  color: string | null,
): void {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const step = Math.max(1, r / 4);
  const n = Math.max(1, Math.ceil(dist / step));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    stamp(edit, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, color);
  }
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}
