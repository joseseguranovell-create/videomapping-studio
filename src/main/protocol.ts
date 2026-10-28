/**
 * Protocolo propio `vmapp://local/...` para servir la interfaz y los archivos multimedia.
 * - /ui/...      → archivos de la interfaz compilada
 * - /media/...   → archivos dentro de la carpeta del proyecto abierto (nunca fuera de ella)
 * Admite peticiones parciales (Range) para que los vídeos se puedan rebobinar y saltar.
 */
import { protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { resolveInside } from './projectStore';
import { MEDIA_SCHEME } from '../shared/api';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm',
  '.mov': 'video/quicktime', '.ogv': 'video/ogg', '.mkv': 'video/x-matroska', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac',
};

export function registerSchemePrivileges() {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  ]);
}

export function installProtocol(opts: { uiDir: string; getProjectDir: () => string | null; getPackDir: (id: string) => string | null }) {
  protocol.handle(MEDIA_SCHEME, async (req) => {
    try {
      const url = new URL(req.url);
      const p = decodeURIComponent(url.pathname);
      let full: string | null = null;
      if (p.startsWith('/ui/')) full = resolveInside(opts.uiDir, p.slice(4));
      else if (p.startsWith('/media/')) {
        const dir = opts.getProjectDir();
        if (!dir) return new Response('No hay proyecto abierto', { status: 404 });
        full = resolveInside(dir, p.slice(7));
      } else if (p.startsWith('/pack/')) {
        const [, , id, ...rest] = p.split('/');
        const dir = opts.getPackDir(id);
        if (!dir) return new Response('Paquete no encontrado', { status: 404 });
        full = resolveInside(dir, rest.join('/'));
      }
      if (!full) return new Response('No encontrado', { status: 404 });
      return await serveFile(full, req.headers.get('range'));
    } catch (e) {
      return new Response(String((e as Error).message), { status: 400 });
    }
  });
}

async function serveFile(full: string, range: string | null): Promise<Response> {
  let st: fs.Stats;
  try {
    st = await fs.promises.stat(full);
    if (!st.isFile()) throw new Error();
  } catch {
    return new Response('Archivo no encontrado', { status: 404 });
  }
  const type = MIME[path.extname(full).toLowerCase()] ?? 'application/octet-stream';
  const base = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
  };
  const size = st.size;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end = m[2] ? parseInt(m[2], 10) : size - 1;
      if (!m[1] && m[2]) { start = Math.max(0, size - parseInt(m[2], 10)); end = size - 1; }
      if (start >= size || start > end) {
        return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } });
      }
      end = Math.min(end, size - 1);
      const stream = fs.createReadStream(full, { start, end });
      return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
        status: 206,
        headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
      });
    }
  }
  const stream = fs.createReadStream(full);
  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
    status: 200,
    headers: { ...base, 'Content-Length': String(size) },
  });
}
