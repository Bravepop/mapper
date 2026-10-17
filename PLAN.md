# Mapper — Hand-Drawn Map Tool for Valheim (Immersive Mode)

A paint-style drawing app for building your own world map while you play with no in-game map.
Runs on a second monitor or alt-tab while playing.

> **Philosophy:** Mapper is a set of drawing tools, not a navigation aid. Making the map by hand is the fun part, so the app never works out positions for you. The grid and the coordinate readout stay as a passive guide, like graph paper.

---

## 1. Goals

- Draw the map the way you'd draw it on paper: freehand, quickly, with mistakes that are easy to fix.
- A **grid with a real-world scale** (meters per cell) as a passive guide for sizes and distances.
- Paint-style tools: pencil, brush, eraser, fill bucket, shapes, line styles, text, texture brushes, stamps.
- Valheim flavor: biome color palette, hand-placed symbols (portals, bases, bosses, dungeons), a parchment look.
- Show elevation in a way that **doesn't need exact measurements** (see section 6).
- Never lose work: autosave plus saving to a file.

## 2. Tech Stack

| Choice | Why |
|---|---|
| **TypeScript + Vite** | Fast dev loop, runs in any browser, no install for players |
| **HTML5 Canvas 2D** | Pixel painting, flood fill, and layers are simple and fast |
| **No UI framework at first** (plain DOM toolbar) | Keeps it small. Can move to React later if the UI grows |
| **Save format: `.vmap` (JSON + PNG layers as base64)** | Readable, versionable, easy to back up |
| **Autosave: IndexedDB** | Survives browser refresh or crash |
| *(Later)* **Tauri** wrapper | Turns it into a real desktop `.exe` with native file dialogs and always-on-top |

## 3. Core Concepts

### World coordinates and scale
- The map is an **infinite (or very large) canvas** measured in **world meters**, not pixels.
- The **origin (0,0) is the spawn stones** (the sacrificial stones at world center), which is a fixed landmark you always know.
- A Valheim world is about **20 km across** (radius ~10,000 m). The canvas covers that full area, but you'll mostly zoom into the explored part.
- Zoom and pan change how meters map to screen pixels. Drawing stays sharp because each layer is stored at a fixed resolution (for example 1 px = 1 m, tiled into chunks).

### The grid
- Configurable cell size: **10 m / 25 m / 50 m / 100 m / 500 m**. Grid lines change with zoom level (major and minor lines, like graph paper).
- Coordinate readout under the cursor: `X: +340 m, Z: −1,210 m` and **distance from spawn**.
- Optional labels on the grid (A1, B2…) so you can write notes like "crypt at F7".

### Direction
- North-up map with a compass rose.
- In-game the sun rises in the east and sets in the west; a reminder appears in the UI to help you orient.

## 4. Feature Roadmap

### Phase 1: Drawing MVP (done)
- [x] Vite + TypeScript project scaffold
- [x] Canvas with pan (middle-mouse or space+drag) and zoom (scroll wheel)
- [x] Grid overlay with configurable meters-per-cell, plus cursor coordinates
- [x] Tools: **Pencil**, **Brush** (size slider), **Eraser**, **Fill bucket**, **Eyedropper**
- [x] Color picker plus a **Valheim biome palette** (Meadows, Black Forest, Swamp, Mountain, Plains, Ocean, Mistlands, Ashlands, Deep North)
- [x] Undo / redo (Ctrl+Z / Ctrl+Y)
- [x] Autosave to IndexedDB, plus manual Save/Load to a `.vmap` file
- [x] Keyboard shortcuts (B brush, E eraser, G fill, etc. like Paint/Photoshop)

### Phase 2: Hand-made map tools (done)
Built in this order:
1. [x] **Layers:** Biomes · Paths · Ink/Outlines · Notes.
   - A layers panel to show/hide, lock, set opacity and reorder each layer. Painting goes to the active layer.
   - Fill reads the active layer by default, with an option to use all visible layers as its boundaries.
   - Undo, autosave and `.vmap` are per-layer. `.vmap` moves to version 2; v1 files load into the Biomes layer.
2. [x] **Shapes:** line, polyline, rectangle, ellipse, each as an outline or filled.
   - Polyline: click to add points; double-click or Enter finishes; Esc cancels.
   - Shift snaps to 45°.
   - Shapes rasterize hard-edged into the active layer, like the brush, so fill keeps working.
