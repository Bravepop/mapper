# Mapper

A paint-style map maker for Valheim's immersive mode (no in-game map). Draw your world as you explore it, on a meter grid centered on the spawn stones.

See [PLAN.md](PLAN.md) for the full roadmap. Phases 1 (drawing MVP), 2 (hand-made map tools) and 3 (Valheim markers, fog of war) are implemented.

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
| Line / Polyline / Rectangle / Ellipse | `L` / `Shift+L` / `R` / `O` |
| Snap to 45°, square, circle | Hold Shift while drawing a shape |
| Finish / cancel a polyline | Double-click or `Enter` / `Esc` (`Backspace` removes the last point) |
| Texture brush / Stamp / Compass rose | `X` / `S` / `C` |
| Reveal (fog of war) | `F` |
| Ruler | `M` (Shift snaps to 45°, `Enter` draws it on the map, `Esc` clears) |
| Text / Select | `T` / `V` |
| Edit a label's text | Click it with Text, or double-click it (or `Enter`) with Select |
| Delete the selected label | `Delete` or `Backspace` |
| Pick a color from the map | Alt+click (any tool) |
| Brush size | `[` / `]` |
| Toggle grid | `Shift+G` |
| Center on spawn | `H` |
| Undo / Redo | `Ctrl+Z` / `Ctrl+Y` (or `Ctrl+Shift+Z`) |
| Save / Save as / Open | `Ctrl+S` / `Ctrl+Shift+S` / `Ctrl+O` |

- **Scale:** 1 pixel of paint is 1 meter. The status bar shows where the cursor is (meters E/W and N/S of spawn) and its distance from spawn. A scale bar sits in the bottom-left corner.
- **Grid:** pick a cell size from 1 to 500 m. When you zoom out, the grid switches to coarser steps so the lines don't blur together.
- **Layers:** the map has four layers: Biomes, Paths, Ink / Outlines and Notes. You always paint on the highlighted layer; click a layer's name to switch. Each layer can be hidden (eye), locked (padlock), faded with its opacity slider, or moved up and down. Locked and hidden layers can't be painted on.
- **Shapes:** lines, polylines (coastlines, roads, rivers), rectangles and ellipses use the **Width** setting for their outline. Tick **Filled** to fill rectangles, ellipses and polylines. Click a polyline's first point to close it. Shapes are painted hard-edged into the active layer like the brush, so the fill bucket stops at them.
- **Line styles:** pencil, brush and shape outlines can be **Solid**, **Dashed** (trails) or **Dotted** (sea routes, borders). Dashed and dotted lines have gaps, so the fill bucket leaks through them; outline areas you want to fill with a solid line.
- **Smoothing** (pencil, brush, eraser) steadies freehand lines: the paint trails the pointer on a short string and only moves when the string is pulled tight. Higher values give smoother curves; it catches up to the pointer when you let go.
- **Texture brush:** paints a pattern of ink symbols along your stroke: Forest, Pine forest, Swamp, Mountains, Hills, Waves or Stipple. Pick the pattern in the top bar. **Size** is the symbol height in meters, and the circle around the pointer shows how wide the symbols scatter.
- **Stamps:** click to place one symbol. The landscape set is tree, pine, rock, peak, cave, tower, longhouse, camp, ship, skull and grave. The Valheim markers are portal, bed / base, boss altar, burial chamber, troll cave, crypt, mine, trader and death marker. The faint preview shows exactly what will be inked. With **Add a label** on, a text box opens under the symbol for a name or note (a portal tag, "iron here"); press Enter to keep it, or Esc / leave it empty for just the symbol. The symbol and its label undo together, and the label stays an ordinary editable label.
- Textures and stamps are drawn like pen-and-ink on an old fantasy map, in the current color. Each one comes out a little different, and they're painted hard-edged into the active layer, so the eraser and undo work on them like any other paint.
- **Compass rose:** with the **Compass** tool, click to place the map's compass rose, or drag it to move it. Choose **Ornate** or **Simple** and a size in meters. While the tool is active, the color palette recolors it. `Delete` or **Remove** takes it off. North always points up.
- **Paper:** the sidebar toggles **Parchment grain** (stains and fibers over the whole map), **Aged edges** (darker rim and corners) and **Sepia ink** (fades paint and labels to brown ink). These only change how the map looks and are saved with it.
- **Ruler:** drag to measure a distance. It shows meters and how many grid cells that is. The measurement is only on screen and nothing is added to the map, unless you press **Draw on map** (or `Enter`). That paints the line in the current color, width and line style on the active layer and adds a label with its length, as one undo step.
- **Fog of war** (optional): tick **Fog of war** in the Paper panel to cover everything you haven't revealed with hatched parchment. Use the **Reveal** tool to paint explored land clear (Size sets the brush), or switch it to **Hide again** to fog an area back over. The fog is a separate mask, so revealing never changes your drawing. It undoes and saves like everything else.
- **Labels:** with the **Text** tool, click the map and type a place name (Enter to keep it, Esc to cancel). Labels use the Uncial Antiqua map font, which is bundled with the app, so it works offline. They're kept as editable text, not paint: use **Select** to drag them around, and with a label selected the **Size** (meters, so labels scale with the map), **Rotate** and **Curve** controls and the color palette restyle it. Curve bends the text along an arc. With no label selected, those controls set the style for new labels. A label belongs to the layer that was active when you made it, so it hides, locks and fades with that layer. Fill and the eyedropper ignore labels.
- **Fill** only spreads across the part of the map you can see, up to 1 km from the click, so filling an open area doesn't flood the whole world. Raise **Tolerance** to fill across slight color differences. By default fill stops at lines on the layer you're painting; switch it to *all visible layers* to fill a biome right up to coastlines you drew on Ink.
- **Autosave:** your map is saved in the browser about a second after each change and restored when you reopen the page. Use **Save** to keep a `.vmap` file as a real backup, since clearing browser data wipes the autosave.

## Code layout

```
src/
  app.ts            app state, input handling (pan/zoom/tool dispatch)
  core/             camera, layer stack and tiled raster layers, labels, undo history, painting, autosave, .vmap file I/O
  render/           renderer, adaptive grid, labels, compass rose, paper effects, fog
  tools/            pencil/brush/eraser (stroke.ts), shapes, texture brush, stamps, compass, ruler, reveal (fog), fill, eyedropper, text/select (label.ts)
  ui/               toolbar, palette, status bar, shortcuts
  valheim/          biome colors, ink symbols and texture patterns (glyphs.ts)
```
