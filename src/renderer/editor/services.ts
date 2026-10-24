/**
 * Operaciones del editor que implican E/S: abrir, guardar, importar recursos, autoguardado,
 * sincronización con la ventana de salida.
 */
import { useStore, mediaBase } from './store';
import type { Asset, AssetKind, Project, Surface } from '../../shared/model';
import type { ImportedFile, OpenedProject, OutputMode, OutputRequest } from '../../shared/api';
import { mediaUrl } from '../engine/media';
import { newId, nowIso } from '../../shared/ids';
import { referencedAssetIds, createSurface } from '../../shared/factory';
import { clampPoint, translateSurface } from '../../shared/geometry';
import { inSchedule } from '../../shared/schedule';

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
  if (o.autosaveNewer) {
    // La recuperación se ofrece en Inicio: se lleva allí al usuario para que no pase desapercibida.
    st().set({ view: 'home' });
    st().toast('warning', 'Hay cambios recuperables del guardado automático (posible cierre inesperado). Revisa el aviso en Inicio.', 10000);
  } else st().set({ view: o.project.installations.length ? 'calibrate' : 'home' });
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
    key: { mode: 'none', color: '#00ff00', threshold: 0.3, softness: 0.1, despill: true },
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

/** Pantalla para la salida: el proyector (pantalla sin el editor) si existe; si no, la única pantalla. */
export function preferredOutputDisplayId(): number | null {
  const s = st();
  const label = s.settings?.lastOutputDisplayLabel;
  const d = s.displays.find((x) => !x.hasEditor && (!label || x.label === label)) ?? s.displays.find((x) => !x.hasEditor) ?? s.displays[0];
  return d?.id ?? null;
}

