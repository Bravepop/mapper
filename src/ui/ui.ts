import { isTextInput, MAX_SIZE, MIN_SIZE, type App } from '../app';
import type { FileActions } from '../core/fileio';
import type { Autosave } from '../core/storage';
import { effectiveGrid, formatEW, formatNS, GRID_SIZES } from '../render/grid';
import type { ToolId } from '../tools/tool';
import { BIOMES, INKS, type Swatch } from '../valheim/biomes';
import { ICONS } from './icons';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const TOOLS: { id: ToolId; label: string; key: string; hint: string; group?: boolean }[] = [
  { id: 'pencil', label: 'Pencil', key: 'P', hint: '1 m hard line' },
  { id: 'brush', label: 'Brush', key: 'B', hint: 'Sized round brush' },
  { id: 'eraser', label: 'Eraser', key: 'E', hint: 'Erase back to parchment' },
  { id: 'fill', label: 'Fill', key: 'G', hint: 'Fill an enclosed area (within the visible map)' },
  { id: 'eyedropper', label: 'Eyedropper', key: 'I', hint: 'Pick a color from the map (or Alt+click with any tool)' },
  { id: 'line', label: 'Line', key: 'L', hint: 'Drag a straight line. Shift snaps to 45°', group: true },
  { id: 'polyline', label: 'Polyline', key: 'Shift+L', hint: 'Click to add points; double-click or Enter to finish, Esc to cancel' },
  { id: 'rect', label: 'Rectangle', key: 'R', hint: 'Drag a rectangle. Shift makes a square' },
  { id: 'ellipse', label: 'Ellipse', key: 'O', hint: 'Drag an ellipse. Shift makes a circle' },
];

const SIZED_TOOLS: ToolId[] = ['brush', 'eraser', 'line', 'polyline', 'rect', 'ellipse'];
const FILLABLE_TOOLS: ToolId[] = ['polyline', 'rect', 'ellipse'];

export function buildUi(app: App, files: FileActions, autosave: Autosave): void {
  buildToolbar(app);
  buildTopbar(app, files);
  buildLayers(app);
  buildPalette(app);
  buildNotice(app);
  buildStatus(app, files, autosave);
  bindShortcuts(app, files);
}

function iconButton(icon: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'icon-btn';
  b.innerHTML = icon;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.addEventListener('click', onClick);
  return b;
}

function buildToolbar(app: App): void {
  const bar = $('toolbar');
  const buttons = TOOLS.map((t) => {
    const b = iconButton(ICONS[t.id], `${t.label} (${t.key}) — ${t.hint}`, () => app.update({ tool: t.id }));
    b.dataset.tool = t.id;
    if (t.group) bar.append(Object.assign(document.createElement('hr'), { className: 'tool-sep' }));
    bar.append(b);
    return b;
  });
  const sync = () => buttons.forEach((b) => b.classList.toggle('active', b.dataset.tool === app.state.tool));
  app.onState(sync);
  sync();
}

