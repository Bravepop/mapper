export type CompassStyle = 'simple' | 'ornate';

/** The map's compass rose: one per map, placed and styled by hand. North is always up. */
export interface Compass {
  x: number;
  y: number;
  /** Diameter of the rose in meters, so it scales with the map. */
  size: number;
  color: string;
  style: CompassStyle;
}

export const MIN_COMPASS_SIZE = 20;
export const MAX_COMPASS_SIZE = 2000;

export class CompassStore {
  private value: Compass | null = null;
  private listeners = new Set<() => void>();

  get(): Compass | null {
    return this.value ? { ...this.value } : null;
  }

  set(c: Compass | null): void {
    this.value = c ? { ...c } : null;
    for (const fn of this.listeners) fn();
  }

  /** Load from saved data, ignoring anything malformed. */
  load(raw: unknown): void {
    this.set(sanitize(raw));
  }

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }
}

function sanitize(raw: unknown): Compass | null {
  const c = raw as Partial<Compass> | null;
  if (!c || typeof c.x !== 'number' || typeof c.y !== 'number' || !Number.isFinite(c.x) || !Number.isFinite(c.y)) return null;
  return {
    x: c.x,
    y: c.y,
    size: typeof c.size === 'number' ? Math.min(MAX_COMPASS_SIZE, Math.max(MIN_COMPASS_SIZE, c.size)) : 150,
    color: typeof c.color === 'string' && /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#2a211a',
    style: c.style === 'simple' ? 'simple' : 'ornate',
  };
}
