/**
 * Estado del editor: documento del proyecto con deshacer/rehacer y estado de la interfaz.
 * El documento es inmutable (immer): cada cambio genera una versión nueva compartiendo estructura,
 * por lo que el historial es barato incluso durante el arrastre de vértices.
 */
import { create } from 'zustand';
import { produce, setAutoFreeze } from 'immer';
import type { Project } from '../../shared/model';
import type { AppSettings, DisplayInfo, OpenedProject, OutputState, OutputStatus } from '../../shared/api';
import { newId } from '../../shared/ids';

setAutoFreeze(false);

export type View = 'home' | 'calibrate' | 'library' | 'characters' | 'shows' | 'play' | 'settings';
export type OutputModeChoice = 'black' | 'calibration' | 'show';
export type CalibTool = 'select' | 'rect' | 'polygon' | 'mask';
export type Pattern = 'test' | 'color' | 'white' | 'none';

export interface Toast {
  id: string;
  kind: 'info' | 'success' | 'warning' | 'error';
  text: string;
}

const HISTORY_LIMIT = 150;

interface State {
  project: Project | null;
  file: string | null;
  dir: string | null;
  projectKey: string;
  dirty: boolean;
  savedAt: string | null;
  changeCounter: number;
  missing: string[];
  recoverAvailable: boolean;
  past: { doc: Project; label: string }[];
  future: { doc: Project; label: string }[];
  dragBase: Project | null;

  view: View;
  installationId: string | null;
  surfaceId: string | null;
  maskId: string | null;
  vertexIndex: number | null;
  showId: string | null;
  sceneId: string | null;
  clipId: string | null;
  soundId: string | null;
  musicId: string | null;

  calib: { tool: CalibTool; showGrid: boolean; showLabels: boolean; pattern: Pattern; soloSelected: boolean; maskTarget: 'installation' | 'surface' };
  outputMode: OutputModeChoice;
  outputShowId: string | null;
  output: OutputState;
  outputStatus: OutputStatus | null;
  displays: DisplayInfo[];
  settings: AppSettings | null;
  toasts: Toast[];
}

interface Actions {
  openProject(o: OpenedProject): void;
  closeProject(): void;
  replaceDocument(doc: Project, label: string): void;
  update(label: string, fn: (draft: Project) => void): void;
  beginDrag(): void;
  dragUpdate(fn: (draft: Project) => void): void;
  endDrag(label: string): void;
  undo(): void;
  redo(): void;
  markSaved(at: string): void;
  setMissing(ids: string[]): void;
  set(p: Partial<State>): void;
  setCalib(p: Partial<State['calib']>): void;
  toast(kind: Toast['kind'], text: string, ms?: number): void;
  dismissToast(id: string): void;
}

export const useStore = create<State & Actions>((set, get) => ({
  project: null,
  file: null,
  dir: null,
  projectKey: '',
  dirty: false,
  savedAt: null,
  changeCounter: 0,
  missing: [],
  recoverAvailable: false,
  past: [],
  future: [],
  dragBase: null,

  view: 'home',
  installationId: null,
  surfaceId: null,
  maskId: null,
  vertexIndex: null,
  showId: null,
  sceneId: null,
  clipId: null,
  soundId: null,
  musicId: null,

  calib: { tool: 'select', showGrid: true, showLabels: true, pattern: 'test', soloSelected: false, maskTarget: 'installation' },
  outputMode: 'black',
  outputShowId: null,
  output: { open: false, displayId: null, fullscreen: true },
  outputStatus: null,
  displays: [],
  settings: null,
  toasts: [],

  openProject(o) {
    const p = o.project;
    set({
      project: p,
      file: o.file,
      dir: o.dir,
      projectKey: `${p.id}-${newId()}`,
      dirty: false,
      savedAt: p.updatedAt,
      missing: o.missingAssetIds,
      recoverAvailable: o.autosaveNewer,
      past: [],
      future: [],
      dragBase: null,
      installationId: p.installations[0]?.id ?? null,
      surfaceId: null,
      maskId: null,
      vertexIndex: null,
      showId: p.shows[0]?.id ?? null,
      sceneId: p.shows[0]?.scenes[0]?.id ?? null,
      clipId: null,
      soundId: null,
      musicId: null,
      outputShowId: p.shows[0]?.id ?? null,
    });
  },
  closeProject() {
    set({ project: null, file: null, dir: null, dirty: false, past: [], future: [], view: 'home', installationId: null, showId: null, sceneId: null, surfaceId: null, clipId: null, outputMode: 'black' });
  },
  replaceDocument(doc, label) {
    const cur = get().project;
    set((s) => ({
      project: doc,
      past: cur ? [...s.past, { doc: cur, label }].slice(-HISTORY_LIMIT) : s.past,
      future: [],
      dirty: true,
      changeCounter: s.changeCounter + 1,
    }));
  },
  update(label, fn) {
    const cur = get().project;
    if (!cur) return;
    const next = produce(cur, (d) => {
      fn(d);
      d.updatedAt = new Date().toISOString();
    });
    if (next === cur) return;
    set((s) => ({
      project: next,
      past: [...s.past, { doc: cur, label }].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true,
      changeCounter: s.changeCounter + 1,
    }));
  },
  beginDrag() {
    set({ dragBase: get().project });
  },
  dragUpdate(fn) {
    const cur = get().project;
    if (!cur) return;
    const next = produce(cur, fn);
    if (next !== cur) set((s) => ({ project: next, changeCounter: s.changeCounter + 1 }));
  },
  endDrag(label) {
    const base = get().dragBase;
    const cur = get().project;
    set({ dragBase: null });
    if (!base || !cur || base === cur) return;
    const stamped = produce(cur, (d) => {
      d.updatedAt = new Date().toISOString();
    });
    set((s) => ({ project: stamped, past: [...s.past, { doc: base, label }].slice(-HISTORY_LIMIT), future: [], dirty: true, changeCounter: s.changeCounter + 1 }));
  },
  undo() {
    const { past, project } = get();
    if (!past.length || !project) return;
    const prev = past[past.length - 1];
    set((s) => ({ project: prev.doc, past: s.past.slice(0, -1), future: [{ doc: project, label: prev.label }, ...s.future], dirty: true, changeCounter: s.changeCounter + 1 }));
    get().toast('info', `Deshecho: ${prev.label}`, 1800);
  },
  redo() {
    const { future, project } = get();
    if (!future.length || !project) return;
    const next = future[0];
    set((s) => ({ project: next.doc, future: s.future.slice(1), past: [...s.past, { doc: project, label: next.label }], dirty: true, changeCounter: s.changeCounter + 1 }));
    get().toast('info', `Rehecho: ${next.label}`, 1800);
  },
  markSaved(at) {
    set({ dirty: false, savedAt: at });
  },
  setMissing(ids) {
    set({ missing: ids });
  },
  set(p) {
    set(p);
  },
  setCalib(p) {
    set((s) => ({ calib: { ...s.calib, ...p } }));
  },
  toast(kind, text, ms = 4000) {
    const id = newId('t');
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, kind, text }] }));
    if (ms > 0) setTimeout(() => get().dismissToast(id), ms);
  },
  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

// ───────── selectores ─────────
export const selInstallation = (s: State) => s.project?.installations.find((i) => i.id === s.installationId) ?? null;
export const selShow = (s: State) => s.project?.shows.find((x) => x.id === s.showId) ?? null;
export const selScene = (s: State) => selShow(s)?.scenes.find((x) => x.id === s.sceneId) ?? null;

export function mediaBase() {
  return 'vmapp://local/media';
}