3. [x] **Smoothing and line styles:** optional stroke stabilizer; solid, dashed (trails) and dotted (sea routes, borders) lines.
4. [x] **Text and labels:** place names in a hand-lettered map font (Uncial Antiqua, bundled), with adjustable size, color and rotation, optionally bent along an arc. Labels stay editable vector objects, with a small Select/move/delete tool.
5. [x] **Texture brushes:** paintable patterns such as trees (forest), tufts (swamp), peaks (mountain), waves (ocean) and stipple.
6. [x] **Stamps:** hand-drawn style symbols you place yourself: tree, rock, cave, tower, camp, ship, skull, and so on.
7. [x] **Paper look:** parchment texture, aged-edge vignette, optional ink/sepia style, and a compass rose you place and style.
8. [x] **Simple ruler:** drag to read a length against the grid. Nothing is kept on the map unless you choose to.

### Phase 3: Markers and Valheim flavor (done)
- [x] Valheim icon stamps you place and label yourself: Portal, Base/Bed, Boss altar, Burial chamber, Troll cave, Crypt, Mine, Trader, Ship, Death marker. They're ordinary hand-placed stamps with a text label, not smart objects
- [x] *(Optional)* **Fog of war:** unexplored area shows as parchment, and you "reveal" it as you explore

### Phase 4: Elevation (see section 6)
- [ ] Elevation band painting layer
- [ ] Hillshade or contour rendering from painted bands
- [ ] Spot-height markers

### Phase 5: Desktop polish
- [ ] Tauri wrapper so it runs as a native `.exe`
- [ ] Always-on-top / compact mode for a second monitor
- [ ] Export to PNG

## 5. Architecture Sketch

```
src/
  main.ts              – bootstraps app
  core/
    camera.ts          – pan/zoom, world<->screen transform
    document.ts        – map doc model: layers, markers, settings
    history.ts         – undo/redo (command pattern + tile snapshots)
    storage.ts         – IndexedDB autosave, .vmap import/export
  render/
    renderer.ts        – draws layers + grid + overlays each frame
    grid.ts            – adaptive grid lines and labels
    tiles.ts           – chunked raster storage (e.g. 512x512 m tiles)
  tools/
    tool.ts            – Tool interface (onDown/onMove/onUp/cursor)
    pencil.ts, brush.ts, eraser.ts, fill.ts, eyedropper.ts
    ruler.ts, shape.ts, stamp.ts, text.ts, select.ts
  ui/
    toolbar.ts, palette.ts, layersPanel.ts, statusBar.ts
  valheim/
    biomes.ts          – biome names + colors
    markers.ts         – icon set definitions
```

**Key design decisions**
- **Chunked raster tiles** instead of one giant canvas, so a 20 km world doesn't use gigabytes of memory. Only tiles you've drawn on exist.
- **Vector objects** (text labels, and later markers) are stored separately from the raster paint, so they stay sharp and can be edited. Shapes, stamps and texture brushes rasterize into the active layer.
- **Tool interface:** every tool implements the same small interface, so adding tools is easy.
- **Undo** stores before/after snapshots of only the tiles a stroke touched.

## 6. Elevation Without Measuring

You can't read altitude in the game, but you can usually tell **relative** height. The plan is to record what you can actually observe:

1. **Elevation bands (main approach):** Paint height with a set of discrete bands, like a topographic map:
   `Deep water · Shallow water · Shore · Lowland · Hills · Highland · Mountain · Peak`.
   You paint roughly "this area is hilly, that ridge is high." The app renders the bands as tinted contours or hillshade under the biome layer.
2. **Biome hints:** Valheim biomes follow height loosely (Ocean is low, Swamp is flat and low, Mountain is high), so the app can suggest a starting band when you paint a biome.
3. **Slope arrows / ridge lines:** Quick strokes for "uphill this way," cliffs, and ridgelines. These are often more useful than absolute heights for finding your way.
4. **Spot heights:** Optional markers with a relative value you write yourself (for example "≈ +40 m above sea").

This gives you a useful terrain picture without fake precision, and the data model leaves room for real numbers later.

## 7. Open Questions

- Browser app first, or go straight to a desktop app (Tauri)? *Recommendation: browser first, then wrap it with Tauri.*
- Do you play on more than one world? If so, add a world/seed picker with one map document per world.
- Multiplayer: would friends want to share or merge maps? (Later. The `.vmap` format could support merging.)

## 8. Next Step

Phase 4: elevation bands, hillshade or contours, and spot heights (section 6).
