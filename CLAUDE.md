# Mapper

Paint-style map maker for Valheim immersive mode. Vite + TypeScript + Canvas 2D, no UI framework. See PLAN.md for the roadmap (Phases 1–2 done; Phase 3 next) and README.md for controls and code layout.

The app is a set of drawing tools, not a navigation aid: it never works out positions for the user. Keep new features in that spirit.

## Commands

- On this Windows machine PowerShell blocks `npm.ps1`: use `npm.cmd` in PowerShell (plain `npm` works in Bash).
- `npm run dev` starts Vite. The `.claude/launch.json` config "mapper" runs it on port 5174 for the browser preview.
- `npm run typecheck` / `npm run build` before committing.
- GitHub: https://github.com/Bravepop/mapper (branch `main`). Push with `git push`. The `gh` CLI is not installed.

## Design notes

- World units are meters, 1 raster pixel = 1 m. +x is east, +y is south (screen-down); Valheim's Z (north) is -y. The spawn stones are at (0, 0) and the world radius is ~10 km.
- Layers (`core/layers.ts`): a fixed stack of four (Biomes, Paths, Ink / Outlines, Notes), each with visibility, lock, opacity and order. Tools paint into the active layer; locked or hidden layers refuse paint via `app.canPaint()`. Opacity is display-only.
- Each layer's paint lives in sparse 256x256 tiles (`core/layer.ts`). Only painted tiles exist.
- Painting is hard-edged (no anti-aliasing) on purpose, so the fill bucket stops cleanly at drawn lines. Shapes, texture brushes and stamps follow this too: ink glyphs (`valheim/glyphs.ts`) are stroked on a scratch canvas, then thresholded to solid pixels (`core/ink.ts`).
- Every pixel change goes through `history.begin()` → `edit.touch(tx, ty)` → `history.commit(edit)`. `begin()` targets the active layer and each patch remembers its layer. That gives undo and also notifies autosave and the renderer.
- Vector objects are kept apart from the paint and stay editable:
  - Labels (`core/labels.ts`, `LabelStore`) belong to a layer and draw right after that layer's tiles, so they follow its order, visibility, lock and opacity. They're drawn in the bundled Uncial Antiqua font (`@fontsource/uncial-antiqua`). Change them with `history.changeLabels()`; live edits (dragging, sliders) go through `labels.put()` then `history.recordLabels()`, or `app.editLabel()` / `flushLabelEdit()`.
  - The compass rose (`core/compass.ts`) is a single object drawn above all layers; north always points up. Change it with `app.setCompass()`, or live with `app.editCompass()` / `flushCompassEdit()`.
- Fill is bounded to the visible area, up to 1 km from the click. It reads the active layer, or all visible layers when `fillSample` is 'visible'.
- Paper look (grain, aged edges, sepia) is display-only, in `render/paper.ts`.
- Autosave writes changed tiles to IndexedDB under `layerId/tx,ty` keys (`core/storage.ts`); labels, the compass and layer settings go in the meta record. Older bare `tx,ty` keys migrate into Biomes.
- Files are saved as `.vmap` version 2: JSON with every layer's settings and one PNG per tile, plus labels and the compass (`core/fileio.ts`). Version 1 files (one layer) load into Biomes.
- `window.mapper` exposes the App instance for debugging in the browser console.
