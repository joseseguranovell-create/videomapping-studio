/** Lectura, importación y exportación de paquetes de contenido. */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { PackManifest, PACK_FORMAT, type PackInfo } from '../shared/pack';
import type { Asset, Character, Installation, Project, Show } from '../shared/model';
import { assetFiles, exists, resolveInside, sanitizeName, uniquePath, ASSETS_DIR, writeFileAtomic } from './projectStore';
import { nowIso } from '../shared/ids';

export async function readPack(dir: string): Promise<PackManifest> {
  const raw = await fsp.readFile(path.join(dir, 'pack.json'), 'utf8');
  const r = PackManifest.safeParse(JSON.parse(raw));
  if (!r.success) throw new Error(`Paquete no válido (${path.basename(dir)}): ${r.error.issues[0]?.path.join('.')} ${r.error.issues[0]?.message}`);
  return r.data;
}

export async function listPacks(dirs: { dir: string; builtIn: boolean }[]): Promise<{ packs: PackInfo[]; errors: string[] }> {
  const packs: PackInfo[] = [];
  const errors: string[] = [];
  const mtimes = new Map<string, number>();
  for (const { dir, builtIn } of dirs) {
    if (!(await exists(dir))) continue;
    for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const pdir = path.join(dir, e.name);
      if (!(await exists(path.join(pdir, 'pack.json')))) continue;
      try {
        const m = await readPack(pdir);
        // Mismo paquete en dos carpetas (p. ej. una versión nueva copiada junto a la antigua): gana el integrado y, entre los del usuario, el más reciente.
        const dup = packs.findIndex((p) => p.id === m.id);
        const mtime = (await fsp.stat(path.join(pdir, 'pack.json'))).mtimeMs;
        if (dup >= 0) {
          if (builtIn || packs[dup].builtIn || mtime <= (mtimes.get(m.id) ?? 0)) continue;
          packs.splice(dup, 1);
        }
        mtimes.set(m.id, mtime);
        packs.push({
          id: m.id, name: m.name, description: m.description, version: m.version, license: m.license, author: m.author,
          builtIn, dir: pdir, assetCount: m.assets.length, characterCount: m.characters.length, showCount: m.shows.length, tags: m.tags,
          contents: {
            assets: m.assets.map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
            characters: m.characters.map((c) => ({ id: c.id, name: c.name })),
            shows: m.shows.map((s) => ({ id: s.id, name: s.name, scenes: s.scenes.length, duration: s.scenes.filter((x) => x.enabled).reduce((t, x) => t + x.duration, 0) })),
            installations: m.installations.map((i) => ({ id: i.id, name: i.name, surfaces: i.surfaces.length })),
          },
        });
      } catch (err) {
        errors.push(String((err as Error).message));
      }
    }
  }
  return { packs, errors };
}

export interface PackImportResult {
  assets: Asset[];
  characters: Character[];
  installations: Installation[];
  shows: Show[];
  skippedAssets: number;
}

/**
 * Copia los archivos del paquete en assets/packs/<id>/ y devuelve las entidades listas para añadir.
 * Los ids del paquete se conservan: reimportar el mismo paquete no duplica recursos.
 */
export async function importPack(packDir: string, projectDir: string, existing: Project): Promise<PackImportResult> {
  const m = await readPack(packDir);
  const baseRel = `${ASSETS_DIR}/packs/${m.id}`;
  const have = new Set(existing.assets.map((a) => a.id));
  const assets: Asset[] = [];
  let skipped = 0;
  for (const a of m.assets) {
    const files = assetFiles(a);
    const newRel = (rel: string) => `${baseRel}/${rel.replace(/\\/g, '/')}`;
    for (const rel of files) {
      const src = resolveInside(packDir, rel);
      const dest = resolveInside(projectDir, newRel(rel));
      if (!(await exists(dest))) {
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.copyFile(src, dest);
      }
    }
    if (have.has(a.id)) { skipped++; continue; }
    let size = 0;
    for (const rel of files) size += (await fsp.stat(resolveInside(packDir, rel))).size;
    assets.push({ ...a, file: newRel(a.file), frames: a.frames.map(newRel), size, addedAt: nowIso(), source: a.source || `Paquete: ${m.name}` });
  }
  const haveChars = new Set(existing.characters.map((c) => c.id));
  return {
    assets,
    characters: m.characters.filter((c) => !haveChars.has(c.id)),
    installations: m.installations,
    shows: m.shows,
    skippedAssets: skipped,
  };
}

/** Exporta recursos y personajes del proyecto a una carpeta de paquete reutilizable. */
export async function exportPack(
  projectDir: string,
  project: Project,
  opts: { parentDir: string; name: string; description: string; assetIds: string[]; characterIds: string[]; includeShows: string[] },
): Promise<string> {
  const characters = project.characters.filter((c) => opts.characterIds.includes(c.id));
  const assetIds = new Set(opts.assetIds);
  characters.forEach((c) => { c.animations.forEach((a) => assetIds.add(a.assetId)); if (c.referenceAssetId) assetIds.add(c.referenceAssetId); });
  const shows = project.shows.filter((s) => opts.includeShows.includes(s.id));
  for (const s of shows) {
    s.music.forEach((m) => assetIds.add(m.assetId));
    s.scenes.forEach((sc) => { sc.clips.forEach((c) => c.source.type === 'asset' && assetIds.add(c.source.assetId)); sc.sounds.forEach((x) => assetIds.add(x.assetId)); });
  }
  const installations = project.installations.filter((i) => shows.some((s) => s.installationId === i.id));
  const id = sanitizeName(opts.name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'paquete';
  const dir = await uniquePath(opts.parentDir, sanitizeName(opts.name));
  await fsp.mkdir(dir, { recursive: true });
  const assets: Asset[] = [];
  for (const a of project.assets.filter((x) => assetIds.has(x.id))) {
    const files = assetFiles(a);
    const map = (rel: string) => `files/${rel.replace(/^assets\//, '')}`;
    for (const rel of files) {
      const src = resolveInside(projectDir, rel);
      if (!(await exists(src))) continue;
      const dest = resolveInside(dir, map(rel));
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.copyFile(src, dest);
    }
    assets.push({ ...a, file: map(a.file), frames: a.frames.map(map) });
  }
  const manifest: PackManifest = {
    format: PACK_FORMAT, formatVersion: 1, id, name: opts.name, description: opts.description, author: '', license: '',
    version: '1.0.0', tags: [], assets, characters, installations, shows,
  };
  await writeFileAtomic(path.join(dir, 'pack.json'), JSON.stringify(manifest, null, 2));
  return dir;
}
