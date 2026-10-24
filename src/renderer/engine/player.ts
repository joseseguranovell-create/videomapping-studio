/**
 * Reproductor: une reloj, línea de tiempo, medios, audio y renderizado.
 * Se usa igual en la ventana de salida (proyector) y en la previsualización del editor.
 */
import type { Asset, Installation, Project, Show, Surface, Vec2 } from '../../shared/model';
import type { OutputMode, OutputStatus } from '../../shared/api';
import { GLRenderer, hexToRgb, type Layer, type LayerMode } from './glRenderer';
import { MediaManager } from './media';
import { AudioEngine } from './audio';
import { IDENTITY, outputToSurfaceUV, surfaceAspect, surfaceOutline, centroid, squareToQuad, applyH } from '../../shared/geometry';
import { layoutShow, evaluateClipsAt, cycleTime, audioCues, mediaTime, contentMatrix, activeSlot, type ShowLayout, type AudioCue, type ClipEval } from '../../shared/timeline';

export interface PlayerOptions {
  audio: boolean;
  /** Mostrar rayas magenta donde falte un recurso (solo previsualización). */
  showMissing: boolean;
  overlay?: HTMLCanvasElement | null;
  /** Ancho máximo del lienzo (la previsualización no necesita resolución completa). */
  maxWidth?: number;
  onError?: (msg: string) => void;
}

export interface OverlayOptions {
  outlines: boolean;
  labels: boolean;
  grid: boolean;
  selectedSurfaceId: string | null;
  active?: { surfaceId: string; target: 'quad' | 'polygon' | 'move'; index: number } | null;
}

const EFFECT_TO_MODE: Record<string, LayerMode> = {
  solid: 'solid', glow: 'glow', stars: 'stars', flicker: 'flicker', rainbow: 'rainbow', testPattern: 'testPattern',
};

export class Player {
  readonly r: GLRenderer;
  readonly media: MediaManager;
  readonly audio: AudioEngine;
  private project: Project | null = null;
  private assets = new Map<string, Asset>();
  private base = '';
  private key = '';
  mode: OutputMode = { kind: 'black' };
  overlay: OverlayOptions = { outlines: false, labels: false, grid: false, selectedSurfaceId: null };
  /** Esquina o vértice activo al calibrar sobre la propia salida (se resalta). */
  activeVertex: (() => { surfaceId: string; target: 'quad' | 'polygon' | 'move'; index: number } | null) | null = null;
  /** Forzar instalación (previsualización de un espectáculo con otra instalación). */
  private raf = 0;
  private running = false;
  // transporte
  playing = false;
  private baseShow = 0;
  private baseClock = 0;
  private clockSrc: 'audio' | 'perf' = 'perf';
  private layoutCache: { show: Show | null; layout: ShowLayout; cues: AudioCue[] } = { show: null, layout: { slots: [], duration: 0 }, cues: [] };
  private lastCycle = -1;
  // estadísticas
  private frames = 0;
  private fpsT0 = performance.now();
  fps = 0;
  frameMs = 0;
  errors: string[] = [];
  private onFrame: ((p: Player) => void) | null = null;
  private lastSceneName: string | null = null;
  /** Hay que redibujar aunque no se esté reproduciendo (cambio de documento, modo, posición…). */
  private needsRender = true;
  private lastPausedRender = 0;

  constructor(readonly canvas: HTMLCanvasElement, readonly opts: PlayerOptions) {
    this.r = new GLRenderer(canvas);
    const onErr = (m: string) => {
      this.errors = [...this.errors.slice(-19), m];
      opts.onError?.(m);
    };
    this.media = new MediaManager(this.r, onErr);
    this.audio = new AudioEngine(onErr);
    if (!opts.audio) this.audio.setEnabled(false, 0);
  }

  setProject(project: Project | null, base: string, key: string) {
    if (key !== this.key || base !== this.base) {
      this.media.setSource(base, key);
      this.audio.clearBuffers();
      this.errors = [];
    }
    this.project = project;
    this.base = base;
    this.key = key;
    this.assets = new Map((project?.assets ?? []).map((a) => [a.id, a]));
    this.needsRender = true;
  }

  /** Fuerza un redibujado en el próximo fotograma. */
  invalidate() {
    this.needsRender = true;
  }

  invalidateAsset(id: string) {
    this.media.invalidate(id);
    this.audio.invalidate(id);
  }

