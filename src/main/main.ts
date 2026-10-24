/**
 * Proceso principal: ventanas (editor + salida de proyección), pantallas, archivos y diálogos.
 * El estado del proyecto vive en la ventana del editor; aquí solo se hace E/S y orquestación.
 */
import { app, BrowserWindow, dialog, ipcMain, screen, shell, powerSaveBlocker, Menu, session, type IpcMainInvokeEvent } from 'electron';
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
  app.quit();
}
app.on('second-instance', () => {
  if (editorWin) {
    if (editorWin.isMinimized()) editorWin.restore();
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
  editorWin.once('ready-to-show', () => {
    editorWin?.show();
    if (wa.width >= 1400 && !process.env.VMSTUDIO_USER_DATA) editorWin?.maximize();
  });
  editorWin.loadURL(`${APP_ORIGIN}/ui/index.html`);
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
    frame: !outputFullscreen,
    fullscreenable: true,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    title: 'Salida de proyección — Videomapping Studio',
    show: false,
    webPreferences: secureWebPreferences('output.cjs'),
  });
  outputWin.setMenu(null);
  outputWin.loadURL(`${APP_ORIGIN}/ui/output.html`);
  outputWin.once('ready-to-show', () => {
    if (!outputWin) return;
    if (outputFullscreen && target) {
      outputWin.setBounds(target.bounds);
      outputWin.showInactive(); // no robar el foco al editor
      outputWin.setFullScreen(true);
    } else {
      outputWin.show();
    }
    editorWin?.focus();
  });
  outputWin.on('closed', () => {
    outputWin = null;
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

function registerIpc() {
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
  if (!fs.existsSync(path.join(uiDir, 'index.html'))) {
    dialog.showErrorBox('Interfaz no compilada', `No se encuentra ${uiDir}. Ejecuta «npm run build».`);
    app.quit();
    return;
  }
  Menu.setApplicationMenu(
    isDev
      ? Menu.buildFromTemplate([
          { label: 'Desarrollo', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { role: 'quit' }] },
        ])
      : null,
  );
  hardenWebContents();
  installProtocol({ uiDir, getProjectDir: () => current?.dir ?? null, getPackDir: (id) => packDirs.get(id) ?? null });
  registerIpc();
  await refreshPacks();
  createEditorWindow();
  watchDisplays();
  log('info', 'main', `Videomapping Studio ${app.getVersion()} iniciado (Electron ${process.versions.electron}, ${process.platform})`);
});

app.on('before-quit', () => {
  // El cierre con cambios pendientes lo gestiona el evento 'close' del editor.
  if (!dirty) quitting = true;
});

app.on('window-all-closed', () => {
  app.quit();
});
