/**
 * Salida por red: sirve en la red de casa la misma imagen que la ventana del proyector, para verla en el
 * navegador de un Fire TV, otra tele o otro ordenador (http://IP:puerto/salida).
 *
 * - La página es la propia ventana de salida del programa; recibe las mismas órdenes (documento, modo,
 *   reproducción…) por eventos del servidor y carga los vídeos y sonidos desde este equipo.
 * - Exige una clave (la lleva el enlace) y solo está activa si se activa en el programa.
 * - Las peticiones de la página (teclado/ratón sobre la proyección) y las luces vuelven al editor.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LightCommand, OutputCommand, OutputRequest } from '../shared/api';
import { log } from './logger';
import { resolveInside } from './projectStore';
import { MIME } from './protocol';

export interface WebOutputOptions {
  port: number;
  token: string;
  uiDir: string;
  getProjectDir: () => string | null;
  getPackDir: (id: string) => string | null;
  onRequest: (r: OutputRequest) => void;
  onLights: (cmds: LightCommand[]) => void;
  onLightsRelease: () => void;
}

let server: http.Server | null = null;
const clients = new Set<http.ServerResponse>();

/** Lo último que se envió, para que una página que se conecta (o se reconecta) se ponga al día. */
const cache: { doc?: string; mode?: string; audio?: string } = {};
let pendingDoc: string | null = null;
let docTimer: NodeJS.Timeout | null = null;
const clock = { pos: 0, at: Date.now(), playing: false };

export function newWebToken(): string {
  return crypto.randomBytes(12).toString('base64url');
}

/** Direcciones de este equipo en la red local (primero las más probables: 192.168.x.x y 10.x.x.x). */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  const rank = (a: string) => (a.startsWith('192.168.56.') ? 3 : a.startsWith('192.168.') || a.startsWith('10.') ? 0 : a.startsWith('172.') ? 2 : 1);
  return out.sort((a, b) => rank(a) - rank(b));
}

const now = () => Date.now();
function position(): number {
  return clock.pos + (clock.playing ? (now() - clock.at) / 1000 : 0);
}

function write(res: http.ServerResponse, json: string) {
  res.write(`data: ${json}\n\n`);
}
function broadcastRaw(json: string) {
  for (const c of clients) write(c, json);
}
function flushDoc() {
  if (docTimer) { clearTimeout(docTimer); docTimer = null; }
  if (pendingDoc === null) return;
  cache.doc = pendingDoc;
  broadcastRaw(pendingDoc);
  pendingDoc = null;
}

