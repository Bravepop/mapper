# Mapper

A paint-style map maker for Valheim's immersive mode (no in-game map). Draw your world as you explore it, on a meter grid centered on the spawn stones.

See [PLAN.md](PLAN.md) for the full roadmap. Phase 1 (drawing MVP) is implemented.

## Run it

```bash
npm install
npm run dev
```

Then open the URL Vite prints (http://localhost:5173 by default).

> **Windows PowerShell:** if `npm` fails with "running scripts is disabled on this system", use `npm.cmd` instead (`npm.cmd run dev`).

Chrome or Edge is recommended: they can save straight to a `.vmap` file. Other browsers download a copy instead.

## Using it

| Action | How |
|---|---|
| Pencil / Brush / Eraser / Fill / Eyedropper | `P` / `B` / `E` / `G` / `I` |
| Pan | Right or middle drag, or hold Space and drag |
| Zoom | Mouse wheel, `+` / `−` |
| Straight line | Click, then Shift+click the end point |
| Pick a color from the map | Alt+click (any tool) |
| Brush size | `[` / `]` |
| Toggle grid | `Shift+G` |
| Center on spawn | `H` |
| Undo / Redo | `Ctrl+Z` / `Ctrl+Y` (or `Ctrl+Shift+Z`) |
| Save / Save as / Open | `Ctrl+S` / `Ctrl+Shift+S` / `Ctrl+O` |

- **Scale:** 1 pixel of paint is 1 meter. The status bar shows where the cursor is (meters E/W and N/S of spawn) and its distance from spawn. A scale bar sits in the bottom-left corner.
- **Grid:** pick a cell size from 1 to 500 m. When you zoom out, the grid switches to coarser steps so the lines don't blur together.
- **Fill** only spreads across the part of the map you can see, up to 1 km from the click, so filling an open area doesn't flood the whole world. Raise **Tolerance** to fill across slight color differences.
- **Autosave:** your map is saved in the browser about a second after each change and restored when you reopen the page. Use **Save** to keep a `.vmap` file as a real backup, since clearing browser data wipes the autosave.

## Code layout

```
src/
  app.ts            app state, input handling (pan/zoom/tool dispatch)
  core/             camera, tiled raster layer, undo history, painting, autosave, .vmap file I/O
  render/           renderer and adaptive grid
  tools/            pencil/brush/eraser (stroke.ts), fill, eyedropper
  ui/               toolbar, palette, status bar, shortcuts
  valheim/          biome colors
```
