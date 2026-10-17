/** Side length of a raster tile, in pixels. One pixel is one meter, so a tile is 256 m × 256 m. */
export const TILE_SIZE = 256;

/** Approximate radius of a Valheim world, in meters. The spawn stones sit at the center (0, 0). */
export const WORLD_RADIUS = 10_000;

/** Painting is clamped slightly beyond the world edge so coastlines at the rim can still be drawn. */
export const PAINT_LIMIT = WORLD_RADIUS + 512;
