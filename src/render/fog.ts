import type { Camera } from '../core/camera';
import { WORLD_RADIUS } from '../core/constants';

const FOG_COLOR = 'rgba(233, 220, 188, 0.96)';
const HATCH = 'rgba(120, 90, 55, 0.22)';

let hatch: HTMLCanvasElement | null = null;

/** A small tile of diagonal pen hatching, the classic mark for unexplored land. */
function hatchTile(): HTMLCanvasElement {
  if (hatch) return hatch;
  const c = document.createElement('canvas');
  c.width = c.height = 14;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = FOG_COLOR;
  ctx.fillRect(0, 0, 14, 14);
  ctx.strokeStyle = HATCH;
  ctx.lineWidth = 1;
  ctx.beginPath();
  // Two segments so the diagonal wraps seamlessly.
  ctx.moveTo(-1, 15);
  ctx.lineTo(15, -1);
  ctx.moveTo(-1, 1);
  ctx.lineTo(1, -1);
  ctx.moveTo(13, 15);
  ctx.lineTo(15, 13);
  ctx.stroke();
  hatch = c;
  return c;
}

/**
 * Off-screen layer for fog of war: hatched parchment over the world disc,
 * with the revealed areas cut out.
 */
export class FogLayer {
  private canvas = document.createElement('canvas');
  readonly ctx = this.canvas.getContext('2d')!;

  /** Size the fog canvas to the view (device pixels) and fill the world disc with fog. */
  begin(cam: Camera, dpr: number, width: number, height: number): CanvasRenderingContext2D {
    const { canvas, ctx } = this;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const pattern = ctx.createPattern(hatchTile(), 'repeat')!;
    pattern.setTransform(new DOMMatrix().translate(cam.toScreenX(0) * dpr, cam.toScreenY(0) * dpr));
    ctx.fillStyle = pattern;
    ctx.beginPath();
    ctx.arc(cam.toScreenX(0) * dpr, cam.toScreenY(0) * dpr, WORLD_RADIUS * cam.zoom * dpr, 0, Math.PI * 2);
    ctx.fill();
    // Revealed tiles drawn next erase the fog. Smoothing softens the cut edges.
    ctx.globalCompositeOperation = 'destination-out';
    return ctx;
  }

  /** Composite the fog onto the map (device-pixel transform). */
  end(target: CanvasRenderingContext2D): void {
    this.ctx.globalCompositeOperation = 'source-over';
    target.drawImage(this.canvas, 0, 0);
  }
}
