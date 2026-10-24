/**
 * Buscar e instalar actualizaciones desde GitHub (solo cuando el usuario pulsa el botón).
 * - Se consulta únicamente api.github.com del repositorio configurado.
 * - El instalador se comprueba con la suma SHA-256 publicada junto a él antes de ofrecer abrirlo.
 * - Si el repositorio es privado hace falta una clave de solo lectura; se guarda cifrada con
 *   safeStorage (protección de datos de Windows) en la carpeta de usuario y nunca sale al editor.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { app, net, safeStorage } from 'electron';
import { UPDATE_REPO, UPDATE_TAG, SUMS_FILE, releaseFromApi, updateAvailable, pickInstaller, parseSums, type BuildInfo } from '../shared/updates';
import type { UpdateCheck } from '../shared/api';

declare const __BUILD_SHA__: string;
declare const __BUILD_DATE__: string;

export const BUILD: BuildInfo = {
  sha: typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev',
  date: typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : '',
};

const tokenFile = () => path.join(app.getPath('userData'), 'update-token.bin');

export function hasToken(): boolean {
  return fs.existsSync(tokenFile());
}

export async function setToken(token: string | null) {
  const f = tokenFile();
  if (!token) { await fs.promises.rm(f, { force: true }); return; }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows no permite guardar la clave cifrada en este equipo.');
  await fs.promises.writeFile(f, safeStorage.encryptString(token.trim()));
}

function readToken(): string | null {
  try {
    return hasToken() ? safeStorage.decryptString(fs.readFileSync(tokenFile())) : null;
  } catch {
    return null;
  }
}

function headers(accept = 'application/vnd.github+json'): Record<string, string> {
  const h: Record<string, string> = { Accept: accept, 'User-Agent': 'Videomapping-Studio', 'X-GitHub-Api-Version': '2022-11-28' };
  const t = readToken();
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

let lastRelease: ReturnType<typeof releaseFromApi> | null = null;

export async function checkForUpdate(): Promise<UpdateCheck> {
  const base: UpdateCheck = { current: BUILD, latest: null, available: false, canInstall: app.isPackaged && process.platform === 'win32', hasToken: hasToken(), error: null };
  let r: Response;
  try {
    r = await net.fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/tags/${UPDATE_TAG}`, { headers: headers() });
  } catch (e) {
    return { ...base, error: `Sin conexión con GitHub (${(e as Error).message}).` };
  }
  if (r.status === 404) {
    return { ...base, error: hasToken() ? 'No se encuentra la versión publicada (¿la clave tiene acceso al repositorio?).' : 'No se encuentra la versión publicada. Si el repositorio es privado, añade una clave de solo lectura.' };
  }
  if (r.status === 401 || r.status === 403) {
    return {
      ...base,
      error: hasToken()
        ? 'GitHub ha rechazado la clave (caducada o sin permiso de lectura de «Contents»).'
        : 'GitHub ha denegado el acceso: el repositorio es privado o se ha superado el límite de consultas. Añade una clave o inténtalo más tarde.',
    };
  }
  if (!r.ok) return { ...base, error: `GitHub respondió ${r.status}.` };
  const rel = releaseFromApi(await r.json());
  lastRelease = rel;
  const inst = pickInstaller(rel.assets);
  return {
    ...base,
    latest: { sha: rel.sha, date: rel.publishedAt, installer: inst?.name ?? null, size: inst?.size ?? 0 },
    available: updateAvailable(BUILD, rel),
  };
}

async function download(assetId: number, dest: string, onProgress?: (done: number) => void): Promise<string> {
  const url = `https://api.github.com/repos/${UPDATE_REPO}/releases/assets/${assetId}`;
  // GitHub redirige a una URL firmada de descarga: se sigue a mano para no reenviar allí la clave.
  let r = await net.fetch(url, { headers: headers('application/octet-stream'), redirect: 'manual' });
  const loc = r.status >= 300 && r.status < 400 ? r.headers.get('location') : null;
  if (loc) {
    if (!/^https:\/\/([a-z0-9-]+\.)*(github\.com|githubusercontent\.com)\//i.test(loc)) throw new Error('Redirección de descarga inesperada.');
    r = await net.fetch(loc, { headers: { 'User-Agent': 'Videomapping-Studio' } });
  } else if (r.status === 0 || (r.status >= 300 && r.status < 400)) {
    r = await net.fetch(url, { headers: headers('application/octet-stream') });
  }
  if (!r.ok || !r.body) throw new Error(`No se pudo descargar (${r.status}).`);
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(dest);
  const reader = r.body.getReader();
  let done = 0;
  try {
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      hash.update(value);
      done += value.byteLength;
      if (!out.write(value)) await new Promise<void>((res) => out.once('drain', () => res()));
      onProgress?.(done);
    }
  } finally {
    await new Promise<void>((res, rej) => out.end((err?: Error | null) => (err ? rej(err) : res())));
  }
  return hash.digest('hex');
}

/** Descarga el instalador, comprueba su suma y lo deja listo. Devuelve la ruta. */
export async function downloadInstaller(onProgress: (done: number, total: number) => void): Promise<string> {
  if (!lastRelease) await checkForUpdate();
  const rel = lastRelease;
  if (!rel) throw new Error('Primero busca actualizaciones.');
  const inst = pickInstaller(rel.assets);
  const sums = rel.assets.find((a) => a.name === SUMS_FILE);
  if (!inst) throw new Error('La versión publicada no tiene instalador.');
  if (!sums) throw new Error('La versión publicada no incluye las sumas de comprobación: no se instala por seguridad.');
  const dir = path.join(app.getPath('temp'), 'vmstudio-update');
  await fs.promises.rm(dir, { recursive: true, force: true });
  await fs.promises.mkdir(dir, { recursive: true });
  const sumsPath = path.join(dir, SUMS_FILE);
  await download(sums.id, sumsPath);
  const expected = parseSums(await fs.promises.readFile(sumsPath, 'utf8')).get(inst.name);
  if (!expected) throw new Error('No hay suma de comprobación para el instalador: no se instala por seguridad.');
  const file = path.join(dir, inst.name);
  const got = await download(inst.id, file, (d) => onProgress(d, inst.size));
  if (got !== expected) {
    await fs.promises.rm(file, { force: true });
    throw new Error('El archivo descargado no coincide con la suma publicada (descarga dañada). Inténtalo otra vez.');
  }
  return file;
}

/** Abre el instalador descargado y cierra la aplicación para que pueda sustituirla. */
export function runInstaller(file: string) {
  const dir = path.join(app.getPath('temp'), 'vmstudio-update');
  if (path.dirname(path.resolve(file)) !== path.resolve(dir) || !/\.exe$/i.test(file) || !fs.existsSync(file)) throw new Error('Instalador no válido.');
  spawn(file, [], { detached: true, stdio: 'ignore' }).unref();
  setTimeout(() => app.quit(), 300);
}
