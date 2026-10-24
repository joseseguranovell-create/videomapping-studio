/**
 * Movimientos predefinidos para clips y personajes.
 * Son funciones puras del tiempo local del clip: no usan temporizadores, por lo que
 * pausar, rebobinar o saltar a cualquier instante produce siempre el mismo resultado.
 */
import type { Motion } from './model';

export interface MotionState {
  /** Desplazamiento en unidades de superficie (1 = ancho/alto completo). */
  dx: number;
  dy: number;
  scale: number;
  /** Grados. */
  rotation: number;
  alpha: number;
}

export const NEUTRAL_MOTION: MotionState = { dx: 0, dy: 0, scale: 1, rotation: 0, alpha: 1 };

const TAU = Math.PI * 2;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
const easeInCubic = (t: number) => Math.pow(clamp01(t), 3);
const easeInOut = (t: number) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
const easeOutBack = (t: number) => {
  const x = clamp01(t);
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

/**
 * @param t tiempo local del clip (s)
 * @param duration duración del clip (s)
 */
export function evaluateMotion(m: Motion | undefined, t: number, duration: number): MotionState {
  if (!m || m.preset === 'none') return NEUTRAL_MOTION;
  const I = m.intensity;
  const sp = m.speed;
  // Duración de las entradas/salidas: ~0.8 s ajustado por la velocidad, sin superar el 35% del clip.
  const edge = Math.max(0.05, Math.min(0.8 / sp, duration * 0.35));
  const inP = t / edge; // progreso de entrada
  const outP = (duration - t) / edge; // progreso de salida (1 → 0 al final)
  const s: MotionState = { dx: 0, dy: 0, scale: 1, rotation: 0, alpha: 1 };
  switch (m.preset) {
    case 'float':
      s.dy = Math.sin(TAU * t * 0.4 * sp) * 0.04 * I;
      s.rotation = Math.sin(TAU * t * 0.2 * sp) * 3 * I;
      break;
    case 'bounce': {
      const ph = (t * 1.1 * sp) % 1;
      const h = Math.sin(Math.PI * ph);
      s.dy = -h * 0.14 * I;
      // pequeño aplastamiento al tocar "suelo"
      s.scale = 1 + (h < 0.15 ? (0.15 - h) * 0.3 * I : 0);
      break;
    }
    case 'wave':
      s.rotation = Math.sin(TAU * t * 0.9 * sp) * 12 * I;
      break;
    case 'lookAround':
      s.dx = Math.sin(TAU * t * 0.22 * sp) * 0.07 * I;
      s.rotation = Math.sin(TAU * t * 0.22 * sp) * 6 * I;
      break;
    case 'pulse':
      s.scale = 1 + Math.sin(TAU * t * 1.0 * sp) * 0.07 * I;
      break;
    case 'shake':
      s.dx = Math.sin(TAU * t * 9 * sp) * 0.012 * I;
      s.rotation = Math.sin(TAU * t * 7 * sp) * 2 * I;
      break;
    case 'spin':
      s.rotation = t * 120 * sp * I;
      break;
    case 'popIn':
      s.scale = Math.max(0, easeOutBack(inP));
      break;
    case 'popOut':
      s.scale = Math.max(0, easeOutBack(outP));
      break;
    case 'peekLeft':
    case 'peekRight':
    case 'peekTop':
    case 'peekBottom': {
      const k = Math.min(easeOutCubic(inP), easeOutCubic(outP)); // 0 escondido, 1 asomado
      const off = (1 - k) * 0.9 * Math.max(0.2, I);
      if (m.preset === 'peekLeft') s.dx = -off;
      if (m.preset === 'peekRight') s.dx = off;
      if (m.preset === 'peekTop') s.dy = -off;
      if (m.preset === 'peekBottom') s.dy = off;
      // ligero balanceo mientras mira
      s.rotation = Math.sin(TAU * t * 0.5 * sp) * 4 * I * k;
      break;
    }
    case 'enterLeft':
      s.dx = -(1 - easeOutCubic(inP)) * 1.0;
      break;
    case 'enterRight':
      s.dx = (1 - easeOutCubic(inP)) * 1.0;
      break;
    case 'exitLeft':
      s.dx = -easeInCubic(1 - outP) * 1.0;
      break;
    case 'exitRight':
      s.dx = easeInCubic(1 - outP) * 1.0;
      break;
    case 'crossLeftToRight':
      s.dx = -1 + 2 * clamp01(t / duration);
      s.dy = Math.sin(TAU * t * 0.6 * sp) * 0.04 * I;
      break;
    case 'crossRightToLeft':
      s.dx = 1 - 2 * clamp01(t / duration);
      s.dy = Math.sin(TAU * t * 0.6 * sp) * 0.04 * I;
      break;
    case 'rise':
      s.dy = (1 - easeOutCubic(inP)) * 1.0;
      break;
    case 'grow':
      s.scale = 0.3 + 0.7 * easeInOut(t / duration);
      break;
    case 'shrink':
      s.scale = 1 - 0.7 * easeInOut(t / duration);
      break;
  }
  return s;
}
