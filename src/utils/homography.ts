// Projection en perspective d'une image sur un quadrilatère, pour l'incrustation
// d'objets (meubles, luminaires) dans une photo (module Studio Photo).

import type { Vec2 } from '../types';

/** Coefficients d'une transformation projective envoyant le carré unité vers un quadrilatère. */
export interface Homography {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  g: number;
  h: number;
  /** Projette un point (u,v) du carré unité [0,1]×[0,1] dans l'espace du quadrilatère. */
  map(u: number, v: number): Vec2;
}

/**
 * Calcule la transformation projective envoyant le carré unité (0,0),(1,0),(1,1),(0,1)
 * sur le quadrilatère `quad`, dont les coins sont donnés dans l'ordre :
 * haut-gauche (p0), haut-droit (p1), bas-droit (p2), bas-gauche (p3).
 */
export function computeHomography(quad: [Vec2, Vec2, Vec2, Vec2]): Homography {
  const [p0, p1, p2, p3] = quad;
  const x0 = p0.x;
  const y0 = p0.y;
  const x1 = p1.x;
  const y1 = p1.y;
  const x2 = p2.x;
  const y2 = p2.y;
  const x3 = p3.x;
  const y3 = p3.y;

  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;

  let a: number;
  let b: number;
  let c: number;
  let d: number;
  let e: number;
  let f: number;
  let g: number;
  let h: number;

  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    // Cas affine (parallélogramme) : pas de terme de perspective.
    g = 0;
    h = 0;
    a = x1 - x0;
    b = x3 - x0;
    c = x0;
    d = y1 - y0;
    e = y3 - y0;
    f = y0;
  } else {
    const den = dx1 * dy2 - dy1 * dx2;
    const safeDen = Math.abs(den) < 1e-9 ? 1e-9 : den;
    g = (dx3 * dy2 - dy3 * dx2) / safeDen;
    h = (dx1 * dy3 - dy1 * dx3) / safeDen;
    a = x1 - x0 + g * x1;
    b = x3 - x0 + h * x3;
    c = x0;
    d = y1 - y0 + g * y1;
    e = y3 - y0 + h * y3;
    f = y0;
  }

  return {
    a,
    b,
    c,
    d,
    e,
    f,
    g,
    h,
    map(u: number, v: number): Vec2 {
      const w = g * u + h * v + 1;
      const safeW = Math.abs(w) < 1e-9 ? 1e-9 : w;
      return {
        x: (a * u + b * v + c) / safeW,
        y: (d * u + e * v + f) / safeW,
      };
    },
  };
}

interface AffineCoeffs {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/**
 * Résout la transformation affine exacte envoyant 3 points source sur 3 points
 * destination (système 2×3, résolution par déterminant / Cramer). Renvoie `null`
 * si les 3 points source sont colinéaires (triangle dégénéré).
 */
function solveAffine(s0: Vec2, s1: Vec2, s2: Vec2, d0: Vec2, d1: Vec2, d2: Vec2): AffineCoeffs | null {
  const dsx1 = s1.x - s0.x;
  const dsy1 = s1.y - s0.y;
  const dsx2 = s2.x - s0.x;
  const dsy2 = s2.y - s0.y;
  const den = dsx1 * dsy2 - dsx2 * dsy1;
  if (Math.abs(den) < 1e-9) return null;

  const ddx1 = d1.x - d0.x;
  const ddx2 = d2.x - d0.x;
  const ddy1 = d1.y - d0.y;
  const ddy2 = d2.y - d0.y;

  const a = (ddx1 * dsy2 - ddx2 * dsy1) / den;
  const c = (ddx2 * dsx1 - ddx1 * dsx2) / den;
  const e = d0.x - a * s0.x - c * s0.y;

  const b = (ddy1 * dsy2 - ddy2 * dsy1) / den;
  const d = (ddy2 * dsx1 - ddy1 * dsx2) / den;
  const f = d0.y - b * s0.x - d * s0.y;

  return { a, b, c, d, e, f };
}

/**
 * Dilate légèrement un triangle destination vers l'extérieur (depuis son centroïde),
 * uniquement pour le chemin de découpe (clip), afin de masquer les fines coutures
 * entre triangles adjacents lors du rendu.
 */
function dilateTriangle(p0: Vec2, p1: Vec2, p2: Vec2, amount: number): [Vec2, Vec2, Vec2] {
  const cx = (p0.x + p1.x + p2.x) / 3;
  const cy = (p0.y + p1.y + p2.y) / 3;
  const push = (p: Vec2): Vec2 => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return p;
    return { x: p.x + (dx / len) * amount, y: p.y + (dy / len) * amount };
  };
  return [push(p0), push(p1), push(p2)];
}

