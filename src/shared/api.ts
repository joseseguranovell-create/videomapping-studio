/** Contrato entre el proceso principal y las ventanas (expuesto vía preload). */
import type { Project, LightKind } from './model';
import type { LightState } from './lights';
import type { PackInfo } from './pack';

export interface DisplayInfo {
  id: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  /** Resolución física aproximada (bounds × scaleFactor). */
  pixelSize: { width: number; height: number };
  scaleFactor: number;
  primary: boolean;
  internal: boolean;
  /** La ventana del editor está en esta pantalla. */
  hasEditor: boolean;
}

export interface OpenedProject {
  file: string;
  dir: string;
  project: Project;
  migratedFrom: number | null;
  autosaveNewer: boolean;
  missingAssetIds: string[];
}

export interface RecentEntry {
  file: string;
  name: string;
  openedAt: string;
  exists?: boolean;
}

export interface ImportedFile {
  name: string;
  kind: 'image' | 'video' | 'audio' | 'sequence';
  file: string;
  frames: string[];
  size: number;
  format: string;
}

export interface BackupEntry {
  name: string;
  size: number;
  modifiedAt: string;
}

export interface AppSettings {
  recent: RecentEntry[];
  lastProject: string | null;
  reopenLastProject: boolean;
  audioEnabled: boolean;
  previewAudio: boolean;
  autosaveSeconds: number;
  lastOutputDisplayLabel: string | null;
  showFps: boolean;
  schedule: ScheduleSettings;
  agentApi: { enabled: boolean; port: number; token: string };
  /** Salida por red: la misma imagen del proyector en el navegador de un Fire TV, otra tele u otro equipo. */
  webOutput: { enabled: boolean; port: number; token: string; fireTvIp: string };
  /** Luces de casa con Home Assistant. La clave de acceso no va aquí: se guarda cifrada aparte. */
  homeAssistant: HomeAssistantSettings;
}

export interface HaAllowedEntity {
  entityId: string;
  name: string;
  kind: LightKind;
}
export interface HomeAssistantSettings {
  enabled: boolean;
  /** Dirección de Home Assistant en la red de casa, p. ej. http://homeassistant.local:8123 */
  url: string;
  /** Únicas luces y enchufes que el programa puede tocar. */
  allowed: HaAllowedEntity[];
}
export interface HaStatus {
  enabled: boolean;
  url: string;
  hasToken: boolean;
  allowed: HaAllowedEntity[];
  /** null = aún no se ha probado. */
  connected: boolean | null;
  lastError: string | null;
  location: string | null;
  version: string | null;
  /** Luces que el espectáculo ha cambiado y que se devolverán a como estaban. */
  inUse: number;
}
export interface HaEntity {
  entityId: string;
  name: string;
  state: string;
  kind: LightKind;
}
/** Orden para una luz real (la ventana de salida ya ha traducido la luz del proyecto a su entidad). */
export interface LightCommand {
  entityId: string;
  kind: LightKind;
  state: LightState;
}

/** Resultado de buscar actualizaciones. */
export interface UpdateCheck {
  current: { sha: string; date: string };
  latest: { sha: string; date: string; installer: string | null; size: number } | null;
  available: boolean;
  /** Solo la aplicación empaquetada de Windows puede instalarse sola. */
  canInstall: boolean;
  hasToken: boolean;
  error: string | null;
}

export interface WebOutputStatus {
  running: boolean;
  port: number;
  /** Enlaces para abrir en la tele (uno por cada dirección de este equipo en la red). */
  urls: string[];
  clients: number;
  fireTvIp: string;
  error: string | null;
}

export interface AgentApiStatus {
  running: boolean;
  url: string | null;
  token: string;
  port: number;
  infoFile: string;
  mcpScript: string;
  exePath: string;
  error: string | null;
}

/** Reproducción automática diaria (p. ej. la noche de Halloween de 18:30 a 22:00). */
export interface ScheduleSettings {
  enabled: boolean;
  projectFile: string | null;
  showId: string | null;
  /** HH:MM (hora local). Si fin < inicio, el periodo cruza la medianoche. */
  start: string;
  end: string;
}

export interface AppInfo {
  version: string;
  platform: string;
  electron: string;
  chrome: string;
  userData: string;
  logsDir: string;
  projectsDir: string;
  userPacksDir: string;
  builtInPacksDir: string;
  isPackaged: boolean;
}

