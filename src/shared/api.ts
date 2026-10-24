/** Contrato entre el proceso principal y las ventanas (expuesto vía preload). */
import type { Project } from './model';
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
  | { type: 'ping' };

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
  ready(): void;
  log(level: 'info' | 'warn' | 'error', message: string): void;
}

export const MEDIA_SCHEME = 'vmapp';
export const APP_ORIGIN = `${MEDIA_SCHEME}://local`;
