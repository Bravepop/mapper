import type { App } from '../app';
import type { Camera } from '../core/camera';
import type { Edit } from '../core/history';
import { inkGlyph } from '../core/ink';
import { stamp, type Point } from '../core/paint';
import { inkWidth, TEXTURES, type Texture } from '../valheim/glyphs';
import { strokeTwoTone, type Cursor, type Tool, type ToolEvent } from './tool';

/** How many recent placements are checked to keep glyphs from piling up. */
const RECENT = 48;
/** Glyphs closer than this (in glyph sizes) to a recent one are skipped. */
const MIN_GAP = 0.55;

/**
 * Paints a pattern of ink symbols (trees, tufts, peaks, waves, stipple) along
 * the stroke. Symbols are scattered with some randomness across a band
 * around the pointer, and each one is rasterized hard-edged into the active
 * layer in the current color.
 */
export class TextureTool implements Tool {
  readonly id = 'texture';
  private edit: Edit | null = null;
  private last: Point | null = null;
  /** Distance travelled since the last placement. */
  private travel = 0;
  private recent: { x: number; y: number; s: number }[] = [];

  constructor(private app: App) {}

  private get texture(): Texture {
    return TEXTURES.find((t) => t.id === this.app.state.texture) ?? TEXTURES[0];
  }

  private get size(): number {
    return this.app.state.glyphSize;
  }

  onDown(e: ToolEvent): void {
    if (!this.app.canPaint()) return;
    this.edit = this.app.history.begin();
    this.last = { x: e.wx, y: e.wy };
    this.travel = 0;
    this.recent = [];
    this.place(e.wx, e.wy, 1, 0);
    this.app.requestRender();
  }

  onMove(e: ToolEvent): void {
    const a = this.last;
    if (!this.edit || !a) return;
    const dx = e.wx - a.x;
    const dy = e.wy - a.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return;
    const step = Math.max(1, this.texture.spacing * this.size);
    let d = step - this.travel;
    for (; d <= len; d += step) this.place(a.x + (dx * d) / len, a.y + (dy * d) / len, dx / len, dy / len);
    this.travel = len - (d - step);
    this.last = { x: e.wx, y: e.wy };
    this.app.requestRender();
  }

  onUp(): void {
    if (!this.edit) return;
    this.app.history.commit(this.edit);
    this.edit = null;
    this.last = null;
  }

  /** Scatter the texture around (x, y); (ux, uy) is the stroke direction. */
  private place(x: number, y: number, ux: number, uy: number): void {
    const t = this.texture;
    const size = this.size;
    const color = this.app.state.color;
    const edit = this.edit!;
    const r = Math.random;

    if (t.glyphs.length === 0) {
      // Stipple: a sprinkle of dots across a disc the size of the brush.
      const n = 1 + Math.round(size / 12);
      const dotR = size >= 40 ? 1 : 0;
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2;
        const dist = Math.sqrt(r()) * size * t.spread;
        stamp(edit, x + Math.cos(a) * dist, y + Math.sin(a) * dist, dotR, color);
      }
      return;
    }

    // Offset sideways (perpendicular to the stroke) and a little along it.
    const side = (r() - 0.5) * 2 * t.spread * size;
    const along = (r() - 0.5) * 0.3 * t.spacing * size;
    const gx = x - uy * side + ux * along;
    const gy = y + ux * side + uy * along;
    const s = size * (t.scale[0] + r() * (t.scale[1] - t.scale[0]));
    for (const p of this.recent) {
      if (Math.hypot(p.x - gx, p.y - gy) < MIN_GAP * Math.min(p.s, s)) return;
    }
    this.recent.push({ x: gx, y: gy, s });
    if (this.recent.length > RECENT) this.recent.shift();
    const glyph = t.glyphs[Math.floor(r() * t.glyphs.length)];
    inkGlyph(edit, glyph, gx, gy, s, inkWidth(s), color, r);
  }

  drawOverlay(ctx: CanvasRenderingContext2D, cursor: Cursor | null, cam: Camera): void {
    if (!cursor) return;
    // The band the symbols scatter across.
    const t = this.texture;
    const radius = (t.spread * this.size + (t.glyphs.length ? this.size / 2 : 0)) * cam.zoom;
    const p = new Path2D();
    if (radius >= 4) p.arc(cursor.sx, cursor.sy, radius, 0, Math.PI * 2);
    p.moveTo(cursor.sx - 5, cursor.sy);
    p.lineTo(cursor.sx + 5, cursor.sy);
    p.moveTo(cursor.sx, cursor.sy - 5);
    p.lineTo(cursor.sx, cursor.sy + 5);
    strokeTwoTone(ctx, p);
  }
}
