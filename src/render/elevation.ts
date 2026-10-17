import { TILE_SIZE } from '../core/constants';
import type { Tile, TileLayer } from '../core/layer';
import { tileKey } from '../core/layer';
import { BANDS, bandOf } from '../valheim/elevation';

/** Hillshade smoothing radius, in meters: how wide a slope between two bands looks. */
const BLUR = 6;
/** Border of neighbor pixels each tile needs (blur plus the gradient step). */
const PAD = BLUR + 2;
const SPAN = TILE_SIZE + 2 * PAD;
/** Vertical exaggeration for the hillshade. */
const RELIEF = 9;
/** Light from the north-west, a little above the horizon, as on old maps. */
const LIGHT = (() => {
  const v = [-1, -1, 1.1];
  const n = Math.hypot(...v);
  return v.map((c) => c / n);
})();

/** Time (ms) per frame spent refreshing stale relief tiles; the rest wait for the next frame. */
const FRAME_BUDGET_MS = 10;

const TINT_ALPHA = 0.55;
const SHADOW: [number, number, number] = [55, 36, 18];
const HIGHLIGHT: [number, number, number] = [255, 251, 236];
const CONTOUR: [number, number, number, number] = [96, 62, 30, 0.85];

const BAND_RGB = BANDS.map(({ color }) => {
  const n = parseInt(color.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
});

export interface ReliefStyle {
  shade: boolean;
  contours: boolean;
  tint: boolean;
}

interface Cached {
  canvas: HTMLCanvasElement;
  style: string;
  /** The tile (or a neighbor) changed since this was rendered. */
  stale: boolean;
}

/**
 * Turns the painted height bands of the Elevation layer into relief: soft
 * hillshade, contour lines at every band edge and, optionally, band tints.
 * Rendered per tile and cached until that tile or a neighbor changes.
 *
 * Refreshing is time-boxed per frame: while you paint, a changed tile keeps
 * showing its previous relief until its turn comes, so strokes stay smooth.
 */
export class ElevationRenderer {
  private cache = new Map<string, Cached>();
  private scratch: CanvasRenderingContext2D;
  private frameStart = 0;
  /** Some tiles were left stale this frame; the caller should draw again. */
  deferred = false;

  constructor(private layer: TileLayer) {
    const c = document.createElement('canvas');
    c.width = c.height = SPAN;
    this.scratch = c.getContext('2d', { willReadFrequently: true })!;
    // A change near a tile edge alters the shading of the neighbors too.
    layer.onChange((key) => {
      const [tx, ty] = key.split(',').map(Number);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const hit = this.cache.get(tileKey(tx + dx, ty + dy));
          if (hit) hit.stale = true;
        }
      }
    });
  }

  /** Call once per frame before rendering tiles. */
  beginFrame(): void {
    this.frameStart = performance.now();
    this.deferred = false;
  }

  /** Drop everything (e.g. after loading another map). */
  clear(): void {
    this.cache.clear();
  }

  /** The relief image for a tile of the Elevation layer. */
  render(tile: Tile, style: ReliefStyle): HTMLCanvasElement {
    const sig = `${+style.shade}${+style.contours}${+style.tint}`;
    const hit = this.cache.get(tile.key);
    if (hit && hit.style === sig && !hit.stale) return hit.canvas;
    // Out of time this frame: show what we have and finish next frame.
    if (hit && performance.now() - this.frameStart > FRAME_BUDGET_MS) {
      this.deferred = true;
      return hit.canvas;
    }
    const canvas = hit?.canvas ?? document.createElement('canvas');
    canvas.width = canvas.height = TILE_SIZE;
    this.paint(tile, canvas, style);
    this.cache.set(tile.key, { canvas, style: sig, stale: false });
    return canvas;
  }

  private paint(tile: Tile, out: HTMLCanvasElement, style: ReliefStyle): void {
    // Gather this tile and a border of its neighbors.
    const s = this.scratch;
    s.clearRect(0, 0, SPAN, SPAN);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const t = dx || dy ? this.layer.get(tile.tx + dx, tile.ty + dy) : tile;
        if (t) s.drawImage(t.canvas, PAD + dx * TILE_SIZE, PAD + dy * TILE_SIZE);
      }
    }
    const src = s.getImageData(0, 0, SPAN, SPAN).data;

    // Band per pixel; -1 where nothing is painted.
    const band = new Int8Array(SPAN * SPAN);
    for (let i = 0; i < SPAN * SPAN; i++) {
      const j = i * 4;
      band[i] = src[j + 3] < 128 ? -1 : bandOf(src[j], src[j + 1], src[j + 2]);
    }

    // Smoothed height via summed-area tables, averaging only painted pixels.
    const W = SPAN + 1;
    const sumH = new Float64Array(W * W);
    const sumN = new Float64Array(W * W);
    for (let y = 0; y < SPAN; y++) {
      let rowH = 0;
      let rowN = 0;
      for (let x = 0; x < SPAN; x++) {
        const b = band[y * SPAN + x];
        if (b >= 0) {
          rowH += b;
          rowN++;
        }
        const k = (y + 1) * W + x + 1;
        sumH[k] = sumH[k - W] + rowH;
        sumN[k] = sumN[k - W] + rowN;
      }
    }
    // Box-averaged height for the tile area plus a 1-pixel ring (for gradients).
    const hs = new Float32Array(SPAN * SPAN);
    for (let y = PAD - 1; y <= PAD + TILE_SIZE; y++) {
      const y0 = (y - BLUR) * W;
      const y1 = (y + BLUR + 1) * W;
      for (let x = PAD - 1; x <= PAD + TILE_SIZE; x++) {
        const x0 = x - BLUR;
        const x1 = x + BLUR + 1;
        const n = sumN[y1 + x1] - sumN[y0 + x1] - sumN[y1 + x0] + sumN[y0 + x0];
        hs[y * SPAN + x] = n ? (sumH[y1 + x1] - sumH[y0 + x1] - sumH[y1 + x0] + sumH[y0 + x0]) / n : 0;
      }
    }

    const ctx = out.getContext('2d')!;
    const img = ctx.createImageData(TILE_SIZE, TILE_SIZE);
    const d = img.data;
    // Blend a color over the output pixel (straight alpha "over").
    const over = (i: number, r: number, g: number, b: number, a: number) => {
      const da = d[i + 3] / 255;
      const oa = a + da * (1 - a);
      if (oa <= 0) return;
      d[i] = (r * a + d[i] * da * (1 - a)) / oa;
      d[i + 1] = (g * a + d[i + 1] * da * (1 - a)) / oa;
      d[i + 2] = (b * a + d[i + 2] * da * (1 - a)) / oa;
      d[i + 3] = oa * 255;
    };

    for (let y = 0; y < TILE_SIZE; y++) {
      for (let x = 0; x < TILE_SIZE; x++) {
        const sx = x + PAD;
        const sy = y + PAD;
        const b = band[sy * SPAN + sx];
        if (b < 0) continue;
        const i = (y * TILE_SIZE + x) * 4;

        if (style.tint) {
          const [r, g, bl] = BAND_RGB[b];
          over(i, r, g, bl, TINT_ALPHA);
        }
        if (style.shade) {
          const k = sy * SPAN + sx;
          const gx = (hs[k + 1] - hs[k - 1]) / 2;
          const gy = (hs[k + SPAN] - hs[k - SPAN]) / 2;
          const nx = -RELIEF * gx;
          const ny = -RELIEF * gy;
          const nl = Math.hypot(nx, ny, 1);
          const lit = (nx * LIGHT[0] + ny * LIGHT[1] + LIGHT[2]) / nl - LIGHT[2];
          if (lit < -0.005) over(i, ...SHADOW, Math.min(0.55, -lit * 1.5));
          else if (lit > 0.005) over(i, ...HIGHLIGHT, Math.min(0.4, lit * 1.1));
        }
        if (style.contours) {
          const k = sy * SPAN + sx;
          const lower = (n: number) => n >= 0 && n < b;
          if (lower(band[k - 1]) || lower(band[k + 1]) || lower(band[k - SPAN]) || lower(band[k + SPAN])) {
            over(i, CONTOUR[0], CONTOUR[1], CONTOUR[2], CONTOUR[3]);
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }
}
