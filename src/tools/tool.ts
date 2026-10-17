import type { Camera } from '../core/camera';

export type ToolId = 'pencil' | 'brush' | 'eraser' | 'fill' | 'eyedropper';

/** Pointer position in world meters plus the modifiers tools care about. */
export interface ToolEvent {
  wx: number;
  wy: number;
  shiftKey: boolean;
}

export interface Cursor {
  sx: number;
  sy: number;
  wx: number;
  wy: number;
}

export interface Tool {
  readonly id: ToolId;
  onDown(e: ToolEvent): void;
  onMove(e: ToolEvent): void;
  onUp(): void;
  /** Draw a cursor preview in CSS-pixel screen space. */
  drawOverlay?(ctx: CanvasRenderingContext2D, cursor: Cursor, camera: Camera): void;
}

/** Outline a shape in black and white so it shows on any background. */
export function strokeTwoTone(ctx: CanvasRenderingContext2D, path: Path2D): void {
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.stroke(path);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.stroke(path);
}
