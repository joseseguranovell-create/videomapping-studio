/**
 * Actualizaciones: decide si la versión publicada en GitHub («Releases», etiqueta «ultima») es más nueva
 * que la instalada, y elige qué archivo descargar. Solo se consulta cuando el usuario lo pide.
 */

/** Repositorio del que se descargan las actualizaciones. */
export const UPDATE_REPO = 'joseseguranovell-create/videomapping-studio';
export const UPDATE_TAG = 'ultima';
export const SUMS_FILE = 'SHA256SUMS.txt';

export interface BuildInfo {
  sha: string; // commit con el que se compiló ('dev' fuera de CI)
  date: string; // ISO
}

export interface ReleaseAsset {
  id: number;
  name: string;
  size: number;
}

export interface ReleaseInfo {
  sha: string;
  publishedAt: string;
  assets: ReleaseAsset[];
}

export function releaseFromApi(j: any): ReleaseInfo {
  return {
    sha: String(j?.target_commitish ?? ''),
    publishedAt: String(j?.published_at ?? ''),
    assets: Array.isArray(j?.assets) ? j.assets.map((a: any) => ({ id: Number(a.id), name: String(a.name), size: Number(a.size) || 0 })) : [],
  };
}

/** Hay actualización si la publicada es de otro commit y posterior a esta compilación. */
export function updateAvailable(current: BuildInfo, rel: ReleaseInfo): boolean {
  if (!rel.sha || rel.sha === current.sha) return false;
  const pub = Date.parse(rel.publishedAt);
  const built = Date.parse(current.date);
  if (!Number.isFinite(pub)) return false;
  return !Number.isFinite(built) || pub > built;
}

/** El instalador de Windows (no la versión portátil). */
export function pickInstaller(assets: ReleaseAsset[]): ReleaseAsset | null {
  return assets.find((a) => /setup.*\.exe$/i.test(a.name)) ?? null;
}

/** Lee un archivo de sumas en formato `sha256sum` («<hash>  <nombre>» o «<hash> *<nombre>»). */
export function parseSums(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/i.exec(line.trim());
    if (m) out.set(m[2].split(/[\\/]/).pop()!, m[1].toLowerCase());
  }
  return out;
}