export interface OutputState {
  open: boolean;
  displayId: number | null;
  fullscreen: boolean;
}

/** Mensajes editor → salida. */
export type OutputCommand =
  | { type: 'doc'; project: Project; mediaBase: string; projectKey: string }
  | { type: 'mode'; mode: OutputMode }
  | { type: 'transport'; action: 'play' | 'pause' | 'stop'; at?: number }
  | { type: 'seek'; time: number }
  | { type: 'audio'; enabled: boolean; volume: number }
  /** Modo directo: escena en bucle hasta que se pida otra. */
  | { type: 'live'; target: LiveTarget }
  | { type: 'ping' };

/** Índice de escena (entre las activas), siguiente/anterior, 'hold' para quedarse en la actual o null para salir. */
export type LiveTarget = number | 'next' | 'prev' | 'hold' | null;

export type OutputMode =
  | { kind: 'black' }
  | {
      kind: 'calibration';
      installationId: string;
      selectedSurfaceId: string | null;
      showGrid: boolean;
      showLabels: boolean;
      pattern: 'test' | 'color' | 'white' | 'none';
      soloSelected: boolean;
    }
  | { kind: 'show'; showId: string };

/** Mensajes salida → editor. */
export interface OutputStatus {
  type: 'status';
  mode: OutputMode['kind'];
  playing: boolean;
  time: number;
  cycleTime: number;
  /** Modo directo activo: escena que se repite. */
  live?: { index: number; count: number; name: string } | null;
  duration: number;
  sceneName: string | null;
  fps: number;
  frameMs: number;
  activeVideos: number;
  textures: number;
  errors: string[];
  width: number;
  height: number;
  /** Implementación WebGL / GPU en uso. */
  gpu: string;
  /** Estado de las luces de casa (simulado en pantalla aunque no haya Home Assistant). */
  lights?: Record<string, LightState>;
}

