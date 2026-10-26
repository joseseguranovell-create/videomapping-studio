/**
 * Luces de casa sincronizadas con el espectáculo.
 * - Los efectos de la pista de luces se convierten en órdenes con hora (`lightEvents`).
 * - `LightDriver` las va enviando según avanza el reloj (y resincroniza al saltar o cambiar de escena).
 * - `haCall` / `haRestoreCall` traducen a llamadas de Home Assistant: solo light.turn_on/turn_off y
 *   switch.turn_on/turn_off. Al terminar, cada luz vuelve a como estaba antes del espectáculo.
 */
import type { LightCue, LightDevice, LightKind, Scene, Show } from './model';
import { layoutShow, sceneLoopLayout, type ShowLayout } from './timeline';
import { createLightCue } from './factory';

/** Estado pedido a una luz. `restore` = como estaba en casa antes de empezar. */
export type LightState = { on: false; transition?: number } | { on: true; color: string; brightness: number; transition?: number } | { restore: true };
export const RESTORE: LightState = { restore: true };

export interface LightEvent {
  t: number;
  deviceId: string;
  state: LightState;
}

interface RawEvent extends LightEvent {
  /** Los destellos no cambian el estado «de fondo»; `back` vuelve a él. */
  peak?: boolean;
  back?: boolean;
}

/** Tiempo mínimo entre órdenes a un enchufe (los relés no deben conmutar deprisa). */
export const PLUG_MIN_INTERVAL = 1;
const FLASH_ON = 0.2;

