/**
 * Persistencia de proyectos en disco (sin dependencias de Electron para poder probarlo).
 *
 * Estructura de un proyecto (carpeta autocontenida, se puede mover o copiar entera):
 *   Mi proyecto/
 *     project.vmsp          ← documento JSON principal
 *     autosave.vmsp         ← guardado automático (recuperación ante cierres inesperados)
 *     assets/               ← copias de los recursos importados (rutas relativas)
 *     backups/              ← copias de seguridad con fecha
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { parseProject, serializeProject } from '../shared/schema';
import type { Project, Asset, AssetKind } from '../shared/model';

export const PROJECT_FILE = 'project.vmsp';
export const AUTOSAVE_FILE = 'autosave.vmsp';
export const ASSETS_DIR = 'assets';
export const BACKUPS_DIR = 'backups';
const MAX_BACKUPS = 30;
const AUTO_BACKUP_MIN_INTERVAL_MS = 10 * 60 * 1000;

export const MEDIA_EXT: Record<string, AssetKind> = {
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.gif': 'image', '.svg': 'image', '.bmp': 'image', '.avif': 'image',
  '.mp4': 'video', '.webm': 'video', '.m4v': 'video', '.mov': 'video', '.ogv': 'video', '.mkv': 'video',
  '.mp3': 'audio', '.wav': 'audio', '.ogg': 'audio', '.oga': 'audio', '.m4a': 'audio', '.aac': 'audio', '.flac': 'audio', '.opus': 'audio',
};

export function kindForFile(p: string): AssetKind | null {
  return MEDIA_EXT[path.extname(p).toLowerCase()] ?? null;
}

export function sanitizeName(name: string): string {
  const s = name
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  const reserved = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
  const r = s.slice(0, 80) || 'Proyecto';
  return reserved.test(r) ? `_${r}` : r;
}

/** Resuelve una ruta relativa garantizando que queda dentro de `base` (evita «../» maliciosos). */
export function resolveInside(base: string, rel: string): string {
  const clean = rel.replace(/\\/g, '/');
  if (path.isAbsolute(clean) || /^[a-zA-Z]:/.test(clean)) throw new Error(`Ruta no permitida: ${rel}`);
  const full = path.resolve(base, clean);
  const b = path.resolve(base);
  if (full !== b && !full.startsWith(b + path.sep)) throw new Error(`Ruta fuera del proyecto: ${rel}`);
  return full;
}

export function toRel(base: string, full: string): string {
  return path.relative(base, full).split(path.sep).join('/');
}

/** Escritura atómica: archivo temporal + fsync + rename. Un corte de luz no deja el archivo a medias. */
export async function writeFileAtomic(file: string, data: string | Buffer): Promise<void> {
  const dir = path.dirname(file);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  const fh = await fsp.open(tmp, 'w');
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await fsp.rename(tmp, file);
  } catch (e) {
    // En Windows, rename puede fallar si un antivirus tiene el archivo abierto: reintento breve.
    await new Promise((r) => setTimeout(r, 150));
    try {
      await fsp.rename(tmp, file);
    } catch (e2) {
      await fsp.rm(tmp, { force: true });
      throw e2;
    }
  }
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function uniquePath(dir: string, base: string, ext = ''): Promise<string> {
  let candidate = path.join(dir, `${base}${ext}`);
  let n = 2;
  while (await exists(candidate)) candidate = path.join(dir, `${base} (${n++})${ext}`);
  return candidate;
}

export interface LoadedProject {
  file: string;
  dir: string;
  project: Project;
  migratedFrom: number | null;
  autosaveNewer: boolean;
}

export async function createProjectFolder(parentDir: string, project: Project): Promise<LoadedProject> {
  const dir = await uniquePath(parentDir, sanitizeName(project.name));
  await fsp.mkdir(path.join(dir, ASSETS_DIR), { recursive: true });
  const file = path.join(dir, PROJECT_FILE);
  await writeFileAtomic(file, serializeProject(project));
  return { file, dir, project, migratedFrom: null, autosaveNewer: false };
}

/** Acepta la ruta del archivo project.vmsp o la de su carpeta. */
export async function normalizeProjectPath(p: string): Promise<string> {
  const st = await fsp.stat(p);
  if (st.isDirectory()) {
    const f = path.join(p, PROJECT_FILE);
    if (!(await exists(f))) throw new Error('La carpeta no contiene un proyecto (falta project.vmsp).');
    return f;
  }
  return p;
}

export async function readProjectFile(file: string): Promise<{ project: Project; migratedFrom: number | null }> {
  const raw = await fsp.readFile(file, 'utf8');
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error('El archivo del proyecto está dañado (JSON no válido). Puedes restaurar una copia de seguridad de la carpeta «backups».');
  }
  return parseProject(json);
}

