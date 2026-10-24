/** Cálculo de la ventana horaria de la reproducción programada (puro, probado). */
export function parseHHMM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** ¿Está la hora `now` dentro del periodo [start, end)? Admite periodos que cruzan la medianoche. */
export function inSchedule(now: Date, start: string, end: string): boolean {
  const a = parseHHMM(start), b = parseHHMM(end);
  if (a === null || b === null || a === b) return false;
  const m = now.getHours() * 60 + now.getMinutes();
  return a < b ? m >= a && m < b : m >= a || m < b;
}

/** Próximo instante de inicio a partir de `now`. */
export function nextStart(now: Date, start: string): Date | null {
  const a = parseHHMM(start);
  if (a === null) return null;
  const d = new Date(now);
  d.setHours(Math.floor(a / 60), a % 60, 0, 0);
  if (d <= now) d.setDate(d.getDate() + 1);
  return d;
}
