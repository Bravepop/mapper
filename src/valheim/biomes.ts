export interface Swatch {
  name: string;
  color: string;
}

/** Hand-map style colors for each Valheim biome. */
export const BIOMES: Swatch[] = [
  { name: 'Meadows', color: '#7fa650' },
  { name: 'Black Forest', color: '#2f4f2f' },
  { name: 'Swamp', color: '#5d5236' },
  { name: 'Mountain', color: '#e4e9ec' },
  { name: 'Plains', color: '#d6c26a' },
  { name: 'Mistlands', color: '#5f5873' },
  { name: 'Ashlands', color: '#a3402c' },
  { name: 'Deep North', color: '#bcd8ea' },
  { name: 'Ocean', color: '#2f5f8a' },
  { name: 'Shallows', color: '#6fa3c4' },
];

/** General-purpose inks for roads, outlines, and notes. */
export const INKS: Swatch[] = [
  { name: 'Ink', color: '#2a211a' },
  { name: 'Road / path', color: '#8a6a45' },
  { name: 'Stone', color: '#8c8c8c' },
  { name: 'Danger', color: '#c0392b' },
  { name: 'Gold', color: '#d9a441' },
  { name: 'White', color: '#ffffff' },
];
