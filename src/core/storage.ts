import type { App, AppState } from '../app';
import { DEFAULT_STATE } from '../app';
import type { Compass } from './compass';
import type { Label } from './labels';
import { isLayerId, type LayerId, type LayerStackState } from './layers';

const DB_NAME = 'mapper';
const DB_VERSION = 1;
const TILES = 'tiles';
const META = 'meta';
const SAVE_DELAY_MS = 800;

export interface SavedMeta {
  camera: { x: number; y: number; zoom: number };
  state: AppState;
  fileName: string | null;
  /** Missing in saves from before layers existed. */
  layers?: LayerStackState;
  /** Missing in saves from before labels existed. */
  labels?: Label[];
  compass?: Compass | null;
}

/**
 * Tile records are keyed `layerId/tx,ty`. Saves from before layers existed
 * used a bare `tx,ty`; those load into the Biomes layer and are rewritten.
 */
const recordKey = (layer: LayerId, tileKey: string) => `${layer}/${tileKey}`;

function parseRecordKey(key: string): { layer: LayerId; tileKey: string; legacy: boolean } | null {
  const slash = key.indexOf('/');
  if (slash < 0) return { layer: 'biomes', tileKey: key, legacy: true };
  const layer = key.slice(0, slash);
  return isLayerId(layer) ? { layer, tileKey: key.slice(slash + 1), legacy: false } : null;
}

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function openDb(): Promise<IDBDatabase> {
  const r = indexedDB.open(DB_NAME, DB_VERSION);
  r.onupgradeneeded = () => {
    r.result.createObjectStore(TILES);
    r.result.createObjectStore(META);
  };
  return req(r);
}

const toBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'));

/**
 * Keeps an always-current copy of the map in IndexedDB so a refresh or crash
 * never loses work. Only tiles that changed are rewritten.
 */
export class Autosave {
  status: SaveStatus = 'idle';
  fileName: string | null = null;

  private db: Promise<IDBDatabase> | null = null;
  /** Record keys (`layerId/tx,ty`) whose tiles need writing or deleting. */
  private dirtyTiles = new Set<string>();
  /** Pre-layers record keys to delete once they have been rewritten under their new key. */
  private legacyKeys = new Set<string>();
  private metaDirty = false;
  private timer = 0;
  private flushing: Promise<void> | null = null;
  private listeners = new Set<() => void>();

  constructor(private app: App) {
    app.layers.onTiles((layer, key) => {
      this.dirtyTiles.add(recordKey(layer.id, key));
      this.schedule();
    });
    app.layers.onChange(() => this.markMeta());
    app.labels.onChange(() => this.markMeta());
    app.compass.onChange(() => this.markMeta());
    app.onState(() => this.markMeta());
    app.onView(() => this.markMeta());
    window.addEventListener('pagehide', () => void this.flush());
  }

  onStatus(fn: () => void): void {
    this.listeners.add(fn);
  }

  markMeta(): void {
    this.metaDirty = true;
    this.schedule();
  }

  /** Restore the last session. Returns false if there was nothing saved. */
  async load(): Promise<boolean> {
    try {
      const db = await this.getDb();
      const tx = db.transaction([TILES, META], 'readonly');
      const tileStore = tx.objectStore(TILES);
      const [keys, blobs, meta] = await Promise.all([
        req(tileStore.getAllKeys()),
        req(tileStore.getAll()) as Promise<Blob[]>,
        req(tx.objectStore(META).get('doc')) as Promise<SavedMeta | undefined>,
      ]);

      const migrated: string[] = [];
      await Promise.all(
        keys.map(async (key, i) => {
          const parsed = parseRecordKey(String(key));
          if (!parsed) return;
          const [tx, ty] = parsed.tileKey.split(',').map(Number);
          const bitmap = await createImageBitmap(blobs[i]);
          this.app.layers.get(parsed.layer).tiles.getOrCreate(tx, ty).ctx.drawImage(bitmap, 0, 0);
          bitmap.close();
          if (parsed.legacy) {
            this.legacyKeys.add(String(key));
            migrated.push(recordKey(parsed.layer, parsed.tileKey));
          }
        }),
      );

      if (meta) {
        this.app.layers.restore(meta.layers);
        this.app.labels.load(meta.labels);
        this.app.compass.load(meta.compass);
        this.app.camera.x = meta.camera.x;
        this.app.camera.y = meta.camera.y;
        this.app.camera.zoom = meta.camera.zoom;
        this.fileName = meta.fileName;
        this.app.update({ ...DEFAULT_STATE, ...meta.state });
      }
      this.app.requestRender();
      this.dirtyTiles = new Set(migrated);
      this.metaDirty = migrated.length > 0;
      if (migrated.length) this.schedule();
      return keys.length > 0 || !!meta;
    } catch (err) {
      console.error('Autosave restore failed', err);
      return false;
    }
  }

