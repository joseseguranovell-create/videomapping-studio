/**
 * Ventana de salida al proyector. Es autónoma: recibe el documento y las órdenes de transporte
 * y reproduce con su propio reloj; el editor puede cerrarse o bloquearse sin detener el espectáculo.
 */
import { Player } from '../engine/player';
import type { OutputCommand, VmOutputApi } from '../../shared/api';
import { setupInteraction } from './interaction';

declare global {
  interface Window { vmOutput: VmOutputApi; __vmPlayer?: Player }
}

const api = window.vmOutput;
const gl = document.getElementById('gl') as HTMLCanvasElement;
const ov = document.getElementById('ov') as HTMLCanvasElement;
const wrap = document.getElementById('wrap') as HTMLDivElement;
const msg = document.getElementById('msg') as HTMLDivElement;

let player: Player;
try {
  player = new Player(gl, { audio: true, showMissing: false, overlay: ov, onError: (m) => api.log('warn', m) });
} catch (e) {
  msg.textContent = `Error de gráficos: ${(e as Error).message}`;
  api.log('error', `No se pudo iniciar WebGL2: ${(e as Error).message}`);
  throw e;
}
window.__vmPlayer = player;
api.log('info', `Salida iniciada. WebGL: ${player.r.rendererName}`);

function fit() {
  // Encaja el fotograma de salida en la ventana manteniendo su proporción (bandas negras si no coincide).
  const W = window.innerWidth, H = window.innerHeight;
  const a = gl.width / gl.height || 16 / 9;
  let w = W, h = W / a;
  if (h > H) { h = H; w = H * a; }
  wrap.style.width = `${Math.round(w)}px`;
  wrap.style.height = `${Math.round(h)}px`;
}
window.addEventListener('resize', fit);

let lastW = 0, lastH = 0;
player.setOnFrame((p) => {
  if (gl.width !== lastW || gl.height !== lastH) { lastW = gl.width; lastH = gl.height; fit(); }
});

api.onCommand((cmd: OutputCommand) => {
  switch (cmd.type) {
    case 'doc':
      player.setProject(cmd.project, cmd.mediaBase, cmd.projectKey);
      break;
    case 'mode':
      player.setMode(cmd.mode);
      msg.textContent = '';
      break;
    case 'transport':
      if (cmd.action === 'play') { if (cmd.at !== undefined) player.seek(cmd.at); void player.play(); }
      else if (cmd.action === 'pause') player.pause();
      else player.stop();
      break;
    case 'seek':
      player.seek(cmd.time);
      break;
    case 'audio':
      player.setAudio(cmd.enabled, cmd.volume);
      break;
    case 'ping':
      break;
  }
  api.sendStatus(player.status());
});

// Estado periódico hacia el editor (posición, fps, errores).
setInterval(() => api.sendStatus(player.status()), 250);

window.addEventListener('error', (e) => api.log('error', `${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => api.log('error', `Promesa rechazada: ${String(e.reason)}`));

const ui = setupInteraction(player, api, wrap, document.getElementById('stage') as HTMLElement, document.getElementById('hud') as HTMLDivElement);
// la esquina/vértice activo se resalta en la superposición de calibración
player.activeVertex = () => ui.activeVertex();

player.start();
fit();
api.ready();
