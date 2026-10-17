# Mapper

Paint-style map maker for Valheim immersive mode. Vite + TypeScript + Canvas 2D, no UI framework. See PLAN.md for the roadmap (Phase 1 done; Phase 2 next) and README.md for controls and code layout.

## Commands

- On this Windows machine PowerShell blocks `npm.ps1`: use `npm.cmd` in PowerShell (plain `npm` works in Bash).
- `npm run dev` starts Vite. The `.claude/launch.json` config "mapper" runs it on port 5174 for the browser preview.
- `npm run typecheck` / `npm run build` before committing.
- GitHub: https://github.com/Bravepop/mapper (branch `main`). Push with `git push`. The `gh` CLI is not installed.

## Design notes

- World units are meters, 1 raster pixel = 1 m. +x is east, +y is south (screen-down); Valheim's Z (north) is -y. The spawn stones are at (0, 0) and the world radius is ~10 km.
- Paint lives in sparse 256x256 tiles (`core/layer.ts`). Only painted tiles exist.
- Painting is hard-edged (no anti-aliasing) on purpose, so the fill bucket stops cleanly at drawn lines.
- Every pixel change goes through `history.begin()` → `edit.touch(tx, ty)` → `history.commit(edit)`. That gives undo and also notifies autosave and the renderer.
- Fill is bounded to the visible area, up to 1 km from the click.
- Autosave writes changed tiles to IndexedDB (`core/storage.ts`). Files are saved as `.vmap`: JSON containing one PNG per tile (`core/fileio.ts`).
- `window.mapper` exposes the App instance for debugging in the browser console.
