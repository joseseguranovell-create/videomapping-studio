/**
 * Genera resources/packs/halloween-infantil/pack.json a partir de los archivos del paquete.
 * Incluye: recursos, personajes, una instalación de ejemplo (casa con 6 ventanas, puerta, desván
 * y frontón) y un espectáculo completo. Se valida con el mismo esquema que usa la aplicación.
 *
 * Uso: node scripts/run-ts.mjs scripts/pack-tools/build-halloween-pack.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PackManifest, PACK_FORMAT } from '../../src/shared/pack';
import type { Asset, Character, Clip, Installation, Scene, Show, SoundCue, Vec2, Motion, ClipSource } from '../../src/shared/model';
import { Clip as ClipSchema, SoundCue as SoundSchema, Surface as SurfaceSchema } from '../../src/shared/model';
import { rectQuad, quadFromBBox } from '../../src/shared/geometry';
import { applyTemplate, type TemplateKind } from '../../src/shared/templates';
import { createScene } from '../../src/shared/factory';

const ROOT = path.resolve(__dirname, '../..');
const PACK = path.join(ROOT, 'resources/packs/halloween-infantil');
const NOW = '2026-10-24T00:00:00.000Z';
const LICENSE = 'CC0 1.0 — ilustraciones y sonidos originales creados para Videomapping Studio';

function probe(rel: string): { duration: number | null; width: number | null; height: number | null } {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height', '-of', 'json', path.join(PACK, rel)]).toString();
    const j = JSON.parse(out);
    const st = (j.streams ?? []).find((s: any) => s.width) ?? {};
    const d = parseFloat(j.format?.duration);
    return { duration: isFinite(d) ? Math.round(d * 1000) / 1000 : null, width: st.width ?? null, height: st.height ?? null };
  } catch {
    return { duration: null, width: null, height: null };
  }
}

function thumb(rel: string): string {
  const tmp = path.join(require('node:os').tmpdir(), `vms-thumb-${process.pid}.png`);
  try {
    const isVideo = rel.endsWith('.webm');
    const args = ['-loglevel', 'error', '-y', ...(isVideo ? ['-c:v', 'libvpx-vp9'] : []), '-i', path.join(PACK, rel), '-frames:v', '1', '-vf', 'scale=192:-1', tmp];
    execFileSync('ffmpeg', args);
    return `data:image/png;base64,${fs.readFileSync(tmp).toString('base64')}`;
  } catch {
    return '';
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

const assets: Asset[] = [];
function asset(id: string, name: string, kind: Asset['kind'], file: string, extra: Partial<Asset> = {}): string {
  const p = kind === 'image' && file.endsWith('.svg') ? { duration: null, width: 512, height: 512 } : probe(file);
  const size = (extra.frames?.length ? extra.frames : [file]).reduce((n, f) => n + fs.statSync(path.join(PACK, f)).size, 0);
  assets.push({
    id, name, kind, file, frames: [], fps: 24, format: path.extname(file).slice(1), width: p.width, height: p.height, duration: p.duration,
    hasAlpha: kind === 'audio' ? null : true, size, tags: [], collections: ['Halloween infantil'], license: LICENSE, source: 'Paquete Halloween infantil',
    thumbnail: kind === 'audio' ? '' : thumb(file), addedAt: NOW, ...extra,
  });
  return id;
}

// ───────── Recursos ─────────
const A = {
  ghost: asset('hx-ast-fantasma', 'Fantasma Boo', 'image', 'files/personajes/fantasma.svg', { tags: ['fantasma', 'personaje'] }),
  ghostWave: asset('hx-ast-fantasma-saluda', 'Fantasma Boo saludando', 'image', 'files/personajes/fantasma-saluda.svg', { tags: ['fantasma', 'personaje'] }),
  ghostVideo: asset('hx-ast-fantasma-video', 'Fantasma flotando (vídeo con alfa)', 'video', 'files/video/fantasma-flotando.webm', { tags: ['fantasma', 'vídeo'] }),
  pumpkin: asset('hx-ast-calabaza', 'Calabaza risueña', 'image', 'files/personajes/calabaza.svg', { tags: ['calabaza', 'personaje'] }),
  pumpkinOh: asset('hx-ast-calabaza-sorpresa', 'Calabaza sorprendida', 'image', 'files/personajes/calabaza-sorpresa.svg', { tags: ['calabaza', 'personaje'] }),
  bat: asset('hx-ast-murcielago', 'Murciélago Murci (aleteo)', 'sequence', 'files/personajes/murcielago-1.svg', {
    frames: ['files/personajes/murcielago-1.svg', 'files/personajes/murcielago-2.svg'], fps: 6, duration: 2 / 6, format: 'svg', width: 512, height: 512, tags: ['murciélago', 'personaje'],
  }),
  cat: asset('hx-ast-gatito', 'Gatito curioso', 'image', 'files/personajes/gatito.svg', { tags: ['gato', 'personaje'] }),
  spider: asset('hx-ast-aranita', 'Arañita colgante', 'image', 'files/personajes/aranita.svg', { tags: ['araña', 'personaje'] }),
  monster: asset('hx-ast-monstruito', 'Monstruito Ojito', 'image', 'files/personajes/monstruito.svg', { tags: ['monstruo', 'personaje'] }),
  moon: asset('hx-ast-luna', 'Luna sonriente', 'image', 'files/decorados/luna.svg', { tags: ['luna', 'decorado'] }),
  web: asset('hx-ast-telarana', 'Telaraña', 'image', 'files/decorados/telarana.svg', { tags: ['telaraña', 'decorado'] }),
  facade: asset('hx-ast-fachada', 'Fachada de ejemplo (referencia)', 'image', 'files/decorados/fachada-ejemplo.svg', { hasAlpha: false, width: 1920, height: 1080, tags: ['referencia'] }),
  music: asset('hx-ast-musica', 'Marcha de los fantasmitas (bucle)', 'audio', 'files/musica/musica-marcha-fantasmitas.ogg', { tags: ['música'] }),
  boo: asset('hx-ast-snd-boo', '¡Buuu!', 'audio', 'files/sonidos/boo.ogg', { tags: ['efecto'] }),
  boing: asset('hx-ast-snd-boing', 'Boing', 'audio', 'files/sonidos/boing.ogg', { tags: ['efecto'] }),
  pop: asset('hx-ast-snd-pop', 'Pop', 'audio', 'files/sonidos/pop.ogg', { tags: ['efecto'] }),
  sparkle: asset('hx-ast-snd-destello', 'Destello mágico', 'audio', 'files/sonidos/destello-magico.ogg', { tags: ['efecto'] }),
  flutter: asset('hx-ast-snd-aleteo', 'Aleteo', 'audio', 'files/sonidos/aleteo.ogg', { tags: ['efecto'] }),
  chime: asset('hx-ast-snd-campanilla', 'Campanilla', 'audio', 'files/sonidos/campanilla.ogg', { tags: ['efecto'] }),
  whoosh: asset('hx-ast-snd-whoosh', 'Whoosh', 'audio', 'files/sonidos/whoosh.ogg', { tags: ['efecto'] }),
  giggle: asset('hx-ast-snd-risita', 'Risita', 'audio', 'files/sonidos/risita.ogg', { tags: ['efecto'] }),
  thunder: asset('hx-ast-snd-trueno', 'Trueno', 'audio', 'files/sonidos/trueno.ogg', { tags: ['efecto', 'trueno'] }),
};

// ───────── Personajes ─────────
const M = (preset: Motion['preset'], intensity = 1, speed = 1): Motion => ({ preset, intensity, speed });
let animN = 0;
function anim(name: string, assetId: string, motion: Motion, duration: number, loop = true, scale = 0.85) {
  return { id: `hx-anm-${++animN}`, name, assetId, motion, duration, loop, fit: 'contain' as const, scale };
}
const characters: Character[] = [
  {
    id: 'hx-chr-boo', name: 'Boo, el fantasma', description: 'Un fantasma simpático y algo tímido. Le encanta saludar desde las ventanas.',
    tags: ['fantasma'], referenceAssetId: A.ghost,
    animations: [
      anim('Aparecer', A.ghost, M('popIn'), 2.5, false), anim('Flotar', A.ghost, M('float'), 6), anim('Saludar', A.ghostWave, M('wave'), 4),
      anim('Asomarse por abajo', A.ghost, M('peekBottom'), 5), anim('Flotando (vídeo)', A.ghostVideo, M('none'), 4), anim('Despedirse', A.ghostWave, M('popOut'), 2.5, false),
    ],
  },
  {
    id: 'hx-chr-calabaza', name: 'Calabaza risueña', description: 'Calabaza saltarina con dos expresiones: risueña y sorprendida.',
    tags: ['calabaza'], referenceAssetId: A.pumpkin,
    animations: [anim('Saltar', A.pumpkin, M('bounce'), 6), anim('Latir', A.pumpkin, M('pulse'), 5), anim('¡Sorpresa!', A.pumpkinOh, M('shake', 1.2), 3)],
  },
  {
    id: 'hx-chr-murci', name: 'Murci, el murciélago', description: 'Secuencia de 2 fotogramas que aletea. Ideal para cruzar de una ventana a otra.',
    tags: ['murciélago'], referenceAssetId: A.bat,
    animations: [anim('Cruzar volando', A.bat, M('crossLeftToRight'), 3, true, 0.55), anim('Revolotear', A.bat, M('float', 1.4, 2), 5, true, 0.6)],
  },
  {
    id: 'hx-chr-gatito', name: 'Gatito curioso', description: 'Se asoma por la parte de abajo de puertas y ventanas.',
    tags: ['gato'], referenceAssetId: A.cat,
    animations: [anim('Asomarse', A.cat, M('peekBottom'), 6), anim('Mirar a los lados', A.cat, M('lookAround'), 6)],
  },
  {
    id: 'hx-chr-aranita', name: 'Arañita', description: 'Baja colgada de su hilo desde arriba.',
    tags: ['araña'], referenceAssetId: A.spider,
    animations: [anim('Bajar del techo', A.spider, M('peekTop'), 6), anim('Balancearse', A.spider, M('wave', 0.8, 0.6), 6)],
  },
  {
    id: 'hx-chr-ojito', name: 'Monstruito Ojito', description: 'Pequeña criatura amistosa de un solo ojo.',
    tags: ['monstruo'], referenceAssetId: A.monster,
    animations: [anim('Saludar', A.monster, M('wave'), 5), anim('Saltar', A.monster, M('bounce', 0.8), 5)],
  },
  {
    id: 'hx-chr-luna', name: 'Luna sonriente', description: 'Decorado para el desván o el tejado.',
    tags: ['decorado'], referenceAssetId: A.moon,
    animations: [anim('Brillar', A.moon, M('pulse', 0.6, 0.5), 8, true, 0.9)],
  },
];

// ───────── Instalación de ejemplo ─────────
const W = 1920, H = 1080;
const N = (x: number, y: number): Vec2 => ({ x: x / W, y: y / H });
function rectSurf(id: string, name: string, kind: any, color: string, x: number, y: number, w: number, h: number, group: string) {
  return SurfaceSchema.parse({ id, name, kind, color, group, quad: rectQuad(x / W, y / H, w / W, h / H) });
}
function quadBezier(a: [number, number], c: [number, number], b: [number, number], n: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    out.push(N((1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]));
  }
  return out;
}
const archPts: Vec2[] = [N(880, 300), N(880, 215), ...quadBezier([880, 215], [880, 163], [960, 163], 6), ...quadBezier([960, 163], [1040, 163], [1040, 215], 6), N(1040, 300)];
const S = {
  fronton: 'hx-srf-fronton', desvan: 'hx-srf-desvan', ai: 'hx-srf-alta-izq', ac: 'hx-srf-alta-centro', ad: 'hx-srf-alta-der',
  bi: 'hx-srf-baja-izq', puerta: 'hx-srf-puerta', bd: 'hx-srf-baja-der',
};
const fronton = SurfaceSchema.parse({
  id: S.fronton, name: 'Frontón', kind: 'wall', color: '#9a7bff', group: 'Tejado', shape: 'polygon',
  polygon: [N(500, 320), N(960, 110), N(1420, 320)], quad: quadFromBBox([N(500, 320), N(960, 110), N(1420, 320)]),
  masks: [{ id: 'hx-msk-desvan', name: 'Hueco del desván', enabled: true, points: archPts.map((p, i) => ({ x: p.x + (p.x - 960 / W) * 0.04, y: p.y + (i ? -0.004 : 0.004) })) }],
  notes: 'Pared triangular bajo el tejado. Tiene una máscara para no proyectar sobre la ventana del desván.',
});
const desvan = SurfaceSchema.parse({ id: S.desvan, name: 'Ventana del desván', kind: 'window', color: '#ffd93d', group: 'Tejado', shape: 'polygon', polygon: archPts, quad: quadFromBBox(archPts) });
const installation: Installation = {
  id: 'hx-ins-casa', name: 'Casa de ejemplo', description: 'Casa de dos plantas con seis ventanas, puerta, desván con arco y frontón. Ajusta cada superficie a tu fachada real.',
  notes: 'La foto de referencia es una ilustración: sustitúyela por una foto de tu fachada tomada desde la posición del proyector.',
  output: { width: W, height: H }, preferredDisplay: null,
  surfaces: [
    fronton, desvan,
    rectSurf(S.ai, 'Ventana alta izquierda', 'window', '#ff8a3d', 540, 380, 220, 180, 'Planta alta'),
    rectSurf(S.ac, 'Ventana alta central', 'window', '#3dd6ff', 850, 380, 220, 180, 'Planta alta'),
    rectSurf(S.ad, 'Ventana alta derecha', 'window', '#b6ff3d', 1160, 380, 220, 180, 'Planta alta'),
    rectSurf(S.bi, 'Ventana baja izquierda', 'window', '#ff3d9a', 540, 680, 220, 200, 'Planta baja'),
    rectSurf(S.puerta, 'Puerta principal', 'door', '#ffb27a', 870, 640, 180, 360, 'Planta baja'),
    rectSurf(S.bd, 'Ventana baja derecha', 'window', '#3dffb0', 1160, 680, 220, 200, 'Planta baja'),
  ],
  masks: [{
    id: 'hx-msk-arbusto', name: 'Arbusto', enabled: true,
    points: [N(1120, 1000), N(1112, 950), N(1135, 905), N(1200, 888), N(1225, 860), N(1265, 850), N(1300, 866), N(1312, 888), N(1360, 884), N(1395, 930), N(1402, 1000)],
  }],
  referenceImageAssetId: A.facade, referenceImageOpacity: 0.6, calibratedAt: null, createdAt: NOW, updatedAt: NOW,
};

// ───────── Espectáculo ─────────
let clipN = 0, sndN = 0;
const img = (assetId: string): ClipSource => ({ type: 'asset', assetId });
const fx = (effect: any, color: string, color2 = '#1a0a2e'): ClipSource => ({ type: 'effect', effect, color, color2 });
function clip(surfaceId: string, source: ClipSource, start: number, duration: number, p: Partial<Clip> = {}): Clip {
  return ClipSchema.parse({ id: `hx-clp-${++clipN}`, surfaceId, source, start, duration, ...p });
}
function snd(assetId: string, start: number, p: Partial<SoundCue> = {}): SoundCue {
  return SoundSchema.parse({ id: `hx-snd-${++sndN}`, assetId, start, ...p });
}
const ch = (c: string, a: number) => ({ characterId: c, animationId: characters.find((x) => x.id === c)!.animations[a].id });
const warm = '#ffb347';
function scene(id: string, name: string, duration: number, transition: Scene['transition'], clips: Clip[], sounds: SoundCue[], notes = ''): Scene {
  return { id, name, duration, transition, clips, sounds, notes, enabled: true };
}
const glowAll = (d: number, op = 0.45) =>
  [S.ai, S.ac, S.ad, S.bi, S.bd].map((s, i) => clip(s, fx('flicker', warm), 0, d, { fit: 'stretch', opacity: op, fadeIn: 0.8, fadeOut: 0.8, z: -10, name: 'Luz de vela' }));

/** Clips de una plantilla de escena con ids estables (para que el paquete no cambie al regenerarlo). */
function fromTemplate(kind: TemplateKind, duration: number, start = 0, exclude: string[] = []) {
  const r = applyTemplate(kind, installation, createScene('t', duration), { start, thunderAssetId: A.thunder });
  const clips = r.clips.filter((c) => !exclude.includes(c.surfaceId)).map((c) => ({ ...c, id: `hx-clp-${++clipN}` }));
  const sounds = r.sounds.map((s) => ({ ...s, id: `hx-snd-${++sndN}` }));
  return { clips, sounds };
}
const neonIntro = fromTemplate('neonDibujo', 10);
const storm = fromTemplate('tormenta', 9);
const finaleLights = fromTemplate('lucesFeria', 11);
const shadowsLight = fromTemplate('cascadaLuz', 10, 0, [S.fronton, S.desvan]);
const sil = (p: Partial<Clip>) => ({ silhouette: true, silhouetteColor: '#120806', ...p });

