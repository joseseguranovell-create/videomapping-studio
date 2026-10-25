/**
 * Plantillas de escena: coreografías listas que se reparten por todas las superficies,
 * escalonadas según su posición (de izquierda a derecha y de arriba abajo).
 * Son funciones puras: devuelven los clips y sonidos que hay que añadir a la escena.
 */
import type { Clip, Installation, Scene, SoundCue, Surface } from './model';
import { createClip, createSoundCue, effectSource } from './factory';
import { centroid, surfaceOutline, surfaceAspect } from './geometry';

export const TEMPLATE_KINDS = ['neonDibujo', 'casaDespierta', 'portales', 'cascadaLuz', 'tormenta', 'ojos', 'sombras', 'telon', 'cristalRoto', 'lucesFeria', 'barrido', 'incendio', 'navidad', 'fuegosArtificiales', 'fiesta', 'nieveMagica', 'luciernagas'] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export const TEMPLATE_INFO: Record<TemplateKind, { name: string; description: string }> = {
  neonDibujo: { name: 'Neón que se dibuja', description: 'El contorno de cada ventana y puerta se traza en cascada y queda encendido en neón.' },
  cascadaLuz: { name: 'Cascada de luz', description: 'Las ventanas se encienden una tras otra como velas, de izquierda a derecha.' },
  tormenta: { name: 'Tormenta', description: 'Relámpagos sincronizados en toda la fachada, lluvia y truenos.' },
  ojos: { name: 'Ojos en la oscuridad', description: 'Parejas de ojos que se abren y parpadean en cada ventana, con espíritus subiendo por la fachada.' },
  casaDespierta: { name: 'La casa despierta', description: 'Las ventanas se convierten en ojos que se abren y miran alrededor, y la franja o la puerta en una boca que sonríe, se ríe y bosteza.' },
  portales: { name: 'Portales mágicos', description: 'Cada ventana se abre a otra dimensión, una detrás de otra, y se cierra con un destello.' },
  fiesta: { name: '¡Fiesta!', description: 'Confeti, farolillos y corazones, con bombillas en los contornos: para cumpleaños y celebraciones.' },
  sombras: { name: 'Alguien pasa por dentro', description: 'Las ventanas se encienden y una sombra cruza la casa de lado a lado, de ventana en ventana.' },
  telon: { name: 'Se abre el telón', description: 'Cortinas de teatro en cada ventana que se abren una tras otra (y se cierran al final).' },
  cristalRoto: { name: 'Cristales rotos', description: 'Destello y grietas que se extienden por las ventanas, una detrás de otra.' },
  navidad: { name: 'Noche de Navidad', description: 'Escarcha en las ventanas, nieve y aurora en la fachada, bombillas rojas y verdes en los contornos.' },
  fuegosArtificiales: { name: 'Fuegos artificiales', description: 'Fuegos artificiales en toda la fachada y bombillas en los contornos: para un gran final.' },
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
    case 'casaDespierta': {
      const wins = surfaces.filter((s) => s.kind === 'window' || s.kind === 'shopwindow');
      // La boca va en la superficie más apaisada que no sea ventana (una franja o un dintel) o, si no hay, en la puerta.
      const rest = surfaces.filter((s) => !wins.includes(s) && s.kind !== 'wall' || (s.kind === 'wall' && surfaceAspect(s, inst.output) > 3));
      const mouth = rest.slice().sort((a, b) => surfaceAspect(b, inst.output) - surfaceAspect(a, inst.output))[0] ?? surfaces.find((s) => s.kind === 'door');
      wins.forEach((s, i) => clip(s, effectSource('bigEye'), i * 0.25, D - i * 0.25, { fadeIn: 0.2, z: 4 }));
      if (mouth) clip(mouth, effectSource('mouth'), 1.6, D - 1.6, { fadeIn: 0.4, z: 4 });
      break;
    }
    case 'portales':
      surfaces.forEach((s, i) => { if (s.kind !== 'wall') clip(s, effectSource('portal', i % 2 ? { color: '#3dffd8', color2: '#9b4dff' } : {}), i * step, D - i * step, { fadeIn: 0, fadeOut: 0.3, z: 4 }); });
      break;
    case 'fiesta':
      surfaces.forEach((s, i) => {
        if (s.kind === 'wall') { clip(s, effectSource('lanterns'), 0, D, { fadeIn: 1.2, opacity: 0.9, z: -6 }); clip(s, effectSource('confetti'), 0, D, { fadeIn: 0.4, z: 3 }); }
        else {
          clip(s, effectSource('hearts'), i * step * 0.5, D - i * step * 0.5, { fadeIn: 0.6, opacity: 0.85, z: 2 });
          clip(s, effectSource('chase', { color: '#ffd23a', color2: '#ff3d6e' }), i * step * 0.4, D - i * step * 0.4, { fadeIn: 0.3, z: 5 });
        }
      });
      break;
    case 'sombras':
      surfaces.forEach((s) => {
        if (s.kind === 'window' || s.kind === 'door' || s.kind === 'shopwindow') clip(s, effectSource('shadowPass'), 0, D, { fadeIn: 0.8 });
      });
      break;
    case 'telon':
      surfaces.forEach((s, i) => {
        if (s.kind !== 'wall') clip(s, effectSource('curtains'), i * step * 0.6, D - i * step * 0.6, { fadeIn: 0, fadeOut: 0, z: 8 });
      });
      break;
    case 'cristalRoto':
      surfaces.forEach((s, i) => {
        if (s.kind !== 'wall') clip(s, effectSource('cracks', { width: 6 + i }), i * Math.min(0.7, step * 1.4), D - i * Math.min(0.7, step * 1.4), { fadeIn: 0, fadeOut: 0.6, z: 6 });
      });
      break;
    case 'navidad':
      surfaces.forEach((s, i) => {
        if (s.kind === 'wall') {
          clip(s, effectSource('aurora'), 0, D, { fadeIn: 2, opacity: 0.7, z: -8 });
        } else {
          clip(s, effectSource('frost'), 0, D, { fadeIn: 0, z: 2 });
          clip(s, effectSource('chase', i % 2 ? { color: '#ff2a2a', color2: '#2aff6a' } : { color: '#2aff6a', color2: '#ff2a2a' }), i * step * 0.5, D - i * step * 0.5, { fadeIn: 0.3, z: 5 });
        }
        clip(s, effectSource('snow'), 0, D, { fadeIn: 1, opacity: 0.8, z: 3 });
      });
      break;
    case 'fuegosArtificiales':
      surfaces.forEach((s, i) => {
        clip(s, effectSource('fireworks'), 0, D, { fadeIn: 0.3, z: 4 });
        if (s.kind !== 'wall') clip(s, effectSource('chase'), i * step * 0.4, D - i * step * 0.4, { fadeIn: 0.3, z: 5 });
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
