/**
 * Proceso principal: ventanas (editor + salida de proyección), pantallas, archivos y diálogos.
 * El estado del proyecto vive en la ventana del editor; aquí solo se hace E/S y orquestación.
 */
import { app, BrowserWindow, dialog, ipcMain, screen, shell, powerSaveBlocker, Menu, session, safeStorage, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { registerSchemePrivileges, installProtocol } from './protocol';
import { initLogger, log, readLogTail } from './logger';
import { SettingsStore } from './settings';
import * as store from './projectStore';
import { listPacks, importPack, exportPack, readPack } from './packStore';
import { createProject } from '../shared/factory';
import { APP_ORIGIN, type DisplayInfo, type OpenedProject, type OutputCommand, type OutputState } from '../shared/api';
import type { Project } from '../shared/model';
import { newId } from '../shared/ids';
import { startAgentApi, stopAgentApi, agentApiRunning, newToken } from './agentApi';
import type { AgentApiStatus } from '../shared/api';
import * as updater from './updater';
import { HomeAssistant } from './homeAssistant';
import type { LightCommand } from '../shared/api';

registerSchemePrivileges();

// Si la GPU no está disponible o está en la lista negra de Chromium, permitir WebGL por software
// (SwiftShader). Es seguro aquí porque la aplicación solo carga contenido local propio.
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
// Evita que Chromium reduzca el ritmo de dibujo de la ventana de salida cuando no tiene el foco.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

// Datos de usuario aislados en pruebas automatizadas.
if (process.env.VMSTUDIO_USER_DATA) app.setPath('userData', process.env.VMSTUDIO_USER_DATA);

const isDev = !app.isPackaged;
const appRoot = app.getAppPath();
const uiDir = path.join(appRoot, 'dist', 'renderer');
const preloadDir = path.join(appRoot, 'dist', 'preload');
const builtInPacksDir = app.isPackaged ? path.join(process.resourcesPath, 'packs') : path.join(appRoot, 'resources', 'packs');
const docsBase = process.env.VMSTUDIO_DOCUMENTS ?? path.join(app.getPath('documents'), 'Videomapping Studio');
const projectsDir = path.join(docsBase, 'Proyectos');
const userPacksDir = path.join(docsBase, 'Paquetes');
const logsDir = path.join(app.getPath('userData'), 'logs');

initLogger(logsDir);
log('info', 'main', `Arrancando (empaquetado=${app.isPackaged}, appPath=${appRoot}, ui=${uiDir})`);
const settings = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));

let editorWin: BrowserWindow | null = null;
let outputWin: BrowserWindow | null = null;
let outputDisplayId: number | null = null;
let outputFullscreen = true;
let powerBlockId: number | null = null;
let current: { file: string; dir: string } | null = null;
let dirty = false;
let quitting = false;
const packDirs = new Map<string, string>();

process.on('uncaughtException', (e) => log('error', 'main', `uncaughtException: ${e.stack ?? e}`));
process.on('unhandledRejection', (e) => log('error', 'main', `unhandledRejection: ${String(e)}`));

// Una sola instancia: abrir el programa dos veces trae al frente la ventana existente.
if (!app.requestSingleInstanceLock() && !process.env.VMSTUDIO_USER_DATA) {
  log('info', 'main', 'Ya hay una instancia abierta: se le pide que se muestre y esta se cierra.');
  app.quit();
}
app.on('second-instance', () => {
  log('info', 'main', 'Segunda instancia: mostrando la ventana existente');
  if (editorWin) {
    if (editorWin.isMinimized()) editorWin.restore();
    editorWin.show();
    editorWin.focus();
  }
});

function secureWebPreferences(preload: string): Electron.WebPreferences {
  return {
    preload: path.join(preloadDir, preload),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    spellcheck: false,
    backgroundThrottling: false,
    autoplayPolicy: 'no-user-gesture-required',
  };
}

function displayInfos(): DisplayInfo[] {
  const primary = screen.getPrimaryDisplay();
  const editorDisplay = editorWin ? screen.getDisplayMatching(editorWin.getBounds()) : primary;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: d.label || `Pantalla ${i + 1}`,
    bounds: d.bounds,
    pixelSize: { width: Math.round(d.bounds.width * d.scaleFactor), height: Math.round(d.bounds.height * d.scaleFactor) },
    scaleFactor: d.scaleFactor,
    primary: d.id === primary.id,
    internal: d.internal,
    hasEditor: d.id === editorDisplay.id,
  }));
}

function outputState(): OutputState {
  return { open: !!outputWin && !outputWin.isDestroyed(), displayId: outputDisplayId, fullscreen: outputFullscreen };
}