const scenes: Scene[] = [
  scene('hx-scn-1', 'La casa despierta', 10, { type: 'fade', duration: 1.5 }, [
    ...neonIntro.clips,
    clip(S.fronton, fx('stars', '#fff6c2', '#7b2ff7'), 4, 6, { fit: 'stretch', fadeIn: 2, name: 'Estrellas' }),
    clip(S.desvan, img(A.moon), 4.5, 5.5, { ...ch('hx-chr-luna', 0), motion: M('pulse', 0.6, 0.5), scale: 0.9, fadeIn: 1.5, name: 'Luna' }),
  ], [snd(A.whoosh, 0.2, { volume: 0.6 }), snd(A.sparkle, 2.5, { volume: 0.7 }), snd(A.chime, 4.5)], 'El contorno de la casa se dibuja con neón, ventana a ventana.'),
  scene('hx-scn-2', '¡Hola, Boo!', 10, { type: 'crossfade', duration: 1 }, [
    ...glowAll(10, 0.4).filter((c) => c.surfaceId !== S.ac),
    clip(S.ac, fx('glow', '#9a7bff', '#140a28'), 0, 10, { fit: 'stretch', z: -10, fadeIn: 0.5, name: 'Resplandor' }),
    clip(S.ac, img(A.ghost), 0.5, 2.5, { ...ch('hx-chr-boo', 0), motion: M('popIn'), loop: false, scale: 0.85, fadeIn: 0, fadeOut: 0, name: 'Boo aparece' }),
    clip(S.ac, img(A.ghostWave), 3, 4, { ...ch('hx-chr-boo', 2), motion: M('wave'), scale: 0.85, fadeIn: 0, fadeOut: 0, name: 'Boo saluda' }),
    clip(S.ac, img(A.ghost), 7, 3, { ...ch('hx-chr-boo', 1), motion: M('float'), scale: 0.85, fadeIn: 0, name: 'Boo flota' }),
    clip(S.fronton, fx('stars', '#fff6c2', '#7b2ff7'), 0, 10, { fit: 'stretch', name: 'Estrellas' }),
    clip(S.desvan, img(A.moon), 0, 10, { motion: M('pulse', 0.6, 0.5), scale: 0.9, name: 'Luna' }),
  ], [snd(A.pop, 0.5), snd(A.boo, 1.0), snd(A.giggle, 4.2)], 'Boo aparece en la ventana central y saluda.'),
  scene('hx-scn-3', 'Calabazas saltarinas', 10, { type: 'crossfade', duration: 1 }, [
    ...glowAll(10, 0.35),
    clip(S.bi, img(A.pumpkin), 0.5, 9.5, { ...ch('hx-chr-calabaza', 0), motion: M('bounce'), scale: 0.8, y: 0.55, name: 'Calabaza' }),
    clip(S.bd, img(A.pumpkin), 1.0, 9, { ...ch('hx-chr-calabaza', 0), motion: M('bounce', 1, 1.2), scale: 0.8, y: 0.55, flipX: true, name: 'Calabaza' }),
    clip(S.puerta, img(A.pumpkinOh), 5, 4, { ...ch('hx-chr-calabaza', 2), motion: M('shake', 1.2), scale: 0.9, y: 0.6, name: '¡Sorpresa!' }),
    clip(S.ac, img(A.ghost), 0, 10, { motion: M('float'), scale: 0.6, opacity: 0.85, name: 'Boo mira' }),
    clip(S.fronton, fx('rainbow', '#ffffff'), 0, 10, { fit: 'stretch', opacity: 0.35, name: 'Arcoíris suave' }),
  ], [snd(A.boing, 0.6), snd(A.boing, 1.5, { volume: 0.8 }), snd(A.boing, 2.4, { volume: 0.7 }), snd(A.boing, 3.3, { volume: 0.6 }), snd(A.pop, 5), snd(A.giggle, 6.5)], 'Dos calabazas saltan en las ventanas bajas.'),
  scene('hx-scn-tormenta', 'Tormenta', 9, { type: 'crossfade', duration: 1 }, [
    ...storm.clips,
    clip(S.ac, img(A.ghost), 1.5, 6, { ...ch('hx-chr-boo', 1), motion: M('shake', 1.4), scale: 0.7, y: 0.55, fadeIn: 0.4, name: 'Boo tiembla' }),
    clip(S.puerta, img(A.pumpkinOh), 2.5, 6, { ...ch('hx-chr-calabaza', 2), motion: M('shake', 1.2), scale: 0.85, y: 0.6, name: '¡Qué susto!' }),
  ], [...storm.sounds, snd(A.giggle, 7.5, { volume: 0.8 })], 'Relámpagos en toda la fachada, lluvia y truenos (Boo y la calabaza tiemblan).'),
  scene('hx-scn-4', 'Vuelo de murciélagos', 9, { type: 'fade', duration: 0.8 }, [
    clip(S.ai, img(A.bat), 0.5, 3, { ...ch('hx-chr-murci', 0), motion: M('crossLeftToRight'), scale: 0.55, fadeIn: 0.2, fadeOut: 0.2, name: 'Murci cruza' }),
    clip(S.ac, img(A.bat), 3.2, 3, { ...ch('hx-chr-murci', 0), motion: M('crossLeftToRight'), scale: 0.55, fadeIn: 0.2, fadeOut: 0.2, name: 'Murci cruza' }),
    clip(S.ad, img(A.bat), 5.9, 3, { ...ch('hx-chr-murci', 0), motion: M('crossLeftToRight'), scale: 0.55, fadeIn: 0.2, fadeOut: 0.2, name: 'Murci cruza' }),
    ...[S.ai, S.ac, S.ad].map((s) => clip(s, fx('glow', '#5f7dff', '#05060f'), 0, 9, { fit: 'stretch', z: -10, opacity: 0.7, name: 'Cielo nocturno' })),
    clip(S.fronton, fx('stars', '#fff6c2', '#7b2ff7'), 0, 9, { fit: 'stretch', name: 'Estrellas' }),
    clip(S.desvan, img(A.moon), 0, 9, { motion: M('pulse', 0.6, 0.5), scale: 0.9, name: 'Luna' }),
  ], [snd(A.whoosh, 0.4), snd(A.flutter, 0.8), snd(A.flutter, 3.5), snd(A.flutter, 6.2)], 'Un murciélago vuela de ventana en ventana por la planta alta.'),
  scene('hx-scn-sombras', 'Sombras chinescas', 10, { type: 'crossfade', duration: 1 }, [
    ...shadowsLight.clips,
    clip(S.bi, img(A.cat), 1, 5, { ...ch('hx-chr-gatito', 1), ...sil({ motion: M('crossLeftToRight', 0.6), scale: 0.75, y: 0.62, fadeIn: 0.2, fadeOut: 0.2, name: 'Sombra del gatito' }) }),
    clip(S.bd, img(A.cat), 5.5, 4, { ...sil({ motion: M('crossLeftToRight', 0.6), scale: 0.75, y: 0.62, fadeIn: 0.2, fadeOut: 0.2, name: 'Sombra del gatito' }) }),
    clip(S.ad, img(A.ghostWave), 2, 6, { ...ch('hx-chr-boo', 2), ...sil({ motion: M('wave'), scale: 0.8, name: 'Sombra de Boo saludando' }) }),
    clip(S.ai, img(A.spider), 3, 6, { ...ch('hx-chr-aranita', 0), ...sil({ motion: M('peekTop'), scale: 0.8, y: 0.35, name: 'Sombra de la arañita' }) }),
    clip(S.ac, img(A.monster), 5, 4.5, { ...ch('hx-chr-ojito', 1), ...sil({ motion: M('bounce', 0.8), scale: 0.7, y: 0.58, name: 'Sombra de Ojito' }) }),
    clip(S.fronton, fx('stars', '#fff6c2', '#7b2ff7'), 0, 10, { fit: 'stretch', name: 'Estrellas' }),
  ], [snd(A.giggle, 2.3), snd(A.boing, 5.4, { volume: 0.6 }), snd(A.boing, 6.3, { volume: 0.5 })], 'Las ventanas se iluminan y por detrás pasan las sombras de los personajes.'),
  scene('hx-scn-5', 'Gatito y arañita', 10, { type: 'crossfade', duration: 1 }, [
    ...glowAll(10, 0.35).filter((c) => c.surfaceId !== S.ad),
    clip(S.puerta, img(A.cat), 0.5, 5.5, { ...ch('hx-chr-gatito', 0), motion: M('peekBottom'), scale: 0.9, y: 0.66, name: 'Gatito se asoma' }),
    clip(S.puerta, img(A.cat), 6, 4, { ...ch('hx-chr-gatito', 1), motion: M('lookAround'), scale: 0.9, y: 0.6, fadeIn: 0.3, name: 'Gatito mira' }),
    clip(S.ad, img(A.spider), 1, 7, { ...ch('hx-chr-aranita', 0), motion: M('peekTop'), scale: 0.8, y: 0.35, name: 'Arañita baja' }),
    clip(S.ai, img(A.monster), 2, 7, { ...ch('hx-chr-ojito', 0), motion: M('wave'), scale: 0.75, name: 'Ojito saluda' }),
    clip(S.bi, img(A.web), 0, 10, { scale: 0.7, x: 0.3, y: 0.32, opacity: 0.85, name: 'Telaraña' }),
    clip(S.fronton, fx('stars', '#fff6c2', '#7b2ff7'), 0, 10, { fit: 'stretch', name: 'Estrellas' }),
  ], [snd(A.pop, 1.0), snd(A.giggle, 2.5), snd(A.whoosh, 6, { volume: 0.5 })], 'Un gatito se asoma por la puerta y una arañita baja en la ventana derecha.'),
  scene('hx-scn-6', 'Estrellas mágicas', 10, { type: 'crossfade', duration: 1 }, [
    ...[S.ai, S.ac, S.ad, S.bi, S.bd].map((s) => clip(s, fx('stars', '#fff6c2', '#ffb347'), 0, 10, { fit: 'stretch', name: 'Estrellas' })),
    ...[S.ai, S.ac, S.ad, S.bi, S.bd].map((s) => clip(s, fx('glow', '#7b2ff7', '#0a0418'), 0, 10, { fit: 'stretch', z: -10, opacity: 0.8, name: 'Fondo mágico' })),
    clip(S.puerta, img(A.ghostVideo), 1, 9, { ...ch('hx-chr-boo', 4), scale: 0.95, y: 0.45, name: 'Boo flotando (vídeo)' }),
    clip(S.desvan, fx('rainbow', '#ffffff'), 0, 10, { fit: 'stretch', name: 'Arcoíris' }),
    clip(S.fronton, fx('glow', '#ffd93d', '#3a0f5c'), 0, 10, { fit: 'stretch', name: 'Resplandor' }),
  ], [snd(A.sparkle, 0.5), snd(A.sparkle, 5, { volume: 0.7 }), snd(A.boo, 2, { volume: 0.6 })], 'Toda la casa se llena de estrellas; Boo flota en la puerta (vídeo con transparencia).'),
  scene('hx-scn-final', '¡Feliz Halloween!', 11, { type: 'crossfade', duration: 1 }, [
    ...finaleLights.clips,
    ...[S.ai, S.ac, S.ad, S.bi, S.bd].map((s) => clip(s, { type: 'effect', effect: 'sweep', color: '#ff9a3c', color2: '#5a1f8c', width: 6, space: 'facade' }, 0, 11, { fit: 'stretch', opacity: 0.7, z: -10, name: 'Barrido de luz' })),
    // El rótulo se parte a ambos lados de la ventana del desván (el frontón tiene ese hueco enmascarado).
    clip(S.fronton, { type: 'text', text: '¡Feliz', font: 'divertida', color: '#ffb347', outline: '#2b1240', glow: true, bold: true }, 1, 10, { motion: M('popIn'), scale: 0.3, x: 0.27, y: 0.74, fadeIn: 0, name: 'Rótulo «¡Feliz»' }),
    clip(S.fronton, { type: 'text', text: 'Halloween!', font: 'divertida', color: '#ffb347', outline: '#2b1240', glow: true, bold: true }, 1.4, 9.6, { motion: M('popIn'), scale: 0.36, x: 0.75, y: 0.74, fadeIn: 0, name: 'Rótulo «Halloween!»' }),
    clip(S.puerta, img(A.ghostWave), 2, 9, { ...ch('hx-chr-boo', 2), motion: M('wave'), scale: 0.95, y: 0.5, name: 'Boo celebra' }),
    clip(S.bi, img(A.pumpkin), 2.5, 8.5, { motion: M('bounce'), scale: 0.75, y: 0.55, name: 'Calabaza' }),
    clip(S.bd, img(A.pumpkin), 3, 8, { motion: M('bounce', 1, 1.2), scale: 0.75, y: 0.55, flipX: true, name: 'Calabaza' }),
    clip(S.desvan, img(A.moon), 0, 11, { motion: M('pulse', 0.6, 0.5), scale: 0.9, name: 'Luna' }),
  ], [snd(A.sparkle, 0.5), snd(A.pop, 1.1), snd(A.boo, 2.2, { volume: 0.7 }), snd(A.giggle, 4), snd(A.sparkle, 7, { volume: 0.7 })], 'Gran final: luces de feria en todos los contornos, barrido de color y rótulo.'),
  scene('hx-scn-7', '¡Buenas noches!', 7, { type: 'fade', duration: 1 }, [
    ...glowAll(7, 0.4),
    clip(S.ac, img(A.ghostWave), 0, 5, { ...ch('hx-chr-boo', 2), motion: M('wave'), scale: 0.85, fadeOut: 0, name: 'Boo se despide' }),
    clip(S.ac, img(A.ghostWave), 5, 2, { ...ch('hx-chr-boo', 5), motion: M('popOut'), loop: false, scale: 0.85, fadeIn: 0, fadeOut: 0, name: 'Boo desaparece' }),
    clip(S.bi, img(A.pumpkin), 0, 6, { motion: M('pulse'), scale: 0.8, y: 0.55, name: 'Calabaza' }),
    clip(S.bd, img(A.pumpkin), 0, 6, { motion: M('pulse'), scale: 0.8, y: 0.55, flipX: true, name: 'Calabaza' }),
    clip(S.desvan, img(A.moon), 0, 7, { motion: M('pulse', 0.6, 0.5), scale: 0.9, name: 'Luna' }),
    clip(S.fronton, fx('stars', '#fff6c2', '#7b2ff7'), 0, 7, { fit: 'stretch', name: 'Estrellas' }),
  ], [snd(A.giggle, 1), snd(A.pop, 5.1), snd(A.chime, 5.6)], 'Todos se despiden y la casa se apaga.'),
];

