import { describe, it, expect } from 'vitest';
import {
  squareToQuad, invert3, applyH, quadToQuad, orderQuad, isValidQuad, isSelfIntersecting, sortByAngle,
  triangulate, pointInPolygon, nearestEdge, rescaleInstallation, surfaceAspect, rectQuad, validateInstallation,
  signedArea, translateGroup, isGroupMaster, followGroupQuad, groupMasterOf,
} from '../../src/shared/geometry';
import { createInstallation, createSurface } from '../../src/shared/factory';

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('homografía', () => {
  const quad = [{ x: 0.1, y: 0.2 }, { x: 0.6, y: 0.15 }, { x: 0.7, y: 0.9 }, { x: 0.05, y: 0.8 }];
  it('lleva las esquinas del cuadrado unidad a las del cuadrilátero', () => {
    const H = squareToQuad(quad);
    const corners = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    corners.forEach((c, i) => {
      const p = applyH(H, c);
      close(p.x, quad[i].x); close(p.y, quad[i].y);
    });
  });
  it('la inversa devuelve el punto original (perspectiva)', () => {
    const H = squareToQuad(quad);
    const Hi = invert3(H);
    for (const u of [0, 0.25, 0.5, 0.9]) for (const v of [0, 0.3, 1]) {
      const p = applyH(Hi, applyH(H, { x: u, y: v }));
      close(p.x, u); close(p.y, v);
    }
  });
  it('un rectángulo produce una transformación afín (g=h=0)', () => {
    const H = squareToQuad(rectQuad(0.2, 0.3, 0.4, 0.5));
    close(H[6], 0); close(H[7], 0);
    const c = applyH(H, { x: 0.5, y: 0.5 });
    close(c.x, 0.4); close(c.y, 0.55);
  });
  it('perspectiva real: el centro uv cae en el cruce de las diagonales del trapecio', () => {
    const trap = [{ x: 0.4, y: 0 }, { x: 0.6, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    const c = applyH(squareToQuad(trap), { x: 0.5, y: 0.5 });
    close(c.x, 0.5);
    close(c.y, 1 / 6); // intersección de diagonales, no el punto medio (una deformación afín daría 0.5)
  });
  it('quadToQuad mapea cuadrilátero a cuadrilátero', () => {
    const a = rectQuad(0, 0, 1, 1);
    const H = quadToQuad(a, quad);
    const p = applyH(H, { x: 1, y: 1 });
    close(p.x, 0.7); close(p.y, 0.9);
  });
  it('lanza error con cuadriláteros degenerados', () => {
    expect(() => invert3(squareToQuad([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]))).toThrow();
  });
});

describe('cuadriláteros y polígonos', () => {
  it('reordena esquinas cruzadas como TL, TR, BR, BL', () => {
    const q = orderQuad([{ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 0 }]);
    expect(q).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]);
    expect(isValidQuad(q)).toBe(true);
  });
  it('detecta cuadriláteros cruzados (pajarita)', () => {
    const bow = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
    expect(isValidQuad(bow)).toBe(false);
    expect(isSelfIntersecting(bow)).toBe(true);
    expect(isSelfIntersecting(sortByAngle(bow))).toBe(false);
  });
  it('triangula un polígono cóncavo irregular (arco)', () => {
    const arch = [
      { x: 0, y: 1 }, { x: 0, y: 0.4 }, { x: 0.15, y: 0.1 }, { x: 0.5, y: 0 }, { x: 0.85, y: 0.1 }, { x: 1, y: 0.4 }, { x: 1, y: 1 },
      { x: 0.6, y: 1 }, { x: 0.6, y: 0.6 }, { x: 0.4, y: 0.6 }, { x: 0.4, y: 1 },
    ];
    const tris = triangulate(arch);
    expect(tris.length).toBe((arch.length - 2) * 3);
    // el área de los triángulos coincide con el área del polígono
    let area = 0;
    for (let i = 0; i < tris.length; i += 3) area += Math.abs(signedArea([arch[tris[i]], arch[tris[i + 1]], arch[tris[i + 2]]]));
    close(area, Math.abs(signedArea(arch)), 1e-9);
  });
  it('point in polygon y arista más cercana', () => {
    const sq = rectQuad(0, 0, 1, 1);
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, sq)).toBe(true);
    expect(pointInPolygon({ x: 1.5, y: 0.5 }, sq)).toBe(false);
    const e = nearestEdge({ x: 0.5, y: -0.1 }, sq);
    expect(e.index).toBe(0);
    close(e.point.y, 0);
  });
  it('coordenadas en los límites (0 y 1) son válidas', () => {
    expect(isValidQuad(rectQuad(0, 0, 1, 1))).toBe(true);
    const H = invert3(squareToQuad(rectQuad(0, 0, 1, 1)));
    const p = applyH(H, { x: 1, y: 1 });
    close(p.x, 1); close(p.y, 1);
  });
});