export interface VmApi {
  app: {
    info(): Promise<AppInfo>;
    getSettings(): Promise<AppSettings>;
    setSettings(p: Partial<AppSettings>): Promise<AppSettings>;
    log(level: 'info' | 'warn' | 'error', message: string): void;
    readLog(): Promise<string>;
    openLogsFolder(): Promise<void>;
    openPath(p: string): Promise<void>;
    setDirty(dirty: boolean): void;
    onRequestSave(cb: () => Promise<boolean>): void;
    setTitle(title: string): void;
  };
  updates: {
    info(): Promise<{ current: { sha: string; date: string }; hasToken: boolean; canInstall: boolean }>;
    check(): Promise<UpdateCheck>;
    /** Descarga y comprueba el instalador; devuelve su ruta. */
    download(): Promise<string>;
    install(file: string): Promise<void>;
    setToken(token: string | null): Promise<void>;
    onProgress(cb: (done: number, total: number) => void): () => void;
  };
  project: {
    create(name: string, template?: { project: Project; packId?: string }): Promise<OpenedProject | null>;
    createFromPack(packId: string, name: string): Promise<OpenedProject | null>;
    openDialog(): Promise<OpenedProject | null>;
    open(file: string): Promise<OpenedProject>;
    save(project: Project): Promise<{ savedAt: string }>;
    saveAs(project: Project): Promise<OpenedProject | null>;
    exportCopy(project: Project): Promise<string | null>;
    autosave(project: Project): Promise<void>;
    loadAutosave(): Promise<Project | null>;
    discardAutosave(): Promise<void>;
    recent(): Promise<RecentEntry[]>;
    removeRecent(file: string): Promise<void>;
    listBackups(): Promise<BackupEntry[]>;
    createBackup(project: Project, label: string): Promise<string>;
    readBackup(name: string): Promise<Project>;
    checkFiles(project: Project): Promise<string[]>;
    close(): Promise<void>;
    current(): Promise<{ file: string; dir: string } | null>;
  };
  assets: {
    importDialog(): Promise<{ files: ImportedFile[]; errors: string[] }>;
    importSequenceDialog(): Promise<ImportedFile | null>;
    relinkDialog(kind: string): Promise<ImportedFile | null>;
    pickImage(): Promise<ImportedFile | null>;
    reveal(rel: string): Promise<void>;
  };
  packs: {
    list(): Promise<{ packs: PackInfo[]; errors: string[] }>;
    importIntoProject(packId: string, project: Project): Promise<{
      assets: Project['assets'];
      characters: Project['characters'];
      installations: Project['installations'];
      shows: Project['shows'];
      skippedAssets: number;
    }>;
    exportPack(project: Project, opts: { name: string; description: string; assetIds: string[]; characterIds: string[]; includeShows: string[] }): Promise<string | null>;
    importPackFolder(): Promise<PackInfo | null>;
    openUserPacksFolder(): Promise<void>;
  };
  demo: {
    /** Empieza a guardar una grabación (trozos en un archivo temporal). */
    begin(ext: 'mp4' | 'webm'): Promise<string>;
    chunk(id: string, data: Uint8Array): Promise<void>;
    /** Pide dónde guardarla; devuelve la ruta o null si se cancela. */
    finish(id: string, name: string): Promise<string | null>;
    cancel(id: string): Promise<void>;
    reveal(): Promise<void>;
  };
  lights: {
    status(): Promise<HaStatus>;
    configure(p: { enabled?: boolean; url?: string }): Promise<HaStatus>;
    setToken(token: string | null): Promise<HaStatus>;
    /** Prueba la conexión con Home Assistant. */
    test(): Promise<HaStatus>;
    /** Luces e interruptores disponibles en Home Assistant (solo lectura). */
    entities(): Promise<HaEntity[]>;
    setAllowed(list: HaAllowedEntity[]): Promise<HaStatus>;
    apply(cmds: LightCommand[]): Promise<void>;
    /** Devuelve las luces a como estaban antes de empezar. */
    release(): Promise<void>;
  };
  web: {
    status(): Promise<WebOutputStatus>;
    configure(p: { enabled?: boolean; fireTvIp?: string }): Promise<WebOutputStatus>;
    /** Conecta con el Fire TV por adb y abre en él la salida. Devuelve un mensaje para mostrar. */
    openOnFireTv(): Promise<string>;
    /** Copia al Fire TV el último vídeo grabado y lo reproduce en VLC. */
    sendLastVideoToFireTv(): Promise<string>;
  };
  agent: {
    status(): Promise<AgentApiStatus>;
    configure(p: { enabled: boolean; port?: number; regenerate?: boolean }): Promise<AgentApiStatus>;
    onRequest(cb: (action: string, params: Record<string, unknown>) => Promise<unknown>): void;
  };
  displays: {
    list(): Promise<DisplayInfo[]>;
    onChanged(cb: (d: DisplayInfo[]) => void): () => void;
  };
  output: {
    open(displayId: number | null, fullscreen: boolean): Promise<OutputState>;
    close(): Promise<OutputState>;
    state(): Promise<OutputState>;
    send(cmd: OutputCommand): void;
    onStatus(cb: (s: OutputStatus) => void): () => void;
    onState(cb: (s: OutputState) => void): () => void;
    onRequest(cb: (r: OutputRequest) => void): () => void;
  };
}

/** Peticiones de la ventana de salida (teclado/ratón sobre la proyección) que resuelve el editor. */
export type OutputRequest =
  | { type: 'key'; action: 'playPause' | 'restart' | 'black' | 'calibration' | 'show' }
  | { type: 'select'; surfaceId: string | null }
  | { type: 'selectNext'; dir: 1 | -1 }
  | { type: 'drag'; phase: 'start' | 'move' | 'end'; surfaceId: string; target: 'quad' | 'polygon' | 'move'; index: number; point: { x: number; y: number }; delta?: { x: number; y: number } }
  | { type: 'nudge'; surfaceId: string; target: 'quad' | 'polygon' | 'move'; index: number; dx: number; dy: number }
  | { type: 'addSurface'; kind: 'window' | 'door'; at: { x: number; y: number } }
  | { type: 'undo' } | { type: 'redo' } | { type: 'save' };

export interface VmOutputApi {
  request(r: OutputRequest): void;
  fullscreen(mode: 'toggle' | 'exit'): void;
  onCommand(cb: (cmd: OutputCommand) => void): void;
  sendStatus(s: OutputStatus): void;
  lights(cmds: LightCommand[]): void;
  lightsRelease(): void;
  ready(): void;
  log(level: 'info' | 'warn' | 'error', message: string): void;
}

export const MEDIA_SCHEME = 'vmapp';
export const APP_ORIGIN = `${MEDIA_SCHEME}://local`;