const show: Show = {
  id: 'hx-shw-halloween', name: 'Halloween infantil (ejemplo)', description: 'Espectáculo de ejemplo (~1 min 40 s, en bucle) para una casa con seis ventanas, puerta y desván: neón, tormenta, sombras chinescas y gran final.',
  tags: ['Halloween', 'infantil', 'ejemplo'], installationId: installation.id, scenes,
  music: [{ id: 'hx-mus-1', assetId: A.music, start: 0, volume: 0.55, fadeIn: 2, fadeOut: 2, loop: true }],
  masterVolume: 1, loop: true, loopGap: 4, createdAt: NOW, updatedAt: NOW,
};

const manifest = PackManifest.parse({
  format: PACK_FORMAT, formatVersion: 1, id: 'halloween-infantil', name: 'Halloween infantil',
  description: 'Personajes simpáticos (fantasma, calabazas, murciélago, gatito, arañita, monstruito), decorados, música y efectos, con una casa y un espectáculo de ejemplo.',
  author: 'Videomapping Studio', license: LICENSE, version: '1.0.0', tags: ['Halloween', 'infantil'],
  assets, characters, installations: [installation], shows: [show],
});
fs.writeFileSync(path.join(PACK, 'pack.json'), JSON.stringify(manifest, null, 2));
console.log(`pack.json: ${manifest.assets.length} recursos, ${manifest.characters.length} personajes, ${manifest.shows[0].scenes.length} escenas`);
