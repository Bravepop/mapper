import type { Camera } from '../core/camera';

export type ShapeKind = 'line' | 'polyline' | 'rect' | 'ellipse';

export type ToolId = 'pencil' | 'brush' | 'eraser' | 'fill' | 'eyedropper' | ShapeKind | 'texture' | 'stamp' | 'text' | 'select';

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
  /** Pointer moved with no button held. */
  onHover?(e: ToolEvent): void;
  /** Key pressed while this tool is active. Return true if the tool handled it. */
  onKey?(e: KeyboardEvent): boolean;
  /** Undo a step of unfinished work (e.g. a polyline's last point). Return true if there was any. */
  undoStep?(): boolean;
  /** True while the tool has unfinished work between pointer presses (e.g. a polyline). */
  hasPending?(): boolean;
  /** Called when switching to another tool. Finishes or drops unfinished work. */
  deactivate?(): void;
  /**
   * Draw a cursor preview in CSS-pixel screen space. `cursor` is null when the
   * pointer is off the map, so tools with unfinished work can still show it.
   */
  drawOverlay?(ctx: CanvasRenderingContext2D, cursor: Cursor | null, camera: Camera): void;
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
