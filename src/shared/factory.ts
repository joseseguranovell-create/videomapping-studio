/** Creación de entidades con valores por defecto válidos y duplicación segura. */
import { newId, nowIso } from './ids';
import {
  SCHEMA_VERSION,
  type Character,
  type Clip,
  type ClipSource,
  type Installation,
  type Mask,
  type Project,
  type Scene,
  type Show,
  type SoundCue,
  type Surface,
  type SurfaceKind,
  type Vec2,
  Clip as ClipSchema,
  SoundCue as SoundCueSchema,
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
  return { id: newId('scn'), name, duration, transition: { type: 'fade', duration: 1 }, clips: [], sounds: [], notes: '', enabled: true };
}

export function createClip(surfaceId: string, source: ClipSource, partial: Partial<Clip> = {}): Clip {
  return ClipSchema.parse({ id: newId('clp'), surfaceId, source, ...partial });
}

export function createSoundCue(assetId: string, partial: Partial<SoundCue> = {}): SoundCue {
  return SoundCueSchema.parse({ id: newId('snd'), assetId, ...partial });
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