/** Dessine le triangle source (s0,s1,s2) de `img` projeté sur le triangle destination (d0,d1,d2). */
function drawTriangle(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  s0: Vec2,
  s1: Vec2,
  s2: Vec2,
  d0: Vec2,
  d1: Vec2,
  d2: Vec2
): void {
  const coeffs = solveAffine(s0, s1, s2, d0, d1, d2);
  if (!coeffs) return;
  const [dd0, dd1, dd2] = dilateTriangle(d0, d1, d2, 0.6);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(dd0.x, dd0.y);
  ctx.lineTo(dd1.x, dd1.y);
  ctx.lineTo(dd2.x, dd2.y);
  ctx.closePath();
  ctx.clip();
  ctx.setTransform(coeffs.a, coeffs.b, coeffs.c, coeffs.d, coeffs.e, coeffs.f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

/**
 * Dessine `img` projetée en perspective sur le quadrilatère `quad` (coordonnées déjà
 * en pixels du canvas de destination, ordre haut-gauche/haut-droit/bas-droit/bas-gauche).
 *
 * Le canvas 2D ne sachant dessiner que des transformations affines, l'image source est
 * découpée en une grille `subdiv`×`subdiv` ; chaque cellule est projetée via l'homographie
 * puis rendue en 2 triangles, chacun dessiné avec sa transformation affine exacte — ce qui
 * approxime la projection réelle avec une erreur négligeable dès que `subdiv` est suffisant.
 */
export function drawImageInQuad(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  quad: [Vec2, Vec2, Vec2, Vec2],
  subdiv = 14
): void {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (iw === 0 || ih === 0) return;

  const homography = computeHomography(quad);
  const n = Math.max(1, Math.floor(subdiv));

  // Pré-calcule la grille de points projetés, (n+1)×(n+1).
  const grid: Vec2[][] = [];
  for (let j = 0; j <= n; j++) {
    const v = j / n;
    const row: Vec2[] = [];
    for (let i = 0; i <= n; i++) {
      row.push(homography.map(i / n, v));
    }
    grid.push(row);
  }

  const savedTransform = ctx.getTransform();
  for (let j = 0; j < n; j++) {
    const v0 = j / n;
    const v1 = (j + 1) / n;
    for (let i = 0; i < n; i++) {
      const u0 = i / n;
      const u1 = (i + 1) / n;

      const d00 = grid[j][i];
      const d10 = grid[j][i + 1];
      const d11 = grid[j + 1][i + 1];
      const d01 = grid[j + 1][i];

      const s00: Vec2 = { x: u0 * iw, y: v0 * ih };
      const s10: Vec2 = { x: u1 * iw, y: v0 * ih };
      const s11: Vec2 = { x: u1 * iw, y: v1 * ih };
      const s01: Vec2 = { x: u0 * iw, y: v1 * ih };

      drawTriangle(ctx, img, s00, s10, s11, d00, d10, d11);
      drawTriangle(ctx, img, s00, s11, s01, d00, d11, d01);
    }
  }
  ctx.setTransform(savedTransform);
}

/** Teste si le point `p` est à l'intérieur du quadrilatère `quad` (ray casting, polygone simple). */
export function pointInQuad(p: Vec2, quad: [Vec2, Vec2, Vec2, Vec2]): boolean {
  let inside = false;
  for (let i = 0, j = quad.length - 1; i < quad.length; j = i++) {
    const pi = quad[i];
    const pj = quad[j];
    const crosses = pi.y > p.y !== pj.y > p.y;
    if (crosses) {
      const xIntersect = ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y) + pi.x;
      if (p.x < xIntersect) inside = !inside;
    }
  }
  return inside;
}
