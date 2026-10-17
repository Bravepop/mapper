import { DEFAULT_STATE, type App, type AppState } from '../app';
import type { Compass } from './compass';
import type { Label } from './labels';
import { isTileEmpty, type TileLayer } from './layer';
import { isLayerId, type LayerId, type LayerProps } from './layers';
import type { Autosave } from './storage';

interface VmapTile {
  x: number;
  y: number;
  png: string;
}

/**
 * On-disk `.vmap` format: JSON with one PNG per painted tile.
 * Version 2 stores every layer, bottom to top, with its settings.
 * Version 1 had a single layer; it loads into Biomes.
 */
interface VmapFile {
  format: 'vmap';
  version: 1 | 2;
  savedAt: string;
  camera: { x: number; y: number; zoom: number };
  settings: Pick<AppState, 'gridSize' | 'showGrid'> &
    Partial<Pick<AppState, 'paperGrain' | 'agedEdges' | 'sepia' | 'fog' | 'elevShade' | 'elevContours' | 'elevTint'>>;
  /** v2 only. */
  activeLayer?: LayerId;
  layers: (Partial<LayerProps> & { id: string; name: string; tiles: VmapTile[] })[];
  /** v2: text labels (vector objects). */
  labels?: Label[];
  /** v2: the compass rose, if placed. */
  compass?: Compass | null;
  /** v2: fog of war mask tiles (revealed = painted). */
  fog?: VmapTile[];
}

const FILE_VERSION = 2;

const PICKER_TYPES = [{ description: 'Valheim map', accept: { 'application/json': ['.vmap'] } }];

export class FileActions {
  private handle: FileSystemFileHandle | null = null;
  private listeners = new Set<() => void>();
  /** True when there are edits not yet written to the .vmap file (autosave still has them). */
  modified = false;

  constructor(
    private app: App,
    private autosave: Autosave,
  ) {
    app.layers.onTiles(() => this.setModified(true));
    app.labels.onChange(() => this.setModified(true));
    app.compass.onChange(() => this.setModified(true));
    app.fog.onChange(() => this.setModified(true));
  }

  get fileName(): string | null {
    return this.autosave.fileName;
  }

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  async newMap(): Promise<void> {
    if ((this.app.layers.tileCount > 0 || this.app.labels.size > 0) && !confirm('Start a new, empty map?\n\nThe current map will be cleared. Save it first (Ctrl+S) if you want to keep it.')) return;
    this.app.resetDocument();
    this.app.camera.centerOn(0, 0);
    this.app.camera.zoom = DEFAULT_ZOOM;
    this.handle = null;
    this.autosave.fileName = null;
    this.setModified(false);
    this.app.viewChanged();
    await this.autosave.replaceAll();
  }

  async save(saveAs = false): Promise<void> {
    const json = this.serialize();
    const suggestedName = this.fileName ?? 'my-world.vmap';
    try {
      if (window.showSaveFilePicker) {
        if (!this.handle || saveAs) {
          this.handle = await window.showSaveFilePicker({ suggestedName, types: PICKER_TYPES });
        }
        const writable = await this.handle.createWritable();
        await writable.write(json);
        await writable.close();
        this.autosave.fileName = this.handle.name;
      } else {
        // Fallback for browsers without the File System Access API: download a copy.
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        a.download = suggestedName;
        a.click();
        URL.revokeObjectURL(a.href);
        this.autosave.fileName = suggestedName;
      }
      this.autosave.markMeta();
      this.setModified(false);
    } catch (err) {
      if ((err as DOMException).name !== 'AbortError') alert(`Couldn't save the map: ${(err as Error).message}`);
    }
  }

  async open(): Promise<void> {
    if (this.modified && (this.app.layers.tileCount > 0 || this.app.labels.size > 0) && !confirm('Open another map?\n\nUnsaved changes to the current map will be lost.')) return;
    try {
      let file: File;
      let handle: FileSystemFileHandle | null = null;
      if (window.showOpenFilePicker) {
        [handle] = await window.showOpenFilePicker({ types: PICKER_TYPES });
        file = await handle.getFile();
      } else {
        const picked = await pickFile();
        if (!picked) return;
        file = picked;
      }
      await this.load(await file.text());
      this.handle = handle;
      this.autosave.fileName = file.name;
      this.setModified(false);
      await this.autosave.replaceAll();
    } catch (err) {
      if ((err as DOMException).name !== 'AbortError') alert(`Couldn't open the map: ${(err as Error).message}`);
    }
  }