function hash(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Órdenes de un efecto de luz, en tiempo de la escena (recortadas a `sceneDuration`). */
export function expandLightCue(c: LightCue, kind: LightKind, sceneDuration: number): RawEvent[] {
  if (c.start >= sceneDuration) return [];
  const end = Math.min(c.start + c.duration, sceneDuration);
  const out: RawEvent[] = [];
  const on = (t: number, color: string, brightness: number, transition: number, extra: Partial<RawEvent> = {}) =>
    out.push({ t, deviceId: c.deviceId, state: brightness <= 0.001 || color.toLowerCase() === '#000000' ? { on: false, transition } : { on: true, color, brightness, transition }, ...extra });
  const plug = kind === 'plug';
  switch (c.action) {
    case 'color':
      on(c.start, c.color, c.brightness, c.transition);
      break;
    case 'off':
      out.push({ t: c.start, deviceId: c.deviceId, state: { on: false, transition: c.transition } });
      break;
    case 'restore':
      out.push({ t: c.start, deviceId: c.deviceId, state: RESTORE });
      break;
    case 'flash': {
      // Destellos irregulares, como un relámpago; los enchufes no parpadean.
      if (plug) break;
      const step = 1 / c.rate;
      for (let i = 0, t = c.start; t < end - 0.05; i++, t = c.start + i * step + (hash(i + c.start) - 0.5) * step * 0.5) {
        on(Math.max(c.start, t), '#ffffff', 1, 0, { peak: true });
        out.push({ t: Math.max(c.start, t) + FLASH_ON, deviceId: c.deviceId, state: RESTORE, back: true });
      }
      break;
    }
    case 'blink': {
      const step = Math.max(plug ? PLUG_MIN_INTERVAL : 0, 1 / c.rate);
      for (let i = 0, t = c.start; t < end - 1e-6; i++, t = c.start + i * step) on(t, i % 2 ? c.color2 : c.color, c.brightness, plug ? 0 : Math.min(c.transition, step * 0.5));
      break;
    }
    case 'candle': {
      if (plug) { on(c.start, c.color, 1, 0); break; }
      const step = 1 / c.rate;
      for (let i = 0, t = c.start; t < end - 1e-6; i++, t = c.start + i * step) on(t, c.color, c.brightness * (0.35 + 0.65 * hash(i * 3.1 + c.start)), step * 0.9);
      break;
    }
  }
  return out.filter((e) => e.t < sceneDuration);
}

/** Resuelve los «volver» de los destellos al estado de fondo que tenía cada luz en ese momento. */
function resolve(raw: RawEvent[]): LightEvent[] {
  raw.sort((a, b) => a.t - b.t || (a.back ? -1 : 0) - (b.back ? -1 : 0));
  const base = new Map<string, LightState>();
  const out: LightEvent[] = [];
  for (const e of raw) {
    if (e.back) out.push({ t: e.t, deviceId: e.deviceId, state: base.get(e.deviceId) ?? RESTORE });
    else {
      if (!e.peak) base.set(e.deviceId, e.state);
      out.push({ t: e.t, deviceId: e.deviceId, state: e.state });
    }
  }
  return out;
}

function sceneRaw(scene: Scene, offset: number, devices: LightDevice[], limit = Infinity): RawEvent[] {
  const out: RawEvent[] = [];
  for (const c of scene.lights ?? []) {
    const targets = c.deviceId === '*' ? devices : devices.filter((d) => d.id === c.deviceId);
    for (const d of targets) {
      for (const e of expandLightCue({ ...c, deviceId: d.id }, d.kind, scene.duration)) {
        const t = offset + e.t;
        if (t < limit) out.push({ ...e, t });
      }
    }
  }
  return out;
}

/** Todas las órdenes de luz del espectáculo, en tiempo del ciclo. */
export function lightEvents(show: Show, devices: LightDevice[], layout: ShowLayout = layoutShow(show)): LightEvent[] {
  if (!devices.length) return [];
  return resolve(layout.slots.flatMap((s) => sceneRaw(s.scene, s.start, devices, s.end)));
}

/** Órdenes de una escena repetida en bucle (modo directo). */
export function sceneLoopLightEvents(scene: Scene, devices: LightDevice[], layout: ShowLayout = sceneLoopLayout(scene)): LightEvent[] {
  if (!devices.length || !layout.slots.length) return [];
  return resolve(sceneRaw(layout.slots[0].scene, 0, devices));
}

/** Estado de cada luz en el instante t (el de la última orden), sin transición. */
export function lightStateAt(events: LightEvent[], t: number): Map<string, LightState> {
  const m = new Map<string, LightState>();
  for (const e of events) {
    if (e.t > t) break;
    m.set(e.deviceId, e.state);
  }
  return m;
}

export function sameLightState(a: LightState | undefined, b: LightState | undefined): boolean {
  if (!a || !b) return a === b;
  if ('restore' in a || 'restore' in b) return 'restore' in a && 'restore' in b;
  if (!a.on || !b.on) return a.on === b.on;
  return a.color.toLowerCase() === b.color.toLowerCase() && Math.abs(a.brightness - b.brightness) < 0.01;
}

/**
 * Envía las órdenes según avanza el tiempo. `key` identifica la línea de tiempo (ciclo del espectáculo
 * o escena en bucle): al cambiar, se sigue desde el principio; si el tiempo salta, se envía directamente
 * el estado que corresponde a ese instante.
 */
export class LightDriver {
  private key = '';
  private lastT = 0;
  private sent = new Map<string, LightState>();
  constructor(private send: (cmds: { deviceId: string; state: LightState }[]) => void) {}

  update(events: LightEvent[], key: string, t: number) {
    const cmds = new Map<string, LightState>();
    const natural = key !== this.key && t < 0.75;
    const jump = !natural && (key !== this.key || t < this.lastT - 0.05 || t - this.lastT > 1.5);
    if (jump) {
      const at = lightStateAt(events, t);
      const ids = new Set([...at.keys(), ...this.sent.keys()]);
      for (const id of ids) {
        const s = at.get(id) ?? RESTORE;
        if (!sameLightState(s, this.sent.get(id) ?? RESTORE)) cmds.set(id, { ...s, ...('restore' in s ? {} : { transition: 0.3 }) } as LightState);
      }
    } else {
      const from = natural ? -Infinity : this.lastT;
      for (const e of events) {
        if (e.t > t) break;
        if (e.t > from) cmds.set(e.deviceId, e.state);
      }
    }
    this.key = key;
    this.lastT = t;
    if (!cmds.size) return;
    const list = [...cmds].map(([deviceId, state]) => ({ deviceId, state }));
    for (const c of list) this.sent.set(c.deviceId, c.state);
    this.send(list);
  }

  /** Estado actual de cada luz (para mostrarlo en pantalla). */
  states(): Record<string, LightState> {
    return Object.fromEntries(this.sent);
  }

  /** Olvida lo enviado (tras devolver las luces a como estaban). */
  reset() {
    this.sent.clear();
    this.key = '';
    this.lastT = 0;
  }
}

// ───────────────────────── Home Assistant ─────────────────────────

/** Solo luces e interruptores/enchufes: nada de cerraduras, alarmas, climatización… */
export const HA_ENTITY_RE = /^(light|switch)\.[a-z0-9_]+$/;

export function isAllowedEntity(id: string): boolean {
  return HA_ENTITY_RE.test(id);
}

export interface HaCall {
  domain: 'light' | 'switch';
  service: 'turn_on' | 'turn_off';
  data: Record<string, unknown>;
}

function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0xffffff;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Llamada de Home Assistant para poner una luz en un estado (null = nada que hacer o «como estaba»). */
export function haCall(entityId: string, kind: LightKind, state: LightState): HaCall | null {
  if (!isAllowedEntity(entityId) || 'restore' in state) return null;
  const domain = entityId.split('.')[0] as 'light' | 'switch';
  if (domain === 'switch' || kind === 'plug') return { domain, service: state.on ? 'turn_on' : 'turn_off', data: { entity_id: entityId } };
  const transition = Math.round((state.transition ?? 0) * 10) / 10;
  if (!state.on) return { domain, service: 'turn_off', data: { entity_id: entityId, transition } };
  const data: Record<string, unknown> = { entity_id: entityId, brightness_pct: Math.max(1, Math.round(state.brightness * 100)), transition };
  if (kind === 'color') data.rgb_color = rgb(state.color);
  return { domain, service: 'turn_on', data };
}

/** Estado de una entidad tal como lo devuelve /api/states. */
export interface HaEntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
}

