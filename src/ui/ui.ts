import { isTextInput, MAX_GLYPH_SIZE, MAX_SIZE, MAX_SMOOTHING, MIN_GLYPH_SIZE, MIN_SIZE, type App } from '../app';
import { MAX_LABEL_SIZE, MIN_LABEL_SIZE } from '../core/labels';
import type { LineStyle } from '../core/paint';
import type { FileActions } from '../core/fileio';
import type { Autosave } from '../core/storage';
import { effectiveGrid, formatEW, formatNS, GRID_SIZES } from '../render/grid';
import type { ToolId } from '../tools/tool';
import { BIOMES, INKS, type Swatch } from '../valheim/biomes';
import { drawGlyph, seededRandom, STAMPS, TEXTURES, type GlyphId } from '../valheim/glyphs';
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
  { id: 'texture', label: 'Texture brush', key: 'X', hint: 'Paint forests, swamps, mountains, waves or stipple', group: true },
  { id: 'stamp', label: 'Stamp', key: 'S', hint: 'Click to place a map symbol' },
  { id: 'text', label: 'Text', key: 'T', hint: 'Click the map to add a label, or click a label to edit it', group: true },
  { id: 'select', label: 'Select', key: 'V', hint: 'Select a label to move, restyle or delete it (double-click to edit)' },
];

const SIZED_TOOLS: ToolId[] = ['brush', 'eraser', 'line', 'polyline', 'rect', 'ellipse', 'texture', 'stamp'];
/** Tools whose Size is the symbol height (glyphSize) rather than the brush/line width. */
const GLYPH_TOOLS: ToolId[] = ['texture', 'stamp'];
const isGlyphTool = (app: App) => GLYPH_TOOLS.includes(app.state.tool);
const FILLABLE_TOOLS: ToolId[] = ['polyline', 'rect', 'ellipse'];
const STYLED_TOOLS: ToolId[] = ['pencil', 'brush', 'line', 'polyline', 'rect', 'ellipse'];
const FREEHAND_TOOLS: ToolId[] = ['pencil', 'brush', 'eraser'];
const LABEL_TOOLS: ToolId[] = ['text', 'select'];

/** The label size slider is logarithmic: 0..100 maps to MIN..MAX_LABEL_SIZE. */
const sizeToSlider = (m: number) => (100 * Math.log(m / MIN_LABEL_SIZE)) / Math.log(MAX_LABEL_SIZE / MIN_LABEL_SIZE);
const sliderToSize = (v: number) => Math.round(MIN_LABEL_SIZE * (MAX_LABEL_SIZE / MIN_LABEL_SIZE) ** (v / 100));
const clampLabelSize = (m: number) => Math.min(MAX_LABEL_SIZE, Math.max(MIN_LABEL_SIZE, Math.round(m) || MIN_LABEL_SIZE));

