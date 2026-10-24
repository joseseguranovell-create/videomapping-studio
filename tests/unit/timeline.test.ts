import { describe, it, expect } from 'vitest';
import { layoutShow, sceneWeight, evaluateClipsAt, cycleTime, audioCues, mediaTime, contentMatrix, activeSlot, sceneLoopLayout, sceneLoopCues, loopTime, textMaxScale } from '../../src/shared/timeline';
import { applyH } from '../../src/shared/geometry';
import { evaluateMotion } from '../../src/shared/motion';
import { MOTION_PRESETS } from '../../src/shared/model';
import { createShow, createScene, createClip, createSoundCue } from '../../src/shared/factory';

function show3() {
  const sh = createShow('Test', null);
  const a = createScene('A', 10); a.transition = { type: 'fade', duration: 1 };
  const b = createScene('B', 6); b.transition = { type: 'crossfade', duration: 2 };
  const c = createScene('C', 4); c.transition = { type: 'cut', duration: 0 };
  sh.scenes = [a, b, c];
  return sh;
}

describe('maquetación de escenas', () => {
  it('encadena escenas y solapa los fundidos cruzados', () => {
    const L = layoutShow(show3());
    expect(L.slots.map((s) => [s.start, s.end])).toEqual([[0, 10], [8, 14], [14, 18]]);
    expect(L.duration).toBe(18);
    expect(L.slots[0].fadeIn).toBe(1);
    expect(L.slots[0].crossOut).toBe(2);
    expect(L.slots[1].crossIn).toBe(2);
    expect(L.slots[2].fadeOut).toBe(1); // cierre del bucle
  });
  it('los pesos del fundido cruzado suman 1', () => {
    const L = layoutShow(show3());
    for (const t of [8.1, 9, 9.9]) {
      expect(sceneWeight(L.slots[0], t) + sceneWeight(L.slots[1], t)).toBeCloseTo(1, 9);
    }
    expect(sceneWeight(L.slots[0], 0.5)).toBeCloseTo(0.5);
  });
  it('omite escenas desactivadas', () => {
    const sh = show3(); sh.scenes[1].enabled = false;
    const L = layoutShow(sh);
    expect(L.slots.length).toBe(2);
    expect(L.duration).toBe(14);
  });
  it('la escena activa es la de mayor peso', () => {
    const L = layoutShow(show3());
    expect(activeSlot(L, 8.5)?.scene.name).toBe('A');
    expect(activeSlot(L, 9.5)?.scene.name).toBe('B');
    expect(activeSlot(L, 20)).toBeNull();
  });
});

describe('reloj y bucle', () => {
  it('repite con pausa en negro', () => {
    const sh = show3(); sh.loop = true; sh.loopGap = 2;
    const L = layoutShow(sh);
    expect(cycleTime(sh, L, 5)).toMatchObject({ time: 5, cycle: 0, inGap: false });
    expect(cycleTime(sh, L, 19)).toMatchObject({ cycle: 0, inGap: true });
    expect(cycleTime(sh, L, 21)).toMatchObject({ time: 1, cycle: 1, inGap: false });
    expect(cycleTime(sh, L, 20 * 1000 + 5).time).toBeCloseTo(5); // reproducción prolongada sin deriva
  });
  it('sin bucle termina', () => {
    const sh = show3(); sh.loop = false;
    expect(cycleTime(sh, layoutShow(sh), 30).ended).toBe(true);
  });
  it('tiempo de medio con bucle y sin bucle', () => {
    expect(mediaTime(7, 1, true, 3)).toBeCloseTo(1);
    expect(mediaTime(7, 2, true, 3)).toBeCloseTo(2);
    expect(mediaTime(7, 1, false, 3)).toBeCloseTo(2.96);
    expect(mediaTime(7, 1, true, null)).toBe(7);
  });
});

describe('clips', () => {
  it('activa clips según su tiempo y aplica fundidos', () => {
    const sh = show3();
    const clip = createClip('s1', { type: 'asset', assetId: 'a1' }, { start: 2, duration: 2, fadeIn: 0.5, fadeOut: 0.5 });
    sh.scenes[0].clips.push(clip);
    const L = layoutShow(sh);
    expect(evaluateClipsAt(L, 1)).toHaveLength(0);
    const e = evaluateClipsAt(L, 2.25);
    expect(e).toHaveLength(1);
    expect(e[0].opacity).toBeCloseTo(0.5);
    expect(evaluateClipsAt(L, 3)[0].opacity).toBeCloseTo(1);
    expect(evaluateClipsAt(L, 4)).toHaveLength(0);
    // pre-carga: aparece antes con opacidad 0
    const pre = evaluateClipsAt(L, 1, 1.5);
    expect(pre).toHaveLength(1);
    expect(pre[0].opacity).toBe(0);
  });
  it('todos los movimientos predefinidos devuelven valores finitos', () => {
    for (const preset of MOTION_PRESETS) for (const t of [0, 0.1, 1, 2.5, 4.99]) {
      const m = evaluateMotion({ preset, intensity: 1, speed: 1 }, t, 5);
      for (const v of Object.values(m)) expect(Number.isFinite(v)).toBe(true);
    }
  });
  it('popIn empieza invisible (escala 0) y termina a escala 1', () => {
    expect(evaluateMotion({ preset: 'popIn', intensity: 1, speed: 1 }, 0, 5).scale).toBeCloseTo(0);
    expect(evaluateMotion({ preset: 'popIn', intensity: 1, speed: 1 }, 3, 5).scale).toBeCloseTo(1);
  });
});

