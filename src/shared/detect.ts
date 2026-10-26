/**
 * Detección de ventanas y puertas en una foto de la fachada (sin cámara ni IA: contraste local y formas).
 * Recibe la imagen en grises y devuelve rectángulos candidatos en coordenadas normalizadas de la imagen.
 * Es una ayuda: la persona confirma o ajusta cada candidato.
 */
export interface Candidate {
  x: number; y: number; w: number; h: number;
  /** 0..1: lo rectangular y destacado que es. */
  score: number;
  kind: 'window' | 'door';
}

export interface DetectOptions {
  /** Diferencia mínima (0..255) respecto al entorno para contar como «distinto». */
  contrast?: number;
  /** Radio del entorno local como fracción del lado mayor. */
  radius?: number;
  maxResults?: number;
  /** Área mínima y máxima de un candidato (fracción de la imagen). */
  minArea?: number;
  maxArea?: number;
}

function blur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  // Media con imagen integral (rápida, suficiente para suavizar ruido).
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += src[y * w + x];
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const s = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
      out[y * w + x] = s / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

function morph(mask: Uint8Array, w: number, h: number, r: number, grow: boolean): Uint8Array {
  // Dilatación (grow) o erosión separables, con ventana cuadrada.
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  const want = grow ? 1 : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = grow ? 0 : 1;
    for (let k = -r; k <= r; k++) {
      const xx = x + k;
      const m = xx < 0 || xx >= w ? (grow ? 0 : 1) : mask[y * w + xx];
      if (m === want) { v = want; break; }
    }
    tmp[y * w + x] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = grow ? 0 : 1;
    for (let k = -r; k <= r; k++) {
      const yy = y + k;
      const m = yy < 0 || yy >= h ? (grow ? 0 : 1) : tmp[yy * w + x];
      if (m === want) { v = want; break; }
    }
    out[y * w + x] = v;
  }
  return out;
}

interface Blob { x0: number; y0: number; x1: number; y1: number; area: number }

function components(mask: Uint8Array, w: number, h: number): Blob[] {
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const blobs: Blob[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || seen[i]) continue;
    const b: Blob = { x0: w, y0: h, x1: 0, y1: 0, area: 0 };
    stack.push(i); seen[i] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w, y = (p / w) | 0;
      b.area++;
      if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
      if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (x < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack.push(p - w); }
      if (y < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack.push(p + w); }
    }
    blobs.push(b);
  }
  return blobs;
}

function iou(a: Candidate, b: Candidate): number {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
}
function contained(a: Candidate, b: Candidate): number {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  return (Math.max(0, x1 - x0) * Math.max(0, y1 - y0)) / (a.w * a.h || 1);
}

export function detectSurfaces(gray: Uint8Array | Uint8ClampedArray, w: number, h: number, opts: DetectOptions = {}): Candidate[] {
  const contrast = opts.contrast ?? 14;
  const radius = Math.max(4, Math.round((opts.radius ?? 0.12) * Math.max(w, h)));
  const minArea = opts.minArea ?? 0.004, maxArea = opts.maxArea ?? 0.3;
  const f = new Float32Array(w * h);
  for (let i = 0; i < f.length; i++) f[i] = gray[i];
  const smooth = blur(f, w, h, 1);
  const local = blur(smooth, w, h, radius);
  const found: Candidate[] = [];
  for (const dark of [true, false]) {
    let mask: Uint8Array = new Uint8Array(w * h);
    for (let i = 0; i < mask.length; i++) mask[i] = (dark ? local[i] - smooth[i] : smooth[i] - local[i]) > contrast ? 1 : 0;
    const r = Math.max(1, Math.round(Math.max(w, h) / 160));
    mask = morph(morph(mask, w, h, r, true), w, h, r, false); // cierre: une barrotes y marcos
    for (const b of components(mask, w, h)) {
      const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
      const areaFrac = (bw * bh) / (w * h);
      if (areaFrac < minArea || areaFrac > maxArea) continue;
      const fill = b.area / (bw * bh);
      const aspect = bw / bh;
      if (fill < 0.55 || aspect < 0.2 || aspect > 5) continue;
      if (b.x0 <= 1 || b.y0 <= 1 || b.x1 >= w - 2 || b.y1 >= h - 2) continue;
      const kind: Candidate['kind'] = bh / bw > 1.7 ? 'door' : 'window';
      found.push({ x: b.x0 / w, y: b.y0 / h, w: bw / w, h: bh / h, score: Math.min(1, fill * (0.6 + Math.sqrt(areaFrac))), kind });
    }
  }
  found.sort((a, b) => b.score - a.score);
  const out: Candidate[] = [];
  for (const c of found) {
    // Fuera los duplicados, los contenidos en otro mejor y los «halos» claros que rodean a uno ya aceptado.
    if (out.some((o) => iou(o, c) > 0.45 || contained(c, o) > 0.85 || (contained(o, c) > 0.7 && c.w * c.h > 1.5 * o.w * o.h))) continue;
    out.push(c);
    if (out.length >= (opts.maxResults ?? 14)) break;
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Convierte píxeles RGBA a grises (luminancia). */
export function toGray(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Uint8Array {
  const g = new Uint8Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]);
  return g;
}
