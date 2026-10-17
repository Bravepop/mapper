import { isLayerId, type LayerId } from './layers';

/**
 * A text label: an editable vector object kept apart from the raster paint,
 * so it stays sharp at any zoom and can be moved, restyled or deleted.
 */
export interface Label {
  id: string;
  /** The layer it belongs to (for visibility, locking, opacity and order). */
  layer: LayerId;
  text: string;
  /** Center of the text, in world meters. */
  x: number;
  y: number;
  /** Letter height in meters, so labels scale with the map. */
  size: number;
  color: string;
  /** Radians, clockwise. */
  rotation: number;
  /** -1..1: bends the text along an arc. 0 is straight, 1 a half circle arching up, -1 sagging down. */
  curve: number;
}

/** One undoable label change: null `before` = added, null `after` = deleted. */
export interface LabelChange {
  before: Label | null;
  after: Label | null;
}

export const LABEL_FONT = "'Uncial Antiqua', Georgia, serif";

export const MIN_LABEL_SIZE = 2;
export const MAX_LABEL_SIZE = 500;

let counter = 0;
export const newLabelId = (): string => `l${Date.now().toString(36)}${(counter++).toString(36)}`;

/** All labels, in the order they were added (later ones draw on top). */
export class LabelStore {
  private labels = new Map<string, Label>();
  private listeners = new Set<() => void>();
  private updateListeners = new Set<(id: string, label: Label | null) => void>();

  get size(): number {
    return this.labels.size;
  }

  get(id: string): Label | undefined {
    return this.labels.get(id);
  }

  all(): Label[] {
    return [...this.labels.values()];
  }

  onLayer(layer: LayerId): Label[] {
    return this.all().filter((l) => l.layer === layer);
  }

  /** Add or replace a label (keeping its place in the draw order). */
  put(label: Label): void {
    this.labels.set(label.id, { ...label });
    this.emit();
    for (const fn of this.updateListeners) fn(label.id, { ...label });
  }

  remove(id: string): void {
    if (!this.labels.delete(id)) return;
    this.emit();
    for (const fn of this.updateListeners) fn(id, null);
  }

  /** Fires for each added, changed (label) or removed (null) label; not for `load`. */
  onUpdate(fn: (id: string, label: Label | null) => void): void {
    this.updateListeners.add(fn);
  }

  /** Apply one side of a change (used by undo/redo). */
  apply(change: LabelChange, side: 'before' | 'after'): void {
    const target = change[side];
    const id = (change.after ?? change.before)!.id;
    if (target) this.put(target);
    else this.remove(id);
  }

  /** Replace every label, e.g. when loading a file. Invalid entries are skipped. */
  load(list: unknown): void {
    this.labels.clear();
    if (Array.isArray(list)) {
      for (const raw of list) {
        const l = sanitize(raw);
        if (l) this.labels.set(l.id, l);
      }
    }
    this.emit();
  }

  /** Drop everything without notifying (used when replacing the whole document). */
  clear(): void {
    this.labels.clear();
  }

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

function sanitize(raw: unknown): Label | null {
  const l = raw as Partial<Label> | null;
  if (!l || typeof l.text !== 'string' || !l.text || typeof l.x !== 'number' || typeof l.y !== 'number') return null;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return {
    id: typeof l.id === 'string' && l.id ? l.id : newLabelId(),
    layer: isLayerId(l.layer) ? l.layer : 'notes',
    text: l.text,
    x: l.x,
    y: l.y,
    size: Math.min(MAX_LABEL_SIZE, Math.max(MIN_LABEL_SIZE, num(l.size, 20))),
    color: typeof l.color === 'string' && /^#[0-9a-f]{6}$/i.test(l.color) ? l.color : '#2a211a',
    rotation: num(l.rotation, 0),
    curve: Math.min(1, Math.max(-1, num(l.curve, 0))),
  };
}
