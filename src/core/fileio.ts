import { DEFAULT_STATE, type App, type AppState } from '../app';
import { isTileEmpty } from './layer';
import type { Autosave } from './storage';

/** On-disk `.vmap` format: JSON with one PNG per painted tile. */
interface VmapFile {
  format: 'vmap';
  version: 1;
  savedAt: string;
  camera: { x: number; y: number; zoom: number };
  settings: Pick<AppState, 'gridSize' | 'showGrid'>;
  layers: {
    id: string;
    name: string;
    tiles: { x: number; y: number; png: string }[];
  }[];
}

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
    app.layer.onChange(() => this.setModified(true));
  }

  get fileName(): string | null {
    return this.autosave.fileName;
  }

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  async newMap(): Promise<void> {
    if (this.app.layer.size > 0 && !confirm('Start a new, empty map?\n\nThe current map will be cleared. Save it first (Ctrl+S) if you want to keep it.')) return;
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
    if (this.modified && this.app.layer.size > 0 && !confirm('Open another map?\n\nUnsaved changes to the current map will be lost.')) return;
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
    const tiles = [];
    for (const tile of this.app.layer.values()) {
      if (isTileEmpty(tile)) continue;
      tiles.push({ x: tile.tx, y: tile.ty, png: tile.canvas.toDataURL('image/png') });
    }
    const { x, y, zoom } = this.app.camera;
    const file: VmapFile = {
      format: 'vmap',
      version: 1,
      savedAt: new Date().toISOString(),
      camera: { x, y, zoom },
      settings: { gridSize: this.app.state.gridSize, showGrid: this.app.state.showGrid },
      layers: [{ id: 'terrain', name: 'Terrain', tiles }],
    };
    return JSON.stringify(file);
  }

  private async load(text: string): Promise<void> {
    const file = JSON.parse(text) as VmapFile;
    if (file.format !== 'vmap' || file.version !== 1 || !Array.isArray(file.layers)) {
      throw new Error('This is not a Mapper .vmap file (or it was made by a newer version).');
    }
    // Decode everything first so a bad file doesn't leave a half-cleared map.
    const tiles = file.layers[0]?.tiles ?? [];
    const images = await Promise.all(
      tiles.map(async (t) => {
        const img = new Image();
        img.src = t.png;
        await img.decode();
        return { ...t, img };
      }),
    );

    this.app.resetDocument();
    for (const t of images) this.app.layer.getOrCreate(t.x, t.y).ctx.drawImage(t.img, 0, 0);
    Object.assign(this.app.camera, file.camera);
    this.app.update({
      gridSize: file.settings?.gridSize ?? DEFAULT_STATE.gridSize,
      showGrid: file.settings?.showGrid ?? DEFAULT_STATE.showGrid,
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
