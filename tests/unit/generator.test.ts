import { describe, it, expect } from 'vitest';
import { generateShow, SHOW_STYLES, soundKitFrom, type Protagonist } from '../../src/shared/generator';
import { Show } from '../../src/shared/model';
import { createInstallation, createSurface } from '../../src/shared/factory';
import { layoutShow } from '../../src/shared/timeline';

function house() {
  const inst = createInstallation('Casa');
  const add = (name: string, kind: any, x: number, y: number, w: number, h: number) => {
    const s = createSurface(name, kind, inst.surfaces.length, { x, y, w, h });
    inst.surfaces.push(s);
    return s;
  };
  add('Pared', 'wall', 0.1, 0.38, 0.9, 0.6);
  add('Franja', 'wall', 0.1, 0.23, 0.88, 0.15);
  add('Barandilla izq', 'decor', 0.17, 0.02, 0.37, 0.2);
  add('Barandilla der', 'decor', 0.6, 0.02, 0.32, 0.2);
  add('Ventana izq', 'window', 0.21, 0.57, 0.27, 0.26);
  add('Ventana der', 'window', 0.66, 0.58, 0.23, 0.26);
  add('Puerta', 'door', 0.02, 0.57, 0.07, 0.41);
  return inst;
}
const heroes: Protagonist[] = [
  { name: 'Bruja', assetId: 'v1', aspect: 0.5625, duration: 6, audioId: 'a1' },
  { name: 'Monja', assetId: 'v2', aspect: 0.5625, duration: 6 },
  { name: 'Payaso', assetId: 'v3', aspect: 0.5625, duration: 6 },
  { name: 'Calabaza', assetId: 'img', aspect: 1, duration: null },
];

describe('asistente de espectáculos', () => {
  for (const style of SHOW_STYLES) {
    it(`compone un espectáculo válido (${style})`, () => {
      const inst = house();
      const sh = generateShow({ style, name: 'Prueba', installation: inst, protagonists: heroes, duration: 120, finaleText: '¡Feliz noche!', sounds: { stinger: 's', pop: 'p', sparkle: 'k', music: 'm' } });
      expect(() => Show.parse(sh)).not.toThrow();
      const ids = new Set(inst.surfaces.map((s) => s.id));
      const clips = sh.scenes.flatMap((s) => s.clips);
      expect(clips.every((c) => ids.has(c.surfaceId))).toBe(true);
      // cada protagonista aparece al menos una vez y su sonido propio va con él
      for (const h of heroes) expect(clips.some((c) => c.source.type === 'asset' && c.source.assetId === h.assetId)).toBe(true);
      expect(sh.scenes.some((s) => s.sounds.some((x) => x.assetId === 'a1'))).toBe(true);
      // empieza con la espera, acaba con despedida y el rótulo del final va en la franja
      expect(sh.scenes[0].name).toMatch(/Espera/);
      expect(sh.scenes[sh.scenes.length - 1].name).toBe('Despedida');
      const franja = inst.surfaces.find((s) => s.name === 'Franja')!.id;
      const finale = sh.scenes.find((s) => s.name === 'Gran final')!;
      expect(finale.clips.some((c) => c.source.type === 'text' && c.source.text === '¡Feliz noche!' && c.surfaceId === franja)).toBe(true);
      const L = layoutShow(sh).duration;
      expect(L).toBeGreaterThan(90);
      expect(L).toBeLessThan(200);
      expect(sh.music[0]?.assetId).toBe('m');
    });
  }
  it('encuadra los vídeos verticales de cintura para arriba en ventanas apaisadas', () => {
    const inst = house();
    const sh = generateShow({ style: 'terror', name: 'x', installation: inst, protagonists: heroes.slice(0, 1) });
    const c = sh.scenes.flatMap((s) => s.clips).find((x) => x.source.type === 'asset' && x.source.assetId === 'v1' && inst.surfaces.find((s) => s.id === x.surfaceId)!.kind === 'window')!;
    expect(c.scale).toBeGreaterThan(2);
    expect(c.duration).toBeLessThanOrEqual(6);
  });
  it('funciona con una instalación mínima y sin protagonistas', () => {
    const inst = createInstallation('Escaparate');
    const s = createSurface('Cristal', 'shopwindow', 0);
    inst.surfaces.push(s);
    const sh = generateShow({ style: 'navidad', name: 'x', installation: inst, protagonists: [] });
    expect(() => Show.parse(sh)).not.toThrow();
    expect(sh.scenes.flatMap((x) => x.clips).every((c) => c.surfaceId === s.id)).toBe(true);
  });
  it('reconoce los sonidos de los paquetes incluidos', () => {
    const k = soundKitFrom([{ id: 'tr-ast-golpe' }, { id: 'hx-ast-snd-pop' }] as any);
    expect(k.stinger).toBe('tr-ast-golpe');
    expect(k.pop).toBe('hx-ast-snd-pop');
    expect(k.whisper).toBeUndefined();
  });
});
