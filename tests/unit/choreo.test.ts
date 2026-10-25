import { describe, it, expect } from 'vitest';
import { choreography, heroFrame } from '../../src/shared/choreo';
import { Clip } from '../../src/shared/model';
import { createInstallation, createSurface } from '../../src/shared/factory';
import { travelPoint, travelMatrix } from '../../src/shared/timeline';
import { applyH } from '../../src/shared/geometry';

function inst() {
  const i = createInstallation('Casa', { width: 1280, height: 720 });
  i.surfaces.push(createSurface('Pared', 'wall', 0, { x: 0.1, y: 0.4, w: 0.8, h: 0.6 }));
  i.surfaces.push(createSurface('Izquierda', 'window', 1, { x: 0.2, y: 0.57, w: 0.27, h: 0.26 }));
  i.surfaces.push(createSurface('Centro', 'window', 2, { x: 0.5, y: 0.57, w: 0.1, h: 0.26 }));
  i.surfaces.push(createSurface('Derecha', 'window', 3, { x: 0.66, y: 0.58, w: 0.23, h: 0.26 }));
  return i;
}
const actor = { name: 'Bruja', source: { type: 'asset' as const, assetId: 'v' }, aspect: 0.5625 };

describe('coreografías entre ventanas', () => {
  it('asomarse y pasar: se asoma en una, cruza por detrás y saluda en la otra, sin huecos', () => {
    const I = inst();
    const [, A, C, B] = I.surfaces;
    const r = choreography({ kind: 'pasar', installation: I, actor, surfaces: [A, B], start: 1, sounds: { whoosh: 'w' } });
    expect(r.clips.every((c) => Clip.safeParse(c).success)).toBe(true);
    const travel = r.clips.find((c) => c.travel)!;
    expect(travel.travel!.from.x).toBeGreaterThan(0.47);          // sale por el borde derecho de la izquierda
    expect(travel.travel!.to.x).toBeLessThan(0.66);               // llega al borde izquierdo de la derecha
    expect(travel.travel!.surfaces).toEqual([C.id]);               // por el camino solo se ve en la del centro
    expect(r.clips.at(-1)!.surfaceId).toBe(B.id);
    // continuidad: cada parte empieza cuando acaba (o justo antes) la anterior
    for (let k = 1; k < r.clips.length; k++) expect(r.clips[k].start).toBeLessThanOrEqual(r.clips[k - 1].start + r.clips[k - 1].duration + 1e-9);
    expect(r.sounds[0].assetId).toBe('w');
  });
  it('escondite: una aparición por ventana, en orden', () => {
    const I = inst();
    const w = I.surfaces.filter((s) => s.kind === 'window');
    const r = choreography({ kind: 'escondite', installation: I, actor, surfaces: w, start: 0 });
    expect(r.clips.map((c) => c.surfaceId)).toEqual(w.map((s) => s.id));
    expect(r.clips[1].start).toBeGreaterThan(r.clips[0].start);
  });
  it('lanzar: vuela en arco de centro a centro y aterriza en el destino', () => {
    const I = inst();
    const [, A, , B] = I.surfaces;
    const r = choreography({ kind: 'lanzar', installation: I, actor: { ...actor, aspect: 1 }, surfaces: [A, B], start: 0 });
    const t = r.clips[0].travel!;
    const mid = travelPoint(t, 0.5);
    expect(mid.y).toBeLessThan(Math.min(t.from.y, t.to.y)); // sube en el arco
    expect(r.clips[1].surfaceId).toBe(B.id);
  });
  it('encuadre: los vídeos verticales en ventanas apaisadas van de cintura para arriba', () => {
    const I = inst();
    expect(heroFrame(0.5625, I.surfaces[1], I).scale).toBeGreaterThan(2);
    expect(heroFrame(1, I.surfaces[1], I).scale).toBeLessThan(1);
  });
  it('la matriz de viaje lleva el centro del clip al centro del contenido', () => {
    const M = travelMatrix({ x: 0.3, y: 0.6 }, 0.25, 0.5, 16 / 9, { rotation: 0, flipX: false });
    const c = applyH(M, { x: 0.3, y: 0.6 });
    expect(c.x).toBeCloseTo(0.5);
    expect(c.y).toBeCloseTo(0.5);
    const top = applyH(M, { x: 0.3, y: 0.6 - 0.125 });
    expect(top.y).toBeCloseTo(0);
  });
});