  setMode(mode: OutputMode) {
    const changedShow = mode.kind !== this.mode.kind || (mode.kind === 'show' && this.mode.kind === 'show' && mode.showId !== this.mode.showId);
    this.mode = mode;
    this.needsRender = true;
    if (changedShow) {
      this.stop();
    }
  }

  setOnFrame(cb: ((p: Player) => void) | null) {
    this.onFrame = cb;
  }

  // ───────── reloj ─────────
  private clock(): number {
    if (this.clockSrc === 'audio' && this.audio.ctx) return this.audio.ctx.currentTime;
    return performance.now() / 1000;
  }

  get time(): number {
    return this.playing ? this.baseShow + (this.clock() - this.baseClock) : this.baseShow;
  }

  async play() {
    if (this.playing) return;
    await this.audio.resume();
    this.clockSrc = this.audio.running ? 'audio' : 'perf';
    this.baseClock = this.clock();
    this.playing = true;
    this.lastCycle = -1;
  }

  pause() {
    if (!this.playing) return;
    this.baseShow = this.time;
    this.playing = false;
    this.audio.stopAll();
    this.media.pauseAllVideos();
  }

  stop() {
    this.playing = false;
    this.baseShow = 0;
    this.audio.stopAll();
    this.media.releaseVideosExcept(new Set());
  }

  seek(t: number) {
    this.needsRender = true;
    const was = this.playing;
    this.audio.stopAll(0.03);
    this.baseShow = Math.max(0, t);
    this.baseClock = this.clock();
    this.playing = was;
    this.lastCycle = -1;
  }

  setAudio(enabled: boolean, volume: number) {
    this.audio.setEnabled(enabled && this.opts.audio, volume);
  }

