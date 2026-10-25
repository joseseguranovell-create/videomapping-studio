/**
 * Coreografías entre superficies: un mismo personaje que se asoma en una ventana y pasa a otra, que juega
 * al escondite de ventana en ventana o un objeto lanzado en arco. Devuelven clips y sonidos para una escena.
 */
import type { Clip, ClipSource, Installation, SoundCue, Surface } from './model';
import { createClip, createSoundCue } from './factory';
import { centroid, surfaceAspect, surfaceOutline } from './geometry';

export const CHOREO_KINDS = ['pasar', 'escondite', 'lanzar'] as const;
export type ChoreoKind = (typeof CHOREO_KINDS)[number];
export const CHOREO_INFO: Record<ChoreoKind, { name: string; description: string }> = {
  pasar: { name: 'Asomarse y pasar a otra ventana', description: 'Se asoma por un lado, sale hacia la otra ventana, cruza por detrás de la pared y aparece en la otra saludando.' },
  escondite: { name: 'Escondite', description: 'Aparece y se esconde en cada ventana, una detrás de otra, como si jugara al escondite.' },
  lanzar: { name: 'Lanzar de ventana a ventana', description: 'Sale volando en arco de una ventana a otra, girando (ideal para calabazas, murciélagos o regalos).' },
};

export interface ChoreoActor {
  name: string;
  source: ClipSource;
  /** Proporción ancho/alto del recurso. */
  aspect: number;
  characterId?: string | null;
  animationId?: string | null;
}

const isDoor = (s: Surface) => s.kind === 'door' || s.kind === 'garage';

/** Encuadre de un personaje en una superficie: vertical en ventana apaisada → de la cabeza a la cintura. */
export function heroFrame(actorAspect: number, s: Surface, inst: Installation): { scale: number; y: number } {
  const A = surfaceAspect(s, inst.output);
  if (actorAspect < 0.9 && A > 1.2 && !isDoor(s)) return { scale: 2.4, y: 0.96 };
  return { scale: isDoor(s) ? 1.0 : 0.9, y: 0.5 };
}

function box(s: Surface) {
  const pts = surfaceOutline(s);
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), c: centroid(pts) };
}

export interface ChoreoOptions {
  kind: ChoreoKind;
  installation: Installation;
  actor: ChoreoActor;
  /** Superficies por orden (pasar/lanzar: origen y destino; escondite: todas las del recorrido). */
  surfaces: Surface[];
  start: number;
  sounds?: { whoosh?: string; pop?: string; giggle?: string };
}

