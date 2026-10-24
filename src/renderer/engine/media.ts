/**
 * Gestión de medios del motor: carga de imágenes/secuencias, elementos de vídeo por clip
 * y texturas asociadas. Libera los recursos cuando un clip deja de estar activo.
 */
import type { Asset, ClipSource } from '../../shared/model';
import { fontFor } from './fonts';

type TextSource = Extract<ClipSource, { type: 'text' }>;

function mixHex(hex: string, to: [number, number, number], k: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0xffffff;
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v, i) => Math.round(v + (to[i] - v) * k));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/**
 * Dibuja un rótulo en un lienzo ajustado a las letras: halo del color del texto, contorno oscuro
 * (en la proyección separa las letras de la pared) y relleno con degradado de arriba (claro) a abajo (intenso).
 */
export function renderText(src: TextSource): HTMLCanvasElement {
  const size = 160;
  const lines = (src.text || ' ').split('\n');
  const { css, overhang } = fontFor(src.font, size);
  const m = document.createElement('canvas').getContext('2d')!;
  m.font = css;
  const metrics = lines.map((l) => m.measureText(l));
  const asc = Math.max(...metrics.map((x) => x.actualBoundingBoxAscent || size * 0.75));
  const desc = Math.max(...metrics.map((x) => x.actualBoundingBoxDescent || size * 0.2));
  const lineH = Math.round((asc + desc) * 1.12);
  const pad = Math.round(size * ((src.glow ? 0.3 : 0.08) + overhang * 0.5));
  const w = Math.max(1, ...metrics.map((x) => Math.ceil((x.actualBoundingBoxLeft || 0) + (x.actualBoundingBoxRight || x.width)))) + pad * 2;
  const h = Math.ceil(lineH * (lines.length - 1) + asc + desc) + pad * 2;
  const c = document.createElement('canvas');
  c.width = Math.min(4096, w);
  c.height = Math.min(2048, h);
  const g = c.getContext('2d')!;
  g.font = css;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.lineJoin = 'round';
  g.miterLimit = 2;
  const cx = c.width / 2;
  lines.forEach((line, i) => {
    const base = pad + asc + i * lineH;
    if (src.glow) {
      g.save();
      g.fillStyle = src.color;
      g.shadowColor = src.color;
      g.shadowBlur = size * 0.45;
      g.globalAlpha = 0.85;
      g.fillText(line, cx, base);
      g.shadowBlur = size * 0.16;
      g.globalAlpha = 1;
      g.fillText(line, cx, base);
      g.restore();
    }
    g.lineWidth = size * 0.11;
    g.strokeStyle = src.outline;
    g.strokeText(line, cx, base);
    const grad = g.createLinearGradient(0, base - asc, 0, base + desc);
    grad.addColorStop(0, mixHex(src.color, [255, 255, 240], 0.55));
    grad.addColorStop(0.45, src.color);
    grad.addColorStop(1, mixHex(src.color, [40, 0, 20], 0.45));
    g.fillStyle = grad;
    g.fillText(line, cx, base);
  });
  return c;
}
import type { GLRenderer } from './glRenderer';

const MAX_IMAGE_SIDE = 2048;
const MAX_FRAME_SIDE = 1024;

export function mediaUrl(base: string, rel: string, key: string): string {
  const path = rel.split('/').map(encodeURIComponent).join('/');
  return `${base}/${path}?k=${encodeURIComponent(key)}`;
}

type Status = 'loading' | 'ready' | 'error';

interface ImageEntry {
  status: Status;
  texture: WebGLTexture | null;
  width: number;
  height: number;
  error?: string;
}

interface SequenceEntry {
  status: Status;
  frames: (HTMLCanvasElement | null)[];
  textures: (WebGLTexture | null)[];
  width: number;
  height: number;
  loaded: number;
  error?: string;
}

export interface VideoEntry {
  key: string;
  assetId: string;
  el: HTMLVideoElement;
  texture: WebGLTexture;
  status: Status;
  dirty: boolean;
  error?: string;
  lastUsed: number;
  seeking: boolean;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = url;
  });
}

