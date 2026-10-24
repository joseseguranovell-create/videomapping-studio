/**
 * Operaciones del editor que implican E/S: abrir, guardar, importar recursos, autoguardado,
 * sincronización con la ventana de salida.
 */
import { useStore, mediaBase } from './store';
import type { Asset, AssetKind, Project } from '../../shared/model';
import type { ImportedFile, OpenedProject, OutputMode } from '../../shared/api';
import { mediaUrl } from '../engine/media';
import { newId, nowIso } from '../../shared/ids';
import { referencedAssetIds } from '../../shared/factory';

export const vm = window.vm;

export function errMsg(e: unknown): string {
  const m = (e as Error)?.message ?? String(e);
  // Los errores de IPC llegan con prefijo técnico; se deja solo el mensaje útil.
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

const st = () => useStore.getState();

// ───────── Proyecto ─────────

export async function afterOpen(o: OpenedProject) {
  st().openProject(o);
  if (o.migratedFrom !== null) st().toast('info', `Proyecto actualizado desde el formato v${o.migratedFrom}. Se guardó una copia del original en «backups».`, 8000);
  if (o.missingAssetIds.length) st().toast('warning', `Faltan ${o.missingAssetIds.length} archivo(s) de recursos. Revisa la Biblioteca para localizarlos.`, 8000);
  st().set({ view: o.project.installations.length ? 'calibrate' : 'home' });
}

export async function openProjectFile(file: string): Promise<OpenedProject | null> {
  try {
    const o = await vm.project.open(file);
    return o;
  } catch (e) {
    st().toast('error', `No se pudo abrir el proyecto: ${errMsg(e)}`, 10000);
    return null;
  }
}

export async function saveProject(): Promise<boolean> {
  const s = st();
  if (!s.project) return false;
  try {
    const r = await vm.project.save(s.project);
    // si hubo cambios mientras se guardaba, se mantiene «sin guardar»
    if (st().project === s.project) st().markSaved(r.savedAt);
    st().toast('success', 'Proyecto guardado', 1800);
    return true;
  } catch (e) {
    st().toast('error', `Error al guardar: ${errMsg(e)}`, 10000);
    return false;
  }
}

export async function saveProjectAs(newName?: string): Promise<boolean> {
  const s = st();
  if (!s.project) return false;
  const doc: Project = newName ? { ...s.project, name: newName, id: newId('prj'), createdAt: nowIso() } : s.project;
  try {
    const o = await vm.project.saveAs(doc);
    if (!o) return false;
    const view = st().view;
    st().openProject(o);
    st().set({ view });
    st().toast('success', `Proyecto guardado en ${o.dir}`, 5000);
    return true;
  } catch (e) {
    st().toast('error', `Error al guardar como: ${errMsg(e)}`, 10000);
    return false;
  }
}

let autosaveTimer: number | null = null;
let lastAutosaved: Project | null = null;

export function startAutosave() {
  if (autosaveTimer) clearInterval(autosaveTimer);
  const secs = Math.max(10, st().settings?.autosaveSeconds ?? 30);
  autosaveTimer = window.setInterval(async () => {
    const s = st();
    if (!s.project || !s.dirty || s.project === lastAutosaved || s.dragBase) return;
    try {
      await vm.project.autosave(s.project);
      lastAutosaved = s.project;
    } catch (e) {
      vm.app.log('warn', `Autoguardado fallido: ${errMsg(e)}`);
    }
  }, secs * 1000);
}

// ───────── Recursos ─────────

export interface Probe {
  width: number | null;
  height: number | null;
  duration: number | null;
  hasAlpha: boolean | null;
  thumbnail: string;
}

function canvasThumb(src: CanvasImageSource, w: number, h: number, size = 192): { url: string; alpha: boolean } {
  const k = size / Math.max(w, h, 1);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  let alpha = false;
  try {
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 16) if (d[i] < 250) { alpha = true; break; }
  } catch {
    /* lienzo contaminado: no debería ocurrir con el protocolo propio */
  }
  return { url: c.toDataURL(alpha ? 'image/png' : 'image/jpeg', 0.8), alpha };
}

function probeImage(url: string): Promise<Probe> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const w = img.naturalWidth || 512, h = img.naturalHeight || 512;
      const t = canvasThumb(img, w, h);
      resolve({ width: w, height: h, duration: null, hasAlpha: t.alpha, thumbnail: t.url });
    };
    img.onerror = () => reject(new Error('imagen no válida o formato no compatible'));
    img.src = url;
  });
}

function probeVideo(url: string): Promise<Probe> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.preload = 'auto';
    const timer = setTimeout(() => done(new Error('tiempo de espera agotado al leer el vídeo')), 15000);
    const done = (err?: Error, p?: Probe) => {
      clearTimeout(timer);
      v.removeAttribute('src');
      v.load();
      err ? reject(err) : resolve(p!);
    };
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(1, (v.duration || 2) / 3);
    };
    v.onseeked = () => {
      const t = canvasThumb(v, v.videoWidth, v.videoHeight);
      done(undefined, { width: v.videoWidth, height: v.videoHeight, duration: isFinite(v.duration) ? v.duration : null, hasAlpha: t.alpha, thumbnail: t.url });
    };
    v.onerror = () => done(new Error(v.error?.code === 4 ? 'formato de vídeo no compatible (usa MP4 H.264 o WebM VP8/VP9)' : 'no se pudo leer el vídeo'));
    v.src = url;
  });
}