/** Llamada para dejar una entidad como estaba según la foto tomada antes del espectáculo. */
export function haRestoreCall(snap: HaEntityState): HaCall | null {
  const id = snap.entity_id;
  if (!isAllowedEntity(id) || (snap.state !== 'on' && snap.state !== 'off')) return null;
  const domain = id.split('.')[0] as 'light' | 'switch';
  if (domain === 'switch') return { domain, service: snap.state === 'on' ? 'turn_on' : 'turn_off', data: { entity_id: id } };
  if (snap.state === 'off') return { domain, service: 'turn_off', data: { entity_id: id, transition: 1 } };
  const a = snap.attributes ?? {};
  const data: Record<string, unknown> = { entity_id: id, transition: 1 };
  if (typeof a.brightness === 'number') data.brightness = a.brightness;
  const mode = a.color_mode;
  if (mode === 'color_temp' && typeof a.color_temp_kelvin === 'number') data.color_temp_kelvin = a.color_temp_kelvin;
  else if (mode === 'rgbww' && Array.isArray(a.rgbww_color)) data.rgbww_color = a.rgbww_color;
  else if (mode === 'rgbw' && Array.isArray(a.rgbw_color)) data.rgbw_color = a.rgbw_color;
  else if ((mode === 'hs' || mode === 'xy' || mode === 'rgb') && Array.isArray(a.hs_color)) data.hs_color = a.hs_color;
  return { domain, service: 'turn_on', data };
}

/** Tipo de luz que se deduce de una entidad de Home Assistant. */
export function kindFromEntity(e: HaEntityState): LightKind {
  if (e.entity_id.startsWith('switch.')) return 'plug';
  const modes = Array.isArray(e.attributes?.supported_color_modes) ? (e.attributes.supported_color_modes as string[]) : [];
  return modes.some((m) => ['hs', 'xy', 'rgb', 'rgbw', 'rgbww'].includes(m)) ? 'color' : 'white';
}

// ───────────────────────── Luces automáticas ─────────────────────────

