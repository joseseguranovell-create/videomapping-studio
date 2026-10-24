/**
 * Evaluación temporal de un espectáculo.
 *
 * Tiempos:
 *  - tiempo del espectáculo: reloj maestro único (segundos desde el inicio).
 *  - tiempo de escena: tiempo del espectáculo menos el inicio de la escena.
 *  - tiempo de clip: tiempo de escena menos el inicio del clip.
 *  - tiempo de medio: tiempo del clip × velocidad, con bucle según la duración real del archivo.
 * El motor llama a `evaluateShow(show, t)` en cada fotograma: no hay temporizadores
 * independientes, así que no se acumulan errores.
 */
import type { Clip, Scene, Show, SoundCue, ClipSource } from './model';
import { evaluateMotion } from './motion';
import type { Mat3 } from './geometry';

export interface SceneSlot {
  scene: Scene;
  index: number; // índice en show.scenes
  start: number;
  end: number;
  fadeIn: number; // desde negro
  fadeOut: number; // hacia negro
  crossIn: number; // solapamiento con la escena anterior
  crossOut: number; // solapamiento con la siguiente
}

export interface ShowLayout {
  slots: SceneSlot[];
  duration: number;
}

export function layoutShow(show: Show): ShowLayout {
  const scenes = show.scenes.map((s, index) => ({ s, index })).filter((x) => x.s.enabled);
  const slots: SceneSlot[] = [];
  let cursor = 0;
  scenes.forEach(({ s, index }, k) => {
    const prev = slots[k - 1];
    const tr = s.transition;
    let start = cursor;
    let fadeIn = 0, crossIn = 0;
    if (tr.type !== 'cut' && tr.duration > 0) {
      const maxD = Math.min(s.duration / 2, prev ? (prev.end - prev.start) / 2 : Infinity);
      const d = Math.min(tr.duration, maxD);
      if (tr.type === 'crossfade' && prev) {
        crossIn = d;
        prev.crossOut = d;
        start = prev.end - d;
      } else {
        fadeIn = d;
        if (prev) prev.fadeOut = d;
      }
    }
    const slot: SceneSlot = { scene: s, index, start, end: start + s.duration, fadeIn, fadeOut: 0, crossIn, crossOut: 0 };
    slots.push(slot);
    cursor = slot.end;
  });
  // Fundido final a negro igual al de la primera escena (cierra el bucle con suavidad).
  if (slots.length) {
    const last = slots[slots.length - 1];
    const first = slots[0].scene.transition;
    if (first.type !== 'cut' && first.duration > 0) last.fadeOut = Math.min(first.duration, (last.end - last.start) / 2);
  }
  return { slots, duration: cursor };
}

export function sceneWeight(slot: SceneSlot, t: number): number {
  const local = t - slot.start;
  const remain = slot.end - t;
  if (local < 0 || remain <= 0) return 0;
  let w = 1;
  if (slot.fadeIn > 0 && local < slot.fadeIn) w *= local / slot.fadeIn;
  if (slot.crossIn > 0 && local < slot.crossIn) w *= local / slot.crossIn;
  if (slot.fadeOut > 0 && remain < slot.fadeOut) w *= remain / slot.fadeOut;
  if (slot.crossOut > 0 && remain < slot.crossOut) w *= remain / slot.crossOut;
  return Math.max(0, Math.min(1, w));
}

// ───────────────────────── Modo directo (una escena en bucle) ─────────────────────────

/** Maqueta de una sola escena que se repite sin fundidos de escena (los clips conservan los suyos). */
export function sceneLoopLayout(scene: Scene): ShowLayout {
  return layoutShow({ scenes: [{ ...scene, enabled: true, transition: { type: 'cut', duration: 0 } }] } as Show);
}

/** Sonidos de una escena suelta (la música del espectáculo va aparte y no se corta al cambiar de escena). */
export function sceneLoopCues(scene: Scene, layout: ShowLayout = sceneLoopLayout(scene)): AudioCue[] {
  return audioCues({ scenes: layout.slots.map((s) => s.scene), music: [] } as unknown as Show, layout);
}

/** Tiempo dentro de la escena y número de repetición, a partir del tiempo desde que empezó a repetirse. */
export function loopTime(elapsed: number, duration: number): { time: number; loop: number } {
  if (duration <= 0) return { time: 0, loop: 0 };
  const e = Math.max(0, elapsed);
  const loop = Math.floor(e / duration);
  return { time: e - loop * duration, loop };
}

