import { TILE_SIZE } from '../core/constants';

const PIXELS = TILE_SIZE * TILE_SIZE;

/**
 * The pixels of a tile that changed, as runs of consecutive pixel indexes plus
 * their new RGBA values, in one buffer:
 *   [u32 runCount][u32 start, u32 length]×runCount [u8 r,g,b,a]×(sum of lengths)
 */
export function encodeDiff(before: Uint8ClampedArray | null, after: Uint8ClampedArray): ArrayBuffer | null {
  const runs: number[] = [];
  let changed = 0;
  let start = -1;
  for (let p = 0; p < PIXELS; p++) {
    const i = p * 4;
    const same = before
      ? before[i] === after[i] && before[i + 1] === after[i + 1] && before[i + 2] === after[i + 2] && before[i + 3] === after[i + 3]
      : after[i + 3] === 0;
    if (!same) {
      if (start < 0) start = p;
    } else if (start >= 0) {
      runs.push(start, p - start);
      changed += p - start;
      start = -1;
    }
  }
  if (start >= 0) {
    runs.push(start, PIXELS - start);
    changed += PIXELS - start;
  }
  if (!changed) return null;

  const header = 4 + runs.length * 4;
  const buf = new ArrayBuffer(header + changed * 4);
  const view = new DataView(buf);
  view.setUint32(0, runs.length / 2, true);
  runs.forEach((v, k) => view.setUint32(4 + k * 4, v, true));
  const rgba = new Uint8Array(buf, header);
  let o = 0;
  for (let k = 0; k < runs.length; k += 2) {
    const from = runs[k] * 4;
    const len = runs[k + 1] * 4;
    rgba.set(after.subarray(from, from + len), o);
    o += len;
  }
  return buf;
}

/** Write an encoded diff into tile pixel data (and optionally into a second copy). */
export function applyDiff(buf: ArrayBuffer, ...targets: Uint8ClampedArray[]): void {
  const view = new DataView(buf);
  const count = view.getUint32(0, true);
  const header = 4 + count * 8;
  const rgba = new Uint8Array(buf, header);
  let o = 0;
  for (let k = 0; k < count; k++) {
    const start = view.getUint32(4 + k * 8, true) * 4;
    const len = view.getUint32(8 + k * 8, true) * 4;
    const slice = rgba.subarray(o, o + len);
    for (const t of targets) t.set(slice, start);
    o += len;
  }
}