  // ───────── bucle ─────────
  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      // Ahorro de GPU: en calibración, en negro o en pausa solo se redibuja cuando algo cambia
      // (en pausa, también unas veces por segundo para mostrar fotogramas de vídeo recién cargados).
      const now = performance.now();
      const animated = this.playing && this.mode.kind === 'show';
      const pausedRefresh = this.mode.kind === 'show' && now - this.lastPausedRender > 150;
      if (animated || this.needsRender || pausedRefresh) {
        this.needsRender = false;
        this.lastPausedRender = now;
        this.renderFrame();
      } else {
        this.frames++;
        this.onFrame?.(this);
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  halt() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  dispose() {
    this.halt();
    this.stop();
    this.media.disposeAll();
    this.audio.dispose();
    this.r.dispose();
  }

  currentShow(): Show | null {
    if (this.mode.kind !== 'show' || !this.project) return null;
    const id = this.mode.showId;
    return this.project.shows.find((s) => s.id === id) ?? null;
  }

  currentInstallation(): Installation | null {
    if (!this.project) return null;
    if (this.mode.kind === 'calibration') {
      const id = this.mode.installationId;
      return this.project.installations.find((i) => i.id === id) ?? null;
    }
    const sh = this.currentShow();
    return sh ? this.project.installations.find((i) => i.id === sh.installationId) ?? null : null;
  }

  private layoutFor(show: Show) {
    if (this.layoutCache.show !== show) {
      const layout = layoutShow(show);
      this.layoutCache = { show, layout, cues: audioCues(show, layout) };
    }
    return this.layoutCache;
  }

  duration(): number {
    const sh = this.currentShow();
    return sh ? this.layoutFor(sh).layout.duration : 0;
  }

  private sizeCanvas(inst: Installation | null) {
    const out = inst?.output ?? { width: 1920, height: 1080 };
    let w = out.width, h = out.height;
    if (this.opts.maxWidth && w > this.opts.maxWidth) {
      h = Math.round((h * this.opts.maxWidth) / w);
      w = Math.round(this.opts.maxWidth);
    }
    this.r.resize(w, h);
    const ov = this.opts.overlay;
    if (ov && (ov.width !== w || ov.height !== h)) {
      ov.width = w;
      ov.height = h;
    }
    if (this.canvas.width !== w || this.canvas.height !== h) this.needsRender = true;
  }

  renderFrame() {
    const t0 = performance.now();
    if (this.r.lost) return;
    const inst = this.currentInstallation();
    this.sizeCanvas(inst);
    this.r.begin();
    const ov = this.opts.overlay?.getContext('2d') ?? null;
    if (ov) ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
    if (this.mode.kind === 'calibration' && inst) this.renderCalibration(inst, ov);
    else if (this.mode.kind === 'show' && inst) this.renderShow(inst, ov);
    else {
      this.media.releaseVideosExcept(new Set());
    }
    this.frameMs = performance.now() - t0;
    this.frames++;
    const now = performance.now();
    if (now - this.fpsT0 >= 1000) {
      this.fps = (this.frames * 1000) / (now - this.fpsT0);
      this.frames = 0;
      this.fpsT0 = now;
    }
    this.onFrame?.(this);
  }

  private exclusions(inst: Installation, s: Surface): Vec2[][] {
    const out: Vec2[][] = [];
    for (const m of s.masks) if (m.enabled && m.points.length >= 3) out.push(m.points);
    for (const m of inst.masks) if (m.enabled && m.points.length >= 3) out.push(m.points);
    return out;
  }

  private renderCalibration(inst: Installation, ov: CanvasRenderingContext2D | null) {
    const mode = this.mode.kind === 'calibration' ? this.mode : null;
    if (!mode) return;
    this.media.releaseVideosExcept(new Set());
    const t = performance.now() / 1000;
    for (const s of inst.surfaces) {
      if (!s.visible) continue;
      if (mode.soloSelected && mode.selectedSurfaceId && s.id !== mode.selectedSurfaceId) continue;
      const H = outputToSurfaceUV(s);
      if (!H || mode.pattern === 'none') continue;
      const color = hexToRgb(s.color);
      const layer: Layer =
        mode.pattern === 'test'
          ? { mode: 'testPattern', toContent: IDENTITY, opacity: 1, color, time: t }
          : { mode: 'solid', toContent: IDENTITY, opacity: 1, color: mode.pattern === 'white' ? [1, 1, 1] : color };
      this.r.drawSurface(surfaceOutline(s), H, this.exclusions(inst, s), [layer]);
    }
    if (ov) {
      drawOverlay(ov, inst, {
        grid: mode.showGrid,
        labels: mode.showLabels,
        outlines: true,
        selectedSurfaceId: mode.selectedSurfaceId,
        active: this.activeVertex?.() ?? null,
      });
    }
  }

  private renderShow(inst: Installation, ov: CanvasRenderingContext2D | null) {
    const show = this.currentShow()!;
    const { layout, cues } = this.layoutFor(show);
    const abs = this.time;
    const ct = cycleTime(show, layout, abs);
    if (ct.ended && this.playing) {
      // Fin del espectáculo sin bucle: se queda en negro al final.
      this.pause();
      this.baseShow = layout.duration;
    }
    if (ct.cycle !== this.lastCycle) {
      this.lastCycle = ct.cycle;
    }
    const t = ct.time;
    const slot = activeSlot(layout, t);
    this.lastSceneName = ct.inGap ? null : slot?.scene.name ?? null;

    // Audio
    if (this.playing && this.audio.ctx && !ct.inGap) {
      const cycleStartCtx = this.audio.ctx.currentTime - t;
      this.audio.sync(cues, this.assets, this.base, this.key, ct.cycle, cycleStartCtx, t, show.masterVolume);
    }

    const evals = ct.inGap ? [] : evaluateClipsAt(layout, t, 1.5);
    const bySurface = new Map<string, ClipEval[]>();
    for (const e of evals) {
      let arr = bySurface.get(e.surfaceId);
      if (!arr) bySurface.set(e.surfaceId, (arr = []));
      arr.push(e);
    }
    const keepVideos = new Set<string>();
    for (const s of inst.surfaces) {
      const list = bySurface.get(s.id);
      if (!list || !s.visible) continue;
      const H = outputToSurfaceUV(s);
      if (!H) continue;
      const A = surfaceAspect(s, inst.output);
      list.sort((a, b) => a.order - b.order);
      const layers: Layer[] = [];
      for (const e of list) {
        const layer = this.layerFor(e, A, keepVideos);
        if (layer) layers.push(layer);
      }
      this.r.drawSurface(surfaceOutline(s), H, this.exclusions(inst, s), layers);
    }
    this.media.releaseVideosExcept(keepVideos);
    if (ov && (this.overlay.outlines || this.overlay.labels || this.overlay.grid)) drawOverlay(ov, inst, this.overlay);
  }

  private layerFor(e: ClipEval, surfAspect: number, keepVideos: Set<string>): Layer | null {
    const clip = e.clip;
    const motion = { dx: e.dx, dy: e.dy, scale: e.scale, rotation: e.rotation };
    if (e.source.type === 'effect') {
      if (e.opacity <= 0) return null;
      return {
        mode: EFFECT_TO_MODE[e.source.effect] ?? 'solid',
        toContent: contentMatrix(clip, surfAspect, surfAspect, motion),
        opacity: e.opacity,
        color: hexToRgb(e.source.color),
        color2: hexToRgb(e.source.color2, [0, 0, 0]),
        time: e.clipTime,
        aspect: surfAspect,
      };
    }
    const asset = this.assets.get(e.source.assetId);
    if (!asset || this.media.errors.has(asset.id)) {
      if (!this.opts.showMissing || e.opacity <= 0) return null;
      return { mode: 'missing', toContent: contentMatrix(clip, surfAspect, surfAspect, motion), opacity: Math.min(0.6, e.opacity) };
    }
    let tex: WebGLTexture | null = null;
    let aspect = (asset.width ?? 1) / (asset.height ?? 1);
    if (asset.kind === 'image') {
      const img = this.media.image(asset);
      tex = img.texture;
      aspect = img.width / img.height;
    } else if (asset.kind === 'sequence') {
      tex = this.media.sequenceFrame(asset, mediaTime(e.clipTime, clip.playbackRate, clip.loop, null), clip.loop);
      if (asset.width && asset.height) aspect = asset.width / asset.height;
    } else if (asset.kind === 'video') {
      keepVideos.add(e.key);
      const v = this.media.video(e.key, asset);
      const el = v.el;
      const dur = isFinite(el.duration) ? el.duration : asset.duration;
      const desired = mediaTime(Math.max(0, e.clipTime), clip.playbackRate, clip.loop, dur);
      el.loop = clip.loop;
      if (el.playbackRate !== clip.playbackRate) el.playbackRate = clip.playbackRate;
      if (v.status === 'ready') {
        let diff = Math.abs(el.currentTime - desired);
        if (clip.loop && dur) diff = Math.min(diff, dur - diff);
        if (this.playing && e.clipTime >= 0) {
          if (el.paused) void el.play().catch(() => {});
          if (!v.seeking && diff > 0.3) el.currentTime = desired;
        } else {
          if (!el.paused) el.pause();
          if (!v.seeking && diff > 0.04) el.currentTime = desired;
        }
      }
      tex = this.media.videoTexture(v);
      if (el.videoWidth && el.videoHeight) aspect = el.videoWidth / el.videoHeight;
    } else {
      return null; // un recurso de audio no se dibuja
    }
    if (!tex || e.opacity <= 0) return null;
    return { mode: 'texture', texture: tex, toContent: contentMatrix(clip, surfAspect, aspect, motion), opacity: e.opacity };
  }

  status(): OutputStatus {
    const show = this.currentShow();
    const layout = show ? this.layoutFor(show).layout : null;
    const abs = this.time;
    const ct = show && layout ? cycleTime(show, layout, abs) : { time: 0 };
    return {
      type: 'status',
      mode: this.mode.kind,
      playing: this.playing,
      time: abs,
      cycleTime: ct.time,
      duration: layout?.duration ?? 0,
      sceneName: this.lastSceneName,
      fps: Math.round(this.fps * 10) / 10,
      frameMs: Math.round(this.frameMs * 100) / 100,
      activeVideos: this.media.activeVideos,
      textures: this.r.textureCount,
      errors: this.errors,
      width: this.canvas.width,
      height: this.canvas.height,
      gpu: this.r.rendererName,
    };
  }
}

// ───────────────────────── Superposición 2D ─────────────────────────

export function drawOverlay(ctx: CanvasRenderingContext2D, inst: Installation, o: OverlayOptions) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const px = (p: Vec2) => [p.x * W, p.y * H] as const;
  const k = Math.max(1, W / 1920);
  ctx.save();
  if (o.grid) {
    ctx.lineWidth = 1 * k;
    const n = 16, m = 9;
    for (let i = 0; i <= n; i++) {
      const x = (i / n) * W;
      ctx.strokeStyle = i % 4 === 0 ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.22)';
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let j = 0; j <= m; j++) {
      const y = (j / m) * H;
      ctx.strokeStyle = j % 3 === 0 ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.22)';
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = `${12 * k}px system-ui, sans-serif`;
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
      if ((i + j) % 2) continue;
      ctx.fillText(`${String.fromCharCode(65 + j)}${i + 1}`, (i / n) * W + 4 * k, (j / m) * H + 14 * k);
    }
    // borde y cruz central del fotograma
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3 * k;
    ctx.strokeRect(1.5 * k, 1.5 * k, W - 3 * k, H - 3 * k);
    ctx.beginPath(); ctx.moveTo(W / 2 - 30 * k, H / 2); ctx.lineTo(W / 2 + 30 * k, H / 2); ctx.moveTo(W / 2, H / 2 - 30 * k); ctx.lineTo(W / 2, H / 2 + 30 * k); ctx.stroke();
  }
  // Máscaras globales
  for (const m of inst.masks) {
    if (m.points.length < 3) continue;
    hatchPolygon(ctx, m.points.map(px), m.enabled ? 'rgba(255,70,70,0.9)' : 'rgba(255,70,70,0.35)', k);
  }
  if (o.outlines || o.labels) {
    inst.surfaces.forEach((s, idx) => {
      if (!s.visible && s.id !== o.selectedSurfaceId) return;
      const sel = s.id === o.selectedSurfaceId;
      const outline = surfaceOutline(s);
      if (o.outlines) {
        ctx.strokeStyle = s.color;
        ctx.lineWidth = (sel ? 4 : 2) * k;
        ctx.setLineDash(s.visible ? [] : [8 * k, 6 * k]);
        ctx.beginPath();
        outline.forEach((p, i) => { const [x, y] = px(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
        for (const m of s.masks) if (m.points.length >= 3) hatchPolygon(ctx, m.points.map(px), m.enabled ? 'rgba(255,70,70,0.9)' : 'rgba(255,70,70,0.35)', k);
        if (sel) {
          // esquinas numeradas del cuadrilátero de mapeo
          if (s.shape === 'polygon') {
            s.polygon.forEach((p, i) => {
              const [x, y] = px(p);
              const act = o.active?.surfaceId === s.id && o.active.target === 'polygon' && o.active.index === i;
              ctx.fillStyle = act ? '#ff8a3d' : '#ffffff';
              ctx.strokeStyle = '#000';
              ctx.lineWidth = 1.5 * k;
              ctx.fillRect(x - 6 * k, y - 6 * k, 12 * k, 12 * k);
              ctx.strokeRect(x - 6 * k, y - 6 * k, 12 * k, 12 * k);
            });
          }
          s.quad.forEach((p, i) => {
            const [x, y] = px(p);
            const act = o.active?.surfaceId === s.id && o.active.target === 'quad' && o.active.index === i;
            if (act) {
              ctx.strokeStyle = '#ffffff';
              ctx.lineWidth = 3 * k;
              ctx.beginPath(); ctx.arc(x, y, 15 * k, 0, Math.PI * 2); ctx.stroke();
            }
            ctx.fillStyle = ['#ff4040', '#40ff60', '#4080ff', '#ffe030'][i];
            ctx.beginPath(); ctx.arc(x, y, 9 * k, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#000';
            ctx.font = `bold ${11 * k}px system-ui, sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(String(i + 1), x, y + 0.5);
          });
          if (s.shape === 'polygon') {
            // malla de perspectiva (para ver la deformación aplicada)
            const Hm = squareToQuad(s.quad);
            ctx.strokeStyle = 'rgba(255,255,255,0.35)';
            ctx.lineWidth = 1 * k;
            for (let i = 1; i < 4; i++) {
              const a = px(applyH(Hm, { x: i / 4, y: 0 })), b = px(applyH(Hm, { x: i / 4, y: 1 }));
              ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
              const c = px(applyH(Hm, { x: 0, y: i / 4 })), d = px(applyH(Hm, { x: 1, y: i / 4 }));
              ctx.beginPath(); ctx.moveTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.stroke();
            }
          }
        }
      }
      if (o.labels) {
        const c = px(centroid(outline));
        const label = `${idx + 1}. ${s.name}`;
        ctx.font = `600 ${(sel ? 18 : 15) * k}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const w = ctx.measureText(label).width + 14 * k;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(c[0] - w / 2, c[1] - 13 * k, w, 26 * k);
        ctx.fillStyle = sel ? '#ffffff' : s.color;
        ctx.fillText(label, c[0], c[1] + 1);
      }
    });
  }
  ctx.restore();
}

function hatchPolygon(ctx: CanvasRenderingContext2D, pts: (readonly [number, number])[], color: string, k: number) {
  ctx.save();
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 * k;
  ctx.setLineDash([6 * k, 4 * k]);
  ctx.stroke();
  ctx.clip();
  ctx.setLineDash([]);
  ctx.lineWidth = 1 * k;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  for (let d = minX - (maxY - minY); d < maxX; d += 12 * k) {
    ctx.beginPath(); ctx.moveTo(d, maxY); ctx.lineTo(d + (maxY - minY), minY); ctx.stroke();
  }
  ctx.restore();
}