/** Convierte tiempo absoluto (que puede crecer sin límite en bucle) en tiempo dentro del ciclo. */
export function cycleTime(show: Show, layout: ShowLayout, t: number): { time: number; cycle: number; inGap: boolean; ended: boolean } {
  const D = layout.duration;
  if (D <= 0) return { time: 0, cycle: 0, inGap: false, ended: true };
  if (!show.loop) return { time: Math.min(t, D), cycle: 0, inGap: false, ended: t >= D };
  const period = D + show.loopGap;
  const cycle = Math.floor(t / period);
  const time = t - cycle * period;
  return { time: Math.min(time, D), cycle, inGap: time >= D, ended: false };
}

export interface ClipEval {
  key: string; // único por escena+clip (para reutilizar recursos de vídeo)
  clip: Clip;
  slot: SceneSlot;
  surfaceId: string;
  source: ClipSource;
  clipTime: number; // segundos desde el inicio del clip
  opacity: number;
  dx: number;
  dy: number;
  scale: number;
  rotation: number;
  order: number;
}

export function clipFade(clip: Clip, lt: number): number {
  let a = 1;
  if (clip.fadeIn > 0 && lt < clip.fadeIn) a *= lt / clip.fadeIn;
  const remain = clip.duration - lt;
  if (clip.fadeOut > 0 && remain < clip.fadeOut) a *= remain / clip.fadeOut;
  return Math.max(0, Math.min(1, a));
}

export function evaluateClipsAt(layout: ShowLayout, t: number, lookahead = 0): ClipEval[] {
  const out: ClipEval[] = [];
  let order = 0;
  for (const slot of layout.slots) {
    if (t < slot.start - lookahead || t >= slot.end) continue;
    const w = sceneWeight(slot, t);
    const st = t - slot.start;
    slot.scene.clips.forEach((clip, ci) => {
      const lt = st - clip.start;
      if (lt < -lookahead || lt >= clip.duration) return;
      const visible = lt >= 0;
      const m = visible ? evaluateMotion(clip.motion, lt, clip.duration) : { dx: 0, dy: 0, scale: 1, rotation: 0, alpha: 0 };
      const opacity = visible ? clip.opacity * clipFade(clip, lt) * m.alpha * w : 0;
      out.push({
        key: `${slot.scene.id}:${clip.id}`,
        clip,
        slot,
        surfaceId: clip.surfaceId,
        source: clip.source,
        clipTime: lt,
        opacity,
        dx: m.dx,
        dy: m.dy,
        scale: m.scale,
        rotation: m.rotation,
        order: order * 10000 + clip.z * 100 + ci,
      });
    });
    order++;
  }
  return out;
}

/** Tiempo dentro del archivo multimedia teniendo en cuenta velocidad y bucle. */
export function mediaTime(clipTime: number, rate: number, loop: boolean, mediaDuration: number | null | undefined): number {
  const t = Math.max(0, clipTime * rate);
  if (!mediaDuration || !isFinite(mediaDuration) || mediaDuration <= 0) return t;
  if (loop) return t % mediaDuration;
  return Math.min(t, Math.max(0, mediaDuration - 0.04));
}

// ───────────────────────── Audio ─────────────────────────

export interface AudioCue {
  id: string;
  assetId: string;
  /** Tiempo de inicio en el ciclo del espectáculo. */
  start: number;
  /** Instante de parada (tiempo de espectáculo) o null para dejarlo terminar solo. */
  end: number | null;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  loop: boolean;
  kind: 'music' | 'sfx';
}

export function audioCues(show: Show, layout: ShowLayout = layoutShow(show)): AudioCue[] {
  const cues: AudioCue[] = [];
  for (const m of show.music) {
    if (m.start >= layout.duration) continue;
    cues.push({
      id: `music:${m.id}`,
      assetId: m.assetId,
      start: m.start,
      end: m.loop ? layout.duration : null,
      volume: m.volume,
      fadeIn: m.fadeIn,
      fadeOut: m.fadeOut,
      loop: m.loop,
      kind: 'music',
    });
  }
  for (const slot of layout.slots) {
    for (const s of slot.scene.sounds as SoundCue[]) {
      if (s.start >= slot.scene.duration) continue;
      const start = slot.start + s.start;
      let end: number | null = s.duration != null ? start + s.duration : null;
      if (!s.continueAfterScene) end = end == null ? slot.end : Math.min(end, slot.end);
      if (s.loop && end == null) end = layout.duration;
      cues.push({
        id: `sfx:${slot.scene.id}:${s.id}`,
        assetId: s.assetId,
        start,
        end,
        volume: s.volume,
        fadeIn: s.fadeIn,
        fadeOut: s.fadeOut,
        loop: s.loop,
        kind: 'sfx',
      });
    }
  }
  return cues;
}

