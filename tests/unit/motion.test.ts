import { describe, it, expect } from 'vitest';
import { evaluateMotion } from '../../src/shared/motion';

describe('movimiento «baja de arriba y se va por un lado»', () => {
  const m = (preset: 'dropExitLeft' | 'dropExitRight') => ({ preset, intensity: 1, speed: 1 });
  it('al empezar está por encima y, al acabar, fuera por el lado', () => {
    const ini = evaluateMotion(m('dropExitLeft'), 0, 4);
    expect(ini.dy).toBeLessThan(-0.8);
    const medio = evaluateMotion(m('dropExitLeft'), 2, 4);
    expect(medio.dy).toBeCloseTo(0, 5);
    expect(medio.dx).toBeCloseTo(0, 5);
    const fin = evaluateMotion(m('dropExitLeft'), 3.99, 4);
    expect(fin.dx).toBeLessThan(-0.9);
    expect(evaluateMotion(m('dropExitRight'), 3.99, 4).dx).toBeGreaterThan(0.9);
  });
});
