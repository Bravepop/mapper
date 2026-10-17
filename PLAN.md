# Mapper — Hand-Drawn Map Tool for Valheim (Immersive Mode)

A paint-style drawing app for building your own world map while you play with no in-game map.
Runs on a second monitor or alt-tab while playing.

---

## 1. Goals

- Draw the map the way you'd draw it on paper: freehand, quickly, with mistakes that are easy to fix.
- Estimate distances using a **grid with a real-world scale** (meters per cell).
- Paint-style tools: pencil, brush, eraser, fill bucket, shapes, text.
- Valheim-specific helpers: biome color palette, map markers (portals, bases, bosses, dungeons).
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

### How you measure distance in-game (no map, no coordinates)
The app helps you turn **time** and **counts** into meters:
1. **Run timer (pace counting):** Hit a hotkey, run in a straight line, hit it again. The app turns seconds into meters using your calibrated run speed.
2. **Calibration wizard:** Build a straight line of known length (e.g. 10 wood floors at 2 m each = 20 m), time yourself running it, and the app stores your speed for running, walking, and sailing.
3. **Building-piece ruler:** Wood floors and beams are 2 m, which makes a good reference for short distances.
4. **Ruler tool:** Drag a line on the map to see its length in meters and its compass bearing.

> Speeds are estimates. Calibrating lets the app use *your* actual pace instead of a guess.

### Direction
- North-up map with a compass rose.
- In-game the sun rises in the east and sets in the west; a reminder appears in the UI to help you orient.

## 4. Feature Roadmap

### Phase 1: Drawing MVP (the first thing to build)
- [ ] Vite + TypeScript project scaffold
- [ ] Canvas with pan (middle-mouse or space+drag) and zoom (scroll wheel)
- [ ] Grid overlay with configurable meters-per-cell, plus cursor coordinates
- [ ] Tools: **Pencil**, **Brush** (size slider), **Eraser**, **Fill bucket**, **Eyedropper**
- [ ] Color picker plus a **Valheim biome palette** (Meadows, Black Forest, Swamp, Mountain, Plains, Ocean, Mistlands, Ashlands, Deep North)
- [ ] Undo / redo (Ctrl+Z / Ctrl+Y)
- [ ] Autosave to IndexedDB, plus manual Save/Load to a `.vmap` file
- [ ] Keyboard shortcuts (B brush, E eraser, G fill, etc. like Paint/Photoshop)

### Phase 2: Map-maker tools
- [ ] **Layers:** Terrain/biomes · Paths & roads · Elevation · Markers · Notes. Each layer can be shown, hidden, or locked
- [ ] **Shapes:** line, polyline (good for coastlines and roads), rectangle, ellipse
- [ ] **Ruler tool** with distance and bearing
- [ ] **Run timer and calibration** (from section 3)
- [ ] **"Dead reckoning" path tool:** pick a heading and a run time, and the app draws that leg from your last point. Chain legs to trace your route
- [ ] **Text labels** (place names, notes)

### Phase 3: Markers and Valheim flavor
- [ ] Icon stamps: Portal (with name/tag), Base/Bed, Boss altar, Burial chamber, Troll cave, Crypt, Mine, Trader, Ship, Death marker
- [ ] Clicking a marker opens a notes panel ("portal tag: SWAMP1", "iron here")
- [ ] **Fog of war:** unexplored area shows as parchment, and you "reveal" it as you explore
- [ ] Parchment / hand-drawn visual style option to suit the game's look

### Phase 4: Elevation (see section 6)
- [ ] Elevation band painting layer
- [ ] Hillshade or contour rendering from painted bands
- [ ] Spot-height markers

### Phase 5: Desktop polish
- [ ] Tauri wrapper so it runs as a native `.exe`
- [ ] Always-on-top / compact mode for a second monitor
- [ ] Global hotkeys that work while the game window is focused (start/stop run timer, drop "you are here")
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
    ruler.ts, shape.ts, marker.ts, text.ts
  ui/
    toolbar.ts, palette.ts, layersPanel.ts, statusBar.ts
  valheim/
    biomes.ts          – biome names + colors
    markers.ts         – icon set definitions
    calibration.ts     – run speed + timer logic
```

**Key design decisions**
- **Chunked raster tiles** instead of one giant canvas, so a 20 km world doesn't use gigabytes of memory. Only tiles you've drawn on exist.
- **Vector objects** (markers, text, ruler lines, paths) are stored separately from the raster paint, so they stay sharp and can be edited.
- **Tool interface:** every tool implements the same small interface, so adding tools is easy.
- **Undo** stores before/after snapshots of only the tiles a stroke touched.

## 6. Elevation Without Measuring

You can't read altitude in the game, but you can usually tell **relative** height. The plan is to record what you can actually observe:

1. **Elevation bands (main approach):** Paint height with a set of discrete bands, like a topographic map:
   `Deep water · Shallow water · Shore · Lowland · Hills · Highland · Mountain · Peak`.
   You paint roughly "this area is hilly, that ridge is high." The app renders the bands as tinted contours or hillshade under the biome layer.
2. **Biome hints:** Valheim biomes follow height loosely (Ocean is low, Swamp is flat and low, Mountain is high), so the app can suggest a starting band when you paint a biome.
3. **Slope arrows / ridge lines:** Quick strokes for "uphill this way," cliffs, and ridgelines. These are often more useful than absolute heights for finding your way.
4. **Spot heights:** Optional markers with a relative value (for example "≈ +40 m above sea"), estimated from building-piece counts or from how long a climb took.

This gives you a useful terrain picture without fake precision, and the data model leaves room for real numbers later.

## 7. Open Questions

- Browser app first, or go straight to a desktop app (Tauri)? *Recommendation: browser first, then wrap it with Tauri.*
- Do you play on more than one world? If so, add a world/seed picker with one map document per world.
- Multiplayer: would friends want to share or merge maps? (Later. The `.vmap` format could support merging.)

## 8. Next Step

Scaffold Phase 1: `npm create vite@latest` (vanilla-ts), then camera + grid, then pencil/brush/eraser/fill, then save/load.
