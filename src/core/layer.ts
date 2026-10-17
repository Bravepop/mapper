import { TILE_SIZE } from './constants';

export interface Tile {
  tx: number;
  ty: number;
  key: string;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

export const tileKey = (tx: number, ty: number): string => `${tx},${ty}`;

/** Index of the tile containing world pixel coordinate `v`. */
export const tileIndex = (v: number): number => Math.floor(v / TILE_SIZE);

/**
 * A sparse raster layer split into fixed-size tiles. Only tiles that have been
 * painted on exist, so a 20 km world costs nothing until you draw on it.
 */
export class TileLayer {
  private tiles = new Map<string, Tile>();
  private listeners = new Set<(key: string) => void>();

  get size(): number {
    return this.tiles.size;
  }

  get(tx: number, ty: number): Tile | undefined {
    return this.tiles.get(tileKey(tx, ty));
  }

  getByKey(key: string): Tile | undefined {
    return this.tiles.get(key);
  }

  getOrCreate(tx: number, ty: number): Tile {
    const key = tileKey(tx, ty);
    let tile = this.tiles.get(key);
    if (!tile) {
      const canvas = document.createElement('canvas');
      canvas.width = TILE_SIZE;
      canvas.height = TILE_SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2D canvas not supported');
      tile = { tx, ty, key, canvas, ctx };
      this.tiles.set(key, tile);
    }
    return tile;
  }

  remove(tx: number, ty: number): void {
    const key = tileKey(tx, ty);
    if (this.tiles.delete(key)) this.notify(key);
  }

  values(): IterableIterator<Tile> {
    return this.tiles.values();
  }

  /** Drop every tile without notifying listeners (used when replacing the whole document). */
  clear(): void {
    this.tiles.clear();
  }

  onChange(fn: (key: string) => void): void {
    this.listeners.add(fn);
  }

  /** Tell listeners (renderer, autosave) that a tile's pixels changed. */
  notify(key: string): void {
    for (const fn of this.listeners) fn(key);
  }
}

export function isTileEmpty(tile: Tile): boolean {
  const data = tile.ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return false;
  return true;
}
