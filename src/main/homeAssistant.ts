/**
 * Luces de casa con Home Assistant (opcional, desactivado por defecto).
 * - Solo habla con la dirección que indica el usuario (su Home Assistant en la red de casa).
 * - Solo llama a light.turn_on/turn_off y switch.turn_on/turn_off de las entidades que el usuario ha
 *   permitido; no crea escenas, automatizaciones ni cambia ninguna configuración.
 * - Antes de tocar una luz guarda cómo estaba y al terminar (detener, negro, cerrar la salida o salir
 *   del programa) la deja igual.
 * - La clave de acceso se guarda cifrada con safeStorage y nunca sale de este proceso.
 * - Limita el ritmo de órdenes por luz para no saturar la red Zigbee/Wi-Fi.
 */
import fs from 'node:fs';
import path from 'node:path';
import { app, net, safeStorage } from 'electron';
import type { HaAllowedEntity, HaEntity, HaStatus, HomeAssistantSettings, LightCommand } from '../shared/api';
import { haCall, haRestoreCall, isAllowedEntity, kindFromEntity, PLUG_MIN_INTERVAL, type HaCall, type HaEntityState } from '../shared/lights';
import { log } from './logger';

const LIGHT_MIN_INTERVAL = 0.25;
const TIMEOUT_MS = 4000;

export function normalizeUrl(u: string): string {
  const s = u.trim();
  if (!s) return '';
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `http://${s}`);
  } catch {
    throw new Error('La dirección no es válida. Ejemplo: http://homeassistant.local:8123');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('La dirección debe empezar por http:// o https://');
  if (url.username || url.password) throw new Error('No pongas usuario ni contraseña en la dirección: usa la clave de acceso.');
  return `${url.protocol}//${url.host}`;
}

