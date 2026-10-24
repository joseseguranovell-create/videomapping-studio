/**
 * Geometría de calibración: homografías, polígonos, triangulación y utilidades de edición.
 * Todo es puro (sin DOM) para poder probarlo y reutilizarlo en el motor y en el editor.
 */
import earcut from 'earcut';
import type { Quad, Surface, Vec2, Installation } from './model';

/** Matriz 3x3 en orden por filas. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const EPS = 1e-12;

/**
 * Homografía que lleva el cuadrado unidad (0,0)(1,0)(1,1)(0,1) al cuadrilátero dado
 * (TL, TR, BR, BL). Método de Heckbert.
 */
export function squareToQuad(q: readonly Vec2[]): Mat3 {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  if (Math.abs(dx3) < EPS && Math.abs(dy3) < EPS) {
    // Paralelogramo: transformación afín.
    return [p1.x - p0.x, p2.x - p1.x, p0.x, p1.y - p0.y, p2.y - p1.y, p0.y, 0, 0, 1];
  }
  const den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(den) < EPS) throw new Error('Cuadrilátero degenerado');
  const g = (dx3 * dy2 - dx2 * dy3) / den;
  const h = (dx1 * dy3 - dx3 * dy1) / den;
  return [
    p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x,
    p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y,
    g, h, 1,
  ];
}

export function invert3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < EPS) throw new Error('Matriz no invertible');
  const inv = 1 / det;
  return [
    A * inv, -(b * i - c * h) * inv, (b * f - c * e) * inv,
    B * inv, (a * i - c * g) * inv, -(a * f - c * d) * inv,
    C * inv, -(a * h - b * g) * inv, (a * e - b * d) * inv,
  ];
}

export function mul3(m: Mat3, n: Mat3): Mat3 {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += m[i * 3 + k] * n[k * 3 + j];
      r[i * 3 + j] = s;
    }
  return r;
}

export function applyH(m: Mat3, p: Vec2): Vec2 {
  const w = m[6] * p.x + m[7] * p.y + m[8];
  return { x: (m[0] * p.x + m[1] * p.y + m[2]) / w, y: (m[3] * p.x + m[4] * p.y + m[5]) / w };
}

/** Homografía general cuadrilátero → cuadrilátero. */
export function quadToQuad(src: readonly Vec2[], dst: readonly Vec2[]): Mat3 {
  return mul3(squareToQuad(dst), invert3(squareToQuad(src)));
}

// ───────────────────────── Polígonos ─────────────────────────

export function signedArea(pts: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function centroid(pts: readonly Vec2[]): Vec2 {
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  return { x: x / pts.length, y: y / pts.length };
}

export function bbox(pts: readonly Vec2[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function cross(o: Vec2, a: Vec2, b: Vec2) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** true si dos aristas no adyacentes se cruzan. */
export function isSelfIntersecting(pts: readonly Vec2[]): boolean {
  const n = pts.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsIntersect(a, b, pts[j], pts[(j + 1) % n])) return true;
    }
  }
  return false;
}

export function isConvex(pts: readonly Vec2[]): boolean {
  const n = pts.length;
  if (n < 3) return false;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const c = cross(pts[i], pts[(i + 1) % n], pts[(i + 2) % n]);
    if (Math.abs(c) < 1e-14) continue;
    const s = Math.sign(c);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return sign !== 0;
}

/** Ordena los vértices por ángulo alrededor del centroide (repara polígonos "fuera de orden"). */
export function sortByAngle(pts: readonly Vec2[]): Vec2[] {
  const c = centroid(pts);
  return [...pts].sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x));
}

/**
 * Reordena cuatro puntos cualesquiera como TL, TR, BR, BL (y hacia abajo).
 * Útil cuando el usuario cruza esquinas sin querer.
 */
export function orderQuad(pts: readonly Vec2[]): Quad {
  if (pts.length !== 4) throw new Error('Se necesitan 4 puntos');
  // Ordenar en sentido horario (en pantalla, y hacia abajo => ángulo creciente).
  const s = sortByAngle(pts);
  // Empezar por el más cercano a la esquina superior izquierda (menor x+y).
  let start = 0;
  for (let i = 1; i < 4; i++) if (s[i].x + s[i].y < s[start].x + s[start].y) start = i;
  const r = [0, 1, 2, 3].map((k) => ({ ...s[(start + k) % 4] }));
  return [r[0], r[1], r[2], r[3]];
}

export function isValidQuad(q: readonly Vec2[]): boolean {
  return q.length === 4 && isConvex(q) && Math.abs(signedArea(q)) > 1e-8;
}

export function pointInPolygon(p: Vec2, pts: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number; dist: number } {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const point = { x: a.x + t * dx, y: a.y + t * dy };
  return { point, t, dist: Math.hypot(p.x - point.x, p.y - point.y) };
}

/** Índice de la arista más cercana a p (la arista i va de pts[i] a pts[i+1]). */
export function nearestEdge(p: Vec2, pts: readonly Vec2[]): { index: number; point: Vec2; dist: number } {
  let best = { index: -1, point: p, dist: Infinity };
  for (let i = 0; i < pts.length; i++) {
    const r = closestPointOnSegment(p, pts[i], pts[(i + 1) % pts.length]);
    if (r.dist < best.dist) best = { index: i, point: r.point, dist: r.dist };
  }
  return best;
}