/** Colores dominantes de una escena (los de sus efectos), para teñir las luces igual. */
function sceneColors(sc: Scene): string[] {
  const out: string[] = [];
  for (const c of sc.clips) if (c.source.type === 'effect') { out.push(c.source.color); if (c.source.color2) out.push(c.source.color2); }
  return out.filter((c) => /^#[0-9a-f]{6}$/i.test(c) && c.toLowerCase() !== '#000000' && c.toLowerCase() !== '#ffffff');
}

/**
 * Pista de luces automática para cada escena, según lo que pasa en ella: relámpagos en las tormentas,
 * parpadeo en las fiestas y fuegos artificiales, vela en el fuego y las velas, apagado en los sustos
 * y el color de los efectos en el resto. Sustituye las pistas de luces que hubiera.
 */
export function autoLights(show: Show, devices: LightDevice[]): Show {
  const sh: Show = JSON.parse(JSON.stringify(show));
  if (!devices.length) return sh;
  const color = devices.filter((d) => d.kind !== 'plug');
  const plugs = devices.filter((d) => d.kind === 'plug');
  const scenes = sh.scenes.filter((s) => s.enabled);
  scenes.forEach((sc, i) => {
    const fx = new Set(sc.clips.flatMap((c) => (c.source.type === 'effect' ? [c.source.effect] : [])));
    const name = sc.name.toLowerCase();
    const cols = sceneColors(sc);
    const c1 = cols[0] ?? '#ff6a00', c2 = cols.find((c) => c.toLowerCase() !== c1.toLowerCase()) ?? '#7a2cff';
    const D = sc.duration;
    const L: LightCue[] = [];
    const all = (p: Partial<LightCue>) => color.forEach((d, k) => L.push(createLightCue(d.id, { ...p, start: Math.min(D - 0.1, (p.start ?? 0) + (p.action === 'blink' ? k * 0.15 : 0)) })));
    const last = i === scenes.length - 1;
    if (last || /despedida|adi[oó]s|fin\b/.test(name)) {
      all({ action: 'color', color: '#ffb36b', brightness: 0.5, transition: 2 });
      plugs.forEach((d) => L.push(createLightCue(d.id, { action: 'color', start: 0 })));
      all({ action: 'restore', start: Math.max(0, D - 1) });
      plugs.forEach((d) => L.push(createLightCue(d.id, { action: 'restore', start: Math.max(0, D - 1) })));
    } else if (fx.has('powerFail') || /apag[oó]n|se va la luz/.test(name)) {
      // Las luces de casa fallan a la vez que la proyección y se apagan al final.
      all({ action: 'blink', color: '#d8f0ff', color2: '#000000', duration: D * 0.85, rate: 2.5, transition: 0 });
      all({ action: 'off', start: D * 0.88, transition: 0 });
      plugs.forEach((d) => L.push(createLightCue(d.id, { action: 'off', start: D * 0.88 })));
    } else if (fx.has('policeLights')) {
      all({ action: 'blink', color: '#ff1010', color2: '#1040ff', duration: D, rate: 1.6, transition: 0 });
      plugs.forEach((d) => L.push(createLightCue(d.id, { action: 'off' })));
    } else if (fx.has('bats') || fx.has('cobwebs') || fx.has('spiders')) {
      all({ action: 'candle', color: '#7a2cff', brightness: 0.45, duration: D, rate: 0.8 });
    } else if (fx.has('blood') || fx.has('handprints') || fx.has('claws') || /sangr/.test(name)) {
      all({ action: 'candle', color: '#a00010', brightness: 0.55, duration: D, rate: 1 });
      plugs.forEach((d) => L.push(createLightCue(d.id, { action: 'off' })));
    } else if (fx.has('lightning') || fx.has('cracks') || /tormenta|rayo|susto/.test(name)) {
      all({ action: 'color', color: '#1a2a6a', brightness: 0.25, transition: 1 });
      all({ action: 'flash', start: Math.min(1.5, D * 0.2), duration: Math.max(1, D - 2), rate: 0.6 });
      plugs.forEach((d) => L.push(createLightCue(d.id, { action: 'off' })));
    } else if (fx.has('fireworks') || fx.has('confetti') || fx.has('rainbow') || /fiesta|final/.test(name)) {
      all({ action: 'blink', color: c1, color2: c2, duration: D, rate: 1, transition: 0.3 });
      plugs.forEach((d) => L.push(createLightCue(d.id, { action: 'color' })));
    } else if (fx.has('fire') || fx.has('flicker') || fx.has('lanterns') || /vela|fuego|incendio|espera/.test(name)) {
      all({ action: 'candle', color: fx.has('fire') ? '#ff4a00' : '#ff8a2a', brightness: 0.7, duration: D, rate: 1.5 });
      plugs.forEach((d) => L.push(createLightCue(d.id, { action: 'off' })));
    } else if (fx.has('eyes') || fx.has('bigEye') || fx.has('shadowPass') || fx.has('spirits')) {
      all({ action: 'off', transition: 1.5 });
      plugs.forEach((d) => L.push(createLightCue(d.id, { action: 'off' })));
    } else {
      all({ action: 'color', color: c1, brightness: 0.6, transition: 1.5 });
    }
    sc.lights = L;
  });
  return sh;
}
