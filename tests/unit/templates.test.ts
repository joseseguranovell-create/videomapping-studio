import { describe, it, expect } from 'vitest';
import { applyTemplate, orderedSurfaces, lightningStrikes, TEMPLATE_KINDS } from '../../src/shared/templates';
import { createInstallation, createSurface, createScene } from '../../src/shared/factory';
import { Clip, SoundCue } from '../../src/shared/model';

function casa() {
  const inst = createInstallation('Casa');
  inst.surfaces.push(createSurface('Derecha', 'window', 0, { x: 0.7, y: 0.2, w: 0.1, h: 0.1 }));
  inst.surfaces.push(createSurface('Izquierda', 'window', 1, { x: 0.1, y: 0.2, w: 0.1, h: 0.1 }));
  inst.surfaces.push(createSurface('Centro', 'door', 2, { x: 0.4, y: 0.5, w: 0.1, h: 0.3 }));
  const oculta = createSurface('Oculta', 'window', 3);
  oculta.visible = false;
  inst.surfaces.push(oculta);
  return inst;
}

describe('plantillas de escena', () => {
  it('ordena las superficies visibles de izquierda a derecha', () => {
    expect(orderedSurfaces(casa()).map((s) => s.name)).toEqual(['Izquierda', 'Centro', 'Derecha']);
  });
  it('todas las plantillas generan clips válidos dentro de la escena', () => {
    const inst = casa();
    const sc = createScene('S', 10);
    for (const k of TEMPLATE_KINDS) {
      const r = applyTemplate(k, inst, sc, { thunderAssetId: 'trueno' });
      expect(r.clips.length, k).toBeGreaterThanOrEqual(3);
      for (const c of r.clips) {
        Clip.parse(c);
        expect(c.start).toBeGreaterThanOrEqual(0);
        expect(c.start + c.duration).toBeLessThanOrEqual(10 + 1e-9);
        expect(inst.surfaces.filter((s) => s.visible).map((s) => s.id)).toContain(c.surfaceId);
      }
      r.sounds.forEach((s) => SoundCue.parse(s));
    }
  });
  it('la cascada se escalona de izquierda a derecha', () => {
    const inst = casa();
    const r = applyTemplate('cascadaLuz', inst, createScene('S', 10));
    const byName = (n: string) => r.clips.find((c) => c.surfaceId === inst.surfaces.find((s) => s.name === n)!.id)!.start;
    expect(byName('Izquierda')).toBeLessThan(byName('Centro'));
    expect(byName('Centro')).toBeLessThan(byName('Derecha'));
  });
  it('el neón se dibuja y después queda encendido', () => {
    const r = applyTemplate('neonDibujo', casa(), createScene('S', 12));
    const effects = r.clips.map((c) => (c.source.type === 'effect' ? c.source.effect : ''));
    expect(effects.filter((e) => e === 'drawOn')).toHaveLength(3);
    expect(effects.filter((e) => e === 'neon')).toHaveLength(3);
  });
  it('la tormenta añade un trueno tras cada relámpago', () => {
    const sc = createScene('S', 12);
    const r = applyTemplate('tormenta', casa(), sc, { thunderAssetId: 'trueno' });
    const strikes = lightningStrikes(12).filter((t) => t + 0.4 < 12);
    expect(r.sounds).toHaveLength(strikes.length);
    expect(r.sounds[0].start).toBeCloseTo(strikes[0] + 0.35);
    expect(applyTemplate('tormenta', casa(), sc).sounds).toHaveLength(0);
  });
  it('respeta un instante de inicio', () => {
    const r = applyTemplate('barrido', casa(), createScene('S', 10), { start: 4 });
    expect(Math.min(...r.clips.map((c) => c.start))).toBe(4);
  });
});
