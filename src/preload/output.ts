/** Puente de la ventana de salida: solo recibe órdenes y envía su estado. */
import { contextBridge, ipcRenderer } from 'electron';
import type { VmOutputApi, OutputCommand } from '../shared/api';

const api: VmOutputApi = {
  request: (r) => ipcRenderer.send('output:request', r),
  fullscreen: (m) => ipcRenderer.send('output:fullscreen', m),
  onCommand: (cb) => { ipcRenderer.on('output:cmd', (_e, c: OutputCommand) => cb(c)); },
  sendStatus: (s) => ipcRenderer.send('output:status', s),
  ready: () => ipcRenderer.send('output:ready'),
  log: (level, message) => ipcRenderer.send('app:log', level, message),
};

contextBridge.exposeInMainWorld('vmOutput', api);
