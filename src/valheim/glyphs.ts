/**
 * Hand-drawn ink symbols in the style of an old fantasy map: single-color pen
 * strokes, no shading fills except small solid details (a cave mouth, eyes).
 *
 * Each glyph draws into a unit box centered on the origin (x and y from -0.5
 * to 0.5, y down) with the context's current stroke/fill style. `rand` adds a
 * little wobble so repeated symbols don't look machine-made.
 */
export type Rand = () => number;
export type GlyphFn = (ctx: CanvasRenderingContext2D, rand: Rand) => void;

/** Small random nudge for a coordinate. */
const w = (rand: Rand, v: number, amount = 0.025) => v + (rand() - 0.5) * 2 * amount;

function poly(ctx: CanvasRenderingContext2D, rand: Rand, pts: [number, number][], close = false): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(w(rand, x), w(rand, y)) : ctx.moveTo(w(rand, x), w(rand, y))));
  if (close) ctx.closePath();
  ctx.stroke();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

export const GLYPHS = {
  /** Broadleaf tree: scalloped crown on a short trunk. */
  tree(ctx, rand) {
    const cy = -0.12;
    const r = 0.27;
    const n = 7;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = Math.PI * 0.75 + (i / n) * Math.PI * 1.5;
      const x = Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) {
        ctx.moveTo(x, y);
        continue;
      }
      const m = a - (Math.PI * 0.75) / n;
      const bulge = r + w(rand, 0.11, 0.03);
      ctx.quadraticCurveTo(Math.cos(m) * bulge, cy + Math.sin(m) * bulge, x, y);
    }
    ctx.stroke();
    poly(ctx, rand, [
      [0, 0.1],
      [0, 0.45],
    ]);
  },

  /** Conifer: stacked chevrons on a trunk. */
  pine(ctx, rand) {
    for (let k = 0; k < 3; k++) {
      const top = -0.46 + k * 0.17;
      const half = 0.12 + k * 0.07;
      poly(ctx, rand, [
        [-half, top + 0.22],
        [0, top],
        [half, top + 0.22],
      ]);
    }
    poly(ctx, rand, [
      [0, -0.46],
      [0, 0.46],
    ]);
  },

  /** Marsh tuft: a few blades springing from a short ground line. */
  tuft(ctx, rand) {
    // Blades lean outward from spread-out roots, so small tufts don't clot into a blob.
    const blades: [number, number, number][] = [
      // [root x, tip x, tip y]
      [-0.2, -0.42, -0.05],
      [-0.04, -0.12, -0.42],
      [0.12, 0.2, -0.34],
      [0.24, 0.44, 0.02],
    ];
    for (const [bx, tx, ty] of blades) {
      ctx.beginPath();
      ctx.moveTo(w(rand, bx, 0.02), 0.3);
      ctx.quadraticCurveTo(w(rand, bx + (tx - bx) * 0.2), w(rand, 0.0), w(rand, tx), w(rand, ty));
      ctx.stroke();
    }
    poly(ctx, rand, [
      [-0.38, 0.32],
      [0.38, 0.32],
    ]);
  },

  /** Mountain peak with hatching on the shadowed (east) side. */
  peak(ctx, rand) {
    const apex: [number, number] = [w(rand, 0, 0.04), -0.46];
    poly(ctx, rand, [[-0.5, 0.42], apex, [0.5, 0.42]]);
    // Ridge line and shading strokes.
    poly(ctx, rand, [
      [apex[0], apex[1]],
      [0.06, -0.12],
      [0.0, 0.1],
    ]);
    for (let i = 1; i <= 4; i++) {
      const t = i / 5;
      const x = apex[0] + (0.5 - apex[0]) * t;
      const y = apex[1] + (0.42 - apex[1]) * t;
      poly(ctx, rand, [
        [x - 0.02, y + 0.02],
        [x - 0.14, y + 0.2],
      ]);
    }
  },

  /** Rounded hill with a couple of shading strokes. */
  hill(ctx, rand) {
    ctx.beginPath();
    ctx.moveTo(w(rand, -0.5), 0.25);
    ctx.quadraticCurveTo(w(rand, 0), w(rand, -0.6, 0.05), w(rand, 0.5), 0.25);
    ctx.stroke();
    poly(ctx, rand, [
      [0.2, -0.02],
      [0.12, 0.18],
    ]);
    poly(ctx, rand, [
      [0.33, 0.08],
      [0.27, 0.22],
    ]);
  },

  /** Sea wave: a pair of little arcs. */
  wave(ctx, rand) {
    ctx.beginPath();
    ctx.moveTo(-0.45, 0.1);
    ctx.quadraticCurveTo(w(rand, -0.22), w(rand, -0.25, 0.05), 0, 0.1);
    ctx.quadraticCurveTo(w(rand, 0.22), w(rand, -0.25, 0.05), 0.45, 0.1);
    ctx.stroke();
  },

  /** Boulder with a crack. */
  rock(ctx, rand) {
    poly(
      ctx,
      rand,
      [
        [-0.42, 0.32],
        [-0.34, -0.06],
        [-0.08, -0.32],
        [0.24, -0.22],
        [0.42, 0.06],
        [0.4, 0.32],
      ],
      true,
    );
    poly(ctx, rand, [
      [-0.08, -0.32],
      [0.02, -0.04],
      [-0.06, 0.32],
    ]);
    poly(ctx, rand, [
      [0.24, -0.22],
      [0.18, 0.04],
    ]);
  },

  /** Cave: a rise with a dark mouth. */
  cave(ctx, rand) {
    ctx.beginPath();
    ctx.moveTo(-0.5, 0.36);
    ctx.quadraticCurveTo(w(rand, -0.32), w(rand, -0.42), w(rand, 0), -0.36);
    ctx.quadraticCurveTo(w(rand, 0.34), w(rand, -0.36), 0.5, 0.36);
    ctx.stroke();
    poly(ctx, rand, [
      [-0.5, 0.36],
      [0.5, 0.36],
    ]);
    ctx.beginPath();
    ctx.moveTo(-0.17, 0.36);
    ctx.arc(0, 0.36, 0.17, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
  },

  /** Watchtower with battlements. */
  tower(ctx, rand) {
    poly(ctx, rand, [
      [-0.14, 0.45],
      [-0.14, -0.22],
      [0.14, -0.22],
      [0.14, 0.45],
    ]);
    poly(ctx, rand, [
      [-0.2, -0.22],
      [-0.2, -0.45],
      [-0.1, -0.45],
      [-0.1, -0.36],
      [-0.03, -0.36],
      [-0.03, -0.45],
      [0.04, -0.45],
      [0.04, -0.36],
      [0.11, -0.36],
      [0.11, -0.45],
      [0.2, -0.45],
      [0.2, -0.22],
    ]);
    poly(ctx, rand, [
      [-0.2, 0.45],
      [0.2, 0.45],
    ]);
    // Door and arrow slit.
    ctx.beginPath();
    ctx.moveTo(-0.06, 0.45);
    ctx.arc(0, 0.33, 0.06, Math.PI, 0);
    ctx.lineTo(0.06, 0.45);
    ctx.stroke();
    poly(ctx, rand, [
      [0, -0.12],
      [0, 0.04],
    ]);
  },

  /** Camp: a tent with a pennant. */
  camp(ctx, rand) {
    poly(
      ctx,
      rand,
      [
        [-0.38, 0.38],
        [0, -0.26],
        [0.38, 0.38],
      ],
      true,
    );
    poly(ctx, rand, [
      [-0.09, 0.38],
      [0, 0.08],
      [0.09, 0.38],
    ]);
    poly(ctx, rand, [
      [0, -0.26],
      [0, -0.48],
    ]);
    ctx.beginPath();
    ctx.moveTo(0, -0.48);
    ctx.lineTo(0.2, -0.42);
    ctx.lineTo(0, -0.36);
    ctx.closePath();
    ctx.fill();
  },

  /** Longship: curved hull, mast and square sail, curled prow. */
  ship(ctx, rand) {
    ctx.beginPath();
    ctx.moveTo(-0.42, 0.12);
    ctx.quadraticCurveTo(w(rand, 0), 0.5, 0.42, 0.12);
    ctx.stroke();
    poly(ctx, rand, [
      [-0.42, 0.12],
      [0.42, 0.12],
    ]);
    // Prow and stern curls.
    ctx.beginPath();
    ctx.moveTo(0.42, 0.12);
    ctx.quadraticCurveTo(0.52, -0.02, 0.44, -0.08);
    ctx.moveTo(-0.42, 0.12);
    ctx.quadraticCurveTo(-0.52, -0.02, -0.44, -0.08);
    ctx.stroke();
    poly(ctx, rand, [
      [0, 0.12],
      [0, -0.46],
    ]);
    ctx.beginPath();
    ctx.moveTo(-0.24, -0.38);
    ctx.lineTo(0.24, -0.38);
    ctx.quadraticCurveTo(w(rand, 0.3), -0.18, 0.22, 0.02);
    ctx.lineTo(-0.22, 0.02);
    ctx.quadraticCurveTo(w(rand, -0.16), -0.18, -0.24, -0.38);
    ctx.stroke();
  },

  /** Skull: danger, a boss, or where you died. */
  skull(ctx, rand) {
    ctx.beginPath();
    ctx.arc(0, -0.1, 0.3, Math.PI * 0.8, Math.PI * 2.2);
    ctx.lineTo(0.16, 0.36);
    ctx.lineTo(-0.16, 0.36);
    ctx.closePath();
    ctx.stroke();
    dot(ctx, w(rand, -0.12, 0.01), -0.06, 0.08);
    dot(ctx, w(rand, 0.12, 0.01), -0.06, 0.08);
    poly(ctx, rand, [
      [0, 0.04],
      [-0.04, 0.13],
      [0.04, 0.13],
    ], true);
    for (const x of [-0.08, 0, 0.08]) {
      poly(ctx, rand, [
        [x, 0.24],
        [x, 0.36],
      ]);
    }
  },

  /** Longhouse: low walls under a big roof. */
  house(ctx, rand) {
    poly(ctx, rand, [
      [-0.34, 0.02],
      [-0.34, 0.36],
      [0.34, 0.36],
      [0.34, 0.02],
    ]);
    poly(
      ctx,
      rand,
      [
        [-0.46, 0.04],
        [-0.24, -0.32],
        [0.24, -0.32],
        [0.46, 0.04],
      ],
      true,
    );
    poly(ctx, rand, [
      [-0.06, 0.36],
      [-0.06, 0.16],
      [0.06, 0.16],
      [0.06, 0.36],
    ]);
  },

  /** Grave: a cross on a mound. */
  grave(ctx, rand) {
    poly(ctx, rand, [
      [0, -0.44],
      [0, 0.26],
    ]);
    poly(ctx, rand, [
      [-0.18, -0.2],
      [0.18, -0.2],
    ]);
    ctx.beginPath();
    ctx.moveTo(-0.38, 0.4);
    ctx.quadraticCurveTo(0, w(rand, 0.12, 0.03), 0.38, 0.4);
    ctx.stroke();
  },
} satisfies Record<string, GlyphFn>;