/** Triangula un polígono simple. Devuelve índices de vértices (tríos). */
export function triangulate(pts: readonly Vec2[]): number[] {
  if (pts.length < 3) return [];
  const flat: number[] = [];
  for (const p of pts) flat.push(p.x, p.y);
  return earcut(flat);
}

/** Triángulos como array plano de coordenadas [x0,y0,x1,y1,...]. */
export function triangulateToArray(pts: readonly Vec2[]): Float32Array {
  const idx = triangulate(pts);
  const out = new Float32Array(idx.length * 2);
  idx.forEach((k, i) => { out[i * 2] = pts[k].x; out[i * 2 + 1] = pts[k].y; });
  return out;
}

export function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

export function clampPoint(p: Vec2, margin = 0.25): Vec2 {
  // Permitimos salirse un poco del fotograma para poder ajustar bordes con precisión.
  return { x: Math.max(-margin, Math.min(1 + margin, p.x)), y: Math.max(-margin, Math.min(1 + margin, p.y)) };
}

// ───────────────────────── Superficies ─────────────────────────

/** Contorno de recorte efectivo de una superficie. */
export function surfaceOutline(s: Surface): Vec2[] {
  return s.shape === 'polygon' && s.polygon.length >= 3 ? s.polygon : [...s.quad];
}

export function rectQuad(x: number, y: number, w: number, h: number): Quad {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

export function quadFromBBox(pts: readonly Vec2[]): Quad {
  const b = bbox(pts);
  return rectQuad(b.minX, b.minY, b.w, b.h);
}

/**
 * Proporción ancho/alto estimada de la superficie en píxeles de salida.
 * Si el usuario la ha fijado (`aspect`), se respeta.
 */
export function surfaceAspect(s: Surface, out: { width: number; height: number }): number {
  if (s.aspect && s.aspect > 0) return s.aspect;
  const [tl, tr, br, bl] = s.quad;
  const W = out.width, H = out.height;
  const len = (a: Vec2, b: Vec2) => Math.hypot((a.x - b.x) * W, (a.y - b.y) * H);
  const w = (len(tl, tr) + len(bl, br)) / 2;
  const h = (len(tl, bl) + len(tr, br)) / 2;
  if (h < 1e-6 || w < 1e-6) return 1;
  return w / h;
}

/** Homografía salida(normalizada) → uv de superficie. */
export function outputToSurfaceUV(s: Surface): Mat3 | null {
  try {
    return invert3(squareToQuad(s.quad));
  } catch {
    return null;
  }
}

export function translatePoints<T extends Vec2>(pts: readonly T[], dx: number, dy: number): T[] {
  return pts.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
}

export function translateSurface(s: Surface, dx: number, dy: number): Surface {
  return {
    ...s,
    quad: translatePoints(s.quad, dx, dy) as Quad,
    polygon: translatePoints(s.polygon, dx, dy),
    masks: s.masks.map((m) => ({ ...m, points: translatePoints(m.points, dx, dy) })),
  };
}

/**
 * Cambio de resolución de salida.
 * - 'keep-relative': la calibración se mantiene relativa al fotograma (misma proporción → mismo resultado).
 * - 'keep-pixels': conserva la posición en píxeles anclada arriba a la izquierda (cuando cambia la proporción
 *   y el proyector recorta en lugar de escalar).
 */
export function rescaleInstallation(
  inst: Installation,
  next: { width: number; height: number },
  mode: 'keep-relative' | 'keep-pixels',
): Installation {
  if (mode === 'keep-relative') return { ...inst, output: { ...next } };
  const sx = inst.output.width / next.width, sy = inst.output.height / next.height;
  const f = (p: Vec2): Vec2 => ({ x: p.x * sx, y: p.y * sy });
  return {
    ...inst,
    output: { ...next },
    masks: inst.masks.map((m) => ({ ...m, points: m.points.map(f) })),
    surfaces: inst.surfaces.map((s) => ({
      ...s,
      quad: s.quad.map(f) as Quad,
      polygon: s.polygon.map(f),
      masks: s.masks.map((m) => ({ ...m, points: m.points.map(f) })),
    })),
  };
}

export interface SurfaceIssue {
  surfaceId: string;
  level: 'warning' | 'error';
  message: string;
}

/** Diagnóstico de geometría para avisar de perfiles incompletos o defectuosos. */
export function validateInstallation(inst: Installation): SurfaceIssue[] {
  const issues: SurfaceIssue[] = [];
  if (inst.surfaces.length === 0) issues.push({ surfaceId: '', level: 'warning', message: 'La instalación no tiene superficies.' });
  for (const s of inst.surfaces) {
    if (!isValidQuad(s.quad)) {
      issues.push({ surfaceId: s.id, level: 'error', message: `«${s.name}»: las esquinas están cruzadas o el cuadrilátero no es convexo.` });
    }
    if (s.shape === 'polygon') {
      if (s.polygon.length < 3) issues.push({ surfaceId: s.id, level: 'error', message: `«${s.name}»: el polígono necesita al menos 3 vértices.` });
      else if (isSelfIntersecting(s.polygon)) issues.push({ surfaceId: s.id, level: 'warning', message: `«${s.name}»: el contorno se cruza consigo mismo.` });
    }
    const out = surfaceOutline(s);
    const b = bbox(out);
    if (b.maxX < 0 || b.maxY < 0 || b.minX > 1 || b.minY > 1) {
      issues.push({ surfaceId: s.id, level: 'warning', message: `«${s.name}» está fuera del área proyectada.` });
    }
  }
  return issues;
}