function buildTopbar(app: App, files: FileActions): void {
  const fileGroup = $('file-actions');
  fileGroup.append(
    iconButton(ICONS.newFile, 'New map', () => void files.newMap()),
    iconButton(ICONS.open, 'Open map… (Ctrl+O)', () => void files.open()),
    iconButton(ICONS.save, 'Save map (Ctrl+S) — Ctrl+Shift+S to save as', () => void files.save()),
  );

  const undo = iconButton(ICONS.undo, 'Undo (Ctrl+Z)', () => app.undo());
  const redo = iconButton(ICONS.redo, 'Redo (Ctrl+Y)', () => app.redo());
  $('history-actions').append(undo, redo);
  const syncHistory = () => {
    undo.disabled = !app.history.canUndo;
    redo.disabled = !app.history.canRedo;
  };
  app.history.onChange(syncHistory);
  syncHistory();

  $('view-actions').append(
    iconButton(ICONS.zoomOut, 'Zoom out (−)', () => app.zoomBy(1 / 1.5)),
    iconButton(ICONS.zoomIn, 'Zoom in (+)', () => app.zoomBy(1.5)),
    iconButton(ICONS.spawn, 'Center on spawn (H)', () => app.centerOnSpawn()),
  );

  const size = $<HTMLInputElement>('size');
  const sizeValue = $<HTMLInputElement>('size-value');
  size.min = sizeValue.min = String(MIN_SIZE);
  size.max = sizeValue.max = String(MAX_SIZE);
  size.addEventListener('input', () => app.update({ size: Number(size.value) }));
  sizeValue.addEventListener('change', () => app.update({ size: Number(sizeValue.value) || MIN_SIZE }));

  const tol = $<HTMLInputElement>('tolerance');
  const tolValue = $('tolerance-value');
  tol.addEventListener('input', () => app.update({ tolerance: Number(tol.value) }));
  const fillSample = $<HTMLSelectElement>('fill-sample');
  fillSample.addEventListener('change', () => app.update({ fillSample: fillSample.value as 'layer' | 'visible' }));

  const shapeFill = $<HTMLInputElement>('shape-fill');
  shapeFill.addEventListener('change', () => app.update({ shapeFill: shapeFill.checked }));

  const grid = $<HTMLSelectElement>('grid-size');
  grid.innerHTML = GRID_SIZES.map((g) => `<option value="${g}">${g} m</option>`).join('');
  grid.addEventListener('change', () => app.update({ gridSize: Number(grid.value) }));
  const showGrid = $<HTMLInputElement>('show-grid');
  showGrid.addEventListener('change', () => app.update({ showGrid: showGrid.checked }));

  const sync = () => {
    const s = app.state;
    size.value = sizeValue.value = String(s.size);
    tol.value = String(s.tolerance);
    tolValue.textContent = String(s.tolerance);
    fillSample.value = s.fillSample;
    grid.value = String(s.gridSize);
    showGrid.checked = s.showGrid;
    shapeFill.checked = s.shapeFill;
    $('size-group').hidden = !SIZED_TOOLS.includes(s.tool);
    $('size-label').textContent = s.tool === 'brush' || s.tool === 'eraser' ? 'Size' : 'Width';
    $('shape-group').hidden = !FILLABLE_TOOLS.includes(s.tool);
    $('tolerance-group').hidden = s.tool !== 'fill';
  };
  app.onState(sync);
  sync();
}

function buildLayers(app: App): void {
  const list = $('layers');
  const { layers } = app;

  const render = () => {
    list.replaceChildren();
    // Top layer first, like most paint programs.
    const ordered = [...layers.all].reverse();
    ordered.forEach((layer, i) => {
      const li = document.createElement('li');
      li.className = 'layer';
      li.classList.toggle('active', layer.id === layers.active.id);
      li.classList.toggle('hidden', !layer.visible);
      li.dataset.layer = layer.id;

      const eye = iconButton(layer.visible ? ICONS.eye : ICONS.eyeOff, layer.visible ? 'Hide layer' : 'Show layer', () =>
        layers.set(layer.id, { visible: !layer.visible }),
      );
      eye.classList.add('small');
      eye.setAttribute('aria-pressed', String(layer.visible));
      const lock = iconButton(layer.locked ? ICONS.lock : ICONS.unlock, layer.locked ? 'Unlock layer' : 'Lock layer', () =>
        layers.set(layer.id, { locked: !layer.locked }),
      );
      lock.classList.add('small');
      lock.classList.toggle('on', layer.locked);
      lock.setAttribute('aria-pressed', String(layer.locked));

      const name = document.createElement('button');
      name.className = 'layer-name';
      name.textContent = layer.name;
      name.title = 'Paint on this layer';
      name.addEventListener('click', () => layers.setActive(layer.id));

      const up = iconButton(ICONS.up, 'Move layer up', () => layers.move(layer.id, 1));
      up.classList.add('small');
      up.disabled = i === 0;
      const down = iconButton(ICONS.down, 'Move layer down', () => layers.move(layer.id, -1));
      down.classList.add('small');
      down.disabled = i === ordered.length - 1;

      const opacity = document.createElement('input');
      opacity.type = 'range';
      opacity.min = '0';
      opacity.max = '100';
      opacity.value = String(Math.round(layer.opacity * 100));
      opacity.className = 'layer-opacity';
      opacity.title = `Opacity ${opacity.value}%`;
      opacity.setAttribute('aria-label', `${layer.name} opacity`);
      opacity.addEventListener('input', () => {
        opacity.title = `Opacity ${opacity.value}%`;
        // Update in place so the slider keeps focus while dragging.
        layer.opacity = Number(opacity.value) / 100;
        app.requestRender();
      });
      opacity.addEventListener('change', () => layers.set(layer.id, { opacity: Number(opacity.value) / 100 }));

      const row = document.createElement('div');
      row.className = 'layer-row';
      row.append(eye, lock, name, up, down);
      li.append(row, opacity);
      list.append(li);
    });
  };
  layers.onChange(render);
  render();
}