describe('matriz de contenido', () => {
  it('stretch ocupa la superficie completa', () => {
    const M = contentMatrix({ fit: 'stretch', x: 0.5, y: 0.5, scale: 1, rotation: 0, flipX: false }, 2, 1);
    const p = applyH(M, { x: 0, y: 0 });
    expect(p.x).toBeCloseTo(0); expect(p.y).toBeCloseTo(0);
    const q = applyH(M, { x: 1, y: 1 });
    expect(q.x).toBeCloseTo(1); expect(q.y).toBeCloseTo(1);
  });
  it('contain respeta la proporción (contenido cuadrado en superficie 2:1)', () => {
    const M = contentMatrix({ fit: 'contain', x: 0.5, y: 0.5, scale: 1, rotation: 0, flipX: false }, 2, 1);
    // el contenido ocupa x de 0.25 a 0.75 en uv
    expect(applyH(M, { x: 0.25, y: 0 }).x).toBeCloseTo(0);
    expect(applyH(M, { x: 0.75, y: 1 }).x).toBeCloseTo(1);
    expect(applyH(M, { x: 0.1, y: 0.5 }).x).toBeLessThan(0); // fuera: no se dibuja
  });
  it('rotación de 90º sin deformar en superficie no cuadrada', () => {
    const M = contentMatrix({ fit: 'contain', x: 0.5, y: 0.5, scale: 0.5, rotation: 90, flipX: false }, 2, 1);
    const c = applyH(M, { x: 0.5, y: 0.5 });
    expect(c.x).toBeCloseTo(0.5); expect(c.y).toBeCloseTo(0.5);
  });
  it('flipX invierte horizontalmente', () => {
    const M = contentMatrix({ fit: 'stretch', x: 0.5, y: 0.5, scale: 1, rotation: 0, flipX: true }, 1, 1);
    expect(applyH(M, { x: 0, y: 0.5 }).x).toBeCloseTo(1);
  });
});

describe('audio', () => {
  it('genera cues absolutos de música y efectos', () => {
    const sh = show3();
    sh.music.push({ id: 'm', assetId: 'mus', start: 0, volume: 1, fadeIn: 1, fadeOut: 1, loop: true });
    sh.scenes[1].sounds.push(createSoundCue('boo', { start: 1 }));
    sh.scenes[1].sounds.push(createSoundCue('bell', { start: 1, continueAfterScene: true }));
    const cues = audioCues(sh);
    const music = cues.find((c) => c.kind === 'music')!;
    expect(music.end).toBe(18);
    const boo = cues.find((c) => c.assetId === 'boo')!;
    expect(boo.start).toBe(9); // escena B empieza en 8
    expect(boo.end).toBe(14);
    expect(cues.find((c) => c.assetId === 'bell')!.end).toBeNull();
  });
});

describe('modo directo (escena en bucle)', () => {
  it('la escena suelta se repite sin fundido de escena y conserva sus clips', () => {
    const sh = show3();
    const b = sh.scenes[1];
    b.clips = [createClip('s1', { type: 'effect', effect: 'glow', color: '#ffffff', color2: '#000000', width: 6, space: 'surface' }, { start: 0, duration: 6, fadeIn: 0, fadeOut: 0 })];
    const L = sceneLoopLayout(b);
    expect(L.duration).toBe(6);
    expect(L.slots[0]).toMatchObject({ fadeIn: 0, fadeOut: 0, crossIn: 0, crossOut: 0 });
    // al principio de cada vuelta ya se ve entera (en el espectáculo empezaría fundiéndose)
    expect(evaluateClipsAt(L, 0.01)[0].opacity).toBeCloseTo(1);
    expect(b.transition.type).toBe('crossfade'); // no modifica la escena original
  });
  it('cuenta las vueltas', () => {
    expect(loopTime(13, 6)).toEqual({ time: 1, loop: 2 });
    expect(loopTime(-1, 6)).toEqual({ time: 0, loop: 0 });
    expect(loopTime(5, 0)).toEqual({ time: 0, loop: 0 });
  });
  it('los sonidos de la escena van sin la música del espectáculo', () => {
    const sh = show3();
    sh.music = [{ id: 'm', assetId: 'mus', start: 0, volume: 1, fadeIn: 0, fadeOut: 0, loop: true }];
    sh.scenes[2].sounds = [createSoundCue('pop', { start: 1 })];
    const cues = sceneLoopCues(sh.scenes[2]);
    expect(cues.map((c) => [c.assetId, c.start, c.kind])).toEqual([['pop', 1, 'sfx']]);
  });
});

describe('rótulos que caben', () => {
  it('un texto largo no se sale de la superficie aunque se pida más escala', () => {
    // superficie 4:1 y texto 6:1 (más ancho): a escala 1 ya ocupa todo el ancho
    expect(textMaxScale({ fit: 'contain', x: 0.5, y: 0.5 }, 4, 6)).toBeCloseTo(0.96);
    // texto corto (2:1) en la misma superficie: puede crecer hasta llenar el alto (con margen para el halo)
    expect(textMaxScale({ fit: 'contain', x: 0.5, y: 0.5 }, 4, 2)).toBeCloseTo(1.15);
    // desplazado a la derecha, tiene menos sitio
    expect(textMaxScale({ fit: 'contain', x: 0.75, y: 0.5 }, 4, 6)).toBeCloseTo(0.48);
  });
});