interface Slot {
  pending: LightCommand | null;
  busy: boolean;
  lastAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export class HomeAssistant {
  private snapshots = new Map<string, HaEntityState>();
  private slots = new Map<string, Slot>();
  private connected: boolean | null = null;
  private lastError: string | null = null;
  private location: string | null = null;
  private version: string | null = null;
  private lastLoggedError = 0;

  constructor(
    private getSettings: () => HomeAssistantSettings,
    private saveSettings: (s: HomeAssistantSettings) => Promise<void>,
  ) {}

  private tokenFile() {
    return path.join(app.getPath('userData'), 'ha-token.bin');
  }
  hasToken() {
    return fs.existsSync(this.tokenFile());
  }
  private readToken(): string | null {
    try {
      return this.hasToken() ? safeStorage.decryptString(fs.readFileSync(this.tokenFile())) : null;
    } catch {
      return null;
    }
  }
  async setToken(token: string | null): Promise<HaStatus> {
    const f = this.tokenFile();
    if (!token?.trim()) await fs.promises.rm(f, { force: true });
    else {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows no permite guardar la clave cifrada en este equipo.');
      await fs.promises.writeFile(f, safeStorage.encryptString(token.trim()));
    }
    this.connected = null;
    return this.status();
  }

  status(): HaStatus {
    const s = this.getSettings();
    return { enabled: s.enabled, url: s.url, hasToken: this.hasToken(), allowed: s.allowed, connected: this.connected, lastError: this.lastError, location: this.location, version: this.version, inUse: this.snapshots.size };
  }

  async configure(p: { enabled?: boolean; url?: string }): Promise<HaStatus> {
    const cur = this.getSettings();
    const next = { ...cur };
    if (p.url !== undefined) next.url = normalizeUrl(p.url);
    if (p.enabled !== undefined) next.enabled = !!p.enabled;
    if (cur.enabled && !next.enabled) await this.release();
    if (next.url !== cur.url) { this.connected = null; this.location = this.version = null; }
    await this.saveSettings(next);
    return this.status();
  }

  async setAllowed(list: HaAllowedEntity[]): Promise<HaStatus> {
    const clean = list.filter((e) => isAllowedEntity(e.entityId)).map((e) => ({ entityId: e.entityId, name: String(e.name).slice(0, 80), kind: e.kind }));
    // Las que dejan de estar permitidas se devuelven a como estaban.
    const keep = new Set(clean.map((e) => e.entityId));
    for (const id of [...this.snapshots.keys()]) if (!keep.has(id)) await this.restoreOne(id);
    await this.saveSettings({ ...this.getSettings(), allowed: clean });
    return this.status();
  }

  private async request(method: 'GET' | 'POST', apiPath: string, body?: unknown): Promise<unknown> {
    const { url } = this.getSettings();
    const token = this.readToken();
    if (!url) throw new Error('Falta la dirección de Home Assistant.');
    if (!token) throw new Error('Falta la clave de acceso de Home Assistant.');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let r: Response;
    try {
      r = await net.fetch(`${url}${apiPath}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctl.signal,
      });
    } catch (e) {
      throw new Error(ctl.signal.aborted ? 'Home Assistant no responde (¿está encendido y en la misma red?).' : `No se pudo conectar con Home Assistant (${(e as Error).message}).`);
    } finally {
      clearTimeout(timer);
    }
    if (r.status === 401 || r.status === 403) throw new Error('Home Assistant rechaza la clave de acceso. Crea un «token de acceso de larga duración» en tu perfil de Home Assistant.');
    if (r.status === 404) throw new Error('No encontrado (revisa la dirección o el nombre de la entidad).');
    if (!r.ok) throw new Error(`Home Assistant respondió ${r.status}.`);
    const text = await r.text();
    try { return text ? JSON.parse(text) : null; } catch { return null; }
  }

  private fail(e: unknown) {
    this.connected = false;
    this.lastError = (e as Error).message;
    // Sin inundar el registro si Home Assistant está apagado durante el espectáculo.
    if (Date.now() - this.lastLoggedError > 30000) {
      this.lastLoggedError = Date.now();
      log('warn', 'luces', this.lastError);
    }
  }

  async test(): Promise<HaStatus> {
    try {
      await this.request('GET', '/api/');
      const cfg = (await this.request('GET', '/api/config')) as { location_name?: string; version?: string } | null;
      this.connected = true;
      this.lastError = null;
      this.location = cfg?.location_name ?? null;
      this.version = cfg?.version ?? null;
    } catch (e) {
      this.fail(e);
    }
    return this.status();
  }

  async entities(): Promise<HaEntity[]> {
    const all = (await this.request('GET', '/api/states')) as HaEntityState[] | null;
    this.connected = true;
    this.lastError = null;
    return (all ?? [])
      .filter((e) => e && typeof e.entity_id === 'string' && isAllowedEntity(e.entity_id))
      .map((e) => ({ entityId: e.entity_id, name: String(e.attributes?.friendly_name ?? e.entity_id), state: e.state, kind: kindFromEntity(e) }))
      .sort((a, b) => a.entityId.localeCompare(b.entityId));
  }

  private active(): boolean {
    const s = this.getSettings();
    return s.enabled && !!s.url && this.hasToken();
  }

  /** Órdenes del espectáculo: se aplican con un ritmo máximo por luz (si llegan muchas, gana la última). */
  apply(cmds: LightCommand[]) {
    if (!this.active()) return;
    const allowed = new Set(this.getSettings().allowed.map((e) => e.entityId));
    for (const c of cmds) {
      if (!allowed.has(c.entityId) || !isAllowedEntity(c.entityId)) continue;
      if ('restore' in c.state && !this.snapshots.has(c.entityId)) continue;
      const s = this.slot(c.entityId);
      s.pending = c;
      this.pump(c.entityId);
    }
  }

  private slot(id: string): Slot {
    let s = this.slots.get(id);
    if (!s) { s = { pending: null, busy: false, lastAt: 0, timer: null }; this.slots.set(id, s); }
    return s;
  }

  private pump(id: string) {
    const s = this.slot(id);
    if (s.busy || s.timer || !s.pending) return;
    const min = (id.startsWith('switch.') || s.pending.kind === 'plug' ? PLUG_MIN_INTERVAL : LIGHT_MIN_INTERVAL) * 1000;
    const wait = s.lastAt + min - Date.now();
    if (wait > 0) {
      s.timer = setTimeout(() => { s.timer = null; this.pump(id); }, wait);
      return;
    }
    const c = s.pending;
    s.pending = null;
    s.busy = true;
    void this.execute(c).finally(() => {
      s.busy = false;
      s.lastAt = Date.now();
      this.pump(id);
    });
  }

  private async execute(c: LightCommand) {
    try {
      if ('restore' in c.state) {
        const snap = this.snapshots.get(c.entityId);
        const call = snap && haRestoreCall(snap);
        if (call) await this.call(call);
        return;
      }
      if (!this.snapshots.has(c.entityId)) {
        // Foto del estado actual antes de tocarla por primera vez.
        const st = (await this.request('GET', `/api/states/${c.entityId}`)) as HaEntityState | null;
        if (!st) return;
        this.snapshots.set(c.entityId, st);
      }
      const call = haCall(c.entityId, c.kind, c.state);
      if (call) await this.call(call);
      this.connected = true;
    } catch (e) {
      this.fail(e);
    }
  }

  private async call(c: HaCall) {
    await this.request('POST', `/api/services/${c.domain}/${c.service}`, c.data);
  }

  private async restoreOne(id: string) {
    const s = this.slot(id);
    if (s.timer) { clearTimeout(s.timer); s.timer = null; }
    s.pending = null;
    // Espera a que termine la orden en curso.
    for (let i = 0; s.busy && i < 40; i++) await new Promise((r) => setTimeout(r, 50));
    const snap = this.snapshots.get(id);
    this.snapshots.delete(id);
    const call = snap && haRestoreCall(snap);
    if (!call) return;
    try { await this.call(call); } catch (e) { this.fail(e); }
  }

  /** Devuelve todas las luces tocadas a como estaban. */
  async release(): Promise<void> {
    const ids = [...this.snapshots.keys()];
    if (!ids.length) return;
    log('info', 'luces', `Devolviendo ${ids.length} luz(ces) a como estaban`);
    await Promise.race([Promise.all(ids.map((id) => this.restoreOne(id))), new Promise((r) => setTimeout(r, 5000))]);
  }

  hasChanges(): boolean {
    return this.snapshots.size > 0;
  }
}
