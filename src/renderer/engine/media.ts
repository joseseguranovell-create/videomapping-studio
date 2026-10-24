/**
 * Gestión de medios del motor: carga de imágenes/secuencias, elementos de vídeo por clip
 * y texturas asociadas. Libera los recursos cuando un clip deja de estar activo.
 */
import type { Asset } from '../../shared/model';
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
