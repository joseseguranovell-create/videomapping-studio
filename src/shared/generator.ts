/**
 * Asistente de espectáculos: compone un espectáculo completo a partir de un estilo, unos protagonistas
 * (vídeos, imágenes o personajes) y la instalación, siguiendo las reglas que funcionan en una fachada:
 * fondo oscuro, un protagonista por escena con luz detrás, acentos en las demás superficies, escenas de
 * impacto intercaladas, espera en bucle al principio y gran final con rótulo. Función pura.
 */
import type { Asset, Clip, ClipSource, Installation, Scene, Show, SoundCue, Surface } from './model';
import { createClip, createScene, createShow, createSoundCue, effectSource } from './factory';
import { applyTemplate, orderedSurfaces, type TemplateKind } from './templates';
import { surfaceAspect } from './geometry';

export const SHOW_STYLES = ['infantil', 'terror', 'navidad'] as const;
export type ShowStyle = (typeof SHOW_STYLES)[number];
export const SHOW_STYLE_LABELS: Record<ShowStyle, string> = { infantil: 'Halloween infantil', terror: 'Terror', navidad: 'Navidad' };

export interface Protagonist {
  name: string;
  /** Recurso que se muestra (vídeo o imagen). */
  assetId: string;
  /** Proporción ancho/alto del recurso. */
  aspect: number;
  /** Duración del vídeo (null para imágenes). */
  duration: number | null;
  /** Sonido propio, sincronizado con su aparición (p. ej. el audio del vídeo). */
  audioId?: string | null;
  /** Si viene de un personaje: su animación (movimiento). */
  characterId?: string;
  animationId?: string;
  motion?: Clip['motion'];
}

/** Sonidos disponibles por función (los que falten simplemente no suenan). */
export interface SoundKit {
  music?: string; ambient?: string; heartbeat?: string; stinger?: string; whisper?: string; tension?: string;
  thunder?: string; creak?: string; musicBox?: string; pop?: string; sparkle?: string; giggle?: string; chime?: string; whoosh?: string; boo?: string;
}

/** Asocia los sonidos de los paquetes incluidos (si están en el proyecto) a sus funciones. */
export function soundKitFrom(assets: readonly Asset[]): SoundKit {
  const has = (id: string) => (assets.some((a) => a.id === id) ? id : undefined);
  return {
    music: undefined, ambient: has('tr-ast-viento'), heartbeat: has('tr-ast-latidos'), stinger: has('tr-ast-golpe'), whisper: has('tr-ast-susurros'),
    tension: has('tr-ast-tension'), thunder: has('hx-ast-snd-trueno'), creak: has('tr-ast-crujido'), musicBox: has('tr-ast-cajita'),
    pop: has('hx-ast-snd-pop'), sparkle: has('hx-ast-snd-destello'), giggle: has('hx-ast-snd-risita'), chime: has('hx-ast-snd-campanilla'),
    whoosh: has('hx-ast-snd-whoosh'), boo: has('hx-ast-snd-boo'),
  };
}
export function defaultMusic(style: ShowStyle, assets: readonly Asset[]): string | undefined {
  const id = style === 'terror' ? 'tr-ast-zumbido' : style === 'infantil' ? 'hx-ast-musica' : undefined;
  return id && assets.some((a) => a.id === id) ? id : undefined;
}

export interface GenerateOptions {
  style: ShowStyle;
  name: string;
  installation: Installation;
  protagonists: Protagonist[];
  /** Duración aproximada en segundos (sin contar la espera). */
  duration?: number;
  /** Rótulo del gran final (p. ej. «¡Feliz Halloween, Arnau!»). */
  finaleText?: string;
  /** Rótulo de la despedida. */
  endText?: string;
  sounds?: SoundKit;
}

interface Palette { main: string; second: string; light: string; ghost: string; eyes: string; outline: string; font: string; endFont: string }
const PALETTES: Record<ShowStyle, Palette> = {
  infantil: { main: '#ff7a12', second: '#9b4dff', light: '#ff8a2a', ghost: '#6a3cff', eyes: '#ffd23a', outline: '#12031c', font: 'terror', endFont: 'cuento' },
  terror: { main: '#ff1f1a', second: '#8a0008', light: '#7a9cff', ghost: '#2a3cff', eyes: '#ff1f1a', outline: '#0a0000', font: 'terror', endFont: 'terror' },
  navidad: { main: '#ffd23a', second: '#ff2a2a', light: '#ffb062', ghost: '#3d7aff', eyes: '#ffffff', outline: '#08122a', font: 'elegante', endFont: 'cuento' },
};