function notifyOutputState() {
  editorWin?.webContents.send('output:state', outputState());
}

function createEditorWindow() {
  const primary = screen.getPrimaryDisplay();
  const wa = primary.workArea;
  editorWin = new BrowserWindow({
    x: wa.x + Math.round(wa.width * 0.03),
    y: wa.y + Math.round(wa.height * 0.03),
    width: Math.min(1600, Math.round(wa.width * 0.94)),
    height: Math.min(1000, Math.round(wa.height * 0.94)),
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0e0f13',
    title: 'Videomapping Studio',
    show: false,
    webPreferences: secureWebPreferences('editor.cjs'),
  });
  let shown = false;
  const reveal = (why: string) => {
    if (shown || !editorWin) return;
    shown = true;
    log('info', 'main', `Mostrando ventana del editor (${why})`);
    editorWin.show();
    if (wa.width >= 1400 && !process.env.VMSTUDIO_USER_DATA) editorWin.maximize();
  };
  editorWin.once('ready-to-show', () => reveal('lista'));
  // Si la interfaz tarda o falla al cargar, la ventana se muestra igualmente: nunca un proceso invisible.
  setTimeout(() => reveal('tiempo de espera'), 6000);
  editorWin.webContents.on('did-fail-load', (_e, code, desc, url) => {
    log('error', 'main', `Fallo al cargar ${url}: ${code} ${desc}`);
    reveal('fallo de carga');
    dialog.showErrorBox('Videomapping Studio no pudo cargar la interfaz', `${desc} (${code})\n${url}\n\nRegistro: ${logsDir}`);
  });
  editorWin.webContents.on('render-process-gone', (_e, d) => {
    log('error', 'main', `El proceso de la interfaz terminó: ${d.reason} (${d.exitCode})`);
    reveal('proceso terminado');
  });
  editorWin.webContents.on('console-message', (_e, level, message) => {
    if (level >= 3) log('error', 'editor-console', message);
  });
  editorWin.loadURL(`${APP_ORIGIN}/ui/index.html`).catch((e) => log('error', 'main', `loadURL: ${e}`));
  editorWin.on('close', async (e) => {
    if (quitting || !dirty) return;
    e.preventDefault();
    const r = await dialog.showMessageBox(editorWin!, {
      type: 'warning',
      buttons: ['Guardar y salir', 'Salir sin guardar', 'Cancelar'],
      defaultId: 0,
      cancelId: 2,
      title: 'Cambios sin guardar',
      message: 'Hay cambios sin guardar en el proyecto.',
      detail: 'Si sales sin guardar, podrás recuperarlos desde el guardado automático la próxima vez que abras el proyecto.',
    });
    if (r.response === 2) return;
    if (r.response === 0) {
      const ok = await requestRendererSave();
      if (!ok) return;
    }
    quitting = true;
    app.quit();
  });
  editorWin.on('closed', () => {
    editorWin = null;
    closeOutput();
  });
}

function requestRendererSave(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!editorWin) return resolve(true);
    const id = newId('save');
    const timer = setTimeout(() => resolve(false), 15000);
    ipcMain.once(`app:saveResult:${id}`, (_e, ok: boolean) => {
      clearTimeout(timer);
      resolve(ok);
    });
    editorWin.webContents.send('app:requestSave', id);
  });
}

