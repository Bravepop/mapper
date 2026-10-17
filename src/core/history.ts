import { TILE_SIZE } from './constants';
import { tileKey, type Tile, type TileLayer } from './layer';

interface Patch {
  tx: number;
  ty: number;
  /** Tile pixels before the edit; null if the tile didn't exist. */
  before: ImageData | null;
  /** Tile pixels after the edit; null if the tile was removed. */
  after: ImageData | null;
}

type Entry = Patch[];

const TILE_BYTES = TILE_SIZE * TILE_SIZE * 4;
const MAX_ENTRIES = 100;
const MAX_BYTES = 256 * 1024 * 1024;

/**
 * One in-progress edit (a brush stroke, a fill). Tools call `touch` before
 * writing to a tile so the tile's original pixels are captured for undo.
 */
export class Edit {
  private patches = new Map<string, Patch>();

  constructor(private layer: TileLayer) {}

  /** Get a tile for writing, creating it if needed and snapshotting its pre-edit state. */
  touch(tx: number, ty: number): Tile {
    const key = tileKey(tx, ty);
    const existing = this.layer.get(tx, ty);
    if (!this.patches.has(key)) {
      const before = existing ? existing.ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE) : null;
      this.patches.set(key, { tx, ty, before, after: null });
    }
    return existing ?? this.layer.getOrCreate(tx, ty);
  }

  /** Like `touch`, but never creates a tile. Used by the eraser. */
  touchExisting(tx: number, ty: number): Tile | undefined {
    return this.layer.get(tx, ty) ? this.touch(tx, ty) : undefined;
  }

  /** Capture the after-state of every touched tile and notify listeners. */
  finish(): Patch[] {
    const patches = [...this.patches.values()];
    for (const p of patches) {
      const tile = this.layer.get(p.tx, p.ty);
      p.after = tile ? tile.ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE) : null;
      this.layer.notify(tileKey(p.tx, p.ty));
    }
    return patches;
  }
}

export class History {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private listeners = new Set<() => void>();

  constructor(private layer: TileLayer) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  begin(): Edit {
    return new Edit(this.layer);
  }

  commit(edit: Edit): void {
    const patches = edit.finish();
    if (patches.length === 0) return;
    this.undoStack.push(patches);
    this.redoStack = [];
    this.trim();
    this.emit();
  }

  undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.apply(entry, 'before');
    this.redoStack.push(entry);
    this.emit();
  }

  redo(): void {
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.apply(entry, 'after');
    this.undoStack.push(entry);
    this.emit();
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.emit();
  }

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  private apply(entry: Entry, side: 'before' | 'after'): void {
    for (const p of entry) {
      const data = p[side];
      if (data) {
        const tile = this.layer.getOrCreate(p.tx, p.ty);
        tile.ctx.putImageData(data, 0, 0);
        this.layer.notify(tile.key);
      } else {
        this.layer.remove(p.tx, p.ty);
      }
    }
  }

  /** Drop the oldest entries once the stack is too long or uses too much memory. */
  private trim(): void {
    const bytes = (e: Entry) => e.reduce((n, p) => n + (p.before ? TILE_BYTES : 0) + (p.after ? TILE_BYTES : 0), 0);
    let total = this.undoStack.reduce((n, e) => n + bytes(e), 0);
    while (this.undoStack.length > 1 && (this.undoStack.length > MAX_ENTRIES || total > MAX_BYTES)) {
      total -= bytes(this.undoStack.shift()!);
    }
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
