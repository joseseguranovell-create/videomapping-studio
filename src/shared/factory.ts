/** Creación de entidades con valores por defecto válidos y duplicación segura. */
import { newId, nowIso } from './ids';
import {
  SCHEMA_VERSION,
  type Character,
  type Clip,
  type EffectKind,
  type ClipSource,
  type Installation,
  type Mask,
  type Project,
  type Scene,
  type Show,
  type SoundCue,
  type LightCue,
  type LightDevice,
  type LightKind,
  type Surface,
  type SurfaceKind,
  type Vec2,
  Clip as ClipSchema,
  SoundCue as SoundCueSchema,
  LightCue as LightCueSchema,
  Surface as SurfaceSchema,
} from './model';
import { quadFromBBox, rectQuad } from './geometry';

export const SURFACE_COLORS = ['#ff8a3d', '#3dd6ff', '#b6ff3d', '#ff3d9a', '#ffd93d', '#9a7bff', '#3dffb0', '#ff5e5e', '#5e8bff', '#e0e0e0'];

export function createProject(name: string): Project {
  const t = nowIso();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId('prj'),
    name,
    description: '',
    createdAt: t,
    updatedAt: t,
    installations: [],
    assets: [],
    characters: [],
    shows: [],
    lights: [],
    collections: [],
  };
}

export function createInstallation(name: string, output = { width: 1920, height: 1080 }): Installation {
  const t = nowIso();
  return {
    id: newId('ins'),
    name,
    description: '',
    notes: '',
    output,
    preferredDisplay: null,
    surfaces: [],
    masks: [],
    referenceImageAssetId: null,
    referenceImageOpacity: 0.5,
    calibratedAt: null,
    createdAt: t,
    updatedAt: t,
  };
}

export function createSurface(
  name: string,
  kind: SurfaceKind,
  index: number,
  rect?: { x: number; y: number; w: number; h: number },
): Surface {
  const r = rect ?? defaultRect(index);
  return SurfaceSchema.parse({
    id: newId('srf'),
    name,
    kind,
    color: SURFACE_COLORS[index % SURFACE_COLORS.length],
    quad: rectQuad(r.x, r.y, r.w, r.h),
  });
}

/** Coloca superficies nuevas escalonadas para que no se solapen al crearlas. */
function defaultRect(index: number) {
  const col = index % 4, row = Math.floor(index / 4) % 3;
  return { x: 0.08 + col * 0.22, y: 0.1 + row * 0.28, w: 0.16, h: 0.2 };
}

export function createPolygonSurface(name: string, kind: SurfaceKind, index: number, points: Vec2[]): Surface {
  const s = createSurface(name, kind, index);
  return { ...s, shape: 'polygon', polygon: points.map((p) => ({ ...p })), quad: quadFromBBox(points) };
}

export function createMask(name: string, points: Vec2[]): Mask {
  return { id: newId('msk'), name, enabled: true, points: points.map((p) => ({ ...p })) };
}

export function createShow(name: string, installationId: string | null): Show {
  const t = nowIso();
  return {
    id: newId('shw'),
    name,
    description: '',
    tags: [],
    installationId,
    scenes: [],
    music: [],
    masterVolume: 1,
    loop: true,
    loopGap: 3,
    createdAt: t,
    updatedAt: t,
  };
}

export function createScene(name: string, duration = 10): Scene {
  return { id: newId('scn'), name, duration, transition: { type: 'fade', duration: 1 }, clips: [], sounds: [], lights: [], notes: '', enabled: true };
}

export function createClip(surfaceId: string, source: ClipSource, partial: Partial<Clip> = {}): Clip {
  return ClipSchema.parse({ id: newId('clp'), surfaceId, source, ...partial });
}

export function createSoundCue(assetId: string, partial: Partial<SoundCue> = {}): SoundCue {
  return SoundCueSchema.parse({ id: newId('snd'), assetId, ...partial });
}

export function createLightCue(deviceId: string, partial: Partial<LightCue> = {}): LightCue {
  return LightCueSchema.parse({ id: newId('lgt'), deviceId, ...partial });
}

export function createLightDevice(name: string, kind: LightKind = 'color', entityId = ''): LightDevice {
  return { id: newId('dev'), name, kind, entityId };
}

export function createCharacter(name: string): Character {
  return { id: newId('chr'), name, description: '', tags: [], referenceAssetId: null, animations: [] };
}

// ───────────────────────── Duplicación ─────────────────────────