const isWindow = (s: Surface) => s.kind === 'window' || s.kind === 'shopwindow';
const isDoor = (s: Surface) => s.kind === 'door' || s.kind === 'garage';

export function generateShow(o: GenerateOptions): Show {
  const inst = o.installation;
  const P = PALETTES[o.style];
  const K = o.sounds ?? {};
  const all = orderedSurfaces(inst);
  const windows = all.filter(isWindow);
  const doors = all.filter(isDoor);
  const stages = windows.length ? windows : all.filter((s) => s.kind !== 'wall');
  const walls = all.filter((s) => s.kind === 'wall');
  const area = (s: Surface) => { const xs = s.quad.map((p) => p.x), ys = s.quad.map((p) => p.y); return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)); };
  const mainWall = walls.slice().sort((a, b) => area(b) - area(a))[0] ?? null;
  const others = all.filter((s) => !isWindow(s) && !isDoor(s) && s !== mainWall);
  // Rótulos: la superficie más apaisada que no sea ventana ni puerta (una franja, un dintel…).
  const textSurf = others.slice().sort((a, b) => surfaceAspect(b, inst.output) - surfaceAspect(a, inst.output))[0] ?? mainWall ?? stages[0] ?? all[0];
  const decor = others.filter((s) => s !== textSurf);
  const frames = [...decor, ...stages, ...doors];

  const clip = (s: Surface, src: ClipSource, start: number, dur: number, p: Partial<Clip> = {}) => createClip(s.id, src, { start, duration: Math.max(0.2, dur), fit: 'stretch', fadeIn: 0.6, fadeOut: 0.6, ...p });
  const snd = (id: string | undefined, start: number, p: Partial<SoundCue> = {}) => (id ? [createSoundCue(id, { start, ...p })] : []);
  const scene = (name: string, d: number, tr: Scene['transition'], clips: Clip[], sounds: SoundCue[], notes = ''): Scene => ({ ...createScene(name, d), transition: tr, clips, sounds, notes });
  const tpl = (kind: TemplateKind, d: number, surfaces: Surface[]) => applyTemplate(kind, { ...inst, surfaces }, createScene('t', d), { thunderAssetId: K.thunder ?? null });
  const text = (t: string, color: string, font: string): ClipSource => ({ type: 'text', text: t, font: font as any, color, outline: P.outline, glow: true, bold: true });
  const fx = (e: Parameters<typeof effectSource>[0], over: Parameters<typeof effectSource>[1] = {}) => effectSource(e, over);
  const light = (s: Surface, d: number, color = P.light, p: Partial<Clip> = {}) =>
    o.style === 'navidad' ? clip(s, fx('glow', { color, color2: '#05030a' }), 0, d, { opacity: 0.7, z: -10, name: 'Luz', ...p }) : clip(s, fx('flicker', { color }), 0, d, { opacity: 0.6, z: -10, name: 'Luz', ...p });
  const accent = (s: Surface, d: number): Clip =>
    o.style === 'navidad' ? clip(s, fx('frost'), 0, d, { fadeIn: 0, name: 'Escarcha' }) : clip(s, fx('eyes', { color: P.eyes, color2: o.style === 'terror' ? '#ff7a1a' : '#7dff3a' }), 0, d, { fadeIn: 0.8, name: 'Ojos' });
  const ambient = (d: number, opacity = 0.45): Clip[] => {
    if (!mainWall) return [];
    if (o.style === 'navidad') return [clip(mainWall, fx('snow'), 0, d, { opacity: 0.8, z: -6, name: 'Nieve' })];
    if (o.style === 'terror') return [clip(mainWall, fx('fog', { color: '#8a2a2a', color2: '#1a0000' }), 0, d, { opacity, z: -12, name: 'Niebla' })];
    return [clip(mainWall, fx('spirits', { color: '#d8c8ff', color2: '#4a2a8c' }), 0, d, { opacity, z: -12, name: 'Espíritus' })];
  };
  // Encuadre del protagonista: vertical en ventana apaisada → de cabeza a cintura; en puerta → entero.
  const hero = (p: Protagonist, s: Surface, start: number, dur: number, extra: Partial<Clip> = {}): Clip => {
    const A = surfaceAspect(s, inst.output);
    const tall = p.aspect < 0.9 && A > 1.2 && !isDoor(s);
    const base: Partial<Clip> = tall ? { fit: 'contain', scale: 2.4, y: 0.96 } : { fit: 'contain', scale: isDoor(s) ? 1.0 : 0.95, y: 0.5 };
    const len = p.duration ? Math.min(dur, p.duration) : dur;
    return createClip(s.id, { type: 'asset', assetId: p.assetId }, {
      start, duration: Math.max(0.5, len), fadeIn: 0.3, fadeOut: 0.6, loop: !p.duration, name: p.name,
      ...(p.characterId ? { characterId: p.characterId, animationId: p.animationId ?? null } : {}),
      ...(p.motion ? { motion: p.motion } : {}), ...base, ...extra,
    } as Partial<Clip>);
  };

  const scenes: Scene[] = [];
  // 1 · Espera
  scenes.push(scene('Espera (bucle)', 14, { type: 'fade', duration: 1.5 }, [
    ...stages.map((s) => accent(s, 14)),
    ...decor.map((s) => clip(s, fx('neon', { color: P.second, width: 4 }), 0, 14, { opacity: 0.3, fadeIn: 3, z: 5, name: 'Contorno' })),
    ...ambient(14, 0.4),
  ], [...snd(o.style === 'terror' ? K.heartbeat : undefined, 0, { loop: true, volume: 0.5 }), ...snd(o.style === 'terror' ? K.ambient : undefined, 0, { loop: true, volume: 0.4 })],
  'Escena tranquila para dejar en bucle (tecla 1) mientras llega la gente.'));
  // 2 · Despertar
  const wake = o.style === 'navidad' ? tpl('telon', 10, stages) : tpl('neonDibujo', 10, frames);
  scenes.push(scene(o.style === 'navidad' ? 'Se abre el telón' : 'La casa despierta', 10, { type: 'fade', duration: 1 }, [
    ...wake.clips.map((c) => ({ ...c, opacity: 0.85 })),
    ...(o.style === 'navidad' ? stages.map((s) => light(s, 10, P.light, { z: -12 })) : []),
  ], [...snd(K.whoosh, 0.2, { volume: 0.6 }), ...snd(K.sparkle, 3, { volume: 0.6 })]));

  // Protagonistas e impactos intercalados
  const target = Math.max(40, o.duration ?? 110);
  const fixed = 10 + 12 + 8;
  const nP = Math.max(o.protagonists.length, 1);
  const nI = Math.max(1, Math.min(4, Math.round((target - fixed - nP * 9) / 9)));
  const impacts: TemplateKind[] = o.style === 'terror' ? ['tormenta', 'cristalRoto', 'ojos', 'sombras'] : o.style === 'navidad' ? ['navidad', 'sombras', 'fuegosArtificiales', 'nieveMagica'] : ['tormenta', 'sombras', 'ojos', 'lucesFeria'];
  let ii = 0;
  const impactScene = () => {
    const kind = impacts[ii % impacts.length];
    ii++;
    const r = tpl(kind, 9, all);
    const extra: SoundCue[] = kind === 'cristalRoto' ? snd(K.stinger, 0, { volume: 0.9 }) : kind === 'ojos' ? snd(K.giggle ?? K.whisper, 2.5, { volume: 0.6 }) : [];
    scenes.push(scene(TEMPLATE_TITLES[kind] ?? kind, 9, { type: 'crossfade', duration: 0.8 }, r.clips, [...r.sounds, ...extra]));
  };
  o.protagonists.forEach((p, i) => {
    const useDoor = doors.length > 0 && p.aspect < 0.9 && i % 3 === 2;
    const s = useDoor ? doors[0] : stages[i % Math.max(1, stages.length)];
    const d = Math.max(8, Math.min(12, (p.duration ?? 6) + 3));
    const at = 1;
    const enter = o.style === 'terror' ? K.stinger : o.style === 'navidad' ? K.sparkle : K.pop;
    const rest = stages.filter((x) => x !== s);
    scenes.push(scene(p.name, d, { type: o.style === 'terror' && i % 2 === 0 ? 'cut' : 'crossfade', duration: 0.8 }, [
      light(s, d, i % 2 && o.style === 'terror' ? '#7dff3a' : P.light),
      hero(p, s, at, d - at),
      ...rest.slice(0, 1).map((x) => accent(x, d)),
      ...(useDoor ? [clip(s, fx('drawOn', { color: P.main, width: 4 }), 0, d, { opacity: 0.85, fadeIn: 0, z: 5, name: 'Contorno' })] : []),
      ...decor.map((x) => clip(x, fx('neon', { color: i % 2 ? P.main : P.second, width: 4 }), 0, d, { opacity: 0.5, z: 5, name: 'Contorno' })),
      ...ambient(d),
    ], [...snd(enter, at, { volume: 0.8 }), ...snd(p.audioId ?? undefined, at, { volume: 0.9 }), ...(o.style === 'terror' ? snd(i % 2 ? K.whisper : K.creak, 0.2, { volume: 0.6 }) : [])]));
    if ((i + 1) % 2 === 0 && ii < nI) impactScene();
  });
  while (ii < nI) impactScene();

  // Gran final
  const finale = o.style === 'navidad' ? tpl('fuegosArtificiales', 12, all) : o.style === 'terror' ? { clips: [], sounds: [] } : tpl('lucesFeria', 12, frames);
  const heroes = o.protagonists.slice(0, stages.length + doors.length);
  const places = [...stages, ...doors];
  scenes.push(scene('Gran final', 12, { type: o.style === 'terror' ? 'cut' : 'fade', duration: 0.6 }, [
    ...finale.clips,
    ...(o.style === 'terror' ? [
      ...(mainWall ? [clip(mainWall, fx('lightning'), 0, 12, { fadeIn: 0, fadeOut: 0, z: 2, name: 'Relámpago' })] : []),
      ...frames.map((s) => clip(s, fx('neon', { color: P.main, width: 3 }), 0.2, 8, { opacity: 0.6, fadeIn: 0.1, z: 5, name: 'Marco' })),
    ] : stages.map((s) => light(s, 12))),
    ...heroes.map((p, k) => hero(p, places[k], 0.3 + (o.style === 'terror' ? 0 : k * 0.4), 11)),
    ...(o.finaleText ? [clip(textSurf, text(o.finaleText, P.main, P.font), 0.8, 11.2, { fit: 'contain', scale: 1.3, fadeIn: 0, motion: { preset: 'popIn', intensity: 1, speed: 1 }, name: 'Rótulo' })] : []),
  ], [...snd(o.style === 'terror' ? K.stinger : K.sparkle, 0.3, { volume: 0.9 }), ...snd(o.style === 'terror' ? K.thunder : K.pop, 0.5, { volume: 0.8 }), ...snd(o.style === 'terror' ? K.tension : K.giggle, 7, { volume: 0.7 })]));
  // Despedida
  const endText = o.endText ?? (o.style === 'terror' ? '¿Te atreves a volver?' : o.style === 'navidad' ? '¡Feliz Navidad!' : 'Buenas noches');
  scenes.push(scene('Despedida', 8, { type: o.style === 'terror' ? 'cut' : 'crossfade', duration: 1 }, [
    clip(textSurf, text(endText, o.style === 'terror' ? P.main : '#cfe0ff', P.endFont), 0.8, 7.2, { fit: 'contain', scale: 1.2, fadeIn: 1.2, fadeOut: 2, name: 'Rótulo' }),
    ...(o.style === 'terror' ? stages.map((s) => clip(s, fx('drawOn', { color: P.second, width: 3 }), 1.5, 6.5, { opacity: 0.8, fadeIn: 0, z: 5, name: 'Trazo' })) : stages.map((s) => light(s, 8, P.light, { opacity: 0.4, fadeOut: 2.5 }))),
  ], [...snd(o.style === 'terror' ? K.heartbeat : K.chime, 0.5, { volume: 0.5, ...(o.style === 'terror' ? { loop: true, duration: 7 } : {}) })]));

  const show = createShow(o.name, inst.id);
  show.scenes = scenes;
  show.tags = [SHOW_STYLE_LABELS[o.style]];
  show.description = `Creado con el asistente (${SHOW_STYLE_LABELS[o.style]}). Retócalo a tu gusto.`;
  const music = o.sounds?.music;
  if (music) show.music = [{ id: `${show.id}-mus`, assetId: music, start: 0, volume: o.style === 'terror' ? 0.55 : 0.45, fadeIn: 3, fadeOut: 3, loop: true }];
  return show;
}

const TEMPLATE_TITLES: Partial<Record<TemplateKind, string>> = {
  tormenta: 'Tormenta', cristalRoto: 'Cristales rotos', ojos: 'Ojos en la oscuridad', sombras: 'Alguien pasa por dentro',
  navidad: 'Noche de Navidad', fuegosArtificiales: 'Fuegos artificiales', nieveMagica: 'Nieve mágica', lucesFeria: 'Luces de feria',
};