/** ¿La salida tapará la pantalla del editor? (una sola pantalla) */
export function outputCoversEditor(displayId: number | null): boolean {
  const d = st().displays.find((x) => x.id === displayId);
  return !!d && d.hasEditor;
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

// ───────── Reproducción programada ─────────


let scheduleTimer: number | null = null;
let scheduleRunning = false;

/** Comprueba cada 10 s si toca empezar o terminar el espectáculo programado. */
export function startScheduler() {
  if (scheduleTimer) clearInterval(scheduleTimer);
  const tick = async () => {
    const s = st();
    const sch = s.settings?.schedule;
    if (!sch?.enabled || !s.project || !sch.showId || s.file !== sch.projectFile) {
      scheduleRunning = false;
      return;
    }
    const show = s.project.shows.find((x) => x.id === sch.showId);
    if (!show) return;
    const inside = inSchedule(new Date(), sch.start, sch.end);
    if (inside && !scheduleRunning) {
      scheduleRunning = true;
      vm.app.log('info', `Programación: inicio de «${show.name}»`);
      s.set({ outputMode: 'show', outputShowId: show.id });
      if (!st().output.open) {
        const target = preferredOutputDisplayId();
        await openOutput(target, target !== null);
      }
      setTimeout(() => transport('play', 0), 800);
      st().toast('info', `Programación: «${show.name}» ha empezado (hasta las ${sch.end}).`, 8000);
    } else if (!inside && scheduleRunning) {
      scheduleRunning = false;
      vm.app.log('info', `Programación: fin de «${show.name}»`);
      transport('stop');
      st().set({ outputMode: 'black' });
      st().toast('info', 'Programación: el espectáculo ha terminado. La salida queda en negro.', 8000);
    }
  };
  scheduleTimer = window.setInterval(() => void tick(), 10000);
  void tick();
}

export function isScheduleRunning() {
  return scheduleRunning;
}

// ───────── Peticiones desde la ventana de salida (teclado y ratón sobre la proyección) ─────────

function outputInstallationId(): string | null {
  const s = st();
  if (!s.project) return null;
  if (s.outputMode === 'show') {
    const sh = s.project.shows.find((x) => x.id === s.outputShowId);
    if (sh?.installationId) return sh.installationId;
  }
  return s.installationId ?? s.project.installations[0]?.id ?? null;
}

function ensureShowSelected(): string | null {
  const s = st();
  if (!s.project) return null;
  const id = s.outputShowId && s.project.shows.some((x) => x.id === s.outputShowId) ? s.outputShowId : s.showId ?? s.project.shows[0]?.id ?? null;
  if (id !== s.outputShowId) s.set({ outputShowId: id });
  return id;
}

export function handleOutputRequest(r: OutputRequest) {
  const s = st();
  if (!s.project) return;
  const instId = outputInstallationId();
  const mutSurface = (live: boolean, label: string, surfaceId: string, fn: (x: Surface) => void) => {
    const apply = (d: Project) => {
      const sf = d.installations.find((i) => i.id === instId)?.surfaces.find((x) => x.id === surfaceId);
      if (sf && !sf.locked) fn(sf);
    };
    live ? st().dragUpdate(apply) : st().update(label, apply);
  };
  switch (r.type) {
    case 'key': {
      if (r.action === 'playPause') {
        if (s.outputMode !== 'show') {
          if (!ensureShowSelected()) return;
          s.set({ outputMode: 'show' });
          setTimeout(() => transport('play'), 250);
        } else transport(s.outputStatus?.playing ? 'pause' : 'play');
      } else if (r.action === 'restart') {
        vm.output.send({ type: 'seek', time: 0 });
      } else if (r.action === 'black') {
        s.set({ outputMode: s.outputMode === 'black' ? (ensureShowSelected() ? 'show' : 'black') : 'black' });
      } else if (r.action === 'calibration') {
        if (instId && instId !== s.installationId) s.set({ installationId: instId });
        if (s.outputStatus?.playing) transport('pause');
        s.set({ outputMode: 'calibration' });
      } else if (r.action === 'show') {
        if (ensureShowSelected()) s.set({ outputMode: 'show' });
      }
      return;
    }
    case 'select':
      s.set({ surfaceId: r.surfaceId, maskId: null });
      return;
    case 'selectNext': {
      const surfaces = s.project.installations.find((i) => i.id === instId)?.surfaces ?? [];
      if (!surfaces.length) return;
      const idx = surfaces.findIndex((x) => x.id === s.surfaceId);
      const next = surfaces[(idx + r.dir + surfaces.length) % surfaces.length];
      s.set({ surfaceId: next.id, maskId: null });
      return;
    }
    case 'drag': {
      if (r.phase === 'start') { st().beginDrag(); return; }
      if (r.phase === 'end') { st().endDrag('Ajustar sobre la proyección'); return; }
      mutSurface(true, '', r.surfaceId, (x) => {
        if (r.target === 'move' && r.delta) Object.assign(x, translateSurface(x, r.delta.x, r.delta.y));
        else if (r.target === 'quad') x.quad[r.index] = clampPoint(r.point);
        else if (r.target === 'polygon' && x.polygon[r.index]) x.polygon[r.index] = clampPoint(r.point);
      });
      return;
    }
    case 'nudge':
      mutSurface(false, 'Ajuste fino sobre la proyección', r.surfaceId, (x) => {
        if (r.target === 'move') Object.assign(x, translateSurface(x, r.dx, r.dy));
        else {
          const pts = r.target === 'quad' ? x.quad : x.polygon;
          const p = pts[r.index];
          if (p) pts[r.index] = clampPoint({ x: p.x + r.dx, y: p.y + r.dy });
        }
      });
      return;
    case 'addSurface': {
      if (!instId) return;
      const inst = s.project.installations.find((i) => i.id === instId)!;
      const w = r.kind === 'door' ? 0.09 : 0.12, h = r.kind === 'door' ? 0.3 : 0.18;
      const n = inst.surfaces.filter((x) => x.kind === r.kind).length + 1;
      const sf = createSurface(`${r.kind === 'door' ? 'Puerta' : 'Ventana'} ${n}`, r.kind, inst.surfaces.length, { x: r.at.x - w / 2, y: r.at.y - h / 2, w, h });
      st().update('Añadir superficie sobre la proyección', (d) => { d.installations.find((i) => i.id === instId)!.surfaces.push(sf); });
      s.set({ surfaceId: sf.id, maskId: null });
      return;
    }
    case 'undo': st().undo(); return;
    case 'redo': st().redo(); return;
    case 'save': void saveProject(); return;
  }
}
