import { describe, it, expect } from 'vitest';
import { detectSurfaces } from '../../src/shared/detect';
import { fitCrop, cropStyle, cropSource } from '../../src/shared/crop';

/** Imagen sintética: pared clara con dos ventanas oscuras rectangulares. */
function wall(w: number, h: number, rects: [number, number, number, number][]) {
  const g = new Uint8Array(w * h).fill(170);
  for (const [x0, y0, x1, y1] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) g[y * w + x] = 40;
  return g;
}

describe('detectSurfaces', () => {
  it('encuentra ventanas oscuras sobre una pared clara', () => {
    const w = 320, h = 240;
    const r = detectSurfaces(wall(w, h, [[60, 60, 120, 130], [190, 60, 250, 130]]), w, h);
    expect(r.length).toBe(2);
    expect(r[0].x).toBeCloseTo(60 / w, 1);
    expect(r[1].x).toBeCloseTo(190 / w, 1);
  });
  it('clasifica como puerta lo muy alto y estrecho', () => {
    const w = 320, h = 240;
    const r = detectSurfaces(wall(w, h, [[140, 80, 175, 200]]), w, h);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe('door');
  });
  it('no inventa nada en una imagen lisa', () => {
    expect(detectSurfaces(new Uint8Array(200 * 150).fill(100), 200, 150)).toEqual([]);
  });
});

describe('encuadre de la foto', () => {
  it('el encuadre mantiene la proporción de la salida y cabe en la foto', () => {
    const c = fitCrop(775, 1033, 16 / 9, 0.5, 0.9);
    expect((c.w * 775) / (c.h * 1033)).toBeCloseTo(16 / 9, 3);
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.y + c.h).toBeLessThanOrEqual(1 + 1e-9);
  });
  it('sin encuadre se muestra la foto entera', () => {
    expect(cropStyle(null).width).toBe('100%');
    expect(cropSource(null, 800, 600)).toEqual([0, 0, 800, 600]);
  });
  it('con encuadre se amplía la zona elegida', () => {
    const s = cropStyle({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
    expect(s.width).toBe('200%');
    expect(s.left).toBe('-50%');
  });
});