export function buildUi(app: App, files: FileActions, autosave: Autosave): void {
  buildToolbar(app);
  buildTopbar(app, files);
  buildGlyphPickers(app);
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
  const setSize = (v: number) => app.update(isGlyphTool(app) ? { glyphSize: v || MIN_GLYPH_SIZE } : { size: v || MIN_SIZE });
  size.addEventListener('input', () => setSize(Number(size.value)));
  sizeValue.addEventListener('change', () => setSize(Number(sizeValue.value)));

  const tol = $<HTMLInputElement>('tolerance');
  const tolValue = $('tolerance-value');
  tol.addEventListener('input', () => app.update({ tolerance: Number(tol.value) }));
  const fillSample = $<HTMLSelectElement>('fill-sample');
  fillSample.addEventListener('change', () => app.update({ fillSample: fillSample.value as 'layer' | 'visible' }));

  const lineStyle = $<HTMLSelectElement>('line-style');
  lineStyle.addEventListener('change', () => app.update({ lineStyle: lineStyle.value as LineStyle }));
  const smoothing = $<HTMLInputElement>('smoothing');
  const smoothingValue = $('smoothing-value');
  smoothing.min = '0';
  smoothing.max = String(MAX_SMOOTHING);
  smoothing.addEventListener('input', () => app.update({ smoothing: Number(smoothing.value) }));

  // Label controls restyle the selected label, or set the style for new ones.
  const labelSize = $<HTMLInputElement>('label-size');
  const labelSizeValue = $<HTMLInputElement>('label-size-value');
  const labelRotation = $<HTMLInputElement>('label-rotation');
  const labelCurve = $<HTMLInputElement>('label-curve');
  labelSizeValue.min = String(MIN_LABEL_SIZE);
  labelSizeValue.max = String(MAX_LABEL_SIZE);
  const setLabel = (size: number, rotationDeg: number, curve: number) => {
    if (app.selected) app.editLabel({ size, rotation: (rotationDeg * Math.PI) / 180, curve: curve / 100 });
    else app.update({ labelSize: size, labelRotation: rotationDeg, labelCurve: curve });
    syncLabel();
  };
  const readLabel = (size = sliderToSize(Number(labelSize.value))) =>
    setLabel(clampLabelSize(size), Number(labelRotation.value), Number(labelCurve.value));
  labelSize.addEventListener('input', () => readLabel());
  labelSizeValue.addEventListener('change', () => readLabel(Number(labelSizeValue.value)));
  labelRotation.addEventListener('input', () => readLabel(Number(labelSizeValue.value)));
  labelCurve.addEventListener('input', () => readLabel(Number(labelSizeValue.value)));
  // Releasing a slider ends that change as one undo step.
  for (const el of [labelSize, labelSizeValue, labelRotation, labelCurve]) el.addEventListener('change', () => app.flushLabelEdit());

  const syncLabel = () => {
    const sel = app.selected;
    const s = app.state;
    const size = sel ? sel.size : s.labelSize;
    const rot = sel ? Math.round((sel.rotation * 180) / Math.PI) : s.labelRotation;
    const curve = sel ? Math.round(sel.curve * 100) : s.labelCurve;
    labelSize.value = String(sizeToSlider(size));
    labelSizeValue.value = String(size);
    labelRotation.value = String(rot);
    $('label-rotation-value').textContent = `${rot}°`;
    labelCurve.value = String(curve);
    $('label-curve-value').textContent = String(curve);
    $('label-target').textContent = sel ? 'Selected label:' : 'New labels:';
  };
  app.labels.onChange(syncLabel);

  const shapeFill = $<HTMLInputElement>('shape-fill');
  shapeFill.addEventListener('change', () => app.update({ shapeFill: shapeFill.checked }));

  const grid = $<HTMLSelectElement>('grid-size');
  grid.innerHTML = GRID_SIZES.map((g) => `<option value="${g}">${g} m</option>`).join('');
  grid.addEventListener('change', () => app.update({ gridSize: Number(grid.value) }));
  const showGrid = $<HTMLInputElement>('show-grid');
  showGrid.addEventListener('change', () => app.update({ showGrid: showGrid.checked }));

  const sync = () => {
    const s = app.state;
    const glyph = isGlyphTool(app);
    size.min = sizeValue.min = String(glyph ? MIN_GLYPH_SIZE : MIN_SIZE);
    size.max = sizeValue.max = String(glyph ? MAX_GLYPH_SIZE : MAX_SIZE);
    size.value = sizeValue.value = String(glyph ? s.glyphSize : s.size);
    $('texture-group').hidden = s.tool !== 'texture';
    $('stamp-group').hidden = s.tool !== 'stamp';
    tol.value = String(s.tolerance);
    tolValue.textContent = String(s.tolerance);
    fillSample.value = s.fillSample;
    grid.value = String(s.gridSize);
    showGrid.checked = s.showGrid;
    shapeFill.checked = s.shapeFill;
    lineStyle.value = s.lineStyle;
    smoothing.value = String(s.smoothing);
    smoothingValue.textContent = s.smoothing ? String(s.smoothing) : 'Off';
    $('style-group').hidden = !STYLED_TOOLS.includes(s.tool);
    $('smoothing-group').hidden = !FREEHAND_TOOLS.includes(s.tool);
    $('label-group').hidden = !LABEL_TOOLS.includes(s.tool);
    syncLabel();
    $('size-group').hidden = !SIZED_TOOLS.includes(s.tool);
    $('size-label').textContent = ['brush', 'eraser', 'texture', 'stamp'].includes(s.tool) ? 'Size' : 'Width';
    $('shape-group').hidden = !FILLABLE_TOOLS.includes(s.tool);
    $('tolerance-group').hidden = s.tool !== 'fill';
  };
  app.onState(sync);
  sync();
}

/** A row of small symbol buttons for the texture brush and stamp tools. */
function buildGlyphPickers(app: App): void {
  const make = <T extends string>(
    containerId: string,
    items: { id: T; name: string; glyph?: GlyphId; dots?: boolean }[],
    current: () => T,
    pick: (id: T) => void,
  ) => {
    const container = $(containerId);
    const buttons = items.map((item) => {
      const b = document.createElement('button');
      b.className = 'icon-btn glyph-btn';
      b.title = item.name;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', item.name);
      const canvas = document.createElement('canvas');
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.height = Math.round(24 * dpr);
      const ctx = canvas.getContext('2d')!;
      ctx.scale(dpr, dpr);
      ctx.strokeStyle = ctx.fillStyle = '#ece0c6';
      if (item.glyph) drawGlyph(ctx, item.glyph, 12, 12, 20, 1.4, seededRandom(7));
      else if (item.dots) {
        const rand = seededRandom(3);
        for (let i = 0; i < 14; i++) ctx.fillRect(3 + rand() * 18, 3 + rand() * 18, 1.5, 1.5);
      }
      b.append(canvas);
      b.addEventListener('click', () => pick(item.id));
      container.append(b);
      return { b, id: item.id };
    });
    const sync = () =>
      buttons.forEach(({ b, id }) => {
        const on = id === current();
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', String(on));
      });
    app.onState(sync);
    sync();
  };

  make(
    'texture-group',
    TEXTURES.map((t) => ({ id: t.id, name: t.name, glyph: t.glyphs[0], dots: t.glyphs.length === 0 })),
    () => app.state.texture,
    (id) => app.update({ texture: id }),
  );
  make(
    'stamp-group',
    STAMPS.map((s) => ({ id: s.id, name: s.name, glyph: s.id })),
    () => app.state.stamp,
    (id) => app.update({ stamp: id }),
  );
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
    x: 'texture',
    s: 'stamp',
    t: 'text',
    v: 'select',
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
    else if (key === '[' || key === ']') {
      const sign = key === ']' ? 1 : -1;
      if (isGlyphTool(app)) app.update({ glyphSize: app.state.glyphSize + sign * stepFor(app.state.glyphSize) });
      else app.update({ size: app.state.size + sign * stepFor(app.state.size) });
    }
    else if (key === '=' || key === '+') app.zoomBy(1.5);
    else if (key === '-' || key === '_') app.zoomBy(1 / 1.5);
    else if (key === 'h' || key === 'home') app.centerOnSpawn();
    else return;
    e.preventDefault();
  });
}

/** Bigger brushes change size in bigger steps. */
const stepFor = (size: number) => (size < 10 ? 1 : size < 40 ? 4 : 10);
