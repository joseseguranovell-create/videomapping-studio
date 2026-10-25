/** Puente seguro editor ↔ proceso principal. Solo expone operaciones concretas. */
import { contextBridge, ipcRenderer } from 'electron';
import type { VmApi } from '../shared/api';

const inv = (ch: string, ...a: unknown[]) => ipcRenderer.invoke(ch, ...a);
const on = <T>(ch: string, cb: (v: T) => void) => {
  const l = (_e: unknown, v: T) => cb(v);
  ipcRenderer.on(ch, l);
  return () => ipcRenderer.removeListener(ch, l);
};

const api: VmApi = {
  app: {
    info: () => inv('app:info'),
    getSettings: () => inv('app:getSettings'),
    setSettings: (p) => inv('app:setSettings', p),
    log: (level, message) => ipcRenderer.send('app:log', level, message),
    readLog: () => inv('app:readLog'),
    openLogsFolder: () => inv('app:openLogs'),
    openPath: (p) => inv('app:openPath', p),
    setDirty: (d) => ipcRenderer.send('app:setDirty', d),
    setTitle: (t) => ipcRenderer.send('app:setTitle', t),
    onRequestSave: (cb) => {
      ipcRenderer.on('app:requestSave', async (_e, id: string) => {
        let ok = false;
        try { ok = await cb(); } catch { ok = false; }
        ipcRenderer.send(`app:saveResult:${id}`, ok);
      });
    },
  },
  updates: {
    info: () => inv('updates:info'),
    check: () => inv('updates:check'),
    download: () => inv('updates:download'),
    install: (file) => inv('updates:install', file),
    setToken: (t) => inv('updates:setToken', t),
    onProgress: (cb) => on<{ done: number; total: number }>('updates:progress', (v) => cb(v.done, v.total)),
  },
  project: {
    create: (name, template) => inv('project:create', name, template),
    createFromPack: (packId, name) => inv('project:createFromPack', packId, name),
    openDialog: () => inv('project:openDialog'),
    open: (file) => inv('project:open', file),
    save: (p) => inv('project:save', p),
    saveAs: (p) => inv('project:saveAs', p),
    exportCopy: (p) => inv('project:exportCopy', p),
    autosave: (p) => inv('project:autosave', p),
    loadAutosave: () => inv('project:loadAutosave'),
    discardAutosave: () => inv('project:discardAutosave'),
    recent: () => inv('project:recent'),
    removeRecent: (f) => inv('project:removeRecent', f),
    listBackups: () => inv('project:listBackups'),
    createBackup: (p, label) => inv('project:createBackup', p, label),
    readBackup: (n) => inv('project:readBackup', n),
    checkFiles: (p) => inv('project:checkFiles', p),
    close: () => inv('project:close'),
    current: () => inv('project:current'),
  },
  assets: {
    importDialog: () => inv('assets:importDialog'),
    importSequenceDialog: () => inv('assets:importSequenceDialog'),
    relinkDialog: (kind) => inv('assets:relinkDialog', kind),
    pickImage: () => inv('assets:pickImage'),
    reveal: (rel) => inv('assets:reveal', rel),
  },
  packs: {
    list: () => inv('packs:list'),
    importIntoProject: (id, p) => inv('packs:importIntoProject', id, p),
    exportPack: (p, o) => inv('packs:exportPack', p, o),
    importPackFolder: () => inv('packs:importPackFolder'),
    openUserPacksFolder: () => inv('packs:openUserFolder'),
  },
  demo: {
    begin: (ext) => inv('demo:begin', ext),
    chunk: (id, data) => inv('demo:chunk', id, data),
    finish: (id, name) => inv('demo:finish', id, name),
    cancel: (id) => inv('demo:cancel', id),
    reveal: () => inv('demo:reveal'),
  },
  lights: {
    status: () => inv('lights:status'),
    configure: (p) => inv('lights:configure', p),
    setToken: (t) => inv('lights:setToken', t),
    test: () => inv('lights:test'),
    entities: () => inv('lights:entities'),
    setAllowed: (l) => inv('lights:setAllowed', l),
    apply: (c) => inv('lights:apply', c),
    release: () => inv('lights:release'),
  },
  agent: {
    status: () => inv('agent:status'),
    configure: (p) => inv('agent:configure', p),
    onRequest: (cb) => {
      ipcRenderer.on('agent:request', async (_e, req: { id: string; action: string; params: Record<string, unknown> }) => {
        try {
          const result = await cb(req.action, req.params);
          ipcRenderer.send(`agent:response:${req.id}`, { ok: true, result });
        } catch (e) {
          ipcRenderer.send(`agent:response:${req.id}`, { ok: false, error: (e as Error)?.message ?? String(e) });
        }
      });
    },
  },
  displays: {
    list: () => inv('displays:list'),
    onChanged: (cb) => on('displays:changed', cb),
  },
  output: {
    open: (id, fs) => inv('output:open', id, fs),
    close: () => inv('output:close'),
    state: () => inv('output:state'),
    send: (cmd) => ipcRenderer.send('output:cmd', cmd),
    onStatus: (cb) => on('output:status', cb),
    onRequest: (cb) => on('output:request', cb),
    onState: (cb) => {
      const a = on('output:state', cb);
      const b = on('output:ready', () => inv('output:state').then(cb));
      return () => { a(); b(); };
    },
  },
};

contextBridge.exposeInMainWorld('vm', api);