  private serialize(): string {
    const pngs = (tiles: TileLayer) => {
      const out: VmapTile[] = [];
      for (const tile of tiles.values()) {
        if (isTileEmpty(tile)) continue;
        out.push({ x: tile.tx, y: tile.ty, png: tile.canvas.toDataURL('image/png') });
      }
      return out;
    };
    const layers = this.app.layers.all.map(({ id, name, visible, locked, opacity, tiles }) => ({
      id,
      name,
      visible,
      locked,
      opacity,
      tiles: pngs(tiles),
    }));
    const { x, y, zoom } = this.app.camera;
    const file: VmapFile = {
      format: 'vmap',
      version: FILE_VERSION,
      savedAt: new Date().toISOString(),
      camera: { x, y, zoom },
      settings: {
        gridSize: this.app.state.gridSize,
        showGrid: this.app.state.showGrid,
        paperGrain: this.app.state.paperGrain,
        agedEdges: this.app.state.agedEdges,
        sepia: this.app.state.sepia,
        fog: this.app.state.fog,
        elevShade: this.app.state.elevShade,
        elevContours: this.app.state.elevContours,
        elevTint: this.app.state.elevTint,
      },
      activeLayer: this.app.activeLayer.id,
      layers,
      labels: this.app.labels.all(),
      compass: this.app.compass.get(),
      fog: pngs(this.app.fog),
    };
    return JSON.stringify(file);
  }

  private async load(text: string): Promise<void> {
    const file = JSON.parse(text) as VmapFile;
    if (file?.format !== 'vmap' || !Array.isArray(file.layers)) throw new Error('This is not a Mapper .vmap file.');
    if (file.version !== 1 && file.version !== 2) {
      throw new Error('This map was made by a newer version of Mapper.');
    }
    // v1 had one layer of paint, which becomes Biomes. v2 layers match by id; unknown ones are skipped.
    const fogTiles = file.version === 2 && Array.isArray(file.fog) ? [{ id: 'fog' as const, tiles: file.fog }] : [];
    const layers =
      file.version === 1
        ? [{ id: 'biomes' as LayerId, tiles: file.layers[0]?.tiles ?? [] }]
        : file.layers.flatMap((l) => (isLayerId(l.id) ? [{ ...l, id: l.id }] : []));

    // Decode everything first so a bad file doesn't leave a half-cleared map.
    const images = await Promise.all(
      [...layers, ...fogTiles].flatMap((l) =>
        // createImageBitmap rather than img.decode(): decode() never settles while the page isn't rendering.
        (l.tiles ?? []).map(async (t) => {
          const img = await createImageBitmap(await (await fetch(t.png)).blob());
          return { layer: l.id, x: t.x, y: t.y, img };
        }),
      ),
    );

    this.app.resetDocument();
    if (file.version === 2) {
      this.app.layers.restore({ layers: layers as LayerProps[], active: file.activeLayer ?? 'biomes' });
    }
    this.app.labels.load(file.version === 2 ? file.labels : []);
    this.app.compass.load(file.version === 2 ? file.compass : null);
    for (const t of images) {
      const target = t.layer === 'fog' ? this.app.fog : this.app.layers.get(t.layer).tiles;
      target.getOrCreate(t.x, t.y).ctx.drawImage(t.img, 0, 0);
      t.img.close();
    }
    Object.assign(this.app.camera, file.camera);
    this.app.update({
      gridSize: file.settings?.gridSize ?? DEFAULT_STATE.gridSize,
      showGrid: file.settings?.showGrid ?? DEFAULT_STATE.showGrid,
      paperGrain: file.settings?.paperGrain ?? DEFAULT_STATE.paperGrain,
      agedEdges: file.settings?.agedEdges ?? DEFAULT_STATE.agedEdges,
      sepia: file.settings?.sepia ?? DEFAULT_STATE.sepia,
      fog: file.settings?.fog ?? DEFAULT_STATE.fog,
      elevShade: file.settings?.elevShade ?? DEFAULT_STATE.elevShade,
      elevContours: file.settings?.elevContours ?? DEFAULT_STATE.elevContours,
      elevTint: file.settings?.elevTint ?? DEFAULT_STATE.elevTint,
    });
    this.app.viewChanged();
  }

  private setModified(v: boolean): void {
    if (v === this.modified) return;
    this.modified = v;
    for (const fn of this.listeners) fn();
  }
}

const DEFAULT_ZOOM = 2;

function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.vmap,application/json';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
