import type { Swatch } from './biomes';

/**
 * Relative height bands, lowest first. You can't read altitude in Valheim,
 * so these describe what you can see ("this is hilly, that ridge is high")
 * rather than measured heights. Each band is painted on the Elevation layer
 * in its own color; the renderer turns the bands into hillshade and contours.
 */
export const BANDS: Swatch[] = [
  { name: 'Deep water', color: '#2c5680' },
  { name: 'Shallow water', color: '#6f9fc4' },
  { name: 'Shore', color: '#e3d6a4' },
  { name: 'Lowland', color: '#a6c486' },
  { name: 'Hills', color: '#c7c187' },
  { name: 'Highland', color: '#b5966a' },
  { name: 'Mountain', color: '#94857a' },
  { name: 'Peak', color: '#f3f2ec' },
];

const RGB = BANDS.map(({ color }) => {
  const n = parseInt(color.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
});

const cache = new Map<number, number>();

/**
 * The band (0 = lowest) a painted pixel belongs to: its nearest band color,
 * so paint from other tools (stamps, odd colors) still reads sensibly.
 */
export function bandOf(r: number, g: number, b: number): number {
  const key = (r << 16) | (g << 8) | b;
  let band = cache.get(key);
  if (band === undefined) {
    let best = Infinity;
    band = 0;
    RGB.forEach(([br, bg, bb], i) => {
      const d = (r - br) ** 2 + (g - bg) ** 2 + (b - bb) ** 2;
      if (d < best) {
        best = d;
        band = i;
      }
    });
    cache.set(key, band);
  }
  return band;
}

export const isBandColor = (color: string): boolean => BANDS.some((b) => b.color === color.toLowerCase());
