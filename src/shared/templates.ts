/**
 * Plantillas de escena: coreografías listas que se reparten por todas las superficies,
 * escalonadas según su posición (de izquierda a derecha y de arriba abajo).
 * Son funciones puras: devuelven los clips y sonidos que hay que añadir a la escena.
 */
import type { Clip, Installation, Scene, SoundCue, Surface } from './model';
import { createClip, createSoundCue, effectSource } from './factory';
import { centroid, surfaceOutline } from './geometry';

export const TEMPLATE_KINDS = ['neonDibujo', 'cascadaLuz', 'tormenta', 'ojos', 'lucesFeria', 'barrido', 'incendio', 'nieveMagica', 'luciernagas'] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export const TEMPLATE_INFO: Record<TemplateKind, { name: string; description: string }> = {
  neonDibujo: { name: 'Neón que se dibuja', description: 'El contorno de cada ventana y puerta se traza en cascada y queda encendido en neón.' },
  cascadaLuz: { name: 'Cascada de luz', description: 'Las ventanas se encienden una tras otra como velas, de izquierda a derecha.' },
  tormenta: { name: 'Tormenta', description: 'Relámpagos sincronizados en toda la fachada, lluvia y truenos.' },
  ojos: { name: 'Ojos en la oscuridad', description: 'Parejas de ojos que se abren y parpadean en cada ventana, con espíritus subiendo por la fachada.' },
  lucesFeria: { name: 'Luces de feria', description: 'Bombillas naranjas y moradas corriendo por todos los contornos.' },
  barrido: { name: 'Barrido de luz', description: 'Una ola de luz cruza toda la casa de lado a lado.' },
  incendio: { name: 'Ventanas en llamas', description: 'Fuego que prende ventana a ventana (de broma, sin miedo).' },
  nieveMagica: { name: 'Nieve mágica', description: 'Nieve continua en toda la fachada con estrellas (ideal para Navidad).' },
  luciernagas: { name: 'Luciérnagas', description: 'Puntos de luz que vagan dentro de cada ventana.' },
};

/** Superficies visibles ordenadas de izquierda a derecha (y de arriba abajo si están alineadas). */
export function orderedSurfaces(inst: Installation): Surface[] {
  return inst.surfaces
    .filter((s) => s.visible)
    .map((s) => ({ s, c: centroid(surfaceOutline(s)) }))
    .sort((a, b) => (Math.abs(a.c.x - b.c.x) > 0.02 ? a.c.x - b.c.x : a.c.y - b.c.y))
    .map((x) => x.s);
}

/** Instantes de los destellos del efecto «Relámpago» (misma fórmula que el shader). */
export function lightningStrikes(duration: number): number[] {
  const period = 3.7;
  const fract = (v: number) => v - Math.floor(v);
  const out: number[] = [];
  for (let n = 0; n * period < duration; n++) {
    const t = n * period + fract(n * 0.6180339) * 1.2;
    if (t < duration) out.push(t);
  }
  return out;
}

export interface TemplateResult {
  clips: Clip[];
  sounds: SoundCue[];
}

export function applyTemplate(kind: TemplateKind, inst: Installation, scene: Scene, opts: { start?: number; thunderAssetId?: string | null } = {}): TemplateResult {
  const start = Math.max(0, Math.min(opts.start ?? 0, scene.duration - 0.5));
  const D = scene.duration - start;
  const surfaces = orderedSurfaces(inst);
  const n = Math.max(1, surfaces.length);
  // Escalonado: reparte las entradas en el primer 40 % de la escena (máx. 0,6 s entre ventanas).
  const step = Math.min(0.6, (D * 0.4) / n);
  const clips: Clip[] = [];
  const sounds: SoundCue[] = [];
  const clip = (s: Surface, src: Parameters<typeof createClip>[1], at: number, dur: number, extra: Partial<Clip> = {}) =>
    clips.push(createClip(s.id, src, { start: start + at, duration: Math.max(0.2, dur), fit: 'stretch', fadeIn: 0.4, fadeOut: 0.6, z: -5, ...extra }));

  switch (kind) {
    case 'neonDibujo': {
      const draw = Math.min(2.5, D * 0.35);
      surfaces.forEach((s, i) => {
        const at = i * step;
        clip(s, effectSource('drawOn'), at, draw + 0.2, { fadeIn: 0, fadeOut: 0.2, z: 5 });
        clip(s, effectSource('neon'), at + draw, D - at - draw, { fadeIn: 0.3, z: 5 });
      });
      break;
    }
    case 'cascadaLuz':
      surfaces.forEach((s, i) => clip(s, effectSource('flicker'), i * step, D - i * step, { fadeIn: 0.8, opacity: 0.85 }));
      break;
    case 'tormenta':
      surfaces.forEach((s) => {
        clip(s, effectSource('lightning'), 0, D, { fadeIn: 0, fadeOut: 0, z: 2 });
        clip(s, effectSource('rain'), 0, D, { fadeIn: 1, opacity: 0.8, z: 1 });
      });
      if (opts.thunderAssetId) {
        // El trueno llega un poco después del destello, como en la realidad.
        for (const t of lightningStrikes(scene.duration)) if (t >= start && t + 0.4 < scene.duration) sounds.push(createSoundCue(opts.thunderAssetId, { start: t + 0.35, volume: 0.9 }));
      }
      break;
    case 'ojos':
      surfaces.forEach((s, i) => {
        if (s.kind === 'wall') clip(s, effectSource('spirits'), 0, D, { fadeIn: 1.5, opacity: 0.7, z: -8 });
        else clip(s, effectSource('eyes', i % 2 ? { color: '#7dff3a', color2: '#ffd23a' } : {}), i * step * 0.7, D - i * step * 0.7, { fadeIn: 0.2 });
      });
      break;
    case 'lucesFeria':
      surfaces.forEach((s, i) => clip(s, effectSource('chase', i % 2 ? { color: '#9b4dff', color2: '#ff8a1c' } : {}), i * step * 0.5, D - i * step * 0.5, { fadeIn: 0.3, z: 5 }));
      break;
    case 'barrido':
      surfaces.forEach((s) => clip(s, effectSource('sweep'), 0, D, { fadeIn: 0.6 }));
      break;
    case 'incendio':
      surfaces.forEach((s, i) => clip(s, effectSource('fire'), i * step, D - i * step, { fadeIn: 0.7 }));
      break;
    case 'nieveMagica':
      surfaces.forEach((s) => {
        clip(s, effectSource('glow', { color: '#3d6dff', color2: '#050a26' }), 0, D, { opacity: 0.6, z: -8 });
        clip(s, effectSource('snow'), 0, D, { fadeIn: 1, z: 3 });
        clip(s, effectSource('stars', { space: 'facade' }), 0, D, { fadeIn: 1.5, opacity: 0.7, z: 2 });
      });
      break;
    case 'luciernagas':
      surfaces.forEach((s, i) => clip(s, effectSource('fireflies'), i * step * 0.5, D - i * step * 0.5, { fadeIn: 1 }));
      break;
  }
  return { clips, sounds };
}