/** Rasteriza (también SVG) a un canvas con tamaño acotado para controlar la memoria de vídeo. */
function rasterize(img: HTMLImageElement, maxSide: number, isSvg: boolean): HTMLCanvasElement {
  let w = img.naturalWidth || img.width || 512;
  let h = img.naturalHeight || img.height || 512;
  // Los SVG se rasterizan grandes para que no se vean borrosos al proyectar.
  const target = isSvg ? maxSide : Math.min(maxSide, Math.max(w, h));
  const k = target / Math.max(w, h);
  w = Math.max(1, Math.round(w * k));
  h = Math.max(1, Math.round(h * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  return c;
}

export class MediaManager {
  private images = new Map<string, ImageEntry>();
  private sequences = new Map<string, SequenceEntry>();
  private videos = new Map<string, VideoEntry>();
  private texts = new Map<string, { texture: WebGLTexture; aspect: number }>();
  errors = new Map<string, string>();
  base = '';
  key = '';

  constructor(private r: GLRenderer, private onError: (msg: string) => void = () => {}) {}

  setSource(base: string, key: string) {
    if (base === this.base && key === this.key) return;
    this.disposeAll();
    this.base = base;
    this.key = key;
  }

  private url(rel: string) {
    return mediaUrl(this.base, rel, this.key);
  }

  private fail(asset: Asset, msg: string) {
    const m = `«${asset.name}»: ${msg}`;
    if (!this.errors.has(asset.id)) this.onError(m);
    this.errors.set(asset.id, m);
  }

  image(asset: Asset): ImageEntry {
    let e = this.images.get(asset.id);
    if (e) return e;
    e = { status: 'loading', texture: null, width: asset.width ?? 1, height: asset.height ?? 1 };
    this.images.set(asset.id, e);
    const entry = e;
    loadImage(this.url(asset.file))
      .then((img) => {
        const c = rasterize(img, MAX_IMAGE_SIDE, asset.file.toLowerCase().endsWith('.svg'));
        entry.texture = this.r.createTexture();
        this.r.upload(entry.texture, c);
        entry.width = img.naturalWidth || c.width;
        entry.height = img.naturalHeight || c.height;
        entry.status = 'ready';
      })
      .catch((err) => {
        entry.status = 'error';
        entry.error = String(err.message ?? err);
        this.fail(asset, 'archivo de imagen ausente o no compatible');
      });
    return e;
  }

  sequence(asset: Asset): SequenceEntry {
    let e = this.sequences.get(asset.id);
    if (e) return e;
    const frames = asset.frames.length ? asset.frames : [asset.file];
    e = { status: 'loading', frames: frames.map(() => null), textures: frames.map(() => null), width: asset.width ?? 1, height: asset.height ?? 1, loaded: 0 };
    this.sequences.set(asset.id, e);
    const entry = e;
    frames.forEach((rel, i) => {
      loadImage(this.url(rel))
        .then((img) => {
          entry.frames[i] = rasterize(img, MAX_FRAME_SIDE, rel.toLowerCase().endsWith('.svg'));
          if (i === 0) { entry.width = img.naturalWidth; entry.height = img.naturalHeight; }
          entry.loaded++;
          if (entry.loaded === frames.length) entry.status = 'ready';
        })
        .catch(() => {
          entry.status = 'error';
          this.fail(asset, `falta el fotograma ${i + 1} de la secuencia`);
        });
    });
    return e;
  }

  /** Textura del fotograma de secuencia (se sube a la GPU bajo demanda). */
  sequenceFrame(asset: Asset, time: number, loop: boolean): WebGLTexture | null {
    const e = this.sequence(asset);
    const n = e.frames.length;
    if (!n) return null;
    let idx = Math.floor(time * asset.fps);
    idx = loop ? ((idx % n) + n) % n : Math.min(n - 1, Math.max(0, idx));
    // si el fotograma aún no ha cargado, usar el último disponible anterior
    for (let k = idx; k >= 0; k--) {
      if (e.frames[k]) {
        if (!e.textures[k]) {
          const t = this.r.createTexture();
          this.r.upload(t, e.frames[k]!);
          e.textures[k] = t;
        }
        return e.textures[k];
      }
    }
    return null;
  }

  /** Textura de un rótulo (se genera una vez por texto y estilo). */
  /** Vuelve a dibujar los rótulos (p. ej. cuando terminan de cargarse las fuentes). */
  clearTexts() {
    for (const t of this.texts.values()) this.r.deleteTexture(t.texture);
    this.texts.clear();
  }

  text(src: TextSource): { texture: WebGLTexture; aspect: number } {
    const k = JSON.stringify([src.text, src.font, src.color, src.outline, src.glow, src.bold]);
    let e = this.texts.get(k);
    if (!e) {
      if (this.texts.size > 60) {
        for (const v of this.texts.values()) this.r.deleteTexture(v.texture);
        this.texts.clear();
      }
      const c = renderText(src);
      const texture = this.r.createTexture();
      this.r.upload(texture, c);
      e = { texture, aspect: c.width / c.height };
      this.texts.set(k, e);
    }
    return e;
  }

  video(key: string, asset: Asset): VideoEntry {
    let v = this.videos.get(key);
    if (v) {
      v.lastUsed = performance.now();
      return v;
    }
    const el = document.createElement('video');
    el.crossOrigin = 'anonymous';
    el.muted = true; // el audio del espectáculo se gestiona aparte con Web Audio
    el.playsInline = true;
    el.preload = 'auto';
    el.loop = false;
    const texture = this.r.createTexture();
    const entry: VideoEntry = { key, assetId: asset.id, el, texture, status: 'loading', dirty: false, lastUsed: performance.now(), seeking: false };
    const onFrame = () => {
      entry.dirty = true;
      if (this.videos.get(key) === entry && 'requestVideoFrameCallback' in el) (el as any).requestVideoFrameCallback(onFrame);
    };
    el.addEventListener('loadeddata', () => {
      entry.status = 'ready';
      entry.dirty = true;
    });
    el.addEventListener('seeking', () => (entry.seeking = true));
    el.addEventListener('seeked', () => {
      entry.seeking = false;
      entry.dirty = true;
    });
    el.addEventListener('error', () => {
      entry.status = 'error';
      const code = el.error?.code;
      this.fail(asset, code === 4 ? 'formato de vídeo no compatible (usa MP4 H.264 o WebM VP8/VP9)' : 'no se pudo leer el vídeo (¿archivo ausente?)');
    });
    if ('requestVideoFrameCallback' in el) (el as any).requestVideoFrameCallback(onFrame);
    el.src = this.url(asset.file);
    this.videos.set(key, entry);
    return entry;
  }

  /** Sube el fotograma actual del vídeo a su textura si ha cambiado. */
  videoTexture(v: VideoEntry): WebGLTexture | null {
    if (v.status !== 'ready' || v.el.readyState < 2) return v.status === 'ready' ? v.texture : null;
    if (v.dirty || !('requestVideoFrameCallback' in v.el)) {
      this.r.upload(v.texture, v.el);
      v.dirty = false;
    }
    return v.texture;
  }

  /** Libera los vídeos que ya no se usan. */
  releaseVideosExcept(keep: Set<string>) {
    for (const [k, v] of this.videos) {
      if (keep.has(k)) continue;
      this.disposeVideo(v);
      this.videos.delete(k);
    }
  }

  private disposeVideo(v: VideoEntry) {
    try {
      v.el.pause();
      v.el.removeAttribute('src');
      v.el.load(); // libera el decodificador
    } catch {
      /* ignorar */
    }
    this.r.deleteTexture(v.texture);
  }

  get activeVideos() {
    return this.videos.size;
  }

  pauseAllVideos() {
    for (const v of this.videos.values()) v.el.pause();
  }

  disposeAll() {
    for (const v of this.videos.values()) this.disposeVideo(v);
    this.videos.clear();
    for (const e of this.images.values()) if (e.texture) this.r.deleteTexture(e.texture);
    this.images.clear();
    for (const s of this.sequences.values()) s.textures.forEach((t) => t && this.r.deleteTexture(t));
    this.sequences.clear();
    for (const t of this.texts.values()) this.r.deleteTexture(t.texture);
    this.texts.clear();
    this.errors.clear();
  }

  /** Olvida un recurso (p. ej. tras volver a localizarlo) para que se recargue. */
  invalidate(assetId: string) {
    const e = this.images.get(assetId);
    if (e?.texture) this.r.deleteTexture(e.texture);
    this.images.delete(assetId);
    const s = this.sequences.get(assetId);
    s?.textures.forEach((t) => t && this.r.deleteTexture(t));
    this.sequences.delete(assetId);
    for (const [k, v] of this.videos) if (v.assetId === assetId) { this.disposeVideo(v); this.videos.delete(k); }
    this.errors.delete(assetId);
  }
}