/** Reenvía a las páginas conectadas una orden del editor. El documento se agrupa (se manda a lo sumo unas 6 veces por segundo). */
export function broadcastCommand(cmd: OutputCommand) {
  if (!server) return;
  if (cmd.type === 'doc') {
    pendingDoc = JSON.stringify(cmd);
    if (!docTimer) docTimer = setTimeout(flushDoc, 160);
    return;
  }
  flushDoc();
  const json = JSON.stringify(cmd);
  if (cmd.type === 'mode') cache.mode = json;
  else if (cmd.type === 'audio') cache.audio = json;
  else if (cmd.type === 'seek') { clock.pos = cmd.time; clock.at = now(); }
  else if (cmd.type === 'transport') {
    if (cmd.action === 'play') { clock.pos = cmd.at ?? position(); clock.at = now(); clock.playing = true; }
    else if (cmd.action === 'pause') { clock.pos = position(); clock.at = now(); clock.playing = false; }
    else { clock.pos = 0; clock.at = now(); clock.playing = false; }
  }
  broadcastRaw(json);
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

function sendFile(req: http.IncomingMessage, res: http.ServerResponse, full: string) {
  let st: fs.Stats;
  try { st = fs.statSync(full); if (!st.isFile()) throw new Error(); } catch { res.writeHead(404); res.end('No encontrado'); return; }
  const headers: Record<string, string | number> = {
    'Content-Type': MIME[path.extname(full).toLowerCase()] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  };
  const size = st.size;
  const m = /bytes=(\d*)-(\d*)/.exec(String(req.headers.range ?? ''));
  if (m) {
    let start = m[1] ? parseInt(m[1], 10) : 0;
    let end = m[2] ? parseInt(m[2], 10) : size - 1;
    if (!m[1] && m[2]) { start = Math.max(0, size - parseInt(m[2], 10)); end = size - 1; }
    if (start >= size || start > end) { res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` }); res.end(); return; }
    end = Math.min(end, size - 1);
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(full, { start, end }).on('error', () => res.destroy()).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': size });
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(full).on('error', () => res.destroy()).pipe(res);
}

function readBody(req: http.IncomingMessage, cb: (data: unknown) => void, res: http.ServerResponse) {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 1_000_000) req.destroy(); });
  req.on('end', () => {
    try { cb(JSON.parse(body || 'null')); sendJson(res, 200, { ok: true }); } catch { sendJson(res, 400, { ok: false }); }
  });
}

/** Script que hace de «puente» de la ventana de salida cuando la página se abre en un navegador. */
const SHIM = `(function () {
  var cb = null, queue = [];
  function post(url, data) { try { fetch(url, { method: 'POST', body: JSON.stringify(data === undefined ? null : data), keepalive: true }); } catch (e) {} }
  function deliver(c) { if (cb) cb(c); else queue.push(c); }
  var es = new EventSource('/eventos');
  es.onmessage = function (e) {
    var c = JSON.parse(e.data);
    if (c.type === 'doc') c.mediaBase = location.origin + '/media';
    deliver(c);
  };
  window.vmOutput = {
    request: function (r) { post('/peticion', r); },
    fullscreen: function () { var d = document; if (d.fullscreenElement) d.exitFullscreen(); else if (d.documentElement.requestFullscreen) d.documentElement.requestFullscreen(); },
    onCommand: function (f) { cb = f; var q = queue; queue = []; q.forEach(f); },
    sendStatus: function () {},
    lights: function (c) { post('/luces', c); },
    lightsRelease: function () { post('/luces-liberar'); },
    ready: function () {},
    log: function (l, m) { (l === 'error' ? console.error : console.log)(m); post('/registro', { level: l, message: String(m) }); }
  };
  window.addEventListener('error', function (e) { post('/registro', { level: 'error', message: e.message + ' @ ' + e.filename + ':' + e.lineno }); });
  // Los navegadores no dejan sonar ni ir a pantalla completa sin un gesto: un OK del mando basta.
  window.addEventListener('DOMContentLoaded', function () {
    var o = document.createElement('div');
    o.style.cssText = 'position:fixed;inset:0;z-index:99;background:#000;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;font:600 34px system-ui,sans-serif;text-align:center;cursor:pointer';
    o.innerHTML = '<div>Videomapping Studio</div><div style="font-size:24px;font-weight:400;margin-top:18px;opacity:.8">Pulsa OK en el mando para empezar</div>';
    function go() {
      o.remove();
      var el = document.documentElement;
      try { if (el.requestFullscreen) el.requestFullscreen(); } catch (e) {}
      try { if (window.__vmPlayer && window.__vmPlayer.audio) window.__vmPlayer.audio.resume(); } catch (e) {}
      window.removeEventListener('keydown', onKey, true);
    }
    function onKey(e) { if (e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 23) { e.preventDefault(); e.stopPropagation(); go(); } }
    o.addEventListener('click', go);
    window.addEventListener('keydown', onKey, true);
    document.body.appendChild(o);
  });
})();`;

export async function startWebOutput(o: WebOutputOptions): Promise<{ port: number }> {
  await stopWebOutput();
  const cookieOf = (req: http.IncomingMessage) => /(?:^|;\s*)vmt=([^;]+)/.exec(String(req.headers.cookie ?? ''))?.[1] ?? '';
  const srv = http.createServer((req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      const key = url.searchParams.get('t') ?? cookieOf(req);
      const ok = key.length === o.token.length && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(o.token));
      if (!ok) { res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Falta la clave: usa el enlace que da Videomapping Studio.'); return; }
      const p = decodeURIComponent(url.pathname);
      if (p === '/salida' || p === '/') {
        const html = fs.readFileSync(path.join(o.uiDir, 'output.html'), 'utf8').replace('<head>', '<head>\n    <script src="/web-shim.js"></script>');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': `vmt=${o.token}; Path=/; SameSite=Lax`, 'Cache-Control': 'no-store' });
        res.end(html);
      } else if (p === '/web-shim.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(SHIM);
      } else if (p === '/eventos') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write('retry: 1500\n\n');
        clients.add(res);
        log('info', 'salida web', `Pantalla conectada (${clients.size})`);
        req.on('close', () => { clients.delete(res); log('info', 'salida web', `Pantalla desconectada (${clients.size})`); });
        flushDoc();
        if (cache.doc) write(res, cache.doc);
        if (cache.audio) write(res, cache.audio);
        if (cache.mode) write(res, cache.mode);
        if (clock.playing) write(res, JSON.stringify({ type: 'transport', action: 'play', at: position() }));
        else if (clock.pos > 0) write(res, JSON.stringify({ type: 'seek', time: clock.pos }));
      } else if (p === '/peticion' && req.method === 'POST') {
        readBody(req, (d) => { if (d && typeof (d as OutputRequest).type === 'string') o.onRequest(d as OutputRequest); }, res);
      } else if (p === '/registro' && req.method === 'POST') {
        readBody(req, (d) => { const m = d as { level?: string; message?: string }; log(m.level === 'error' ? 'error' : 'info', 'salida web (pantalla)', String(m.message ?? '').slice(0, 4000)); }, res);
      } else if (p === '/luces' && req.method === 'POST') {
        readBody(req, (d) => { if (Array.isArray(d)) o.onLights(d as LightCommand[]); }, res);
      } else if (p === '/luces-liberar' && req.method === 'POST') {
        readBody(req, () => o.onLightsRelease(), res);
      } else if (p.startsWith('/media/')) {
        const dir = o.getProjectDir();
        if (!dir) { res.writeHead(404); res.end('No hay proyecto abierto'); return; }
        sendFile(req, res, resolveInside(dir, p.slice(7)));
      } else if (p.startsWith('/pack/')) {
        const [, , id, ...rest] = p.split('/');
        const dir = o.getPackDir(id);
        if (!dir) { res.writeHead(404); res.end('Paquete no encontrado'); return; }
        sendFile(req, res, resolveInside(dir, rest.join('/')));
      } else {
        sendFile(req, res, resolveInside(o.uiDir, p.replace(/^\/+/, '')));
      }
    } catch (e) {
      res.writeHead(400); res.end(String((e as Error).message));
    }
  });
  await new Promise<void>((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(o.port, '0.0.0.0', () => resolve());
  });
  server = srv;
  log('info', 'salida web', `Salida por red activa en el puerto ${o.port}`);
  return { port: o.port };
}

export async function stopWebOutput() {
  if (!server) return;
  for (const c of clients) { try { c.end(); } catch { /* ignorar */ } }
  clients.clear();
  await new Promise<void>((r) => { server!.close(() => r()); server!.closeAllConnections?.(); });
  server = null;
  cache.doc = cache.mode = cache.audio = undefined;
  pendingDoc = null;
  log('info', 'salida web', 'Salida por red desactivada');
}

export const webOutputRunning = () => !!server;
export const webOutputClients = () => clients.size;