describe('instalaciones', () => {
  it('estima la proporción de la superficie en píxeles de salida', () => {
    const s = createSurface('V', 'window', 0, { x: 0, y: 0, w: 0.5, h: 0.5 });
    close(surfaceAspect(s, { width: 1920, height: 1080 }), 1920 / 1080, 1e-9);
    expect(surfaceAspect({ ...s, aspect: 0.5 }, { width: 1920, height: 1080 })).toBe(0.5);
  });
  it('cambio de resolución manteniendo píxeles', () => {
    const inst = createInstallation('Casa', { width: 1000, height: 1000 });
    inst.surfaces.push(createSurface('V', 'window', 0, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }));
    const r = rescaleInstallation(inst, { width: 2000, height: 1000 }, 'keep-pixels');
    close(r.surfaces[0].quad[0].x, 0.25); close(r.surfaces[0].quad[0].y, 0.5);
    const k = rescaleInstallation(inst, { width: 2000, height: 1000 }, 'keep-relative');
    close(k.surfaces[0].quad[0].x, 0.5);
    expect(k.output.width).toBe(2000);
  });
  it('valida perfiles incompletos o defectuosos', () => {
    const inst = createInstallation('Vacía');
    expect(validateInstallation(inst).length).toBe(1);
    const s = createSurface('Mal', 'door', 0);
    s.quad = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
    inst.surfaces.push(s);
    expect(validateInstallation(inst).some((i) => i.level === 'error')).toBe(true);
  });
});

describe('mover un grupo de superficies', () => {
  const mk = () => {
    const a = createSurface('A', 'decor', 0), b = createSurface('B', 'decor', 1), c = createSurface('C', 'decor', 2), d = createSurface('D', 'decor', 3);
    a.group = b.group = c.group = 'Balaustrada';
    a.groupMove = b.groupMove = c.groupMove = true;
    c.locked = true;
    return [a, b, c, d];
  };
  it('mueve las del mismo grupo y respeta bloqueadas y las de otro grupo', () => {
    const l = mk(); const antes = l.map((s) => s.quad[0].x);
    translateGroup(l, l[0].id, 0.1, 0);
    close(l[0].quad[0].x, antes[0] + 0.1); close(l[1].quad[0].x, antes[1] + 0.1);
    close(l[2].quad[0].x, antes[2]); close(l[3].quad[0].x, antes[3]);
  });
  it('un grupo que es solo una etiqueta (sin «mover juntas») no arrastra a las demás', () => {
    const l = mk(); l.forEach((s) => { s.groupMove = false; });
    const antes = l.map((s) => s.quad[0].x);
    translateGroup(l, l[0].id, 0.1, 0);
    close(l[0].quad[0].x, antes[0] + 0.1); close(l[1].quad[0].x, antes[1]);
  });
  it('con solo mueve únicamente la indicada, y sin grupo también', () => {
    const l = mk(); const antes = l.map((s) => s.quad[0].x);
    translateGroup(l, l[0].id, 0.1, 0, true);
    close(l[1].quad[0].x, antes[1]);
    translateGroup(l, l[3].id, 0.1, 0);
    close(l[3].quad[0].x, antes[3] + 0.1);
  });
});

describe('estirar un grupo desde su pieza principal', () => {
  const mk = () => {
    const fondo = createSurface('Fondo', 'decor', 0, { x: 0.2, y: 0.2, w: 0.4, h: 0.2 });
    const pil = createSurface('Pilar', 'decor', 1, { x: 0.3, y: 0.25, w: 0.1, h: 0.1 });
    const otro = createSurface('Otro', 'decor', 2, { x: 0.7, y: 0.7, w: 0.1, h: 0.1 });
    fondo.group = pil.group = 'Balaustrada';
    fondo.groupMove = pil.groupMove = true;
    return [fondo, pil, otro];
  };
  it('al elegir una pieza del grupo se selecciona la principal; las sueltas, ellas mismas', () => {
    const l = mk();
    expect(groupMasterOf(l, l[1]).id).toBe(l[0].id);
    expect(groupMasterOf(l, l[2]).id).toBe(l[2].id);
    l[1].groupMove = false;
    expect(groupMasterOf(l, l[1]).id).toBe(l[1].id);
  });
  it('la pieza más grande es la principal', () => {
    const l = mk();
    expect(isGroupMaster(l, l[0].id)).toBe(true);
    expect(isGroupMaster(l, l[1].id)).toBe(false);
    expect(isGroupMaster(l, l[2].id)).toBe(false);
  });
  it('las demás siguen al estirar la principal y las de otro grupo no se tocan', () => {
    const l = mk();
    const origs = structuredClone(l);
    const nq = structuredClone(l[0].quad);
    nq[2] = { x: 1.0, y: 0.4 }; nq[1] = { x: 1.0, y: 0.2 };
    l[0].quad = nq;
    followGroupQuad(l, l[0].id, origs, l[0].quad);
    // el pilar estaba a un cuarto del ancho del fondo: ahora sigue estándolo
    close(l[1].quad[0].x, 0.2 + (0.3 - 0.2) * 2, 1e-6);
    close(l[2].quad[0].x, origs[2].quad[0].x);
  });
});