async function probeAudio(url: string): Promise<Probe> {
  const r = await fetch(url);
  if (!r.ok) throw new Error('archivo de audio ausente');
  const ab = await r.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 44100);
  let buf: AudioBuffer;
  try {
    buf = await ctx.decodeAudioData(ab);
  } catch {
    throw new Error('formato de audio no compatible (usa MP3, WAV, OGG o M4A)');
  }
  // forma de onda como miniatura
  const c = document.createElement('canvas');
  c.width = 192;
  c.height = 108;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1b1d26';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#7dd3fc';
  const data = buf.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / c.width));
  for (let x = 0; x < c.width; x++) {
    let max = 0;
    for (let i = x * step; i < Math.min(data.length, (x + 1) * step); i += 8) max = Math.max(max, Math.abs(data[i]));
    const h = Math.max(1, max * c.height * 0.9);
    g.fillRect(x, (c.height - h) / 2, 1, h);
  }
  return { width: null, height: null, duration: buf.duration, hasAlpha: null, thumbnail: c.toDataURL('image/jpeg', 0.8) };
}

export async function probe(kind: AssetKind, rel: string): Promise<Probe> {
  const url = mediaUrl(mediaBase(), rel, st().projectKey);
  if (kind === 'image' || kind === 'sequence') return probeImage(url);
  if (kind === 'video') return probeVideo(url);
  return probeAudio(url);
}

export async function assetFromImported(f: ImportedFile): Promise<{ asset: Asset; warning?: string }> {
  let p: Probe = { width: null, height: null, duration: null, hasAlpha: null, thumbnail: '' };
  let warning: string | undefined;
  try {
    p = await probe(f.kind, f.file);
  } catch (e) {
    warning = `${f.name}: ${errMsg(e)}`;
  }
  const asset: Asset = {
    id: newId('ast'),
    name: f.name,
    kind: f.kind,
    file: f.file,
    frames: f.frames,
    fps: 24,
    format: f.format,
    width: p.width,
    height: p.height,
    duration: f.kind === 'sequence' ? f.frames.length / 24 : p.duration,
    hasAlpha: f.format === 'mp4' || f.format === 'jpg' || f.format === 'jpeg' ? false : p.hasAlpha,
    size: f.size,
    tags: [],
    collections: [],
    license: '',
    source: 'Importado',
    thumbnail: p.thumbnail,
    addedAt: nowIso(),
  };
  return { asset, warning };
}

export async function importAssets(): Promise<Asset[]> {
  try {
    const r = await vm.assets.importDialog();
    r.errors.forEach((e) => st().toast('error', e, 8000));
    if (!r.files.length) return [];
    const assets: Asset[] = [];
    for (const f of r.files) {
      const { asset, warning } = await assetFromImported(f);
      if (warning) st().toast('warning', warning, 8000);
      assets.push(asset);
    }
    st().update(`Importar ${assets.length} recurso(s)`, (d) => {
      d.assets.push(...assets);
    });
    st().toast('success', `${assets.length} recurso(s) importado(s)`);
    return assets;
  } catch (e) {
    st().toast('error', `Error al importar: ${errMsg(e)}`, 8000);
    return [];
  }
}

export async function importSequence(): Promise<Asset | null> {
  try {
    const f = await vm.assets.importSequenceDialog();
    if (!f) return null;
    const { asset, warning } = await assetFromImported(f);
    if (warning) st().toast('warning', warning, 8000);
    st().update('Importar secuencia', (d) => {
      d.assets.push(asset);
    });
    st().toast('success', `Secuencia de ${f.frames.length} fotogramas importada`);
    return asset;
  } catch (e) {
    st().toast('error', `Error al importar la secuencia: ${errMsg(e)}`, 8000);
    return null;
  }
}

export async function relinkAsset(assetId: string) {
  const a = st().project?.assets.find((x) => x.id === assetId);
  if (!a) return;
  try {
    const f = await vm.assets.relinkDialog(a.kind);
    if (!f) return;
    if (f.kind !== a.kind) {
      st().toast('error', `El archivo elegido es de tipo ${f.kind}, pero el recurso es de tipo ${a.kind}.`);
      return;
    }
    const { asset } = await assetFromImported(f);
    st().update(`Localizar «${a.name}»`, (d) => {
      const x = d.assets.find((y) => y.id === assetId);
      if (!x) return;
      x.file = f.file;
      x.frames = f.frames;
      x.size = f.size;
      x.format = f.format;
      x.width = asset.width;
      x.height = asset.height;
      x.duration = asset.duration;
      x.thumbnail = asset.thumbnail || x.thumbnail;
      if (asset.hasAlpha !== null) x.hasAlpha = asset.hasAlpha;
    });
    await refreshMissing();
    invalidateAssetInPlayers(assetId);
    st().toast('success', `«${a.name}» vuelve a estar disponible`);
  } catch (e) {
    st().toast('error', errMsg(e));
  }
}

