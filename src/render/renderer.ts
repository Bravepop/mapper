import type { App } from '../app';
import { TILE_SIZE, WORLD_RADIUS } from '../core/constants';
import type { Tile, TileLayer } from '../core/layer';
import { drawGrid } from './grid';
import { drawCompass } from './compass';
import { ElevationRenderer } from './elevation';
import { FogLayer } from './fog';
import { drawLabel, outlineLabel } from './labels';
import { drawAgedEdges, drawGrain, SEPIA_FILTER } from './paper';

const OUTSIDE = '#2e2a24';
const PARCHMENT = '#efe4c8';
const SCALE_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private frame = 0;
  private fogLayer = new FogLayer();
  private relief: ElevationRenderer;

  constructor(
    private canvas: HTMLCanvasElement,
    private app: App,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas not supported');
    this.ctx = ctx;
    this.relief = new ElevationRenderer(app.layers.get('elevation').tiles);
  }

  /** Forget cached derived images (after the whole document is replaced). */
  clearCaches(): void {
    this.relief.clear();
  }

  resize(width: number, height: number): void {
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.app.camera.width = width;
    this.app.camera.height = height;
    this.draw();
  }

  request(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw(): void {
    const { ctx, dpr } = this;
    const { camera: cam, state } = this.app;

    // Background and world disc, in CSS pixels.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = OUTSIDE;
    ctx.fillRect(0, 0, cam.width, cam.height);
    ctx.beginPath();
    ctx.arc(cam.toScreenX(0), cam.toScreenY(0), WORLD_RADIUS * cam.zoom, 0, Math.PI * 2);
    ctx.fillStyle = PARCHMENT;
    ctx.fill();

    // Tiles and grid in device pixels so edges line up exactly.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Each layer's labels draw right after its paint, so layer order applies to both.
    const labels = this.app.labels.all();
    if (state.sepia) ctx.filter = SEPIA_FILTER;
    this.relief.beginFrame();
    for (const layer of this.app.layers.all) {
      if (!layer.visible || layer.opacity <= 0) continue;
      ctx.globalAlpha = layer.opacity;
      if (layer.id === 'elevation') {
        // Relief instead of raw band colors; the bands show as tints while you paint them.
        const style = {
          shade: state.elevShade,
          contours: state.elevContours,
          tint: state.elevTint || this.app.activeLayer.id === 'elevation',
        };
        this.drawTiles(layer.tiles, ctx, false, (tile) => this.relief.render(tile, style));
      } else {
        this.drawTiles(layer.tiles);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const label of labels) {
        if (label.layer === layer.id && label.id !== this.app.editingLabel) drawLabel(ctx, label, cam);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const compass = this.app.compass.get();
    if (compass) drawCompass(ctx, compass, cam);
    ctx.filter = 'none';
    if (state.fog) {
      const fctx = this.fogLayer.begin(cam, dpr, this.canvas.width, this.canvas.height);
      this.drawTiles(this.app.fog, fctx, true);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.fogLayer.end(ctx);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    if (state.paperGrain) drawGrain(ctx, cam);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (state.showGrid) drawGrid(ctx, cam, dpr, state.gridSize);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (state.agedEdges) drawAgedEdges(ctx, cam);
    const selected = this.app.selected;
    if (selected && (state.tool === 'select' || state.tool === 'text') && selected.id !== this.app.editingLabel) {
      outlineLabel(ctx, selected, cam);
    }
    this.drawWorldEdge();
    this.drawSpawn();
    if (!this.app.isPanning) this.app.tool.drawOverlay?.(ctx, this.app.cursor, cam);
    this.drawScaleBar();
    // Relief tiles left stale by the frame budget: keep refreshing.
    if (this.relief.deferred) this.request();
  }

  /** Draw a tile layer in device pixels. `smooth` blurs pixel edges when zoomed in (used for the fog mask). */
  private drawTiles(
    layer: TileLayer,
    ctx = this.ctx,
    smooth = false,
    image: (tile: Tile) => CanvasImageSource = (tile) => tile.canvas,
  ): void {
    const { dpr } = this;
    const cam = this.app.camera;
    ctx.imageSmoothingEnabled = smooth || cam.zoom < 1;
    ctx.imageSmoothingQuality = 'high';

    const r = cam.visibleRect();
    const tx0 = Math.floor(r.x0 / TILE_SIZE);
    const tx1 = Math.floor(r.x1 / TILE_SIZE);
    const ty0 = Math.floor(r.y0 / TILE_SIZE);
    const ty1 = Math.floor(r.y1 / TILE_SIZE);

    const draw = (tile: Tile) => {
      const x0 = Math.round(cam.toScreenX(tile.tx * TILE_SIZE) * dpr);
      const x1 = Math.round(cam.toScreenX((tile.tx + 1) * TILE_SIZE) * dpr);
      const y0 = Math.round(cam.toScreenY(tile.ty * TILE_SIZE) * dpr);
      const y1 = Math.round(cam.toScreenY((tile.ty + 1) * TILE_SIZE) * dpr);
      ctx.drawImage(image(tile), x0, y0, x1 - x0, y1 - y0);
    };

    // Zoomed far out, there are more visible slots than painted tiles: walk the tiles instead.
    if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > layer.size) {
      for (const tile of layer.values()) {
        if (tile.tx >= tx0 && tile.tx <= tx1 && tile.ty >= ty0 && tile.ty <= ty1) draw(tile);
      }
    } else {
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const tile = layer.get(tx, ty);
          if (tile) draw(tile);
        }
      }
    }
  }

  private drawWorldEdge(): void {
    const { ctx } = this;
    const cam = this.app.camera;
    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(140, 40, 20, 0.6)';
    ctx.beginPath();
    ctx.arc(cam.toScreenX(0), cam.toScreenY(0), WORLD_RADIUS * cam.zoom, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawSpawn(): void {
    const { ctx } = this;
    const cam = this.app.camera;
    const x = cam.toScreenX(0);
    const y = cam.toScreenY(0);
    if (x < -50 || y < -50 || x > cam.width + 50 || y > cam.height + 50) return;
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#8c2814';
    ctx.fillStyle = 'rgba(239, 228, 200, 0.9)';
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#8c2814';
    ctx.fill();
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('Spawn', x + 10, y);
  }

  private drawScaleBar(): void {
    const { ctx } = this;
    const cam = this.app.camera;
    const meters = SCALE_STEPS.find((m) => m * cam.zoom >= 80) ?? SCALE_STEPS[SCALE_STEPS.length - 1];
    const len = meters * cam.zoom;
    const x = 16;
    const y = cam.height - 18;
    ctx.fillStyle = 'rgba(239, 228, 200, 0.85)';
    ctx.fillRect(x - 6, y - 20, len + 12, 28);
    ctx.strokeStyle = '#2a211a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x, y);
    ctx.lineTo(x + len, y);
    ctx.lineTo(x + len, y - 5);
    ctx.stroke();
    ctx.fillStyle = '#2a211a';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.fillText(meters >= 1000 ? `${meters / 1000} km` : `${meters} m`, x, y - 4);
  }
}