function openOutput(displayId: number | null, fullscreen: boolean): OutputState {
  const displays = screen.getAllDisplays();
  const target = displays.find((d) => d.id === displayId) ?? null;
  closeOutput();
  outputFullscreen = !!target && fullscreen;
  outputDisplayId = target?.id ?? null;
  const b = target
    ? target.bounds
    : { x: screen.getPrimaryDisplay().workArea.x + 80, y: screen.getPrimaryDisplay().workArea.y + 80, width: 960, height: 540 };
  outputWin = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    // Con marco siempre: al salir de pantalla completa (Esc) queda una ventana normal que se puede mover.
    frame: true,
    fullscreenable: true,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    title: 'Salida de proyección — Videomapping Studio',
    show: false,
    webPreferences: secureWebPreferences('output.cjs'),
  });
  outputWin.setMenu(null);
  outputWin.loadURL(`${APP_ORIGIN}/ui/output.html`);
  // Si la salida cubre la pantalla del editor (una sola pantalla), recibe el foco para poder usar el teclado
  // (Espacio = reproducir, Esc = salir de pantalla completa…). Si va a otra pantalla, el foco sigue en el editor.
  const editorDisplay = editorWin ? screen.getDisplayMatching(editorWin.getBounds()) : null;
  const coversEditor = !target || target.id === editorDisplay?.id;
  outputWin.once('ready-to-show', () => {
    if (!outputWin) return;
    if (outputFullscreen && target) {
      outputWin.setBounds(target.bounds);
      if (coversEditor) outputWin.show();
      else outputWin.showInactive();
      outputWin.setFullScreen(true);
    } else {
      outputWin.show();
    }
    if (coversEditor) outputWin.focus();
    else editorWin?.focus();
  });
  outputWin.on('enter-full-screen', () => { outputFullscreen = true; notifyOutputState(); });
  outputWin.on('leave-full-screen', () => { outputFullscreen = false; notifyOutputState(); });
  outputWin.on('closed', () => {
    outputWin = null;
    void ha?.release();
    outputDisplayId = null;
    if (powerBlockId !== null && powerSaveBlocker.isStarted(powerBlockId)) powerSaveBlocker.stop(powerBlockId);
    powerBlockId = null;
    notifyOutputState();
  });
  // Evita que el proyector o el monitor entren en reposo durante el espectáculo.
  powerBlockId = powerSaveBlocker.start('prevent-display-sleep');
  if (target) void settings.set({ lastOutputDisplayLabel: target.label || null });
  log('info', 'main', `Salida abierta en ${target ? `pantalla ${target.id} (${target.bounds.width}x${target.bounds.height})` : 'ventana'}`);
  notifyOutputState();
  return outputState();
}

function closeOutput() {
  if (outputWin && !outputWin.isDestroyed()) outputWin.destroy();
  outputWin = null;
  outputDisplayId = null;
}

function setCurrent(lp: { file: string; dir: string } | null) {
  current = lp;
}

async function toOpened(lp: store.LoadedProject): Promise<OpenedProject> {
  setCurrent({ file: lp.file, dir: lp.dir });
  await settings.touchRecent(lp.file, lp.project.name);
  const missingAssetIds = await store.findMissingAssets(lp.dir, lp.project);
  log('info', 'main', `Proyecto abierto: ${lp.file} (recursos ausentes: ${missingAssetIds.length})`);
  return { file: lp.file, dir: lp.dir, project: lp.project, migratedFrom: lp.migratedFrom, autosaveNewer: lp.autosaveNewer, missingAssetIds };
}

function requireProject(): { file: string; dir: string } {
  if (!current) throw new Error('No hay ningún proyecto abierto.');
  return current;
}

async function refreshPacks() {
  const r = await listPacks([
    { dir: builtInPacksDir, builtIn: true },
    { dir: userPacksDir, builtIn: false },
  ]);
  packDirs.clear();
  r.packs.forEach((p) => packDirs.set(p.id, p.dir));
  r.errors.forEach((e) => log('warn', 'packs', e));
  return r;
}

function handle(channel: string, fn: (e: IpcMainInvokeEvent, ...args: any[]) => any) {
  ipcMain.handle(channel, async (e, ...args) => {
    // Solo la ventana del editor puede invocar operaciones de archivo.
    if (!editorWin || e.sender.id !== editorWin.webContents.id) throw new Error('Origen no autorizado');
    try {
      return await fn(e, ...args);
    } catch (err) {
      log('error', 'ipc', `${channel}: ${(err as Error).stack ?? err}`);
      throw err;
    }
  });
}

// ───────── API para agentes de IA ─────────

const agentInfoFile = path.join(app.getPath('userData'), 'agent-api.json');
const mcpScript = app.isPackaged ? path.join(process.resourcesPath, 'mcp', 'vmstudio-mcp.cjs') : path.join(appRoot, 'resources', 'mcp', 'vmstudio-mcp.cjs');
let agentError: string | null = null;

function agentStatus(): AgentApiStatus {
  const a = settings.get().agentApi;
  return {
    running: agentApiRunning(),
    url: agentApiRunning() ? `http://127.0.0.1:${a.port}` : null,
    token: a.token,
    port: a.port,
    infoFile: agentInfoFile,
    mcpScript,
    exePath: process.execPath,
    error: agentError,
  };
}

/** Reenvía una acción al editor y espera su respuesta. */
function askEditor(action: string, params: Record<string, unknown>, timeoutMs = 20000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!editorWin) return reject(new Error('La ventana del editor no está abierta'));
    const id = newId('ag');
    const timer = setTimeout(() => { ipcMain.removeAllListeners(`agent:response:${id}`); reject(new Error('El editor no respondió a tiempo')); }, timeoutMs);
    ipcMain.once(`agent:response:${id}`, (_e, r: { ok: boolean; result?: unknown; error?: string }) => {
      clearTimeout(timer);
      r.ok ? resolve(r.result) : reject(new Error(r.error ?? 'Error'));
    });
    editorWin.webContents.send('agent:request', { id, action, params });
  });
}

