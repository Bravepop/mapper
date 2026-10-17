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

export interface Point {
  x: number;
  y: number;
}

export type LineStyle = 'solid' | 'dashed' | 'dotted';

/**
 * Paints a path as a chain of stamps, in a solid, dashed or dotted style.
 * The dash pattern carries on across segments (and across pointer events
 * during a freehand stroke), so corners and slow strokes look even.
 */
export class PathPainter {
  /** Distance travelled along the path so far, in meters. */
  private dist = 0;
  private last: Point | null = null;
  /** Dashed: length of each dash. */
  private on = 0;
  /** Dashed: length of one dash + gap. Dotted: spacing between dots. */
  private period = 0;

  constructor(
    private edit: Edit,
    private r: number,
    private color: string | null,
    private style: LineStyle = 'solid',
  ) {
    const w = 2 * r + 1;
    if (style === 'dashed') {
      this.on = 4 * w + 2;
      this.period = this.on + 3 * w + 1;
    } else if (style === 'dotted') {
      this.period = Math.max(3, 2.5 * w);
    }
  }

  /** Start a new run of the path at (x, y), stamping it. */
  moveTo(x: number, y: number): void {
    this.last = { x, y };
    this.dist = 0;
    stamp(this.edit, x, y, this.r, this.color);
  }

  lineTo(x: number, y: number): void {
    const a = this.last;
    if (!a) return this.moveTo(x, y);
    const len = Math.hypot(x - a.x, y - a.y);
    this.last = { x, y };
    if (len === 0) return;
    const at = (d: number) => stamp(this.edit, a.x + ((x - a.x) * d) / len, a.y + ((y - a.y) * d) / len, this.r, this.color);

    if (this.style === 'dotted') {
      // One dot at every multiple of the spacing along the path.
      const first = Math.floor(this.dist / this.period + 1) * this.period - this.dist;
      for (let d = first; d <= len; d += this.period) at(d);
    } else {
      // Stamps close enough together to form a continuous line; dashed skips the gaps.
      const step = Math.max(1, this.r / 4);
      const n = Math.max(1, Math.ceil(len / step));
      for (let i = 1; i <= n; i++) {
        const d = (len * i) / n;
        if (this.style === 'solid' || (this.dist + d) % this.period < this.on) at(d);
      }
    }
    this.dist += len;
  }
}

/** Paint along a chain of points (closing it back to the start if `closed`). */
export function strokePath(
  edit: Edit,
  pts: Point[],
  r: number,
  color: string | null,
  closed = false,
  style: LineStyle = 'solid',
): void {
  if (pts.length === 0) return;
  const painter = new PathPainter(edit, r, color, style);
  painter.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) painter.lineTo(pts[i].x, pts[i].y);
  if (closed && pts.length > 2) painter.lineTo(pts[0].x, pts[0].y);
}

/** Paint pixels x0..x1 (inclusive) of row y, across however many tiles that spans. */
function fillRow(edit: Edit, y: number, x0: number, x1: number, color: string): void {
  if (Math.abs(y) > PAINT_LIMIT) return;
  x0 = Math.max(x0, -PAINT_LIMIT);
  x1 = Math.min(x1, PAINT_LIMIT);
  if (x1 < x0) return;
  const ty = tileIndex(y);
  const py = y - ty * TILE_SIZE;
  for (let tx = tileIndex(x0); tx <= tileIndex(x1); tx++) {
    const ox = tx * TILE_SIZE;
    const a = Math.max(x0, ox);
    const b = Math.min(x1, ox + TILE_SIZE - 1);
    const ctx = edit.touch(tx, ty).ctx;
    ctx.fillStyle = color;
    ctx.fillRect(a - ox, py, b - a + 1, 1);
  }
}

/**
 * Fill a polygon hard-edged (even-odd rule): a pixel is painted when its
 * center is inside. Like the brush, there's no anti-aliasing.
 */
export function fillPolygon(edit: Edit, pts: Point[], color: string): void {
  if (pts.length < 3) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const xs: number[] = [];
  for (let py = Math.floor(minY); py <= Math.floor(maxY); py++) {
    const yc = py + 0.5;
    xs.length = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if ((a.y <= yc && yc < b.y) || (b.y <= yc && yc < a.y)) xs.push(a.x + ((yc - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) fillRow(edit, py, Math.ceil(xs[i] - 0.5), Math.floor(xs[i + 1] - 0.5), color);
  }
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}
