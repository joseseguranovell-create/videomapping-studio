/** Identificadores únicos cortos y legibles. */
export function newId(prefix = ''): string {
  const c = globalThis.crypto;
  let rand: string;
  if (c && typeof c.randomUUID === 'function') {
    rand = c.randomUUID().replace(/-/g, '').slice(0, 12);
  } else {
    rand = Math.random().toString(36).slice(2, 14).padEnd(12, '0');
  }
  return prefix ? `${prefix}_${rand}` : rand;
}

export function nowIso(): string {
  return new Date().toISOString();
}
