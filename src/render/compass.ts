import type { Camera } from '../core/camera';
import type { Compass } from '../core/compass';
import { LABEL_FONT } from '../core/labels';

/** Point (x, y) at `len` from the center in compass direction `deg` (0 = north, clockwise). */
const polar = (deg: number, len: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [Math.sin(a) * len, -Math.cos(a) * len];
};

/**
 * One star point as two halves (left and right of its center line), so one
 * half can be inked solid for the classic engraved look.
 */
function starPoint(ctx: CanvasRenderingContext2D, deg: number, len: number, halfWidth: number, fillLeft: boolean): void {
  const tip = polar(deg, len);
  const left = polar(deg - 45, halfWidth);
  const right = polar(deg + 45, halfWidth);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(...left);
  ctx.lineTo(...tip);
  ctx.closePath();
  if (fillLeft) ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(...right);
  ctx.lineTo(...tip);
  ctx.closePath();
  ctx.stroke();
}

/** Draw the compass rose in CSS-pixel screen space, as ink line art in its color. */
export function drawCompass(ctx: CanvasRenderingContext2D, c: Compass, cam: Camera): void {
  const r = (c.size / 2) * cam.zoom;
  if (r < 4) return;
  ctx.save();
  ctx.translate(cam.toScreenX(c.x), cam.toScreenY(c.y));
  ctx.strokeStyle = ctx.fillStyle = c.color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1, r * 0.022);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const ring = (radius: number) => {
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();
  };
  const letter = (text: string, deg: number, dist: number, px: number) => {
    ctx.font = `${px}px ${LABEL_FONT}`;
    ctx.fillText(text, ...polar(deg, dist));
  };

  if (c.style === 'simple') {
    ring(r * 0.55);
    for (const deg of [0, 90, 180, 270]) starPoint(ctx, deg, r * 0.9, r * 0.13, true);
    letter('N', 0, r * 1.08, r * 0.3);
  } else {
    // Double outer ring with tick marks between.
    ring(r);
    ring(r * 0.9);
    for (let i = 0; i < 32; i++) {
      const long = i % 4 === 0;
      ctx.beginPath();
      ctx.moveTo(...polar(i * 11.25, r * 0.9));
      ctx.lineTo(...polar(i * 11.25, long ? r : r * 0.95));
      ctx.stroke();
    }
    ring(r * 0.42);
    // Intercardinal points behind, cardinal points on top.
    for (const deg of [45, 135, 225, 315]) starPoint(ctx, deg, r * 0.62, r * 0.1, false);
    for (const deg of [0, 90, 180, 270]) starPoint(ctx, deg, r * 0.86, r * 0.15, true);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.04, 0, Math.PI * 2);
    ctx.fill();
    letter('N', 0, r * 1.17, r * 0.24);
    letter('E', 90, r * 1.15, r * 0.18);
    letter('S', 180, r * 1.15, r * 0.18);
    letter('W', 270, r * 1.15, r * 0.18);
  }
  ctx.restore();
}

/** Is world point (x, y) on the compass? */
export const hitCompass = (c: Compass, x: number, y: number): boolean => Math.hypot(x - c.x, y - c.y) <= c.size * 0.6;
