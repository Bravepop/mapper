import type { Camera } from '../core/camera';
import { labelFontCss, type Label, type LabelFont } from '../core/labels';

/** Labels smaller than this on screen (px) aren't drawn. */
const MIN_SCREEN_PX = 3;
const HALO = 'rgba(239, 228, 200, 0.85)';

const measureCtx = document.createElement('canvas').getContext('2d')!;
const REF_PX = 100;

/** Width of `text` in meters when set at `size` meters tall in `font`. */
export function textWidth(text: string, size: number, font?: LabelFont): number {
  measureCtx.font = `${REF_PX}px ${labelFontCss(font)}`;
  return (measureCtx.measureText(text).width / REF_PX) * size;
}

/** Total arc angle (radians) a label bends through. */
const arcAngle = (label: Label) => Math.abs(label.curve) * Math.PI;

/**
 * Half-extents of a label's box in its own (rotated) frame, in meters,
 * plus the vertical offset of the box center from the label's anchor.
 */
export function labelBox(label: Label): { hw: number; hh: number; cy: number } {
  const w = textWidth(label.text, label.size, label.font);
  const hh = label.size * 0.6;
  const theta = arcAngle(label);
  if (theta < 1e-3) return { hw: w / 2, hh, cy: 0 };
  // Curved: the text bows away from the baseline by the arc's sagitta.
  const r = w / theta;
  const sag = r * (1 - Math.cos(theta / 2));
  const hw = r * Math.sin(Math.min(theta / 2, Math.PI / 2)) + hh;
  return { hw, hh: hh + sag / 2, cy: (Math.sign(label.curve) * sag) / 2 };
}

/** Is world point (x, y) on the label? */
export function hitLabel(label: Label, x: number, y: number, padding = 0): boolean {
  const { hw, hh, cy } = labelBox(label);
  const dx = x - label.x;
  const dy = y - label.y;
  const c = Math.cos(-label.rotation);
  const s = Math.sin(-label.rotation);
  const lx = dx * c - dy * s;
  const ly = dx * s + dy * c - cy;
  return Math.abs(lx) <= hw + padding && Math.abs(ly) <= hh + padding;
}

/** Draw a label in CSS-pixel screen space. */
export function drawLabel(ctx: CanvasRenderingContext2D, label: Label, cam: Camera): void {
  const px = label.size * cam.zoom;
  if (px < MIN_SCREEN_PX) return;
  ctx.save();
  ctx.translate(cam.toScreenX(label.x), cam.toScreenY(label.y));
  ctx.rotate(label.rotation);
  ctx.font = `${px}px ${labelFontCss(label.font)}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, px * 0.14);
  ctx.strokeStyle = HALO;
  ctx.fillStyle = label.color;

  const draw = (text: string, x: number, y: number) => {
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
  };

  const theta = arcAngle(label);
  if (theta < 1e-3) {
    draw(label.text, 0, 0);
  } else {
    // Lay the letters along a circle whose arc length matches the text width.
    // Positive curve arches up (circle center below), negative sags down.
    const sign = Math.sign(label.curve);
    const chars = [...label.text];
    const widths = chars.map((ch) => ctx.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0);
    const r = total / theta;
    // Shift so the middle of the arc sits on the anchor.
    const cy = sign * r;
    let along = -total / 2;
    chars.forEach((ch, i) => {
      const mid = along + widths[i] / 2;
      const phi = mid / r;
      ctx.save();
      ctx.translate(r * Math.sin(phi), cy - sign * r * Math.cos(phi));
      ctx.rotate(sign * phi);
      draw(ch, 0, 0);
      ctx.restore();
      along += widths[i];
    });
  }
  ctx.restore();
}

/** Dashed box around a label (selection outline), in CSS-pixel screen space. */
export function outlineLabel(ctx: CanvasRenderingContext2D, label: Label, cam: Camera): void {
  const { hw, hh, cy } = labelBox(label);
  const pad = 2 / cam.zoom + label.size * 0.1;
  ctx.save();
  ctx.translate(cam.toScreenX(label.x), cam.toScreenY(label.y));
  ctx.rotate(label.rotation);
  const w = (hw + pad) * cam.zoom;
  const h = (hh + pad) * cam.zoom;
  const y = cy * cam.zoom;
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.strokeRect(-w, y - h, 2 * w, 2 * h);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(140, 40, 20, 0.95)';
  ctx.strokeRect(-w, y - h, 2 * w, 2 * h);
  ctx.restore();
}