export type GlyphId = keyof typeof GLYPHS;

/** Symbols offered by the Stamp tool, in picker order. */
export const STAMPS: { id: GlyphId; name: string }[] = [
  { id: 'tree', name: 'Tree' },
  { id: 'pine', name: 'Pine' },
  { id: 'rock', name: 'Rock' },
  { id: 'peak', name: 'Peak' },
  { id: 'cave', name: 'Cave' },
  { id: 'tower', name: 'Tower' },
  { id: 'house', name: 'Longhouse' },
  { id: 'camp', name: 'Camp' },
  { id: 'ship', name: 'Ship' },
  { id: 'skull', name: 'Skull' },
  { id: 'grave', name: 'Grave' },
];

export type TextureId = 'forest' | 'pines' | 'swamp' | 'mountains' | 'hills' | 'waves' | 'stipple';

export interface Texture {
  id: TextureId;
  name: string;
  /** Glyphs scattered at random; empty for stipple (plain dots). */
  glyphs: GlyphId[];
  /** Distance between placements along the stroke, in glyph sizes. */
  spacing: number;
  /** How far placements stray sideways from the stroke, in glyph sizes. */
  spread: number;
  /** Random size range for each glyph, as a factor of the brush size. */
  scale: [number, number];
}

export const TEXTURES: Texture[] = [
  { id: 'forest', name: 'Forest', glyphs: ['tree', 'tree', 'pine'], spacing: 0.55, spread: 0.7, scale: [0.8, 1.1] },
  { id: 'pines', name: 'Pine forest', glyphs: ['pine'], spacing: 0.45, spread: 0.7, scale: [0.8, 1.15] },
  { id: 'swamp', name: 'Swamp', glyphs: ['tuft'], spacing: 0.7, spread: 0.9, scale: [0.6, 1.0] },
  { id: 'mountains', name: 'Mountains', glyphs: ['peak'], spacing: 0.6, spread: 0.45, scale: [0.75, 1.3] },
  { id: 'hills', name: 'Hills', glyphs: ['hill'], spacing: 0.75, spread: 0.6, scale: [0.7, 1.1] },
  { id: 'waves', name: 'Waves', glyphs: ['wave'], spacing: 1.1, spread: 1.0, scale: [0.6, 1.0] },
  { id: 'stipple', name: 'Stipple', glyphs: [], spacing: 0.08, spread: 0.5, scale: [1, 1] },
];

/** Small, fast seeded random generator (mulberry32), so previews match what gets painted. */
export function seededRandom(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pen width in pixels for a glyph `size` pixels tall. */
export const inkWidth = (size: number): number => Math.max(1.4, size * 0.055);

/** Draw a glyph centered at (x, y), `size` units tall, in the context's current transform. */
export function drawGlyph(ctx: CanvasRenderingContext2D, glyph: GlyphId, x: number, y: number, size: number, penPx: number, rand: Rand): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size, size);
  ctx.lineWidth = penPx / size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  GLYPHS[glyph](ctx, rand);
  ctx.restore();
}