export function choreography(o: ChoreoOptions): { clips: Clip[]; sounds: SoundCue[]; end: number } {
  const inst = o.installation;
  const a = o.actor;
  const clips: Clip[] = [];
  const sounds: SoundCue[] = [];
  const snd = (id: string | undefined, start: number, volume = 0.8) => { if (id) sounds.push(createSoundCue(id, { start, volume })); };
  const base = (s: Surface, start: number, duration: number, p: Partial<Clip>) => {
    const f = heroFrame(a.aspect, s, inst);
    return createClip(s.id, a.source, {
      start, duration, fit: 'contain', scale: f.scale, y: f.y, fadeIn: 0, fadeOut: 0, name: a.name, loop: true,
      characterId: a.characterId ?? null, animationId: a.animationId ?? null, z: 3, ...p,
    });
  };
  let t = o.start;
  if (o.kind === 'escondite') {
    const peeks = ['peekBottom', 'peekLeft', 'peekRight', 'peekTop'] as const;
    o.surfaces.forEach((s, i) => {
      clips.push(base(s, t, 1.8, { motion: { preset: peeks[i % peeks.length], intensity: 1, speed: 1 }, fadeIn: 0.15, fadeOut: 0.15, name: `${a.name} (escondite)` }));
      snd(i % 2 ? o.sounds?.giggle : o.sounds?.pop, t + 0.3, 0.7);
      t += 1.6;
    });
    return { clips, sounds, end: t + 0.2 };
  }
  const [A, B] = o.surfaces;
  if (!A || !B) return { clips, sounds, end: t };
  const ba = box(A), bb = box(B);
  const dir = bb.c.x >= ba.c.x ? 1 : -1;
  const fa = heroFrame(a.aspect, A, inst);
  const hA = ba.y1 - ba.y0;
  // Tamaño del viaje: el mismo que tenía en la ventana de origen.
  const yOf = (b: typeof ba) => b.y0 + fa.y * hA;
  if (o.kind === 'pasar') {
    clips.push(base(A, t, 2.6, { motion: { preset: dir > 0 ? 'peekRight' : 'peekLeft', intensity: 1, speed: 1 }, fadeIn: 0.2, name: `${a.name} se asoma` }));
    t += 2.6;
    clips.push(base(A, t, 0.8, { motion: { preset: dir > 0 ? 'exitRight' : 'exitLeft', intensity: 1, speed: 1 }, name: `${a.name} sale` }));
    t += 0.7;
    // Por detrás de la pared, de un borde al otro (solo se ve si cruza otras ventanas por el camino).
    const from = { x: dir > 0 ? ba.x1 + 0.02 : ba.x0 - 0.02, y: yOf(ba) };
    const to = { x: dir > 0 ? bb.x0 - 0.02 : bb.x1 + 0.02, y: yOf(bb) };
    const dur = Math.max(0.5, Math.abs(to.x - from.x) / 0.45);
    clips.push(createClip(A.id, a.source, {
      start: t, duration: dur, fit: 'contain', scale: fa.scale, fadeIn: 0, fadeOut: 0, name: `${a.name} cruza`, loop: true, flipX: dir < 0,
      characterId: a.characterId ?? null, animationId: a.animationId ?? null, z: 3,
      travel: { from, to, arc: 0, surfaces: inst.surfaces.filter((s) => s.kind !== 'wall' && s.id !== A.id && s.id !== B.id).map((s) => s.id) },
    }));
    snd(o.sounds?.whoosh, t, 0.6);
    t += dur - 0.1;
    clips.push(base(B, t, 0.8, { motion: { preset: dir > 0 ? 'enterLeft' : 'enterRight', intensity: 1, speed: 1 }, name: `${a.name} entra` }));
    t += 0.8;
    clips.push(base(B, t, 2.8, { motion: { preset: 'wave', intensity: 1, speed: 1 }, fadeOut: 0.4, name: `${a.name} saluda` }));
    snd(o.sounds?.giggle, t + 0.2, 0.7);
    return { clips, sounds, end: t + 2.8 };
  }
  // lanzar: un solo clip que vuela en arco de centro a centro, girando, visible en todo lo que no es pared.
  const smallScale = Math.min(0.8, fa.scale);
  const from = { x: ba.c.x, y: ba.c.y };
  const to = { x: bb.c.x, y: bb.c.y };
  const dur = Math.max(0.9, Math.abs(to.x - from.x) / 0.5);
  clips.push(createClip(A.id, a.source, {
    start: t, duration: dur, fit: 'contain', scale: smallScale, fadeIn: 0.1, fadeOut: 0.1, name: `${a.name} vuela`, loop: true,
    motion: { preset: 'spin', intensity: 1, speed: 1.5 }, characterId: a.characterId ?? null, animationId: a.animationId ?? null, z: 3,
    // Vuela por el aire: se ve en toda la fachada, también sobre las paredes.
    travel: { from, to, arc: 0.25, surfaces: inst.surfaces.map((s) => s.id) },
  }));
  snd(o.sounds?.whoosh, t, 0.7);
  snd(o.sounds?.pop, t + dur - 0.1, 0.8);
  // aterriza y rebota en la ventana de destino
  clips.push(base(B, t + dur - 0.05, 2.5, { scale: smallScale, motion: { preset: 'bounce', intensity: 1, speed: 1.3 }, fadeOut: 0.4, name: `${a.name} aterriza` }));
  return { clips, sounds, end: t + dur + 2.5 };
}