/** Escena activa principal en el tiempo t (la de mayor peso). */
export function activeSlot(layout: ShowLayout, t: number): SceneSlot | null {
  let best: SceneSlot | null = null;
  let bw = -1;
  for (const s of layout.slots) {
    if (t >= s.start && t < s.end) {
      const w = sceneWeight(s, t);
      if (w > bw) { bw = w; best = s; }
    }
  }
  return best;
}

// ───────────────────────── Composición en la superficie ─────────────────────────

/**
 * Matriz afín (en 3x3) que lleva coordenadas uv de la superficie a coordenadas del contenido (0..1).
 * Fuera de [0,1] el contenido no se dibuja.
 */
/**
 * Escala máxima para que un rótulo no se salga de su superficie (ni por los lados ni por arriba/abajo),
 * teniendo en cuenta dónde está colocado. Así un texto largo se encoge en vez de cortarse.
 */
export function textMaxScale(p: { fit: 'contain' | 'cover' | 'stretch'; x: number; y: number }, surfaceAspect: number, contentAspect: number, margin = 0.96): number {
  const A = surfaceAspect > 0 ? surfaceAspect : 1;
  const C = contentAspect > 0 ? contentAspect : 1;
  let fw = 1, fh = 1;
  if (p.fit === 'contain') {
    if (C > A) { fw = 1; fh = A / C; } else { fh = 1; fw = C / A; }
  } else if (p.fit === 'cover') {
    if (C > A) { fh = 1; fw = C / A; } else { fw = 1; fh = A / C; }
  }
  const roomX = 2 * Math.max(0.05, Math.min(p.x, 1 - p.x)) * margin;
  const roomY = 2 * Math.max(0.05, Math.min(p.y, 1 - p.y)) * 1.15; // el halo puede rozar arriba y abajo
  return Math.max(0.05, Math.min(roomX / fw, roomY / fh));
}

export function contentMatrix(
  p: { fit: 'contain' | 'cover' | 'stretch'; x: number; y: number; scale: number; rotation: number; flipX: boolean },
  surfaceAspect: number,
  contentAspect: number,
  motion: { dx: number; dy: number; scale: number; rotation: number } = { dx: 0, dy: 0, scale: 1, rotation: 0 },
): Mat3 {
  const A = surfaceAspect > 0 ? surfaceAspect : 1;
  const C = contentAspect > 0 ? contentAspect : 1;
  // Tamaño del contenido en unidades uv antes de escalar.
  let fw = 1, fh = 1;
  if (p.fit === 'contain') {
    if (C > A) { fw = 1; fh = A / C; } else { fh = 1; fw = C / A; }
  } else if (p.fit === 'cover') {
    if (C > A) { fh = 1; fw = C / A; } else { fw = 1; fh = A / C; }
  }
  const s = p.scale * motion.scale;
  // Trabajamos en "espacio de aspecto" (x multiplicado por A) para que la rotación no deforme.
  const W = fw * A * s; // ancho en espacio de aspecto
  const H = fh * s;
  const th = ((p.rotation + motion.rotation) * Math.PI) / 180;
  const cos = Math.cos(th), sin = Math.sin(th);
  const cx = (p.x + motion.dx) * A;
  const cy = p.y + motion.dy;
  const fx = p.flipX ? -1 : 1;
  // Directa: c(0..1) → q = R·diag(W·fx,H)·(c-0.5) + (cx,cy); uv = (q.x/A, q.y)
  // Inversa: c = diag(1/(W·fx),1/H)·Rᵀ·((uv.x·A, uv.y) - (cx,cy)) + 0.5
  const iw = 1 / (W * fx), ih = 1 / H;
  // fila 1: c.x = iw*( cos*(A*u - cx) + sin*(v - cy) ) + 0.5
  // fila 2: c.y = ih*( -sin*(A*u - cx) + cos*(v - cy) ) + 0.5
  return [
    iw * cos * A, iw * sin, iw * (-cos * cx - sin * cy) + 0.5,
    ih * -sin * A, ih * cos, ih * (sin * cx - cos * cy) + 0.5,
    0, 0, 1,
  ];
}

export function formatTime(t: number): string {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
