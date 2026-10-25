import { describe, it, expect } from 'vitest';
import { expandLightCue, lightEvents, sceneLoopLightEvents, lightStateAt, LightDriver, haCall, haRestoreCall, kindFromEntity, autoLights, isAllowedEntity, RESTORE, PLUG_MIN_INTERVAL, type LightState } from '../../src/shared/lights';
import { createShow, createScene, createLightCue, createLightDevice, effectSource, createClip } from '../../src/shared/factory';
import { Show } from '../../src/shared/model';
import { parseProject } from '../../src/shared/schema';

const tira = createLightDevice('Tira porche', 'color', 'light.tira_porche');
const enchufe = createLightDevice('Enchufe calabaza', 'plug', 'switch.calabaza');

function show2() {
  const sh = createShow('x', null);
  const a = createScene('A', 10);
  const b = createScene('B', 10);
  a.transition = { type: 'cut', duration: 0 };
  b.transition = { type: 'cut', duration: 0 };
  a.lights.push(createLightCue(tira.id, { action: 'color', color: '#ff0000', start: 1 }));
  b.lights.push(createLightCue('*', { action: 'off', start: 0 }));
  sh.scenes.push(a, b);
  return sh;
}

describe('pista de luces', () => {
  it('coloca las órdenes de cada escena en el tiempo del espectáculo y «*» llega a todas las luces', () => {
    const ev = lightEvents(show2(), [tira, enchufe]);
    expect(ev.map((e) => [e.t, e.deviceId])).toEqual([[1, tira.id], [10, tira.id], [10, enchufe.id]]);
    const s = lightStateAt(ev, 5).get(tira.id) as Extract<LightState, { on: true }>;
    expect(s.on && s.color).toBe('#ff0000');
    expect(lightStateAt(ev, 12).get(enchufe.id)).toEqual({ on: false, transition: 0.5 });
  });

  it('los relámpagos destellan en blanco y vuelven al color de fondo', () => {
    const sc = createScene('Tormenta', 6);
    sc.lights.push(createLightCue(tira.id, { action: 'color', color: '#112266', brightness: 0.3, start: 0 }));
    sc.lights.push(createLightCue(tira.id, { action: 'flash', start: 1, duration: 4, rate: 1 }));
    const ev = sceneLoopLightEvents(sc, [tira]);
    const peaks = ev.filter((e) => 'on' in e.state && e.state.on && e.state.color === '#ffffff');
    expect(peaks.length).toBeGreaterThanOrEqual(3);
    const after = ev[ev.indexOf(peaks[0]) + 1];
    expect(after.t).toBeCloseTo(peaks[0].t + 0.2, 5);
    expect('on' in after.state && after.state.on && after.state.color).toBe('#112266');
  });

  it('sin color de fondo, tras el destello la luz vuelve a como estaba en casa', () => {
    const sc = createScene('T', 4);
    sc.lights.push(createLightCue(tira.id, { action: 'flash', start: 0, duration: 2, rate: 1 }));
    const ev = sceneLoopLightEvents(sc, [tira]);
    expect(ev[1].state).toEqual(RESTORE);
  });

  it('los enchufes no parpadean deprisa ni hacen relámpagos', () => {
    const blink = createLightCue(enchufe.id, { action: 'blink', duration: 5, rate: 3 });
    const ev = expandLightCue(blink, 'plug', 10);
    for (let i = 1; i < ev.length; i++) expect(ev[i].t - ev[i - 1].t).toBeGreaterThanOrEqual(PLUG_MIN_INTERVAL - 1e-9);
    expect(expandLightCue(createLightCue(enchufe.id, { action: 'flash', duration: 5 }), 'plug', 10)).toEqual([]);
  });

  it('nada fuera de la escena: los efectos se recortan a su duración', () => {
    const ev = expandLightCue(createLightCue(tira.id, { action: 'candle', start: 2, duration: 30, rate: 2 }), 'color', 5);
    expect(ev.every((e) => e.t < 5)).toBe(true);
    expect(expandLightCue(createLightCue(tira.id, { start: 8 }), 'color', 5)).toEqual([]);
  });
});

describe('envío de órdenes', () => {
  it('envía cada orden una vez al pasar su instante y resincroniza al saltar', () => {
    const ev = lightEvents(show2(), [tira, enchufe]);
    const sent: string[] = [];
    const d = new LightDriver((c) => c.forEach((x) => sent.push(`${x.deviceId === tira.id ? 'tira' : 'enchufe'}:${'restore' in x.state ? 'restore' : x.state.on ? 'on' : 'off'}`)));
    d.update(ev, 'c0', 0);
    d.update(ev, 'c0', 0.5);
    expect(sent).toEqual([]);
    d.update(ev, 'c0', 1.02);
    d.update(ev, 'c0', 1.05);
    expect(sent).toEqual(['tira:on']);
    // salto adelante: estado directo del instante 15
    d.update(ev, 'c0', 15);
    expect(sent.slice(1).sort()).toEqual(['enchufe:off', 'tira:off']);
    // salto atrás al principio: la tira vuelve a como estaba y el enchufe también
    sent.length = 0;
    d.update(ev, 'c0', 0.2);
    expect(sent.sort()).toEqual(['enchufe:restore', 'tira:restore']);
    // nuevo ciclo que empieza desde 0: sigue con normalidad
    sent.length = 0;
    d.update(ev, 'c1', 0.01);
    d.update(ev, 'c1', 1.1);
    expect(sent).toEqual(['tira:on']);
    expect(Object.keys(d.states()).length).toBe(2);
  });
});

