import { TileLayer } from './layer';

export type LayerId = 'biomes' | 'elevation' | 'paths' | 'ink' | 'notes';

/** Display and editing properties of a layer (everything except its pixels). */
export interface LayerProps {
  id: LayerId;
  name: string;
  visible: boolean;
  locked: boolean;
  /** 0–1. Display only: tools always see a layer's pixels at full strength. */
  opacity: number;
}

export interface MapLayer extends LayerProps {
  tiles: TileLayer;
}

/** The fixed set of layers, bottom to top, in their default order. */
export const DEFAULT_LAYERS: readonly LayerProps[] = [
  { id: 'biomes', name: 'Biomes', visible: true, locked: false, opacity: 1 },
  // Painted in height bands; drawn as hillshade and contours rather than as raw color.
  { id: 'elevation', name: 'Elevation', visible: true, locked: false, opacity: 1 },
  { id: 'paths', name: 'Paths', visible: true, locked: false, opacity: 1 },
  { id: 'ink', name: 'Ink / Outlines', visible: true, locked: false, opacity: 1 },
  { id: 'notes', name: 'Notes', visible: true, locked: false, opacity: 1 },
];

export const DEFAULT_ACTIVE: LayerId = 'biomes';

export const isLayerId = (v: unknown): v is LayerId => DEFAULT_LAYERS.some((l) => l.id === v);

/** Saved layer settings: order (bottom to top), props and the active layer. */
export interface LayerStackState {
  layers: LayerProps[];
  active: LayerId;
}

/**
 * The map's paint layers, bottom to top. Each layer is its own sparse tile
 * layer; tools paint into the active one.
 */
export class LayerStack {
  /** Bottom to top. */
  private order: MapLayer[];
  private activeId: LayerId = DEFAULT_ACTIVE;
  private tileListeners = new Set<(layer: MapLayer, key: string) => void>();
  private listeners = new Set<() => void>();

  constructor() {
    this.order = DEFAULT_LAYERS.map((p) => {
      const layer: MapLayer = { ...p, tiles: new TileLayer() };
      layer.tiles.onChange((key) => {
        for (const fn of this.tileListeners) fn(layer, key);
      });
      return layer;
    });
  }

  /** Bottom to top. */
  get all(): readonly MapLayer[] {
    return this.order;
  }

  get active(): MapLayer {
    return this.get(this.activeId);
  }

  get(id: LayerId): MapLayer {
    return this.order.find((l) => l.id === id)!;
  }

  /** Total painted tiles across all layers. */
  get tileCount(): number {
    return this.order.reduce((n, l) => n + l.tiles.size, 0);
  }

  setActive(id: LayerId): void {
    if (id === this.activeId) return;
    this.activeId = id;
    this.emit();
  }

  set(id: LayerId, patch: Partial<Pick<LayerProps, 'visible' | 'locked' | 'opacity'>>): void {
    const layer = this.get(id);
    if (patch.opacity !== undefined) patch.opacity = Math.min(1, Math.max(0, patch.opacity));
    Object.assign(layer, patch);
    this.emit();
  }

  /** Move a layer up (+1, toward the top) or down (-1). */
  move(id: LayerId, delta: number): void {
    const i = this.order.findIndex((l) => l.id === id);
    const j = i + delta;
    if (j < 0 || j >= this.order.length) return;
    const [layer] = this.order.splice(i, 1);
    this.order.splice(j, 0, layer);
    this.emit();
  }

  state(): LayerStackState {
    return {
      layers: this.order.map(({ id, name, visible, locked, opacity }) => ({ id, name, visible, locked, opacity })),
      active: this.activeId,
    };
  }

  /**
   * Apply saved settings. Unknown layers are ignored. Layers missing from the
   * save (e.g. ones added in a later version) go back in just above the layer
   * they follow by default.
   */
  restore(state: Partial<LayerStackState> | undefined): void {
    const saved = (state?.layers ?? []).filter((l) => isLayerId(l?.id));
    const ids: LayerId[] = saved.map((l) => l.id).filter((id, i, all) => all.indexOf(id) === i);
    DEFAULT_LAYERS.forEach((d, i) => {
      if (ids.includes(d.id)) return;
      const prev = i > 0 ? ids.indexOf(DEFAULT_LAYERS[i - 1].id) : -1;
      ids.splice(prev + 1, 0, d.id);
    });
    this.order.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    for (const layer of this.order) {
      const s = saved.find((l) => l.id === layer.id);
      const d = DEFAULT_LAYERS.find((l) => l.id === layer.id)!;
      layer.visible = typeof s?.visible === 'boolean' ? s.visible : d.visible;
      layer.locked = typeof s?.locked === 'boolean' ? s.locked : d.locked;
      layer.opacity = typeof s?.opacity === 'number' ? Math.min(1, Math.max(0, s.opacity)) : d.opacity;
    }
    this.activeId = isLayerId(state?.active) ? state.active : DEFAULT_ACTIVE;
    this.emit();
  }

  /** Drop all pixels (without notifying tile listeners) and reset layer settings. */
  reset(): void {
    for (const l of this.order) l.tiles.clear();
    this.restore(undefined);
  }

  /** Fires when any layer's pixels change. */
  onTiles(fn: (layer: MapLayer, key: string) => void): void {
    this.tileListeners.add(fn);
  }

  /** Fires when layer order, settings or the active layer change. */
  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
