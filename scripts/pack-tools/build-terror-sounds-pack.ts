/**
 * Genera resources/packs/terror-sonidos/pack.json: sonidos de miedo sintetizados por
 * scripts/pack-tools/synth_audio.py (opción «terror»), originales y libres (CC0).
 *
 * Uso: python3 scripts/pack-tools/synth_audio.py <tmp> terror  (y convertir a OGG en files/)
 *      node scripts/run-ts.mjs scripts/pack-tools/build-terror-sounds-pack.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PackManifest, PACK_FORMAT } from '../../src/shared/pack';
import type { Asset } from '../../src/shared/model';

const PACK = path.resolve(__dirname, '../../resources/packs/terror-sonidos');
const NOW = '2026-10-25T00:00:00.000Z';
const LICENSE = 'CC0 1.0 — sonidos originales sintetizados para Videomapping Studio';

function duration(rel: string): number | null {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path.join(PACK, rel)]).toString();
    const d = parseFloat(out);
    return Number.isFinite(d) ? Math.round(d * 1000) / 1000 : null;
  } catch {
    return null;
  }
}

const SOUNDS: [string, string, string, string[]][] = [
  ['tr-ast-zumbido', 'Zumbido oscuro (fondo en bucle)', 'files/zumbido-oscuro.ogg', ['música', 'bucle']],
  ['tr-ast-latidos', 'Latidos (bucle)', 'files/latidos.ogg', ['efecto', 'bucle']],
  ['tr-ast-golpe', 'Golpe de susto', 'files/golpe-susto.ogg', ['efecto', 'susto']],
  ['tr-ast-susurros', 'Susurros', 'files/susurros.ogg', ['efecto']],
  ['tr-ast-cajita', 'Cajita de música desafinada', 'files/cajita-musica.ogg', ['efecto', 'música']],
  ['tr-ast-viento', 'Viento (bucle)', 'files/viento.ogg', ['efecto', 'bucle']],
  ['tr-ast-crujido', 'Crujido de puerta', 'files/crujido.ogg', ['efecto']],
  ['tr-ast-tension', 'Subida de tensión', 'files/tension.ogg', ['efecto', 'susto']],
];

const assets: Asset[] = SOUNDS.map(([id, name, file, tags]) => ({
  id, name, kind: 'audio', file, frames: [], fps: 24, format: 'ogg', width: null, height: null, duration: duration(file), hasAlpha: null,
  size: fs.statSync(path.join(PACK, file)).size, tags, collections: ['Terror'], license: LICENSE, source: 'Paquete Sonidos de terror', thumbnail: '',
  addedAt: NOW, key: { mode: 'none', color: '#00ff00', threshold: 0.3, softness: 0.1, despill: true },
} as Asset));

const manifest = PackManifest.parse({
  format: PACK_FORMAT, formatVersion: 1, id: 'terror-sonidos', name: 'Sonidos de terror',
  description: 'Zumbido de fondo, latidos, golpe de susto, susurros, cajita de música, viento, crujido y subida de tensión.',
  author: 'Videomapping Studio', license: LICENSE, version: '1.0.0', tags: ['terror', 'Halloween'], assets,
});
fs.writeFileSync(path.join(PACK, 'pack.json'), JSON.stringify(manifest, null, 2));
console.log(`pack.json: ${manifest.assets.length} sonidos`);