export function cloneDeep<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Duplica una instalación con identificadores nuevos. Devuelve también el mapa de ids de superficie. */
export function duplicateInstallation(inst: Installation, name?: string): { installation: Installation; surfaceMap: Record<string, string> } {
  const c = cloneDeep(inst);
  const surfaceMap: Record<string, string> = {};
  c.id = newId('ins');
  c.name = name ?? `${inst.name} (copia)`;
  c.createdAt = c.updatedAt = nowIso();
  c.surfaces = c.surfaces.map((s) => {
    const id = newId('srf');
    surfaceMap[s.id] = id;
    return { ...s, id, masks: s.masks.map((m) => ({ ...m, id: newId('msk') })) };
  });
  c.masks = c.masks.map((m) => ({ ...m, id: newId('msk') }));
  return { installation: c, surfaceMap };
}

export function duplicateScene(scene: Scene, name?: string): Scene {
  const c = cloneDeep(scene);
  c.id = newId('scn');
  c.name = name ?? `${scene.name} (copia)`;
  c.clips = c.clips.map((k) => ({ ...k, id: newId('clp') }));
  c.sounds = c.sounds.map((k) => ({ ...k, id: newId('snd') }));
  c.lights = c.lights.map((k) => ({ ...k, id: newId('lgt') }));
  return c;
}

/**
 * Duplica un espectáculo. Si se indica `surfaceMap`, reasigna los clips a las superficies nuevas;
 * los clips cuya superficie no esté en el mapa se conservan con su id original para revisarlos.
 */
export function duplicateShow(
  show: Show,
  opts: { name?: string; installationId?: string | null; surfaceMap?: Record<string, string> } = {},
): Show {
  const c = cloneDeep(show);
  c.id = newId('shw');
  c.name = opts.name ?? `${show.name} (copia)`;
  c.createdAt = c.updatedAt = nowIso();
  if (opts.installationId !== undefined) c.installationId = opts.installationId;
  c.scenes = c.scenes.map((s) => {
    const d = duplicateScene(s, s.name);
    if (opts.surfaceMap) d.clips = d.clips.map((k) => ({ ...k, surfaceId: opts.surfaceMap![k.surfaceId] ?? k.surfaceId }));
    return d;
  });
  c.music = c.music.map((m) => ({ ...m, id: newId('mus') }));
  return c;
}

/** Reasigna las superficies de un espectáculo existente (sin duplicarlo). */
export function remapShowSurfaces(show: Show, surfaceMap: Record<string, string | null>, installationId: string | null): Show {
  const c = cloneDeep(show);
  c.installationId = installationId;
  c.scenes = c.scenes.map((s) => ({
    ...s,
    clips: s.clips
      .filter((k) => surfaceMap[k.surfaceId] !== null)
      .map((k) => ({ ...k, surfaceId: surfaceMap[k.surfaceId] ?? k.surfaceId })),
  }));
  c.updatedAt = nowIso();
  return c;
}

/** Sugerencia automática de reasignación por nombre y después por tipo y orden. */
export function suggestSurfaceMap(from: Surface[], to: Surface[]): Record<string, string | null> {
  const map: Record<string, string | null> = {};
  const used = new Set<string>();
  const norm = (s: string) => s.trim().toLowerCase();
  for (const s of from) {
    const m = to.find((t) => !used.has(t.id) && norm(t.name) === norm(s.name));
    if (m) { map[s.id] = m.id; used.add(m.id); }
  }
  for (const s of from) {
    if (map[s.id]) continue;
    const m = to.find((t) => !used.has(t.id) && t.kind === s.kind);
    if (m) { map[s.id] = m.id; used.add(m.id); }
  }
  for (const s of from) {
    if (map[s.id] !== undefined) continue;
    const m = to.find((t) => !used.has(t.id));
    if (m) { map[s.id] = m.id; used.add(m.id); } else map[s.id] = null;
  }
  return map;
}

/** Ids de recursos usados por el proyecto (para avisos de recursos ausentes o limpieza). */
export function referencedAssetIds(p: Project): Set<string> {
  const ids = new Set<string>();
  for (const sh of p.shows) {
    sh.music.forEach((m) => ids.add(m.assetId));
    for (const sc of sh.scenes) {
      sc.clips.forEach((c) => c.source.type === 'asset' && ids.add(c.source.assetId));
      sc.sounds.forEach((s) => ids.add(s.assetId));
    }
  }
  for (const ch of p.characters) {
    ch.animations.forEach((a) => ids.add(a.assetId));
    if (ch.referenceAssetId) ids.add(ch.referenceAssetId);
  }
  for (const i of p.installations) if (i.referenceImageAssetId) ids.add(i.referenceImageAssetId);
  return ids;
}

// ───────── Efectos ─────────

