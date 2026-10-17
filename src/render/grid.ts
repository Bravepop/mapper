import type { Camera } from '../core/camera';

/** Grid steps (meters) the grid can coarsen to when zoomed out, with the matching major-line spacing. */
const STEPS: [cell: number, major: number][] = [
  [1, 10],
  [2, 10],
  [5, 50],
  [10, 100],
  [25, 100],
  [50, 250],
  [100, 1000],
  [250, 1000],
  [500, 2500],
  [1000, 5000],
  [2500, 10000],
  [5000, 10000],
];

const MIN_CELL_PX = 8;
const MIN_LABEL_PX = 70;

export const GRID_SIZES = [1, 2, 5, 10, 25, 50, 100, 250, 500];

/** The cell actually drawn: the user's chosen size, coarsened when zoomed out so lines don't merge. */
export function effectiveGrid(base: number, zoom: number): { cell: number; major: number } {
  for (const [cell, major] of STEPS) {
    if (cell >= base && cell * zoom >= MIN_CELL_PX) return { cell, major };
  }
  const [cell, major] = STEPS[STEPS.length - 1];
  return { cell, major };
}

/** Format a world x coordinate as "500 E" / "500 W". */
export const formatEW = (x: number): string => (x === 0 ? '0' : `${Math.abs(Math.round(x)).toLocaleString()} ${x > 0 ? 'E' : 'W'}`);
/** Format a world y coordinate (screen-down) as "500 N" / "500 S". */
export const formatNS = (y: number): string => (y === 0 ? '0' : `${Math.abs(Math.round(y)).toLocaleString()} ${y < 0 ? 'N' : 'S'}`);

/** Draws in device pixels (identity transform) so 1px lines stay crisp. */
export function drawGrid(ctx: CanvasRenderingContext2D, cam: Camera, dpr: number, base: number): void {
  const { cell, major } = effectiveGrid(base, cam.zoom);
  const r = cam.visibleRect();
  const W = cam.width * dpr;
  const H = cam.height * dpr;
  const sx = (x: number) => Math.round(cam.toScreenX(x) * dpr) + 0.5;
  const sy = (y: number) => Math.round(cam.toScreenY(y) * dpr) + 0.5;

  const minor = new Path2D();
  const majorPath = new Path2D();
  for (let x = Math.floor(r.x0 / cell) * cell; x <= r.x1; x += cell) {
    const p = x % major === 0 ? majorPath : minor;
    p.moveTo(sx(x), 0);
    p.lineTo(sx(x), H);
  }
  for (let y = Math.floor(r.y0 / cell) * cell; y <= r.y1; y += cell) {
    const p = y % major === 0 ? majorPath : minor;
    p.moveTo(0, sy(y));
    p.lineTo(W, sy(y));
  }

  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(70, 50, 30, 0.14)';
  ctx.stroke(minor);
  ctx.strokeStyle = 'rgba(70, 50, 30, 0.38)';
  ctx.stroke(majorPath);

  // Axes through the spawn stones.
  ctx.strokeStyle = 'rgba(140, 40, 20, 0.45)';
  ctx.lineWidth = Math.max(1, dpr);
  ctx.beginPath();
  ctx.moveTo(sx(0), 0);
  ctx.lineTo(sx(0), H);
  ctx.moveTo(0, sy(0));
  ctx.lineTo(W, sy(0));
  ctx.stroke();

  if (major * cam.zoom < MIN_LABEL_PX) return;
  ctx.font = `${11 * dpr}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(60, 40, 25, 0.8)';
  ctx.textBaseline = 'top';
  for (let x = Math.floor(r.x0 / major) * major; x <= r.x1; x += major) {
    ctx.fillText(formatEW(x), sx(x) + 3 * dpr, 4 * dpr);
  }
  ctx.textBaseline = 'bottom';
  for (let y = Math.floor(r.y0 / major) * major; y <= r.y1; y += major) {
    ctx.fillText(formatNS(y), 4 * dpr, sy(y) - 2 * dpr);
  }
}
