/**
 * API local para agentes de IA (Claude Desktop/Code vía MCP, scripts, PowerShell…).
 *
 * - Desactivada por defecto; se activa en Ajustes. Solo escucha en 127.0.0.1 y exige una clave.
 * - POST /api  { "accion": "...", "parametros": { ... } }  →  { "ok": true, "resultado": ... }
 * - Las acciones las resuelve el editor (dueño del documento): todo cambio queda en el historial
 *   y se puede deshacer con Ctrl+Z.
 * - El archivo agent-api.json (carpeta de datos del usuario) guarda la URL y la clave para el servidor MCP.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { log } from './logger';

export interface AgentApiOptions {
  port: number;
  token: string;
  infoFile: string;
  /** Resuelve una acción (la mayoría se reenvían al editor). */
  handle: (action: string, params: Record<string, unknown>) => Promise<unknown>;
}

let server: http.Server | null = null;
let currentInfoFile: string | null = null;

export function newToken(): string {
  return crypto.randomBytes(18).toString('base64url');
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export async function startAgentApi(o: AgentApiOptions): Promise<{ url: string }> {
  await stopAgentApi();
  const srv = http.createServer((req, res) => {
    // Rechaza peticiones con cabecera Origin de páginas web (evita que una web abierta en el navegador lo use).
    if (req.headers.origin) return send(res, 403, { ok: false, error: 'Origen no permitido' });
    if (req.method === 'GET' && req.url === '/salud') return send(res, 200, { ok: true, app: 'Videomapping Studio' });
    if (req.method !== 'POST' || req.url !== '/api') return send(res, 404, { ok: false, error: 'Usa POST /api' });
    const auth = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (!safeEqual(auth, o.token)) return send(res, 401, { ok: false, error: 'Clave incorrecta (cabecera Authorization: Bearer <clave>)' });
    let body = '';
    let tooBig = false;
    req.on('data', (c) => {
      body += c;
      if (body.length > 20 * 1024 * 1024) { tooBig = true; req.destroy(); }
    });
    req.on('end', async () => {
      if (tooBig) return;
      let msg: { accion?: string; parametros?: Record<string, unknown> };
      try {
        msg = JSON.parse(body || '{}');
      } catch {
        return send(res, 400, { ok: false, error: 'JSON no válido' });
      }
      const action = String(msg.accion ?? '');
      if (!action) return send(res, 400, { ok: false, error: 'Falta «accion»' });
      try {
        const resultado = await o.handle(action, msg.parametros ?? {});
        log('info', 'agente', `acción ${action}`);
        send(res, 200, { ok: true, resultado: resultado ?? null });
      } catch (e) {
        log('warn', 'agente', `acción ${action} fallida: ${(e as Error).message}`);
        send(res, 200, { ok: false, error: (e as Error).message });
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(o.port, '127.0.0.1', () => resolve());
  });
  server = srv;
  const url = `http://127.0.0.1:${o.port}`;
  fs.mkdirSync(path.dirname(o.infoFile), { recursive: true });
  fs.writeFileSync(o.infoFile, JSON.stringify({ url, token: o.token }, null, 2));
  currentInfoFile = o.infoFile;
  log('info', 'agente', `API para agentes activa en ${url}`);
  return { url };
}

export async function stopAgentApi() {
  if (server) {
    await new Promise<void>((r) => server!.close(() => r()));
    server = null;
    log('info', 'agente', 'API para agentes desactivada');
  }
  if (currentInfoFile) {
    try { fs.rmSync(currentInfoFile, { force: true }); } catch { /* ignorar */ }
    currentInfoFile = null;
  }
}

export function agentApiRunning() {
  return !!server;
}
