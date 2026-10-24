import { describe, it, expect } from 'vitest';
import { updateAvailable, pickInstaller, parseSums, releaseFromApi } from '../../src/shared/updates';

const rel = (sha: string, publishedAt: string) => ({ sha, publishedAt, assets: [] });

describe('actualizaciones', () => {
  it('detecta una versión publicada más nueva', () => {
    const cur = { sha: 'aaa', date: '2026-10-24T20:00:00Z' };
    expect(updateAvailable(cur, rel('bbb', '2026-10-24T21:00:00Z'))).toBe(true);
    expect(updateAvailable(cur, rel('aaa', '2026-10-24T21:00:00Z'))).toBe(false); // la misma
    expect(updateAvailable(cur, rel('bbb', '2026-10-24T19:00:00Z'))).toBe(false); // más antigua
    expect(updateAvailable(cur, rel('', '2026-10-24T21:00:00Z'))).toBe(false);
    expect(updateAvailable({ sha: 'dev', date: '' }, rel('bbb', '2026-10-24T21:00:00Z'))).toBe(true);
  });
  it('elige el instalador y no la versión portátil', () => {
    const assets = [
      { id: 1, name: 'Videomapping-Studio-0.1.0-win-x64-portable.zip', size: 1 },
      { id: 2, name: 'Videomapping-Studio-Setup-0.1.0.exe', size: 2 },
      { id: 3, name: 'SHA256SUMS.txt', size: 3 },
    ];
    expect(pickInstaller(assets)?.id).toBe(2);
    expect(pickInstaller(assets.slice(0, 1))).toBeNull();
  });
  it('lee las sumas SHA-256 con o sin asterisco y con rutas', () => {
    const h = 'a'.repeat(64), g = 'B'.repeat(64);
    const m = parseSums(`${h}  release/Videomapping-Studio-Setup-0.1.0.exe\r\n${g} *otro.zip\nbasura\n`);
    expect(m.get('Videomapping-Studio-Setup-0.1.0.exe')).toBe(h);
    expect(m.get('otro.zip')).toBe('b'.repeat(64));
    expect(m.size).toBe(2);
  });
  it('convierte la respuesta de la API de GitHub', () => {
    const r = releaseFromApi({ target_commitish: 'abc', published_at: '2026-10-24T21:00:00Z', assets: [{ id: 5, name: 'x.exe', size: 10 }] });
    expect(r).toEqual({ sha: 'abc', publishedAt: '2026-10-24T21:00:00Z', assets: [{ id: 5, name: 'x.exe', size: 10 }] });
    expect(releaseFromApi(null).assets).toEqual([]);
  });
});