async function agentHandle(action: string, params: Record<string, unknown>): Promise<unknown> {
  if (action === 'captura') {
    // Imagen de lo que se proyecta (o del editor si la salida está cerrada), para que el agente «vea».
    const win = outputWin && !outputWin.isDestroyed() && params.de !== 'editor' ? outputWin : editorWin;
    if (!win) throw new Error('No hay ventanas abiertas');
    const img = await win.webContents.capturePage();
    const max = Number(params.anchoMaximo ?? 1280);
    const sized = img.getSize().width > max ? img.resize({ width: max }) : img;
    return { de: win === outputWin ? 'salida' : 'editor', ancho: sized.getSize().width, alto: sized.getSize().height, png: sized.toPNG().toString('base64') };
  }
  if (action === 'importar_recurso') {
    if (!current) throw new Error('No hay ningún proyecto abierto');
    const ruta = String(params.ruta ?? '');
    if (!ruta || !path.isAbsolute(ruta)) throw new Error('Indica «ruta» absoluta al archivo');
    const f = await store.copyIntoProject(current.dir, ruta);
    return askEditor('importar_recurso_copiado', { archivo: f, nombre: params.nombre });
  }
  if (action === 'abrir_proyecto') {
    const lp = await store.loadProject(String(params.ruta ?? ''));
    const o = await toOpened(lp);
    return askEditor('proyecto_abierto', { abierto: o });
  }
  if (action === 'abrir_salida') {
    const id = params.pantallaId !== undefined ? Number(params.pantallaId) : null;
    const displays = screen.getAllDisplays();
    const editorDisplay = editorWin ? screen.getDisplayMatching(editorWin.getBounds()) : null;
    const target = id !== null ? displays.find((d) => d.id === id) : displays.find((d) => d.id !== editorDisplay?.id) ?? displays[0];
    // Idempotente: si ya está abierta en esa pantalla, no se reabre.
    if (outputWin && !outputWin.isDestroyed() && (id === null || outputDisplayId === target?.id)) return outputState();
    return openOutput(target?.id ?? null, params.pantallaCompleta !== false);
  }
  if (action === 'cerrar_salida') {
    closeOutput();
    notifyOutputState();
    return outputState();
  }
  if (action === 'pantallas') return displayInfos();
  return askEditor(action, params);
}

async function applyAgentSettings(): Promise<AgentApiStatus> {
  const a = settings.get().agentApi;
  agentError = null;
  if (!a.enabled) {
    await stopAgentApi();
    return agentStatus();
  }
  try {
    await startAgentApi({ port: a.port, token: a.token, infoFile: agentInfoFile, handle: agentHandle });
  } catch (e) {
    agentError = `No se pudo abrir el puerto ${a.port}: ${(e as Error).message}`;
    log('error', 'agente', agentError);
  }
  return agentStatus();
}

// ───────── Luces de casa (Home Assistant) ─────────

let ha: HomeAssistant | null = null;
function lights(): HomeAssistant {
  if (!ha) ha = new HomeAssistant(() => settings.get().homeAssistant, async (h) => { await settings.set({ homeAssistant: h }); });
  return ha;
}
/** Órdenes que llegan de la ventana de salida (se filtran contra las luces permitidas). */
function sanitizeLightCommands(v: unknown): LightCommand[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 200).filter((c): c is LightCommand => !!c && typeof c.entityId === 'string' && typeof c.state === 'object' && c.state !== null && ['color', 'white', 'plug'].includes(c.kind));
}

// ───────── Vídeo de demostración (grabado por el editor a trozos) ─────────

let lastDemo: string | null = null;
const demos = new Map<string, { file: string; ext: string; stream: fs.WriteStream }>();

