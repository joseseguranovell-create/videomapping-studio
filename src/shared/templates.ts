/**
 * Plantillas de escena: coreografías listas que se reparten por todas las superficies,
 * escalonadas según su posición (de izquierda a derecha y de arriba abajo).
 * Son funciones puras: devuelven los clips y sonidos que hay que añadir a la escena.
 */
import type { Clip, Installation, Scene, SoundCue, Surface } from './model';
import { createClip, createSoundCue, effectSource } from './factory';
import { centroid, surfaceOutline, surfaceAspect } from './geometry';

export const TEMPLATE_KINDS = ['neonDibujo', 'casaDespierta', 'portales', 'cascadaLuz', 'tormenta', 'ojos', 'sombras', 'telon', 'cristalRoto', 'lucesFeria', 'barrido', 'incendio', 'navidad', 'fuegosArtificiales', 'fiesta', 'nieveMagica', 'luciernagas', 'apagon', 'sangre', 'algoQuiereEntrar', 'escenaCrimen', 'casaEncantada'] as const;
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
  apagon: { name: 'Se va la luz', description: 'Toda la casa se ilumina como un fluorescente que falla, parpadea cada vez más y se apaga de golpe.' },
  sangre: { name: 'La casa sangra', description: 'La sangre rezuma por arriba de cada ventana, puerta y franja y va cayendo en hilos, con un latido rojo en la pared.' },
  escenaCrimen: { name: 'Escena del crimen', description: 'Cinta policial «NO PASAR» cruzando la casa, sirena roja y azul y focos que barren la fachada buscando a alguien.' },
  casaEncantada: { name: 'Casa encantada', description: 'Telarañas en las esquinas de ventanas y puerta, arañas que bajan por su hilo y murciélagos cruzando la fachada.' },
  algoQuiereEntrar: { name: 'Algo quiere entrar', description: 'Manos que golpean los cristales una tras otra y zarpazos en la puerta.' },
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

/** Sonidos opcionales de las plantillas (ids de recursos del proyecto). */
export interface TemplateSounds { powerFail?: string; drips?: string; knocks?: string; scratch?: string; siren?: string }

/** Sonidos de las plantillas sacados del paquete «Sonidos de terror», si el proyecto lo tiene. */
export function templateSounds(assets: { id: string }[]): TemplateSounds {
  const has = (id: string) => (assets.some((a) => a.id === id) ? id : undefined);
  return { powerFail: has('tr-ast-luz-falla'), drips: has('tr-ast-goteo'), knocks: has('tr-ast-golpes-puerta'), scratch: has('tr-ast-aranazo'), siren: has('tr-ast-sirena') };
}

export function applyTemplate(kind: TemplateKind, inst: Installation, scene: Scene, opts: { start?: number; thunderAssetId?: string | null; sounds?: TemplateSounds } = {}): TemplateResult {
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
    case 'apagon':
      // Igual en todas las superficies (mismo reloj): la casa entera parpadea y se apaga a la vez.
      surfaces.forEach((s) => clip(s, effectSource('powerFail'), 0, D, { fadeIn: 0, fadeOut: 0, z: 8 }));
      if (opts.sounds?.powerFail) sounds.push(createSoundCue(opts.sounds.powerFail, { start, volume: 0.9, duration: Math.min(6, D) }));
      break;
    case 'sangre':
      surfaces.forEach((s, i) => {
        if (s.kind === 'wall' && surfaceAspect(s, inst.output) < 3) clip(s, effectSource('pulse', { color: '#a00010', color2: '#1a0000', width: 7 }), 0, D, { fadeIn: 1.5, opacity: 0.55, z: -8 });
        else clip(s, effectSource('blood'), i * step * 0.6, D - i * step * 0.6, { fadeIn: 0, z: 6 });
      });
      if (opts.sounds?.drips) sounds.push(createSoundCue(opts.sounds.drips, { start, volume: 0.7, loop: true, duration: D }));
      break;
    case 'escenaCrimen':
      // Todo en el espacio de la fachada: la cinta, la sirena y los focos cruzan la casa entera.
      surfaces.forEach((s) => {
        clip(s, effectSource('policeLights'), 0, D, { fadeIn: 0.2, opacity: 0.55, z: -6 });
        clip(s, effectSource('searchBeams'), 0, D, { fadeIn: 1, z: 2 });
        clip(s, effectSource('policeTape'), 0.5, D - 0.5, { fadeIn: 0, z: 7 });
      });
      if (opts.sounds?.siren) sounds.push(createSoundCue(opts.sounds.siren, { start, volume: 0.6, loop: true, duration: D }));
      break;
    case 'casaEncantada':
      surfaces.forEach((s) => {
        if (s.kind === 'wall') clip(s, effectSource('bats'), 0, D, { fadeIn: 1, z: 3 });
        else {
          clip(s, effectSource('cobwebs'), 0, D, { fadeIn: 1.5, opacity: 0.85, z: 6 });
          if (s.kind === 'window' || s.kind === 'door' || s.kind === 'shopwindow') clip(s, effectSource('spiders'), 1, D - 1, { fadeIn: 0.5, z: 7 });
        }
      });
      break;
    case 'algoQuiereEntrar': {
      const wins = surfaces.filter((s) => s.kind === 'window' || s.kind === 'shopwindow');
      const doors = surfaces.filter((s) => s.kind === 'door' || s.kind === 'garage');
      wins.forEach((s, i) => clip(s, effectSource('handprints'), i * 0.45, D - i * 0.45, { fadeIn: 0, z: 6 }));
      doors.forEach((s) => clip(s, effectSource('claws'), Math.min(1.5, D * 0.3), D - Math.min(1.5, D * 0.3), { fadeIn: 0, z: 6 }));
      if (opts.sounds?.knocks) sounds.push(createSoundCue(opts.sounds.knocks, { start: start + 0.25, volume: 0.9 }));
      if (opts.sounds?.scratch && doors.length) sounds.push(createSoundCue(opts.sounds.scratch, { start: start + Math.min(1.5, D * 0.3), volume: 0.9 }));
      break;
    }
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
