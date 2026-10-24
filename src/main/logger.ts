/** Registro de errores técnicos en un archivo rotativo (sin datos personales). */
import fs from 'node:fs';
import path from 'node:path';

const MAX_SIZE = 2 * 1024 * 1024;
let logFile: string | null = null;

export function initLogger(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  logFile = path.join(dir, 'app.log');
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > MAX_SIZE) {
      fs.renameSync(logFile, path.join(dir, 'app.old.log'));
    }
  } catch {
    /* ignorar */
  }
}

export function log(level: 'info' | 'warn' | 'error', source: string, message: string) {
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] [${source}] ${message.replace(/\s+$/, '')}\n`;
  // En Windows una aplicación gráfica puede no tener consola: escribir en ella nunca debe romper nada.
  try {
    if (level === 'error') process.stderr.write(line);
    else process.stdout.write(line);
  } catch {
    /* sin consola */
  }
  if (!logFile) return;
  try {
    fs.appendFileSync(logFile, line);
  } catch {
    /* el registro nunca debe romper la aplicación */
  }
}

export function readLogTail(maxBytes = 200_000): string {
  if (!logFile || !fs.existsSync(logFile)) return '';
  const st = fs.statSync(logFile);
  const fd = fs.openSync(logFile, 'r');
  try {
    const len = Math.min(st.size, maxBytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}
