export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Maps between world space and screen space.
 *
 * World space is in meters with +x pointing east and +y pointing south (screen-down).
 * Valheim's Z axis points north, so the in-game Z coordinate is -y.
 */
export class Camera {
  static readonly MIN_ZOOM = 0.02;
  static readonly MAX_ZOOM = 40;

  /** World position at the center of the screen. */
  x = 0;
  y = 0;
  /** Screen (CSS) pixels per meter. */
  zoom = 2;
  /** Viewport size in CSS pixels. */
  width = 1;
  height = 1;

  toScreenX(wx: number): number {
    return (wx - this.x) * this.zoom + this.width / 2;
  }

  toScreenY(wy: number): number {
    return (wy - this.y) * this.zoom + this.height / 2;
  }

  toWorldX(sx: number): number {
    return (sx - this.width / 2) / this.zoom + this.x;
  }

  toWorldY(sy: number): number {
    return (sy - this.height / 2) / this.zoom + this.y;
  }

  visibleRect(): Rect {
    return {
      x0: this.toWorldX(0),
      y0: this.toWorldY(0),
      x1: this.toWorldX(this.width),
      y1: this.toWorldY(this.height),
    };
  }

  panBy(dsx: number, dsy: number): void {
    this.x -= dsx / this.zoom;
    this.y -= dsy / this.zoom;
  }

  /** Zoom by `factor`, keeping the world point under (sx, sy) fixed on screen. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const wx = this.toWorldX(sx);
    const wy = this.toWorldY(sy);
    this.zoom = Math.min(Camera.MAX_ZOOM, Math.max(Camera.MIN_ZOOM, this.zoom * factor));
    this.x = wx - (sx - this.width / 2) / this.zoom;
    this.y = wy - (sy - this.height / 2) / this.zoom;
  }

  centerOn(wx: number, wy: number): void {
    this.x = wx;
    this.y = wy;
  }
}
