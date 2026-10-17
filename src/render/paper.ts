import type { Camera } from '../core/camera';
import { WORLD_RADIUS } from '../core/constants';

/** Size of the tileable grain texture, in screen pixels. */
const GRAIN_SIZE = 256;

/** Canvas filter that turns paint and labels into faded sepia ink. */
export const SEPIA_FILTER = 'sepia(0.85) saturate(0.75) brightness(0.97)';

let grain: HTMLCanvasElement | null = null;

/** Tileable value noise: a random lattice that wraps every `cells` cells. */
function noiseLayer(cells: number, rand: () => number): (x: number, y: number) => number {
  const lattice = Float32Array.from({ length: cells * cells }, rand);
  const at = (i: number, j: number) => lattice[((j % cells) + cells) % cells * cells + (((i % cells) + cells) % cells)];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = (x / GRAIN_SIZE) * cells;
    const fy = (y / GRAIN_SIZE) * cells;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const u = smooth(fx - i);
    const v = smooth(fy - j);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * u;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * u;
    return a + (b - a) * v;
  };
}

/**
 * A light, translucent brown texture of blotches, fibers and specks that,
 * laid over the map, makes it read as old paper. Generated once.
 */
function grainCanvas(): HTMLCanvasElement {
  if (grain) return grain;
  let seed = 20240917;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const octaves = [noiseLayer(4, rand), noiseLayer(8, rand), noiseLayer(16, rand), noiseLayer(64, rand)];
  const weights = [0.45, 0.28, 0.17, 0.1];

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = GRAIN_SIZE;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(GRAIN_SIZE, GRAIN_SIZE);
  const d = img.data;
  for (let y = 0; y < GRAIN_SIZE; y++) {
    for (let x = 0; x < GRAIN_SIZE; x++) {
      let n = 0;
      octaves.forEach((f, k) => (n += f(x, y) * weights[k]));
      // Blotchy stains where the noise is high, plus a fine speckle everywhere.
      let alpha = Math.max(0, n - 0.48) * 0.55 + rand() * 0.045;
      if (rand() < 0.004) alpha += 0.12;
      const i = (y * GRAIN_SIZE + x) * 4;
      d[i] = 105;
      d[i + 1] = 72;
      d[i + 2] = 38;
      d[i + 3] = Math.min(255, alpha * 255);
    }
  }
  ctx.putImageData(img, 0, 0);

  // A few faint paper fibers.
  ctx.strokeStyle = 'rgba(105, 72, 38, 0.08)';
  ctx.lineWidth = 0.7;
  for (let k = 0; k < 40; k++) {
    const x = rand() * GRAIN_SIZE;
    const y = rand() * GRAIN_SIZE;
    const a = rand() * Math.PI;
    const len = 6 + rand() * 14;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + rand() * 3, y + Math.sin(a) * len * 0.5, x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  grain = canvas;
  return canvas;
}

/** Clip to the world disc (CSS-pixel space). */
function clipWorld(ctx: CanvasRenderingContext2D, cam: Camera): void {
  ctx.beginPath();
  ctx.arc(cam.toScreenX(0), cam.toScreenY(0), WORLD_RADIUS * cam.zoom, 0, Math.PI * 2);
  ctx.clip();
}

/** Lay the paper grain over the world disc. It pans with the map. */
export function drawGrain(ctx: CanvasRenderingContext2D, cam: Camera): void {
  const pattern = ctx.createPattern(grainCanvas(), 'repeat');
  if (!pattern) return;
  pattern.setTransform(new DOMMatrix().translate(cam.toScreenX(0), cam.toScreenY(0)));
  ctx.save();
  clipWorld(ctx, cam);
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, cam.width, cam.height);
  ctx.restore();
}

/** Darken the rim of the world disc and the corners of the view, like old, handled paper. */
export function drawAgedEdges(ctx: CanvasRenderingContext2D, cam: Camera): void {
  const cx = cam.toScreenX(0);
  const cy = cam.toScreenY(0);
  const r = WORLD_RADIUS * cam.zoom;
  ctx.save();
  clipWorld(ctx, cam);
  const rim = ctx.createRadialGradient(cx, cy, r * 0.9, cx, cy, r);
  rim.addColorStop(0, 'rgba(90, 55, 25, 0)');
  rim.addColorStop(0.7, 'rgba(90, 55, 25, 0.18)');
  rim.addColorStop(1, 'rgba(70, 40, 15, 0.55)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, cam.width, cam.height);
  ctx.restore();

  const diag = Math.hypot(cam.width, cam.height) / 2;
  const v = ctx.createRadialGradient(cam.width / 2, cam.height / 2, diag * 0.55, cam.width / 2, cam.height / 2, diag);
  v.addColorStop(0, 'rgba(60, 38, 18, 0)');
  v.addColorStop(1, 'rgba(60, 38, 18, 0.32)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, cam.width, cam.height);
}