export async function loadProject(p: string): Promise<LoadedProject> {
  const file = await normalizeProjectPath(p);
  const dir = path.dirname(file);
  const { project, migratedFrom } = await readProjectFile(file);
  let autosaveNewer = false;
  const auto = path.join(dir, AUTOSAVE_FILE);
  if (await exists(auto)) {
    // Guardar borra el autoguardado; si existe y difiere del proyecto, hay cambios sin guardar recuperables.
    const [a, b] = await Promise.all([fsp.readFile(auto, 'utf8'), fsp.readFile(file, 'utf8')]);
    autosaveNewer = a !== b;
  }
  if (migratedFrom !== null) {
    // Conserva el original antes de reescribirlo con el esquema nuevo.
    await backupFile(dir, file, `pre-migracion-v${migratedFrom}`);
  }
  return { file, dir, project, migratedFrom, autosaveNewer };
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

export async function backupFile(dir: string, file: string, label = 'auto'): Promise<string | null> {
  if (!(await exists(file))) return null;
  const bdir = path.join(dir, BACKUPS_DIR);
  await fsp.mkdir(bdir, { recursive: true });
  const dest = await uniquePath(bdir, `${stamp()}_${sanitizeName(label)}`, '.vmsp');
  await fsp.copyFile(file, dest);
  await pruneBackups(bdir);
  return dest;
}

async function pruneBackups(bdir: string) {
  const files = (await fsp.readdir(bdir)).filter((f) => f.endsWith('.vmsp')).sort();
  // Las copias manuales y de migración no se borran automáticamente.
  const autos = files.filter((f) => f.includes('_auto'));
  const excess = autos.length - MAX_BACKUPS;
  for (let i = 0; i < excess; i++) await fsp.rm(path.join(bdir, autos[i]), { force: true });
}

export async function lastAutoBackupTime(dir: string): Promise<number> {
  const bdir = path.join(dir, BACKUPS_DIR);
  if (!(await exists(bdir))) return 0;
  let latest = 0;
  for (const f of await fsp.readdir(bdir)) {
    if (!f.includes('_auto')) continue;
    const st = await fsp.stat(path.join(bdir, f));
    latest = Math.max(latest, st.mtimeMs);
  }
  return latest;
}

/** Guarda el proyecto: copia de seguridad periódica del anterior + escritura atómica + borra el autosave. */
export async function saveProject(file: string, project: Project): Promise<void> {
  const dir = path.dirname(file);
  const json = serializeProject(project);
  // Validación previa: nunca escribimos algo que luego no se pueda abrir.
  parseProject(JSON.parse(json));
  if (Date.now() - (await lastAutoBackupTime(dir)) > AUTO_BACKUP_MIN_INTERVAL_MS) await backupFile(dir, file, 'auto');
  await writeFileAtomic(file, json);
  await fsp.rm(path.join(dir, AUTOSAVE_FILE), { force: true });
}

export async function writeAutosave(dir: string, project: Project): Promise<void> {
  await writeFileAtomic(path.join(dir, AUTOSAVE_FILE), serializeProject(project));
}

export async function readAutosave(dir: string): Promise<Project | null> {
  const f = path.join(dir, AUTOSAVE_FILE);
  if (!(await exists(f))) return null;
  return (await readProjectFile(f)).project;
}

export async function discardAutosave(dir: string): Promise<void> {
  await fsp.rm(path.join(dir, AUTOSAVE_FILE), { force: true });
}

export interface BackupEntry {
  name: string;
  size: number;
  modifiedAt: string;
}

export async function listBackups(dir: string): Promise<BackupEntry[]> {
  const bdir = path.join(dir, BACKUPS_DIR);
  if (!(await exists(bdir))) return [];
  const out: BackupEntry[] = [];
  for (const f of await fsp.readdir(bdir)) {
    if (!f.endsWith('.vmsp')) continue;
    const st = await fsp.stat(path.join(bdir, f));
    out.push({ name: f, size: st.size, modifiedAt: new Date(st.mtimeMs).toISOString() });
  }
  return out.sort((a, b) => b.name.localeCompare(a.name));
}

export async function readBackup(dir: string, name: string): Promise<Project> {
  const file = resolveInside(path.join(dir, BACKUPS_DIR), name);
  return (await readProjectFile(file)).project;
}

export async function writeManualBackup(dir: string, project: Project, label: string): Promise<string> {
  const bdir = path.join(dir, BACKUPS_DIR);
  await fsp.mkdir(bdir, { recursive: true });
  const dest = await uniquePath(bdir, `${stamp()}_${sanitizeName(label || 'manual')}`, '.vmsp');
  await writeFileAtomic(dest, serializeProject(project));
  return dest;
}

// ───────────────────────── Recursos ─────────────────────────

export interface ImportedFile {
  name: string;
  kind: AssetKind;
  file: string;
  frames: string[];
  size: number;
  format: string;
}

/** Copia un archivo dentro de assets/ con un nombre único. Nunca ejecuta ni interpreta el contenido. */
export async function copyIntoProject(dir: string, src: string, subdir = ''): Promise<ImportedFile> {
  const kind = kindForFile(src);
  if (!kind) throw new Error(`Formato no admitido: ${path.basename(src)}`);
  const st = await fsp.stat(src);
  if (!st.isFile()) throw new Error(`No es un archivo: ${src}`);
  const ext = path.extname(src).toLowerCase();
  const base = sanitizeName(path.basename(src, path.extname(src)));
  const destDir = path.join(dir, ASSETS_DIR, subdir);
  await fsp.mkdir(destDir, { recursive: true });
  // Si ya está dentro del proyecto, no se copia otra vez.
  const resolvedSrc = path.resolve(src);
  if (resolvedSrc.startsWith(path.resolve(dir, ASSETS_DIR) + path.sep)) {
    return { name: base, kind, file: toRel(dir, resolvedSrc), frames: [], size: st.size, format: ext.slice(1) };
  }
  const dest = await uniquePath(destDir, base, ext);
  await fsp.copyFile(src, dest);
  return { name: base, kind, file: toRel(dir, dest), frames: [], size: st.size, format: ext.slice(1) };
}

const naturalCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/** Importa una carpeta de imágenes numeradas como secuencia (PNG con transparencia recomendado). */
export async function importSequenceFolder(dir: string, folder: string): Promise<ImportedFile> {
  const entries = (await fsp.readdir(folder)).filter((f) => ['.png', '.webp', '.jpg', '.jpeg'].includes(path.extname(f).toLowerCase())).sort(naturalCompare);
  if (entries.length < 2) throw new Error('La carpeta debe contener al menos 2 imágenes numeradas (PNG, WebP o JPG).');
  const name = sanitizeName(path.basename(folder));
  const destDir = await uniquePath(path.join(dir, ASSETS_DIR), name);
  await fsp.mkdir(destDir, { recursive: true });
  let size = 0;
  const frames: string[] = [];
  for (const f of entries) {
    const src = path.join(folder, f);
    const dest = path.join(destDir, sanitizeName(f));
    await fsp.copyFile(src, dest);
    size += (await fsp.stat(src)).size;
    frames.push(toRel(dir, dest));
  }
  return { name, kind: 'sequence', file: frames[0], frames, size, format: path.extname(entries[0]).slice(1).toLowerCase() };
}

export function assetFiles(a: Pick<Asset, 'file' | 'frames' | 'kind'>): string[] {
  return a.kind === 'sequence' && a.frames.length ? a.frames : [a.file];
}

export async function findMissingAssets(dir: string, project: Project): Promise<string[]> {
  const missing: string[] = [];
  for (const a of project.assets) {
    let ok = true;
    for (const f of assetFiles(a)) {
      try {
        if (!(await exists(resolveInside(dir, f)))) { ok = false; break; }
      } catch {
        ok = false;
        break;
      }
    }
    if (!ok) missing.push(a.id);
  }
  return missing;
}

export async function copyDir(src: string, dest: string, filter: (rel: string) => boolean = () => true, relBase = ''): Promise<void> {
  await fsp.mkdir(dest, { recursive: true });
  for (const e of await fsp.readdir(src, { withFileTypes: true })) {
    const rel = relBase ? `${relBase}/${e.name}` : e.name;
    if (!filter(rel)) continue;
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    if (e.isDirectory()) await copyDir(s, d, filter, rel);
    else if (e.isFile()) await fsp.copyFile(s, d);
  }
}

/**
 * «Guardar como» / exportar: crea una carpeta de proyecto nueva con todos los recursos referenciados.
 * El proyecto original no se modifica.
 */
export async function saveProjectAs(srcDir: string, parentDir: string, project: Project): Promise<LoadedProject> {
  const dir = await uniquePath(parentDir, sanitizeName(project.name));
  await fsp.mkdir(path.join(dir, ASSETS_DIR), { recursive: true });
  for (const a of project.assets) {
    for (const rel of assetFiles(a)) {
      try {
        const s = resolveInside(srcDir, rel);
        if (!(await exists(s))) continue; // los ausentes se informan al abrir
        const d = resolveInside(dir, rel);
        await fsp.mkdir(path.dirname(d), { recursive: true });
        await fsp.copyFile(s, d);
      } catch {
        /* ruta inválida: se ignora y se notificará como recurso ausente */
      }
    }
  }
  const file = path.join(dir, PROJECT_FILE);
  await writeFileAtomic(file, serializeProject(project));
  return { file, dir, project, migratedFrom: null, autosaveNewer: false };
}