  /** Wipe the stored copy and rewrite it from the current document (after New/Open). */
  async replaceAll(): Promise<void> {
    await this.flushing;
    const db = await this.getDb();
    const tx = db.transaction([TILES, META], 'readwrite');
    tx.objectStore(TILES).clear();
    tx.objectStore(META).clear();
    await done(tx);
    this.legacyKeys.clear();
    for (const layer of this.app.layers.all) {
      for (const tile of layer.tiles.values()) this.dirtyTiles.add(recordKey(layer.id, tile.key));
    }
    this.metaDirty = true;
    await this.flush();
  }

  private schedule(): void {
    this.setStatus('pending');
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), SAVE_DELAY_MS);
  }

  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.flushing) await this.flushing;
    if (this.dirtyTiles.size === 0 && !this.metaDirty && this.legacyKeys.size === 0) {
      if (this.status === 'pending') this.setStatus('saved');
      return;
    }
    this.flushing = this.write().finally(() => (this.flushing = null));
    return this.flushing;
  }

  private async write(): Promise<void> {
    const keys = [...this.dirtyTiles];
    this.dirtyTiles.clear();
    const legacy = [...this.legacyKeys];
    this.legacyKeys.clear();
    const writeMeta = this.metaDirty;
    this.metaDirty = false;
    this.setStatus('saving');
    try {
      // Encode PNGs before opening the transaction; IDB transactions auto-commit across awaits.
      const blobs = await Promise.all(
        keys.map(async (key) => {
          const parsed = parseRecordKey(key)!;
          const tile = this.app.layers.get(parsed.layer).tiles.getByKey(parsed.tileKey);
          return [key, tile ? await toBlob(tile.canvas) : null] as const;
        }),
      );
      const db = await this.getDb();
      const tx = db.transaction([TILES, META], 'readwrite');
      const store = tx.objectStore(TILES);
      for (const [key, blob] of blobs) {
        if (blob) store.put(blob, key);
        else store.delete(key);
      }
      for (const key of legacy) store.delete(key);
      if (writeMeta) tx.objectStore(META).put(this.meta(), 'doc');
      await done(tx);
      this.setStatus(this.dirtyTiles.size || this.metaDirty ? 'pending' : 'saved');
    } catch (err) {
      console.error('Autosave failed', err);
      for (const k of keys) this.dirtyTiles.add(k);
      for (const k of legacy) this.legacyKeys.add(k);
      this.metaDirty ||= writeMeta;
      this.setStatus('error');
    }
  }

  private meta(): SavedMeta {
    const { x, y, zoom } = this.app.camera;
    return {
      camera: { x, y, zoom },
      state: { ...this.app.state },
      fileName: this.fileName,
      layers: this.app.layers.state(),
      labels: this.app.labels.all(),
      compass: this.app.compass.get(),
    };
  }

  private getDb(): Promise<IDBDatabase> {
    return (this.db ??= openDb());
  }

  private setStatus(s: SaveStatus): void {
    if (s === this.status) return;
    this.status = s;
    for (const fn of this.listeners) fn();
  }
}