function registerIpc() {
  handle('demo:begin', (_e, ext: string) => {
    const e = ext === 'mp4' ? 'mp4' : 'webm';
    const id = newId('demo');
    const file = path.join(app.getPath('temp'), `vmstudio-${id}.${e}`);
    demos.set(id, { file, ext: e, stream: fs.createWriteStream(file) });
    return id;
  });
  handle('demo:chunk', async (_e, id: string, data: Uint8Array) => {
    const d = demos.get(id);
    if (!d || !(data instanceof Uint8Array)) throw new Error('Grabación desconocida');
    await new Promise<void>((res, rej) => d.stream.write(Buffer.from(data), (err) => (err ? rej(err) : res())));
  });
  handle('demo:finish', async (_e, id: string, name: string) => {
    const d = demos.get(id);
    if (!d) throw new Error('Grabación desconocida');
    demos.delete(id);
    await new Promise<void>((res) => d.stream.end(() => res()));
    const safe = String(name || 'Demostración').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Demostración';
    const r = await dialog.showSaveDialog(editorWin!, {
      title: 'Guardar vídeo de demostración',
      defaultPath: path.join(app.getPath('videos'), `${safe}.${d.ext}`),
      filters: [{ name: d.ext === 'mp4' ? 'Vídeo MP4' : 'Vídeo WebM', extensions: [d.ext] }],
    });
    if (r.canceled || !r.filePath) { await fs.promises.rm(d.file, { force: true }); return null; }
    try { await fs.promises.rename(d.file, r.filePath); } catch { await fs.promises.copyFile(d.file, r.filePath); await fs.promises.rm(d.file, { force: true }); }
    lastDemo = r.filePath;
    log('info', 'demo', `Vídeo de demostración guardado en ${r.filePath}`);
    return r.filePath;
  });
  handle('demo:cancel', async (_e, id: string) => {
    const d = demos.get(id);
    if (!d) return;
    demos.delete(id);
    await new Promise<void>((res) => d.stream.end(() => res()));
    await fs.promises.rm(d.file, { force: true });
  });
  // Solo se puede mostrar el último vídeo guardado.
  handle('demo:reveal', () => { if (lastDemo) shell.showItemInFolder(lastDemo); });
  handle('lights:status', () => lights().status());
  handle('lights:configure', (_e, p: { enabled?: boolean; url?: string }) => lights().configure(p ?? {}));
  handle('lights:setToken', (_e, t: string | null) => lights().setToken(typeof t === 'string' ? t : null));
  handle('lights:test', () => lights().test());
  handle('lights:entities', () => lights().entities());
  handle('lights:setAllowed', (_e, list) => lights().setAllowed(Array.isArray(list) ? list : []));
  handle('lights:apply', (_e, cmds) => { lights().apply(sanitizeLightCommands(cmds)); });
  handle('lights:release', () => lights().release());
  ipcMain.on('lights:out', (e, cmds) => {
    if (!outputWin || e.sender.id !== outputWin.webContents.id) return;
    lights().apply(sanitizeLightCommands(cmds));
  });
  ipcMain.on('lights:outRelease', (e) => {
    if (!outputWin || e.sender.id !== outputWin.webContents.id) return;
    void lights().release();
  });
  // ── Actualizaciones (solo cuando el usuario lo pide) ──
  handle('updates:info', () => ({ current: updater.BUILD, hasToken: updater.hasToken(), canInstall: app.isPackaged && process.platform === 'win32' }));
  handle('updates:check', () => updater.checkForUpdate());
  handle('updates:download', (e) => updater.downloadInstaller((done, total) => { if (!e.sender.isDestroyed()) e.sender.send('updates:progress', { done, total }); }));
  handle('updates:install', (_e, file: string) => { log('info', 'actualización', `Abriendo el instalador ${file}`); updater.runInstaller(file); });
  handle('updates:setToken', (_e, token: string | null) => updater.setToken(token));
  handle('agent:status', () => agentStatus());
  handle('agent:configure', async (_e, p: { enabled: boolean; port?: number; regenerate?: boolean }) => {
    const a = settings.get().agentApi;
    const port = p.port && p.port > 1023 && p.port < 65536 ? Math.round(p.port) : a.port;
    const token = !a.token || p.regenerate ? newToken() : a.token;
    await settings.set({ agentApi: { enabled: !!p.enabled, port, token } });
    return applyAgentSettings();
  });
  // ── App ──
  handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    userData: app.getPath('userData'),
    logsDir,
    projectsDir,
    userPacksDir,
    builtInPacksDir,
    isPackaged: app.isPackaged,
  }));
  handle('app:getSettings', () => settings.get());
  handle('app:setSettings', (_e, p) => settings.set(p));
  handle('app:readLog', () => readLogTail());
  handle('app:openLogs', () => shell.openPath(logsDir));
  handle('app:openPath', (_e, p: string) => {
    // Solo se permiten carpetas conocidas (proyecto, paquetes, registros).
    const allowed = [current?.dir, userPacksDir, logsDir, projectsDir].filter(Boolean) as string[];
    if (!allowed.some((a) => path.resolve(p).startsWith(path.resolve(a)))) throw new Error('Ruta no permitida');
    return shell.openPath(p);
  });
  ipcMain.on('app:log', (e, level, message) => {
    const src = outputWin && e.sender.id === outputWin.webContents.id ? 'output' : 'editor';
    log(level, src, String(message).slice(0, 4000));
  });
  ipcMain.on('app:setDirty', (e, d: boolean) => {
    if (editorWin && e.sender.id === editorWin.webContents.id) dirty = !!d;
  });
  ipcMain.on('app:setTitle', (e, t: string) => {
    if (editorWin && e.sender.id === editorWin.webContents.id) editorWin.setTitle(String(t).slice(0, 200));
  });

  // ── Proyectos ──
  handle('project:create', async (_e, name: string, template?: { project: Project }) => {
    await fs.promises.mkdir(projectsDir, { recursive: true });
    const proj = template?.project ?? createProject(name);
    proj.name = name;
    return toOpened(await store.createProjectFolder(projectsDir, proj));
  });
  handle('project:createFromPack', async (_e, packId: string, name: string) => {
    await refreshPacks();
    const dir = packDirs.get(packId);
    if (!dir) throw new Error('Paquete no encontrado');
    await fs.promises.mkdir(projectsDir, { recursive: true });
    const proj = createProject(name);
    const lp = await store.createProjectFolder(projectsDir, proj);
    const r = await importPack(dir, lp.dir, proj);
    proj.assets.push(...r.assets);
    proj.characters.push(...r.characters);
    proj.installations.push(...r.installations);
    proj.shows.push(...r.shows);
    const m = await readPack(dir);
    proj.description = m.description;
    await store.saveProject(lp.file, proj);
    return toOpened({ ...lp, project: proj });
  });
  handle('project:openDialog', async () => {
    const r = await dialog.showOpenDialog(editorWin!, {
      title: 'Abrir proyecto',
      defaultPath: projectsDir,
      filters: [{ name: 'Proyecto de Videomapping Studio', extensions: ['vmsp'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return toOpened(await store.loadProject(r.filePaths[0]));
  });
  handle('project:open', async (_e, file: string) => toOpened(await store.loadProject(file)));
  handle('project:save', async (_e, project: Project) => {
    const c = requireProject();
    await store.saveProject(c.file, project);
    await settings.touchRecent(c.file, project.name);
    return { savedAt: new Date().toISOString() };
  });
  handle('project:saveAs', async (_e, project: Project) => {
    const c = requireProject();
    const r = await dialog.showOpenDialog(editorWin!, {
      title: 'Elegir carpeta donde crear la copia del proyecto',
      defaultPath: projectsDir,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const lp = await store.saveProjectAs(c.dir, r.filePaths[0], project);
    return toOpened(lp);
  });
  handle('project:exportCopy', async (_e, project: Project) => {
    const c = requireProject();
    const r = await dialog.showOpenDialog(editorWin!, {
      title: 'Exportar copia completa del proyecto (con recursos)',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const lp = await store.saveProjectAs(c.dir, r.filePaths[0], project);
    return lp.dir;
  });
  handle('project:autosave', async (_e, project: Project) => {
    if (!current) return;
    await store.writeAutosave(current.dir, project);
  });
  handle('project:loadAutosave', async () => (current ? store.readAutosave(current.dir) : null));
  handle('project:discardAutosave', async () => current && store.discardAutosave(current.dir));
  handle('project:recent', async () => {
    const s = settings.get();
    return Promise.all(s.recent.map(async (r) => ({ ...r, exists: await store.exists(r.file) })));
  });
  handle('project:removeRecent', async (_e, file: string) => {
    const s = settings.get();
    await settings.set({ recent: s.recent.filter((r) => r.file !== file), lastProject: s.lastProject === file ? null : s.lastProject });
  });
  handle('project:listBackups', async () => store.listBackups(requireProject().dir));
  handle('project:createBackup', async (_e, project: Project, label: string) => store.writeManualBackup(requireProject().dir, project, label));
  handle('project:readBackup', async (_e, name: string) => store.readBackup(requireProject().dir, name));
  handle('project:checkFiles', async (_e, project: Project) => store.findMissingAssets(requireProject().dir, project));
  handle('project:close', async () => {
    setCurrent(null);
    await settings.set({ lastProject: null });
  });
  handle('project:current', () => current);

  // ── Recursos ──
  handle('assets:importDialog', async () => {
    const c = requireProject();
    const r = await dialog.showOpenDialog(editorWin!, {
      title: 'Importar recursos',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Multimedia', extensions: Object.keys(store.MEDIA_EXT).map((x) => x.slice(1)) },
        { name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'avif'] },
        { name: 'Vídeos', extensions: ['mp4', 'webm', 'm4v', 'mov', 'ogv', 'mkv'] },
        { name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus'] },
      ],
    });
    if (r.canceled) return { files: [], errors: [] };
    const files = [];
    const errors: string[] = [];
    for (const f of r.filePaths) {
      try {
        files.push(await store.copyIntoProject(c.dir, f));
      } catch (e) {
        errors.push(`${path.basename(f)}: ${(e as Error).message}`);
      }
    }
    return { files, errors };
  });
  handle('assets:importSequenceDialog', async () => {
    const c = requireProject();
    const r = await dialog.showOpenDialog(editorWin!, { title: 'Carpeta con imágenes numeradas (secuencia)', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return store.importSequenceFolder(c.dir, r.filePaths[0]);
  });
  handle('assets:relinkDialog', async (_e, kind: string) => {
    const c = requireProject();
    if (kind === 'sequence') {
      const r = await dialog.showOpenDialog(editorWin!, { title: 'Localizar carpeta de la secuencia', properties: ['openDirectory'] });
      if (r.canceled || !r.filePaths[0]) return null;
      return store.importSequenceFolder(c.dir, r.filePaths[0]);
    }
    const r = await dialog.showOpenDialog(editorWin!, { title: 'Localizar archivo', properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return store.copyIntoProject(c.dir, r.filePaths[0]);
  });
  handle('assets:pickImage', async () => {
    const c = requireProject();
    const r = await dialog.showOpenDialog(editorWin!, {
      title: 'Foto de referencia de la fachada',
      properties: ['openFile'],
      filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return store.copyIntoProject(c.dir, r.filePaths[0], 'referencias');
  });
  handle('assets:reveal', async (_e, rel: string) => {
    const c = requireProject();
    shell.showItemInFolder(store.resolveInside(c.dir, rel));
  });

  // ── Paquetes ──
  handle('packs:list', refreshPacks);
  handle('packs:importIntoProject', async (_e, packId: string, project: Project) => {
    const c = requireProject();
    if (!packDirs.size) await refreshPacks();
    const dir = packDirs.get(packId);
    if (!dir) throw new Error('Paquete no encontrado');
    return importPack(dir, c.dir, project);
  });
  handle('packs:exportPack', async (_e, project: Project, opts) => {
    const c = requireProject();
    await fs.promises.mkdir(userPacksDir, { recursive: true });
    const dir = await exportPack(c.dir, project, { ...opts, parentDir: userPacksDir });
    await refreshPacks();
    return dir;
  });
  handle('packs:importPackFolder', async () => {
    const r = await dialog.showOpenDialog(editorWin!, { title: 'Carpeta del paquete (contiene pack.json)', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const m = await readPack(r.filePaths[0]);
    await fs.promises.mkdir(userPacksDir, { recursive: true });
    const dest = await store.uniquePath(userPacksDir, store.sanitizeName(m.name));
    await store.copyDir(r.filePaths[0], dest);
    const list = await refreshPacks();
    return list.packs.find((p) => p.id === m.id) ?? null;
  });
  handle('packs:openUserFolder', async () => {
    await fs.promises.mkdir(userPacksDir, { recursive: true });
    await shell.openPath(userPacksDir);
  });

  // ── Pantallas y salida ──
  handle('displays:list', () => displayInfos());
  handle('output:open', (_e, displayId: number | null, fullscreen: boolean) => openOutput(displayId, fullscreen));
  handle('output:close', () => {
    closeOutput();
    notifyOutputState();
    return outputState();
  });
  handle('output:state', () => outputState());
  ipcMain.on('output:cmd', (e, cmd: OutputCommand) => {
    if (!editorWin || e.sender.id !== editorWin.webContents.id) return;
    if (outputWin && !outputWin.isDestroyed()) outputWin.webContents.send('output:cmd', cmd);
  });
  ipcMain.on('output:status', (e, s) => {
    if (!outputWin || e.sender.id !== outputWin.webContents.id) return;
    editorWin?.webContents.send('output:status', s);
  });
  // Peticiones desde la ventana de salida (teclado y ratón sobre la proyección): las resuelve el editor.
  ipcMain.on('output:request', (e, req) => {
    if (!outputWin || e.sender.id !== outputWin.webContents.id) return;
    editorWin?.webContents.send('output:request', req);
  });
  ipcMain.on('output:fullscreen', (e, mode: 'toggle' | 'exit') => {
    if (!outputWin || e.sender.id !== outputWin.webContents.id) return;
    const fs = outputWin.isFullScreen();
    if (mode === 'exit' && !fs) return;
    if (fs) {
      outputWin.setFullScreen(false);
      const d = screen.getDisplayMatching(outputWin.getBounds()).workArea;
      outputWin.setBounds({ x: d.x + Math.round(d.width * 0.2), y: d.y + Math.round(d.height * 0.2), width: Math.round(d.width * 0.6), height: Math.round(d.height * 0.6) });
    } else {
      const d = screen.getDisplayMatching(outputWin.getBounds());
      outputDisplayId = d.id;
      outputWin.setFullScreen(true);
    }
  });
  ipcMain.on('output:ready', (e) => {
    if (!outputWin || e.sender.id !== outputWin.webContents.id) return;
    editorWin?.webContents.send('output:ready');
  });
}

function watchDisplays() {
  const changed = () => editorWin?.webContents.send('displays:changed', displayInfos());
  screen.on('display-added', changed);
  screen.on('display-metrics-changed', () => {
    changed();
    // Si la pantalla del proyector cambia de resolución, recolocar la salida para que siga cubriéndola.
    if (outputWin && outputDisplayId !== null) {
      const d = screen.getAllDisplays().find((x) => x.id === outputDisplayId);
      if (d && outputFullscreen) {
        outputWin.setFullScreen(false);
        outputWin.setBounds(d.bounds);
        outputWin.setFullScreen(true);
      }
    }
  });
  screen.on('display-removed', (_e, d) => {
    // Si se desconecta el proyector, cerramos la salida para que no aparezca sobre el monitor del editor.
    if (outputDisplayId === d.id) {
      log('warn', 'main', `Pantalla de salida desconectada (${d.id}); se cierra la salida.`);
      closeOutput();
      notifyOutputState();
    }
    changed();
  });
}

function hardenWebContents() {
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (ev, url) => {
      if (!url.startsWith(APP_ORIGIN)) ev.preventDefault();
    });
    contents.on('will-attach-webview', (ev) => ev.preventDefault());
  });
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'fullscreen'));
  // No se descarga nada automáticamente.
  session.defaultSession.on('will-download', (e) => e.preventDefault());
}

app.whenReady().then(async () => {
  try {
    await startApp();
  } catch (e) {
    log('error', 'main', `Error al arrancar: ${(e as Error).stack ?? e}`);
    dialog.showErrorBox('Videomapping Studio no pudo arrancar', `${(e as Error).message}\n\nRegistro: ${logsDir}`);
    app.quit();
  }
});

async function startApp() {
  log('info', 'main', 'Electron listo');
  if (!fs.existsSync(path.join(uiDir, 'index.html'))) {
    dialog.showErrorBox('Interfaz no compilada', `No se encuentra ${uiDir}. Ejecuta «npm run build».`);
    app.quit();
    return;
  }
  // Solo para las pruebas automáticas en Linux sin llavero (en Windows el cifrado siempre está disponible).
  if (process.platform === 'linux' && process.env.VMSTUDIO_TEST_BASIC_KEYS === '1') safeStorage.setUsePlainTextEncryption(true);
  log('info', 'main', 'Paso: menú');
  Menu.setApplicationMenu(
    isDev
      ? Menu.buildFromTemplate([
          { label: 'Desarrollo', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { role: 'quit' }] },
        ])
      : null,
  );
  log('info', 'main', 'Paso: seguridad');
  hardenWebContents();
  log('info', 'main', 'Paso: protocolo');
  installProtocol({ uiDir, getProjectDir: () => current?.dir ?? null, getPackDir: (id) => packDirs.get(id) ?? null });
  log('info', 'main', 'Paso: IPC');
  registerIpc();
  log('info', 'main', 'Paso: paquetes');
  await refreshPacks();
  log('info', 'main', 'Paso: ventana');
  createEditorWindow();
  watchDisplays();
  if (settings.get().agentApi.enabled) void applyAgentSettings();
  log('info', 'main', `Videomapping Studio ${app.getVersion()} iniciado (Electron ${process.versions.electron}, ${process.platform})`);
}

let lightsReleased = false;
app.on('will-quit', (e) => {
  void stopAgentApi();
  // Antes de salir, las luces de casa vuelven a como estaban (como mucho unos segundos).
  if (!lightsReleased && ha?.hasChanges()) {
    e.preventDefault();
    lightsReleased = true;
    void ha.release().finally(() => app.quit());
  }
});

app.on('before-quit', () => {
  // El cierre con cambios pendientes lo gestiona el evento 'close' del editor.
  if (!dirty) quitting = true;
});

app.on('window-all-closed', () => {
  app.quit();
});