describe('Home Assistant', () => {
  it('solo acepta luces y enchufes', () => {
    expect(isAllowedEntity('light.tira_porche')).toBe(true);
    expect(isAllowedEntity('switch.calabaza')).toBe(true);
    expect(isAllowedEntity('lock.puerta')).toBe(false);
    expect(isAllowedEntity('alarm_control_panel.casa')).toBe(false);
    expect(isAllowedEntity('light.x/../../api')).toBe(false);
    expect(haCall('lock.puerta', 'plug', { on: true, color: '#fff', brightness: 1 })).toBeNull();
  });

  it('traduce estados a light.turn_on / turn_off y switch', () => {
    expect(haCall('light.tira', 'color', { on: true, color: '#ff8000', brightness: 0.5, transition: 0.25 })).toEqual({ domain: 'light', service: 'turn_on', data: { entity_id: 'light.tira', brightness_pct: 50, transition: 0.3, rgb_color: [255, 128, 0] } });
    expect(haCall('light.blanca', 'white', { on: true, color: '#ff8000', brightness: 1 })?.data).toEqual({ entity_id: 'light.blanca', brightness_pct: 100, transition: 0 });
    expect(haCall('light.tira', 'color', { on: false, transition: 1 })).toEqual({ domain: 'light', service: 'turn_off', data: { entity_id: 'light.tira', transition: 1 } });
    expect(haCall('switch.calabaza', 'plug', { on: true, color: '#fff', brightness: 1 })).toEqual({ domain: 'switch', service: 'turn_on', data: { entity_id: 'switch.calabaza' } });
    expect(haCall('light.tira', 'color', RESTORE)).toBeNull();
  });

  it('devuelve cada luz a como estaba', () => {
    expect(haRestoreCall({ entity_id: 'light.salon', state: 'off', attributes: {} })).toEqual({ domain: 'light', service: 'turn_off', data: { entity_id: 'light.salon', transition: 1 } });
    expect(haRestoreCall({ entity_id: 'light.salon', state: 'on', attributes: { brightness: 180, color_mode: 'color_temp', color_temp_kelvin: 2700 } })?.data).toEqual({ entity_id: 'light.salon', transition: 1, brightness: 180, color_temp_kelvin: 2700 });
    expect(haRestoreCall({ entity_id: 'light.tira', state: 'on', attributes: { brightness: 90, color_mode: 'hs', hs_color: [30, 100] } })?.data).toEqual({ entity_id: 'light.tira', transition: 1, brightness: 90, hs_color: [30, 100] });
    expect(haRestoreCall({ entity_id: 'switch.x', state: 'on', attributes: {} })).toEqual({ domain: 'switch', service: 'turn_on', data: { entity_id: 'switch.x' } });
    expect(haRestoreCall({ entity_id: 'light.rota', state: 'unavailable', attributes: {} })).toBeNull();
  });

  it('deduce el tipo de luz', () => {
    expect(kindFromEntity({ entity_id: 'switch.x', state: 'off', attributes: {} })).toBe('plug');
    expect(kindFromEntity({ entity_id: 'light.x', state: 'off', attributes: { supported_color_modes: ['xy', 'color_temp'] } })).toBe('color');
    expect(kindFromEntity({ entity_id: 'light.x', state: 'off', attributes: { supported_color_modes: ['brightness'] } })).toBe('white');
  });
});

describe('luces automáticas', () => {
  it('relámpagos en la tormenta, parpadeo en la fiesta y como estaba al final', () => {
    const sh = createShow('x', null);
    const t = createScene('Tormenta', 8);
    t.clips.push(createClip('s', effectSource('lightning')));
    const f = createScene('Fiesta', 8);
    f.clips.push(createClip('s', effectSource('fireworks')));
    const fin = createScene('Despedida', 6);
    sh.scenes.push(t, f, fin);
    const out = autoLights(sh, [tira, enchufe]);
    expect(() => Show.parse(out)).not.toThrow();
    expect(out.scenes[0].lights.some((c) => c.action === 'flash' && c.deviceId === tira.id)).toBe(true);
    expect(out.scenes[0].lights.some((c) => c.action === 'flash' && c.deviceId === enchufe.id)).toBe(false);
    expect(out.scenes[1].lights.some((c) => c.action === 'blink')).toBe(true);
    expect(out.scenes[2].lights.filter((c) => c.action === 'restore').length).toBe(2);
    // el original no cambia
    expect(sh.scenes[0].lights).toEqual([]);
  });
});

describe('esquema', () => {
  it('un proyecto de la versión 6 se abre con luces vacías', () => {
    const doc = { schemaVersion: 6, id: 'p', name: 'x', createdAt: 'a', updatedAt: 'a', shows: [{ id: 's', name: 's', installationId: null, createdAt: 'a', updatedAt: 'a', scenes: [{ id: 'c', name: 'c' }] }] };
    const { project, migratedFrom } = parseProject(doc);
    expect(migratedFrom).toBe(6);
    expect(project.lights).toEqual([]);
    expect(project.shows[0].scenes[0].lights).toEqual([]);
  });
});