export async function refreshMissing() {
  const p = st().project;
  if (!p) return;
  try {
    st().setMissing(await vm.project.checkFiles(p));
  } catch {
    /* ignorar */
  }
}

/** Añade un paquete de contenido al proyecto (recursos + personajes, opcionalmente espectáculos). */
export async function addPackToProject(packId: string, withShows: boolean) {
  const p = st().project;
  if (!p) return;
  try {
    const r = await vm.packs.importIntoProject(packId, p);
    st().update('Añadir paquete', (d) => {
      d.assets.push(...r.assets);
      d.characters.push(...r.characters);
      if (withShows) {
        for (const i of r.installations) if (!d.installations.some((x) => x.id === i.id)) d.installations.push(i);
        for (const s of r.shows) if (!d.shows.some((x) => x.id === s.id)) d.shows.push(s);
      }
    });
    st().toast('success', `Paquete añadido: ${r.assets.length} recursos, ${r.characters.length} personajes${r.skippedAssets ? ` (${r.skippedAssets} ya estaban)` : ''}`);
    await refreshMissing();
  } catch (e) {
    st().toast('error', `No se pudo añadir el paquete: ${errMsg(e)}`, 8000);
  }
}

export function assetUsage(p: Project, assetId: string): number {
  let n = 0;
  for (const sh of p.shows) {
    n += sh.music.filter((m) => m.assetId === assetId).length;
    for (const sc of sh.scenes) {
      n += sc.clips.filter((c) => c.source.type === 'asset' && c.source.assetId === assetId).length;
      n += sc.sounds.filter((s) => s.assetId === assetId).length;
    }
  }
  for (const ch of p.characters) n += ch.animations.filter((a) => a.assetId === assetId).length + (ch.referenceAssetId === assetId ? 1 : 0);
  return n;
}

export function unusedAssetIds(p: Project): string[] {
  const used = referencedAssetIds(p);
  return p.assets.filter((a) => !used.has(a.id)).map((a) => a.id);
}

// ───────── Salida de proyección ─────────

const playerInvalidators = new Set<(id: string) => void>();
export function registerPlayerInvalidator(fn: (id: string) => void) {
  playerInvalidators.add(fn);
  return () => playerInvalidators.delete(fn);
}
function invalidateAssetInPlayers(id: string) {
  playerInvalidators.forEach((f) => f(id));
}

/** Documento sin miniaturas para enviar a la salida (menos datos por IPC). */
export function slimProject(p: Project): Project {
  return { ...p, assets: p.assets.map((a) => (a.thumbnail ? { ...a, thumbnail: '' } : a)) };
}

export function currentOutputMode(): OutputMode {
  const s = st();
  if (!s.project) return { kind: 'black' };
  if (s.outputMode === 'calibration') {
    const inst = s.project.installations.find((i) => i.id === s.installationId) ?? s.project.installations[0];
    if (!inst) return { kind: 'black' };
    return {
      kind: 'calibration',
      installationId: inst.id,
      selectedSurfaceId: s.surfaceId,
      showGrid: s.calib.showGrid,
      showLabels: s.calib.showLabels,
      pattern: s.calib.pattern,
      soloSelected: s.calib.soloSelected,
    };
  }
  if (s.outputMode === 'show' && s.outputShowId) return { kind: 'show', showId: s.outputShowId };
  return { kind: 'black' };
}

let lastSentDoc: Project | null = null;
let lastSentMode = '';
let syncRaf = 0;

export function scheduleOutputSync(force = false) {
  if (force) {
    lastSentDoc = null;
    lastSentMode = '';
  }
  if (syncRaf) return;
  syncRaf = requestAnimationFrame(() => {
    syncRaf = 0;
    const s = st();
    if (!s.output.open) return;
    if (s.project && s.project !== lastSentDoc) {
      vm.output.send({ type: 'doc', project: slimProject(s.project), mediaBase: mediaBase(), projectKey: s.projectKey });
      lastSentDoc = s.project;
    }
    const mode = currentOutputMode();
    const key = JSON.stringify(mode);
    if (key !== lastSentMode) {
      vm.output.send({ type: 'mode', mode });
      lastSentMode = key;
    }
  });
}

export function sendAudioSettings() {
  const s = st().settings;
  vm.output.send({ type: 'audio', enabled: s?.audioEnabled ?? true, volume: 1 });
}

export async function openOutput(displayId: number | null, fullscreen = true) {
  try {
    const state = await vm.output.open(displayId, fullscreen);
    st().set({ output: state });
  } catch (e) {
    st().toast('error', `No se pudo abrir la salida: ${errMsg(e)}`);
  }
}

export async function closeOutput() {
  const state = await vm.output.close();
  st().set({ output: state, outputStatus: null });
}

export function transport(action: 'play' | 'pause' | 'stop', at?: number) {
  vm.output.send({ type: 'transport', action, at });
}
