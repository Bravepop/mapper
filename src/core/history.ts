import { TILE_SIZE } from './constants';
import type { Compass, CompassStore } from './compass';
import type { LabelChange, LabelStore } from './labels';
import { tileKey, type Tile, type TileLayer } from './layer';

interface Patch {
  layer: TileLayer;
  tx: number;
  ty: number;
  /** Tile pixels before the edit; null if the tile didn't exist. */
  before: ImageData | null;
  /** Tile pixels after the edit; null if the tile was removed. */
  after: ImageData | null;
}

/** One undo step: tile pixel patches and/or label changes. */
interface Entry {
  patches: Patch[];
  labels: LabelChange[];
  /** Compass rose before/after, if this step changed it. */
  compass?: { before: Compass | null; after: Compass | null };
}

const TILE_BYTES = TILE_SIZE * TILE_SIZE * 4;
const MAX_ENTRIES = 100;
const MAX_BYTES = 256 * 1024 * 1024;

/**
 * One in-progress edit (a brush stroke, a fill) on one layer. Tools call
 * `touch` before writing to a tile so the tile's original pixels are captured
 * for undo.
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
      this.patches.set(key, { layer: this.layer, tx, ty, before, after: null });
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

  /** `target` returns the layer new edits paint into (the active layer). */
  constructor(
    private target: () => TileLayer,
    private labels: LabelStore,
    private compass: CompassStore,
  ) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  begin(): Edit {
    return new Edit(this.target());
  }

  /** Finish an edit as one undo step, optionally together with label changes (applied now). */
  commit(edit: Edit, ...labels: LabelChange[]): void {
    const patches = edit.finish();
    for (const c of labels) this.labels.apply(c, 'after');
    if (patches.length === 0 && labels.length === 0) return;
    this.push({ patches, labels });
  }

  /** Apply label changes and record them as one undo step. */
  changeLabels(...changes: LabelChange[]): void {
    for (const c of changes) this.labels.apply(c, 'after');
    this.recordLabels(...changes);
  }

  /** Record label changes that were already applied live (e.g. while dragging). */
  recordLabels(...changes: LabelChange[]): void {
    const real = changes.filter((c) => JSON.stringify(c.before) !== JSON.stringify(c.after));
    if (real.length) this.push({ patches: [], labels: real });
  }

  /** Record a compass change that was already applied. */
  recordCompass(before: Compass | null, after: Compass | null): void {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    this.push({ patches: [], labels: [], compass: { before, after } });
  }

  private push(entry: Entry): void {
    this.undoStack.push(entry);
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
    const labels = side === 'before' ? [...entry.labels].reverse() : entry.labels;
    for (const c of labels) this.labels.apply(c, side);
    if (entry.compass) this.compass.set(entry.compass[side]);
    for (const p of entry.patches) {
      const data = p[side];
      if (data) {
        const tile = p.layer.getOrCreate(p.tx, p.ty);
        tile.ctx.putImageData(data, 0, 0);
        p.layer.notify(tile.key);
      } else {
        p.layer.remove(p.tx, p.ty);
      }
    }
  }

  /** Drop the oldest entries once the stack is too long or uses too much memory. */
  private trim(): void {
    const bytes = (e: Entry) => e.patches.reduce((n, p) => n + (p.before ? TILE_BYTES : 0) + (p.after ? TILE_BYTES : 0), 0);
    let total = this.undoStack.reduce((n, e) => n + bytes(e), 0);
    while (this.undoStack.length > 1 && (this.undoStack.length > MAX_ENTRIES || total > MAX_BYTES)) {
      total -= bytes(this.undoStack.shift()!);
    }
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