function buildNotice(app: App): void {
  const el = $('notice');
  let timer = 0;
  app.onNotice((msg) => {
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(timer);
    timer = window.setTimeout(() => (el.hidden = true), 2500);
  });
}

function buildPalette(app: App): void {
  const current = $<HTMLInputElement>('current-color');
  current.addEventListener('input', () => app.update({ color: current.value }));

  const swatches: HTMLButtonElement[] = [];
  const addGroup = (containerId: string, list: Swatch[]) => {
    const container = $(containerId);
    for (const s of list) {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.title = `${s.name} (${s.color})`;
      b.dataset.color = s.color;
      b.innerHTML = `<span class="chip" style="background:${s.color}"></span><span class="name">${s.name}</span>`;
      b.addEventListener('click', () => app.update({ color: s.color }));
      container.append(b);
      swatches.push(b);
    }
  };
  addGroup('biome-swatches', BIOMES);
  addGroup('ink-swatches', INKS);

  const sync = () => {
    current.value = app.state.color;
    $('current-color-hex').textContent = app.state.color.toUpperCase();
    swatches.forEach((b) => b.classList.toggle('active', b.dataset.color === app.state.color));
  };
  app.onState(sync);
  sync();
}

function buildStatus(app: App, files: FileActions, autosave: Autosave): void {
  const pos = $('status-pos');
  const dist = $('status-dist');
  const scale = $('status-grid');
  const file = $('status-file');
  const save = $('status-save');

  const syncView = () => {
    const c = app.cursor;
    if (c) {
      pos.textContent = `${formatEW(c.wx)} · ${formatNS(c.wy)}`;
      dist.textContent = `${Math.round(Math.hypot(c.wx, c.wy)).toLocaleString()} m from spawn`;
    } else {
      pos.textContent = '—';
      dist.textContent = '';
    }
    const { cell } = effectiveGrid(app.state.gridSize, app.camera.zoom);
    const shown = app.state.showGrid ? `Grid ${cell} m${cell !== app.state.gridSize ? ' (zoomed out)' : ''}` : 'Grid off';
    scale.textContent = `${shown} · Zoom ${Math.round(app.camera.zoom * 100)}%`;
  };
  app.onView(syncView);
  app.onState(syncView);
  syncView();

  const syncFile = () => {
    file.textContent = `${files.fileName ?? 'Untitled map'}${files.modified ? ' •' : ''}`;
    file.title = files.modified ? 'Changes not yet saved to a .vmap file (they are autosaved in the browser)' : '';
  };
  files.onChange(syncFile);
  syncFile();

  const labels = { idle: '', pending: 'Autosaving…', saving: 'Autosaving…', saved: 'Autosaved', error: 'Autosave failed!' };
  const syncSave = () => {
    save.textContent = labels[autosave.status];
    save.classList.toggle('error', autosave.status === 'error');
    syncFile();
  };
  autosave.onStatus(syncSave);
  syncSave();
}

function bindShortcuts(app: App, files: FileActions): void {
  const toolKeys: Record<string, ToolId> = {
    p: 'pencil',
    b: 'brush',
    e: 'eraser',
    g: 'fill',
    i: 'eyedropper',
    l: 'line',
    r: 'rect',
    o: 'ellipse',
  };

  window.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    if (ctrl) {
      const actions: Record<string, () => void> = {
        z: () => (e.shiftKey ? app.redo() : app.undo()),
        y: () => app.redo(),
        s: () => void files.save(e.shiftKey),
        o: () => void files.open(),
      };
      if (actions[key]) {
        e.preventDefault();
        actions[key]();
      }
      return;
    }
    if (isTextInput(e.target) || e.altKey) return;
    if (app.tool.onKey?.(e)) {
      e.preventDefault();
      return;
    }

    if (key === 'g' && e.shiftKey) app.update({ showGrid: !app.state.showGrid });
    else if (key === 'l' && e.shiftKey) app.update({ tool: 'polyline' });
    else if (toolKeys[key]) app.update({ tool: toolKeys[key] });
    else if (key === '[') app.update({ size: app.state.size - stepFor(app.state.size) });
    else if (key === ']') app.update({ size: app.state.size + stepFor(app.state.size) });
    else if (key === '=' || key === '+') app.zoomBy(1.5);
    else if (key === '-' || key === '_') app.zoomBy(1 / 1.5);
    else if (key === 'h' || key === 'home') app.centerOnSpawn();
    else return;
    e.preventDefault();
  });
}

/** Bigger brushes change size in bigger steps. */
const stepFor = (size: number) => (size < 10 ? 1 : size < 40 ? 4 : 10);