/** Colores y ajustes por defecto de cada efecto (elegidos para que luzcan proyectados). */
export const EFFECT_DEFAULTS: Record<EffectKind, { color: string; color2: string; width?: number; space?: 'surface' | 'facade'; fit?: Clip['fit'] }> = {
  solid: { color: '#ff9a3c', color2: '#000000' },
  glow: { color: '#ff7a1a', color2: '#1a0526' },
  stars: { color: '#fff6c2', color2: '#7b2ff7' },
  flicker: { color: '#ffb347', color2: '#000000' },
  rainbow: { color: '#ffffff', color2: '#000000' },
  testPattern: { color: '#ffffff', color2: '#000000' },
  neon: { color: '#ff7a1a', color2: '#ffe0a8', width: 6 },
  drawOn: { color: '#ff8a1c', color2: '#ffe0a8', width: 5 },
  chase: { color: '#ff8a1c', color2: '#9b4dff', width: 7 },
  sweep: { color: '#ff8a1c', color2: '#5a1f8c', space: 'facade' },
  lightning: { color: '#e6ecff', color2: '#7f9dff', space: 'facade' },
  fire: { color: '#ff5a00', color2: '#ffd23a' },
  fog: { color: '#b9c4d8', color2: '#6d5a99', space: 'facade' },
  rain: { color: '#a9c8ff', color2: '#203060', space: 'facade' },
  snow: { color: '#ffffff', color2: '#9fd0ff', space: 'facade' },
  fireflies: { color: '#d8ff6a', color2: '#ffb347' },
  eyes: { color: '#ffd23a', color2: '#7dff3a' },
  spirits: { color: '#cfe0ff', color2: '#7b5cff', space: 'facade' },
  shadowPass: { color: '#ffb062', color2: '#120703', space: 'facade' },
  curtains: { color: '#9e0f1e', color2: '#ffcf5a' },
  shutters: { color: '#7a4a22', color2: '#1e0e05' },
  stainedGlass: { color: '#ffffff', color2: '#0d0d0d' },
  cracks: { color: '#e8f4ff', color2: '#7fb8ff' },
  glitch: { color: '#bfe6ff', color2: '#ff2a6a' },
  pulse: { color: '#ff1a1a', color2: '#2a0000' },
  searchlight: { color: '#f4f7ff', color2: '#6a8cff', space: 'facade' },
  fireworks: { color: '#ffd23a', color2: '#ff3d9a', space: 'facade' },
  frost: { color: '#eef8ff', color2: '#7fc4ff' },
  aurora: { color: '#3dff9a', color2: '#9b4dff', space: 'facade' },
  shootingStars: { color: '#ffffff', color2: '#9fd0ff', space: 'facade' },
  portal: { color: '#b26bff', color2: '#2a6bff' },
  burst: { color: '#ffb02a', color2: '#ff3d9a' },
  vortex: { color: '#9b4dff', color2: '#3dffd8' },
  runes: { color: '#ffb02a', color2: '#6a2cff' },
  bigEye: { color: '#7dff3a', color2: '#ff8a1c' },
  mouth: { color: '#ff7a12', color2: '#3a0010' },
  bubbles: { color: '#7dff6a', color2: '#b26bff' },
  confetti: { color: '#ffd23a', color2: '#ff3d6e', space: 'facade' },
  fairyDust: { color: '#fff1a8', color2: '#b26bff', space: 'facade' },
  hearts: { color: '#ff3d6e', color2: '#ff9ad2' },
  lanterns: { color: '#ff9a3a', color2: '#ffd23a', space: 'facade' },
  blood: { color: '#8a0008', color2: '#ff2a1a', space: 'surface' },
  handprints: { color: '#b0000a', color2: '#3a0004', space: 'surface' },
  claws: { color: '#ff1f1a', color2: '#ffd0b0', space: 'surface' },
  powerFail: { color: '#d8f0ff', color2: '#7a9cff', space: 'facade' },
  searchBeams: { color: '#fff4d8', color2: '#cfe0ff', space: 'facade' },
  policeTape: { color: '#ffd400', color2: '#000000', space: 'facade' },
  policeLights: { color: '#ff1010', color2: '#1040ff', space: 'facade' },
  cobwebs: { color: '#dcdcf0', color2: '#8080a0', space: 'surface' },
  bats: { color: '#ff7a1a', color2: '#5a1f8c', space: 'facade' },
  spiders: { color: '#9b7bff', color2: '#3a1a5a', space: 'surface' },
  comet: { color: '#ff8a1c', color2: '#ffffff', width: 5 },
};

export function effectSource(effect: EffectKind, over: Partial<{ color: string; color2: string; width: number; space: 'surface' | 'facade' }> = {}): ClipSource {
  const d = EFFECT_DEFAULTS[effect];
  return { type: 'effect', effect, color: d.color, color2: d.color2, width: d.width ?? 6, space: d.space ?? 'surface', ...over };
}
