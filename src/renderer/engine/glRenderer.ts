/**
 * Renderizador WebGL2 de superficies de proyección.
 *
 * Para cada superficie:
 *  1. Se dibuja su contorno (triangulado) en el stencil = 1.
 *  2. Las máscaras de exclusión (de la superficie y globales) se dibujan con stencil = 0.
 *  3. Cada capa se dibuja sobre el contorno con test stencil == 1. El fragment shader calcula,
 *     para cada píxel de salida, su coordenada uv en la superficie mediante la homografía inversa
 *     (perspectiva exacta, no una simple deformación afín) y luego la coordenada en el contenido.
 * Así el contenido nunca invade superficies vecinas ni zonas excluidas.
 */
import type { Mat3 } from '../../shared/geometry';
import type { Vec2 } from '../../shared/model';
import { triangulateToArray } from '../../shared/geometry';

export const EFFECT_MODE = {
  texture: 0,
  solid: 1,
  glow: 2,
  stars: 3,
  flicker: 4,
  rainbow: 5,
  testPattern: 6,
  missing: 7,
  sweep: 8,
  lightning: 9,
  fire: 10,
  fog: 11,
  rain: 12,
  snow: 13,
  fireflies: 14,
  eyes: 15,
  spirits: 16,
  shadowPass: 17,
  curtains: 18,
  shutters: 19,
  stainedGlass: 20,
  cracks: 21,
  glitch: 22,
  pulse: 23,
  searchlight: 24,
  fireworks: 25,
  frost: 26,
  aurora: 27,
  shootingStars: 28,
  portal: 29,
  burst: 30,
  vortex: 31,
  runes: 32,
  bigEye: 33,
  mouth: 34,
  bubbles: 35,
  confetti: 36,
  fairyDust: 37,
  hearts: 38,
  lanterns: 39,
  blood: 40,
  handprints: 41,
  claws: 42,
  powerFail: 43,
  searchBeams: 44,
  policeTape: 45,
  policeLights: 46,
  cobwebs: 47,
  bats: 48,
  spiders: 49,
  slitEye: 50,
} as const;

export const CONTOUR_MODE = { neon: 0, drawOn: 1, chase: 2, comet: 3 } as const;

/** Capa de contorno: se dibuja sobre el borde de la superficie y brilla hacia fuera. */
export interface ContourLayer {
  mode: keyof typeof CONTOUR_MODE;
  opacity: number;
  color: [number, number, number];
  color2: [number, number, number];
  /** grosor en píxeles para una salida de 1080 líneas */
  width: number;
  time: number;
  duration: number;
}

export type LayerMode = keyof typeof EFFECT_MODE;

export interface Layer {
  mode: LayerMode;
  texture?: WebGLTexture | null;
  /** surface uv → content uv */
  toContent: Mat3;
  opacity: number;
  color?: [number, number, number];
  color2?: [number, number, number];
  time?: number;
  /** Tiempo desde que empezó el clip y su duración (efectos que se abren, se rompen o crecen). */
  local?: number;
  duration?: number;
  /** Parámetro numérico del efecto (el «grosor»). */
  param?: number;
  /** `toContent` parte de coordenadas de salida (clips que viajan por la fachada) en vez de la superficie. */
  fromOutput?: boolean;
  /** Alto de la superficie en la salida (0..1): para efectos de fachada con tamaño de ventana. */
  surfH?: number;
  /** Borde inferior de la superficie en la salida (0..1), para figuras de tamaño real en la fachada. */
  surfBottom?: number;
  /** y (0..1) que separa la fila de arriba de la de abajo; <0 si solo hay una fila. */
  rowSplit?: number;
  /** Cuánto queda por debajo del borde inferior el suelo donde pisa una figura (alturas de persona): 0 en puertas. */
  sill?: number;
  aspect?: number;
  /** El efecto usa coordenadas de toda la fachada (continuo entre superficies). */
  global?: boolean;
  /** Pintar el recurso de un solo color (silueta). */
  silhouette?: [number, number, number] | null;
  /** Quitar fondo: 1 = por color, 2 = fondos oscuros. */
  key?: { mode: 0 | 1 | 2; color: [number, number, number]; threshold: number; softness: number; despill: boolean };
}

const VS = `#version 300 es
in vec2 a_pos;
out vec2 v_pos;
void main() {
  v_pos = a_pos;
  gl_Position = vec4(a_pos.x * 2.0 - 1.0, 1.0 - a_pos.y * 2.0, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec2 v_pos;
uniform mat3 u_toSurface;
uniform mat3 u_toContent;
uniform int u_mode;
uniform sampler2D u_tex;
uniform float u_opacity;
uniform float u_time;
uniform float u_local;
uniform float u_dur;
uniform float u_param;
uniform float u_surfH;
uniform float u_surfBottom;
uniform float u_rowSplit;
uniform float u_sill;
uniform int u_fromOutput;
uniform float u_aspect;
uniform vec3 u_color;
uniform vec3 u_color2;
uniform int u_keyMode;
uniform vec3 u_keyColor;
uniform float u_keyTh;
uniform float u_keySoft;
uniform int u_despill;
uniform int u_global;
uniform float u_outAspect;
uniform int u_tint;
uniform vec3 u_tintColor;
out vec4 o;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float hash1(float n) { return fract(sin(n) * 43758.5453123); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
float sdCapsule(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
/** Voronoi: x = distancia al borde entre celdas, yz = id de la celda. */
vec3 voronoi(vec2 p) {
  vec2 n = floor(p), f = fract(p);
  vec2 mg = vec2(0.0), mr = vec2(0.0);
  float md = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = vec2(hash(n + g), hash(n + g + 17.3));
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < md) { md = d; mr = r; mg = g; }
  }
  md = 8.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec2 g = mg + vec2(float(i), float(j));
    vec2 o = vec2(hash(n + g), hash(n + g + 17.3));
    vec2 r = g + o - f;
    if (dot(mr - r, mr - r) > 0.00001) md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
  }
  return vec3(md, n + mg);
}
/** Entra al principio del clip y sale al final (0 = cerrado, 1 = abierto). */
// Letras de 5×7 para la cinta policial: N O P A S R y espacio (cada fila, 5 bits; el bit 4 es la columna izquierda).
const int FONT57[49] = int[49](
  17, 25, 21, 19, 17, 17, 17,
  14, 17, 17, 17, 17, 17, 14,
  30, 17, 17, 30, 16, 16, 16,
  14, 17, 17, 31, 17, 17, 17,
  15, 16, 16, 14, 1, 1, 30,
  30, 17, 17, 30, 20, 18, 17,
  0, 0, 0, 0, 0, 0, 0);
const int TAPE_TEXT[10] = int[10](0, 1, 6, 2, 3, 4, 3, 5, 6, 6);
float glyph57(int ch, vec2 f) {
  // f en [0,1)² dentro de la celda (6×9 con márgenes)
  int cx = int(floor(f.x * 6.0)), cy = int(floor(f.y * 9.0)) - 1;
  if (cx > 4 || cy < 0 || cy > 6) return 0.0;
  return float((FONT57[ch * 7 + cy] >> (4 - cx)) & 1);
}
float openAmount(float lt, float dur, float tin) {
  float k = min(tin, dur * 0.3);
  return smoothstep(0.0, k, lt) * (1.0 - smoothstep(dur - k, dur, lt));
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

float edgeD(vec2 p, vec2 a, vec2 b) { return (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y); }
/** Triángulo suave (1 dentro, 0 fuera); el borde se difumina e = ancho en unidades locales. */
float triM(vec2 p, vec2 a, vec2 b, vec2 c, float e) {
  float s = sign(edgeD(c, a, b));
  float d = min(edgeD(p, a, b) * s / length(b - a), min(edgeD(p, b, c) * s / length(c - b), edgeD(p, c, a) * s / length(a - c)));
  return smoothstep(0.0, e, d);
}
/** Murciélago de frente: cuerpo, cabeza con orejas y alas con dedos y borde festoneado. p en el espacio de la figura (arriba = -y), f = aleteo -1..1. */
float batMask(vec2 p, float f, float e) {
  vec2 q2 = vec2(abs(p.x), p.y);
  vec2 S = vec2(0.09, -0.06);
  vec2 W = vec2(0.5, -0.1 - 0.42 * f);
  vec2 T1 = W + vec2(0.46, 0.3 - 0.5 * f);
  vec2 T2 = W + vec2(0.3, 0.52 - 0.34 * f);
  vec2 T3 = W + vec2(0.04, 0.58 - 0.14 * f);
  vec2 B = vec2(0.11, 0.36);
  float m = triM(q2, S, W, T1, e);
  m = max(m, triM(q2, S, T1, T2, e));
  m = max(m, triM(q2, S, T2, T3, e));
  m = max(m, triM(q2, S, T3, B, e));
  m = max(m, smoothstep(1.0, 1.0 - e * 4.0, length((q2 - vec2(0.0, 0.08)) / vec2(0.14, 0.3))));
  m = max(m, smoothstep(1.0, 1.0 - e * 4.0, length((q2 - vec2(0.0, -0.3)) / vec2(0.1, 0.1))));
  m = max(m, triM(q2, vec2(0.02, -0.36), vec2(0.1, -0.35), vec2(0.085, -0.58), e));
  return m;
}

void main() {
  vec3 s = u_toSurface * vec3(v_pos, 1.0);
  if (s.z <= 0.0) discard;
  vec2 uv = s.xy / s.z;
  vec2 c = (u_toContent * vec3(u_fromOutput == 1 ? v_pos : uv, 1.0)).xy;
  if (c.x < 0.0 || c.y < 0.0 || c.x > 1.0 || c.y > 1.0) discard;
  vec4 col;
  vec2 qn = u_global == 1 ? v_pos : c;
  vec2 q = u_global == 1 ? vec2(v_pos.x * u_outAspect, v_pos.y) : vec2(c.x * u_aspect, c.y);
  float t = u_time;
  if (u_mode == 0) {
    col = texture(u_tex, c); // ya premultiplicado
    if (u_keyMode > 0 && col.a > 0.0) {
      // Quitar fondo (croma o fondo negro) para vídeos e imágenes sin transparencia.
      vec3 rgb = col.rgb / col.a;
      float k;
      if (u_keyMode == 1) {
        float d = distance(rgb, u_keyColor) / 1.7320508;
        k = smoothstep(u_keyTh, u_keyTh + u_keySoft + 0.001, d);
        if (u_despill == 1) {
          if (u_keyColor.g > u_keyColor.r && u_keyColor.g > u_keyColor.b) rgb.g = min(rgb.g, max(rgb.r, rgb.b) + 0.06);
          else if (u_keyColor.b > u_keyColor.r && u_keyColor.b > u_keyColor.g) rgb.b = min(rgb.b, max(rgb.r, rgb.g) + 0.06);
        }
      } else {
        float l = dot(rgb, vec3(0.299, 0.587, 0.114));
        k = smoothstep(u_keyTh * 0.6, u_keyTh * 0.6 + u_keySoft + 0.001, l);
      }
      col = vec4(rgb * col.a * k, col.a * k);
    }
    if (u_tint == 1) col = vec4(u_tintColor * col.a, col.a); // silueta
  } else if (u_mode == 1) {
    col = vec4(u_color, 1.0);
  } else if (u_mode == 2) {
    vec2 d = (c - 0.5) * vec2(u_aspect, 1.0);
    float r = length(d) / max(0.5 * max(u_aspect, 1.0), 0.0001);
    float pulse = 0.75 + 0.25 * sin(u_time * 2.2);
    float k = pow(smoothstep(1.05, 0.0, r), 1.6) * pulse;
    col = vec4(mix(u_color2, u_color, k) * (0.06 + 0.94 * k), 1.0);
  } else if (u_mode == 3) {
    vec2 g = q * 14.0;
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = hash(id);
    vec2 off = (vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5) * 0.6;
    float tw = 0.5 + 0.5 * sin(u_time * (1.5 + 3.0 * h) + h * 40.0);
    float star = smoothstep(0.12, 0.0, length(f - off)) * step(0.55, h) * tw;
    float cross_ = (smoothstep(0.03, 0.0, abs(f.x - off.x)) + smoothstep(0.03, 0.0, abs(f.y - off.y))) * smoothstep(0.35, 0.0, length(f - off)) * step(0.8, h) * tw;
    float a = clamp(star + cross_ * 0.6, 0.0, 1.0);
    col = vec4(mix(u_color2, u_color, 0.5 + 0.5 * h) * a, a);
  } else if (u_mode == 4) {
    // Vela: la luz nace abajo (como una vela en el alféizar), tiembla y deja la parte alta en penumbra.
    float fl = 0.8 + 0.1 * sin(t * 7.3) + 0.07 * sin(t * 13.1 + 1.3) + 0.04 * sin(t * 23.7) - 0.3 * smoothstep(0.86, 0.97, vnoise(vec2(t * 2.7, 3.0)));
    vec2 src = vec2(0.5 + 0.04 * sin(t * 1.7) + 0.02 * sin(t * 5.3), 1.05);
    vec2 dd = (c - src) * vec2(u_aspect * 0.75, 1.0);
    float v = exp(-dot(dd, dd) * 2.4);
    vec3 warm = mix(u_color * vec3(0.7, 0.35, 0.15), u_color, v);
    col = vec4(warm * v * fl * 1.15, 1.0);
  } else if (u_mode == 5) {
    col = vec4(hsv2rgb(vec3(fract(qn.x * 0.6 + qn.y * 0.2 + u_time * 0.1), 0.65, 1.0)), 1.0);
  } else if (u_mode == 6) {
    // Patrón de calibración: cuadrícula, borde, cruz central, diagonales y esquinas identificables.
    vec2 g = floor(c * 8.0);
    float chk = mod(g.x + g.y, 2.0);
    vec3 base = mix(u_color * 0.35, u_color * 0.75, chk);
    vec2 px = fwidth(c);
    float border = step(c.x, px.x * 4.0) + step(1.0 - px.x * 4.0, c.x) + step(c.y, px.y * 4.0) + step(1.0 - px.y * 4.0, c.y);
    float center = (step(abs(c.x - 0.5), px.x * 1.5) + step(abs(c.y - 0.5), px.y * 1.5));
    float diag = step(abs(c.x - c.y), px.x * 1.5 + px.y * 1.5) + step(abs(c.x - (1.0 - c.y)), px.x * 1.5 + px.y * 1.5);
    vec3 cc = base;
    cc = mix(cc, vec3(1.0), clamp(diag, 0.0, 1.0) * 0.5);
    cc = mix(cc, vec3(1.0), clamp(center, 0.0, 1.0));
    cc = mix(cc, vec3(1.0), clamp(border, 0.0, 1.0));
    // marcas de esquina: TL rojo, TR verde, BR azul, BL amarillo
    float cs = 0.14;
    if (c.x < cs && c.y < cs) cc = vec3(1.0, 0.15, 0.15);
    if (c.x > 1.0 - cs && c.y < cs) cc = vec3(0.15, 1.0, 0.3);
    if (c.x > 1.0 - cs && c.y > 1.0 - cs) cc = vec3(0.2, 0.45, 1.0);
    if (c.x < cs && c.y > 1.0 - cs) cc = vec3(1.0, 0.9, 0.1);
    // flecha "arriba"
    vec2 a = c - vec2(0.5, 0.22);
    if (a.y > -0.1 && a.y < 0.06 && abs(a.x) < (a.y + 0.1) * 0.6) cc = vec3(1.0);
    col = vec4(cc, 1.0);
  } else if (u_mode == 8) {
    // Barrido: una banda de luz cruza (en modo fachada, toda la casa) de izquierda a derecha.
    float x = qn.x + (qn.y - 0.5) * 0.25;
    float b = fract(t * 0.28) * 1.8 - 0.4;
    float k = exp(-pow((x - b) / 0.08, 2.0)) + 0.45 * exp(-pow((x - b + 0.2) / 0.05, 2.0));
    vec3 bc = mix(u_color2, u_color, clamp(k, 0.0, 1.0));
    float a = clamp(k * 1.1, 0.0, 1.0);
    col = vec4(bc * a, a);
  } else if (u_mode == 9) {
    // Relámpago: destellos irregulares (iguales en todas las superficies) y rayo en zigzag.
    float period = 3.7;
    float n = floor(t / period);
    // desfase estable en 32 y 64 bits (el mismo cálculo se hace en JavaScript para los truenos)
    float ph = t - n * period - fract(n * 0.6180339) * 1.2;
    float f = 0.0;
    if (ph > 0.0) f = exp(-ph * 9.0) + 0.7 * exp(-max(ph - 0.16, 0.0) * 12.0) * step(0.16, ph) + 0.45 * exp(-max(ph - 0.33, 0.0) * 14.0) * step(0.33, ph);
    float bx = (0.15 + 0.7 * hash1(n * 3.1)) * (u_global == 1 ? u_outAspect : u_aspect);
    float jag = (fbm(vec2(q.y * 6.0, n * 13.0)) - 0.5) * 0.35 + (vnoise(vec2(q.y * 30.0, n)) - 0.5) * 0.05;
    float d = abs(q.x - bx - jag);
    float bolt = (smoothstep(0.012, 0.0, d) + 0.4 * exp(-d * 25.0)) * step(0.0, ph) * exp(-max(ph, 0.0) * 6.0);
    float a = clamp(f * 1.15 + bolt * 1.5, 0.0, 1.0);
    col = vec4(mix(u_color2, mix(u_color, vec3(1.0), 0.35), clamp(f + bolt, 0.0, 1.0)) * a, a);
  } else if (u_mode == 10) {
    // Fuego: lenguas alargadas que suben (ruido estirado en vertical), núcleo incandescente, brasas y chispas.
    float h = 1.0 - qn.y;                       // 0 abajo … 1 arriba
    float w = u_global == 1 ? u_outAspect : u_aspect;
    float x = (q.x / max(w, 0.0001)) * (3.0 + w * 2.0); // ancho de lengua independiente del tamaño de la superficie
    float sway = (fbm(vec2(h * 1.3 - t * 0.55, 4.0)) - 0.5) * 0.9 * h;
    vec2 p = vec2(x + sway, h * 1.5);
    float n1 = fbm(vec2(p.x * 1.1, p.y * 0.9 - t * 1.5));
    float n2 = fbm(vec2(p.x * 2.6 + 7.0, p.y * 1.7 - t * 2.6));
    float n3 = vnoise(vec2(p.x * 6.0 + 3.0, p.y * 3.2 - t * 4.2));
    float turb = n1 * 0.6 + n2 * 0.3 + n3 * 0.1;
    float prof = 0.5 + 0.5 * smoothstep(0.0, 0.5, 1.0 - abs(fract(x * 0.5) - 0.5) * 2.0 * 0.0); // (sin perfil lateral: la lengua la dibuja el ruido)
    float heat = ((1.0 - h * 1.05) * 0.62 + (turb - 0.5) * 1.55) * prof;
    heat += smoothstep(0.06, 0.0, h) * 0.2;                   // lecho de brasas
    heat = clamp(heat, 0.0, 1.0);
    float body = smoothstep(0.12, 0.5, heat);
    vec3 fc = mix(vec3(0.35, 0.02, 0.0), u_color, smoothstep(0.12, 0.45, heat));
    fc = mix(fc, u_color2, smoothstep(0.45, 0.78, heat));
    fc = mix(fc, vec3(1.0, 0.93, 0.7), smoothstep(0.9, 1.0, heat) * 0.8);
    float a = body;
    // chispas que se desprenden y suben
    float sp = 0.0;
    for (int l = 0; l < 2; l++) {
      vec2 g = vec2(x * (2.2 + float(l)), h * (4.0 + float(l) * 2.0) - t * (0.9 + 0.7 * float(l)));
      vec2 id = floor(g);
      vec2 f = fract(g) - 0.5;
      float hh = hash(id + float(l) * 19.0);
      vec2 off = (vec2(hash(id + 2.1), hash(id + 8.3)) - 0.5) * 0.5;
      sp += smoothstep(0.11, 0.0, length(f - off)) * step(0.86, hh) * (1.0 - smoothstep(0.2, 0.95, h)) * (0.6 + 0.4 * sin(t * 12.0 + hh * 50.0));
    }
    fc = mix(fc, vec3(1.0, 0.75, 0.3), clamp(sp, 0.0, 1.0));
    a = clamp(a + sp * 0.9, 0.0, 1.0);
    col = vec4(fc * a, a);
  } else if (u_mode == 11) {
    // Niebla que se desliza.
    float n = fbm(q * 2.2 + vec2(t * 0.06, t * 0.015)) * 0.65 + fbm(q * 4.5 - vec2(t * 0.11, 0.0)) * 0.35;
    float edge = smoothstep(0.0, 0.12, c.x) * smoothstep(1.0, 0.88, c.x) * smoothstep(0.0, 0.15, c.y);
    float a = smoothstep(0.32, 0.85, n) * 0.8 * (0.55 + 0.45 * qn.y) * edge;
    col = vec4(mix(u_color2, u_color, n) * a, a);
  } else if (u_mode == 12) {
    // Lluvia: cuatro capas de profundidad (lejos = fina y lenta, cerca = larga y rápida), inclinadas por el viento,
    // con la cabeza de cada hilo más brillante que su cola y una bruma ligera que cae.
    float a = 0.0;
    vec2 r = vec2(q.x + q.y * 0.16, q.y);
    for (int l = 0; l < 4; l++) {
      float depth = float(l) / 3.0;
      float dens = 150.0 - 80.0 * depth;
      float id = floor(r.x * dens);
      float fx = fract(r.x * dens) - 0.5;
      float hh = hash1(id * 7.13 + float(l) * 31.7);
      float present = step(0.3, hash1(id * 3.77 + float(l) * 5.3));
      float speed = 1.0 + 1.6 * depth + hh * 0.5;
      float y = fract(r.y * (0.5 + 0.2 * depth) - t * speed + hh * 9.0);
      float len = 0.16 + 0.22 * depth;
      float streak = (1.0 - smoothstep(len - 0.004, len, y)) * pow(y / len, 2.2);
      float line = smoothstep(0.10 + 0.08 * depth, 0.0, abs(fx));
      a += streak * line * present * (0.45 + 0.55 * depth);
    }
    float mist = fbm(vec2(q.x * 2.5 + q.y * 0.4, q.y * 1.6 - t * 1.4));
    a = clamp(a * 0.95 + (mist - 0.35) * 0.18, 0.0, 0.9);
    col = vec4(mix(u_color, vec3(1.0), 0.25) * a, a);
  } else if (u_mode == 13) {
    // Nieve: copos de varios tamaños que caen balanceándose.
    float a = 0.0;
    for (int l = 0; l < 3; l++) {
      float s = 7.0 + float(l) * 6.0;
      vec2 p = q * s;
      p.y -= t * (0.35 + 0.25 * float(l)) * s * 0.12;
      p.x += sin(p.y * 0.7 + t * 0.8 + float(l)) * 0.35;
      vec2 id = floor(p);
      vec2 f = fract(p) - 0.5;
      float h = hash(id + float(l) * 31.0);
      vec2 o2 = (vec2(hash(id + 1.3), hash(id + 7.1)) - 0.5) * 0.6;
      float r = (0.06 + 0.07 * h) * (1.0 - 0.25 * float(l));
      a += smoothstep(r, r * 0.3, length(f - o2)) * step(0.35, h);
    }
    a = clamp(a, 0.0, 1.0);
    col = vec4(mix(u_color2, u_color, 0.7) * a, a);
  } else if (u_mode == 14) {
    // Luciérnagas: puntos de luz que vagan y parpadean.
    vec2 g = q * 6.0;
    float a = 0.0;
    vec3 acc = vec3(0.0);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 id = floor(g) + vec2(float(i), float(j));
      float h = hash(id);
      if (h < 0.45) continue;
      vec2 pos = id + 0.5 + 0.45 * vec2(sin(t * (0.4 + h) + h * 30.0), cos(t * (0.35 + h * 0.8) + h * 17.0));
      float d = length(g - pos);
      float blink = smoothstep(0.2, 1.0, 0.5 + 0.5 * sin(t * (1.0 + 2.0 * h) + h * 50.0));
      float v = (exp(-d * d * 60.0) * 1.2 + exp(-d * 6.0) * 0.35) * blink;
      a += v;
      acc += mix(u_color, u_color2, step(0.8, h)) * v;
    }
    a = clamp(a, 0.0, 1.0);
    col = vec4(clamp(acc, 0.0, 1.0), a);
  } else if (u_mode == 15) {
    // Ojos en la oscuridad: parejas de ojos que se abren, parpadean, miran a los lados y se cierran.
    vec2 g = q * 1.7;
    vec2 id = floor(g);
    vec2 f = fract(g);
    float h = hash(id + 0.37);
    vec3 acc = vec3(0.0);
    float a = 0.0;
    if (h > 0.42) {
      float h2 = hash(id + 5.1), h3 = hash(id + 9.7);
      float P = 4.0 + 4.0 * h2;
      float lt = mod(t + h3 * P, P);
      // abiertos de 0,4 s a 3 s, con un parpadeo a mitad
      float open = smoothstep(0.4, 0.7, lt) * (1.0 - smoothstep(2.7, 3.0, lt));
      float blink = 1.0 - (smoothstep(1.55, 1.62, lt) - smoothstep(1.66, 1.75, lt));
      float o = open * blink;
      vec2 cen = vec2(0.3 + 0.4 * h2, 0.35 + 0.3 * h3);
      float sep = 0.34 + 0.06 * h;
      float rx = 0.1 + 0.03 * h3, ry = 0.058 + 0.014 * h3;
      float look = 0.35 * sin(t * 0.9 + h * 20.0);
      vec3 ec = h3 > 0.5 ? u_color : u_color2;
      for (int k = 0; k < 2; k++) {
        vec2 e = cen + vec2(k == 0 ? -sep * 0.5 : sep * 0.5, 0.0);
        vec2 d = (f - e) / vec2(rx, ry * max(o, 0.001));
        // forma almendrada: más estrecha en los extremos
        float dist = length(vec2(d.x, d.y * (1.0 + 0.9 * d.x * d.x)));
        float ball = smoothstep(1.0, 0.88, dist) * step(0.02, o);             // ojo (borde del párpado suave)
        vec2 pl = vec2(d.x - look * 0.6, d.y * 0.9);
        float rr = length(pl);
        float dil = 0.5 + 0.5 * sin(t * 0.7 + h * 9.0);
        float slitW = mix(0.1, 0.34, dil);
        float pupil = h > 0.62 ? smoothstep(slitW, slitW * 0.55, abs(pl.x)) * smoothstep(0.98, 0.75, abs(d.y))
                               : smoothstep(0.4, 0.26, rr);
        // brillo de animal: más claro hacia el centro, aro oscuro en el borde, fibras finas en el iris
        float fib = 0.85 + 0.15 * sin(atan(pl.y, pl.x) * 14.0 + rr * 6.0);
        float tone = (0.5 + 0.7 * smoothstep(0.95, 0.15, rr)) * (1.0 - 0.55 * smoothstep(0.62, 1.0, dist)) * fib;
        float glint = smoothstep(0.16, 0.0, length(d - vec2(-0.28 + look * 0.25, -0.34))) * step(0.02, o);
        float bloom = exp(-length((f - e) / vec2(rx, ry)) * 1.5) * 0.35 * o;
        vec3 shine = mix(ec, vec3(1.0), 0.18) * tone;
        acc += shine * ball * (1.0 - 0.96 * pupil) + vec3(1.0) * glint * 0.9 + ec * bloom;
        a += ball + bloom + glint;
      }
    }
    a = clamp(a, 0.0, 1.0);
    col = vec4(clamp(acc, 0.0, 1.0), a);
  } else if (u_mode == 16) {
    // Espíritus: jirones de humo pálido que suben y se deshacen.
    vec2 p = vec2(q.x * 3.0, qn.y * 1.2);
    vec2 w = vec2(fbm(p * 1.1 + vec2(0.0, t * 0.3)), fbm(p * 1.1 + vec2(4.3, t * 0.25)));
    float n = fbm(vec2(p.x * 2.6 + w.x * 2.2, p.y * 0.9 + t * 0.55 + w.y * 0.6));
    // jirones finos: solo la cresta del ruido
    float streak = smoothstep(0.6, 0.72, n) * (1.0 - smoothstep(0.78, 0.95, n) * 0.4);
    float fade = smoothstep(0.02, 0.5, qn.y) * (0.55 + 0.45 * smoothstep(1.0, 0.55, qn.y));
    float a = streak * fade * 0.6 * smoothstep(0.0, 0.08, c.x) * smoothstep(1.0, 0.92, c.x);
    col = vec4(mix(u_color2, u_color, smoothstep(0.55, 0.9, n)) * a, a);
  } else if (u_mode == 17) {
    // Sombra que pasa: ventana iluminada por dentro y la sombra de alguien que la cruza andando.
    float flick = 0.94 + 0.04 * sin(t * 6.1) + 0.02 * sin(t * 13.7);
    vec2 dd = (c - vec2(0.5, 0.75)) * vec2(u_aspect * 0.6, 1.0);
    vec3 light = u_color * (0.55 + 0.45 * exp(-dot(dd, dd) * 1.6)) * flick;
    float Hf = 0.9;                       // altura de la figura (en alturas de ventana)
    // En modo fachada la misma persona cruza toda la casa: entra por una ventana y sale por la otra.
    float per = u_global == 1 ? 9.0 : 5.5;
    float tt = u_global == 1 ? u_time : u_local;
    float n = floor(tt / per);
    float lp = fract(tt / per);
    float dir = mod(n, 2.0) < 1.0 ? 1.0 : -1.0;
    vec2 p;
    if (u_global == 1) {
      float X = (-0.08 + lp * 1.16) * u_outAspect;
      if (dir < 0.0) X = u_outAspect - X;
      // Persona de tamaño real: la misma altura en todas las ventanas y pisando el suelo de su planta,
      // por debajo del alféizar (en las ventanas se ve cortada por las piernas). Cada paso recorre una sola planta.
      float Hp = 0.26;
      float feetY = u_surfBottom + u_sill * Hp;
      bool lowRow = u_rowSplit > 0.0 && u_surfBottom > u_rowSplit;
      if (u_rowSplit > 0.0 && (lowRow ? mod(n, 2.0) > 0.5 : mod(n, 2.0) < 0.5)) { Hp = 1e6; }
      p = vec2((v_pos.x * u_outAspect - X) / Hp, (v_pos.y - feetY) / Hp);
    } else {
      float X = (-0.25 + lp * 1.5) * u_aspect;
      if (dir < 0.0) X = u_aspect - X;
      p = (vec2(c.x * u_aspect, c.y) - vec2(X, 1.02)) / Hf; // pies en (0,0); arriba es -y
    }
    p.x *= dir;
    // Persona de perfil andando: cabeza con nariz, cuello, hombros, tronco, caderas, brazos con codo y piernas con rodilla.
    float w = tt * 5.2;
    p.y += abs(sin(w)) * 0.02;                                    // el cuerpo sube y baja al dar cada paso
    p.x -= 0.035 * (-p.y);                                        // ligera inclinación hacia delante
    float d = (length((p - vec2(0.01, -0.89)) / vec2(0.07, 0.086)) - 1.0) * 0.075;   // cabeza
    d = min(d, length(p - vec2(0.075, -0.875)) - 0.022);                               // nariz
    d = min(d, sdCapsule(p, vec2(0.0, -0.81), vec2(0.0, -0.76), 0.034));                // cuello
    d = min(d, sdCapsule(p, vec2(-0.015, -0.74), vec2(0.0, -0.5), 0.1));                // tronco
    d = min(d, sdCapsule(p, vec2(-0.01, -0.5), vec2(0.0, -0.45), 0.085));               // caderas
    for (int k = 0; k < 2; k++) {
      float ph = w + float(k) * 3.14159;
      float th = 0.46 * sin(ph);                                                       // muslo
      vec2 hip = vec2(0.0, -0.45);
      vec2 knee = hip + 0.215 * vec2(sin(th), cos(th));
      float sa = th - 0.7 * max(0.0, sin(ph + 1.1));                                   // la pantorrilla se dobla hacia atrás
      vec2 ankle = knee + 0.215 * vec2(sin(sa), cos(sa));
      d = min(d, sdCapsule(p, hip, knee, 0.058));
      d = min(d, sdCapsule(p, knee, ankle, 0.044));
      d = min(d, sdCapsule(p, ankle, ankle + vec2(0.075, 0.012), 0.026));              // pie
      float ta = -0.5 * sin(ph);                                                       // brazo (opuesto a la pierna)
      vec2 sho = vec2(0.0, -0.72);
      vec2 elb = sho + 0.18 * vec2(sin(ta), cos(ta));
      float fa = ta + 0.35 + 0.35 * max(0.0, sin(ph));
      vec2 hand = elb + 0.17 * vec2(sin(fa), cos(fa));
      d = min(d, sdCapsule(p, sho, elb, 0.036));
      d = min(d, sdCapsule(p, elb, hand, 0.03));
    }
    float sh = smoothstep(0.035, -0.012, d) * 0.93;                // sombra algo borrosa, como sobre una cortina
    // la cortina: pliegues verticales y luz que cae hacia abajo
    float fold = 0.9 + 0.1 * sin(c.x * u_aspect * 15.0 + fbm(vec2(c.x * 3.0, c.y * 1.5)) * 1.6);
    light *= fold * (1.05 - 0.2 * c.y);
    col = vec4(mix(light, u_color2, sh), 1.0);
  } else if (u_mode == 18) {
    // Cortinas de teatro que se abren al empezar el clip y se cierran al acabar.
    float op = openAmount(u_local, u_dur, 2.2);
    float w = mix(0.5, 0.13, op);         // ancho de cada mitad
    float side = c.x < 0.5 ? c.x : 1.0 - c.x;
    // borde inferior recogido hacia el lateral cuando están abiertas
    float lift = op * 0.25 * smoothstep(0.0, w, side) * smoothstep(0.35, 1.0, c.y);
    float inside = step(side, w - lift * 0.4);
    float u = side / max(w, 0.001) * 0.5;
    float folds = 0.5 + 0.5 * cos(u * 6.2831 * 7.0 + 0.6 * sin(c.y * 3.0));
    vec3 velvet = u_color * (0.25 + 0.85 * pow(folds, 1.4)) * (0.75 + 0.25 * (1.0 - c.y));
    float val = step(c.y, 0.11 + 0.02 * cos(c.x * 6.2831 * 6.0));        // cenefa superior
    vec3 trim = u_color2 * (0.7 + 0.3 * sin(c.x * 120.0));
    float a = max(inside, val);
    vec3 cc = val > 0.5 ? mix(velvet * 0.8, trim, step(0.085, c.y)) : velvet;
    col = vec4(cc * a, a);
  } else if (u_mode == 19) {
    // Contraventanas de lamas que se abren (girando hacia fuera) y se cierran.
    float op = openAmount(u_local, u_dur, 1.6);
    float pw = 0.5 * cos(op * 1.45);      // ancho aparente de cada hoja
    float side = c.x < 0.5 ? c.x : 1.0 - c.x;
    float a = step(side, pw);
    float lx = side / max(pw, 0.001);
    float sl = fract(c.y * 11.0);
    float slat = 0.55 + 0.45 * smoothstep(0.0, 0.8, sl) * smoothstep(1.0, 0.85, sl);
    float frame = step(lx, 0.1) + step(0.9, lx) + step(c.y, 0.05) + step(0.95, c.y);
    vec3 wood = u_color * (0.6 + 0.4 * fbm(vec2(c.x * 40.0, c.y * 3.0)));
    vec3 cc = mix(wood * slat, wood * 0.9, clamp(frame, 0.0, 1.0)) * (1.0 - 0.45 * op);
    cc = mix(cc, u_color2, smoothstep(0.08, 0.0, sl) * (1.0 - clamp(frame, 0.0, 1.0)) * 0.8);
    col = vec4(cc * a, a);
  } else if (u_mode == 20) {
    // Vidriera: teselas grandes de colores joya, plomo grueso, textura de vidrio y luz más fuerte en el centro.
    vec3 v = voronoi(q * 3.0);
    float h = hash(v.yz);
    vec3 pal = h < 0.22 ? vec3(0.55, 0.03, 0.06) : h < 0.44 ? vec3(0.05, 0.14, 0.55) : h < 0.62 ? vec3(0.75, 0.48, 0.05) : h < 0.78 ? vec3(0.05, 0.4, 0.18) : h < 0.9 ? vec3(0.32, 0.07, 0.48) : vec3(0.8, 0.75, 0.6);
    float lead = smoothstep(0.03, 0.08, v.x);
    vec2 dd = (c - vec2(0.5, 0.45)) * vec2(u_aspect * 0.7, 1.0);
    float center = 0.45 + 0.75 * exp(-dot(dd, dd) * 2.5);
    float glass = 0.8 + 0.2 * fbm(q * 14.0 + h * 10.0) + 0.1 * sin(t * 0.7 + h * 9.0);
    float bright = (0.65 + 0.35 * hash(v.yz + 3.0)) * center * glass;
    vec3 cc = mix(u_color2, pal * u_color * bright * 1.25, lead);
    col = vec4(cc, 1.0);
  } else if (u_mode == 21) {
    // Cristal que se rompe: grietas que se extienden desde el impacto, con destello.
    vec2 p0 = vec2((0.35 + 0.3 * hash1(floor(u_param) + 3.0)) * u_aspect, 0.4 + 0.2 * hash1(floor(u_param) + 9.0));
    // Cristal roto: fractura tipo telaraña. Se reparte el cristal en fragmentos (Voronoi en coordenadas log-polares:
    // pequeños junto al impacto y cada vez mayores), las grietas son los bordes de los fragmentos y se propagan desde el golpe.
    vec2 d = q - p0 + (vec2(vnoise(q * 9.0), vnoise(q * 9.0 + 5.0)) - 0.5) * 0.012;
    float r = length(d);
    float ang = atan(d.y, d.x);
    float R = 1.7 * smoothstep(0.0, 0.4, u_local);
    float NA = 15.0;
    vec2 pc = vec2(log(r + 0.025) * 3.4, (ang / 6.2831853 + 0.5) * NA);
    vec2 n = floor(pc), f = fract(pc);
    float md = 8.0;
    vec2 mr = vec2(0.0), mid = vec2(0.0);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 id = n + g; id.y = mod(id.y, NA);
      vec2 rr = g + vec2(hash(id), hash(id + 17.3)) - f;
      float dd = dot(rr, rr);
      if (dd < md) { md = dd; mr = rr; mid = id; }
    }
    float me = 8.0;
    for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 id = n + g; id.y = mod(id.y, NA);
      vec2 rr = g + vec2(hash(id), hash(id + 17.3)) - f;
      if (dot(mr - rr, mr - rr) > 0.00001) me = min(me, dot(0.5 * (mr + rr), normalize(rr - mr)));
    }
    float ep = me * 0.38 * max(r, 0.025);                       // distancia al borde en unidades de la superficie
    float reach = step(r, R) * (1.0 - smoothstep(0.75, 1.5, r));
    float crack = smoothstep(0.0032, 0.0006, ep) * reach;
    float glow = smoothstep(0.011, 0.0, ep) * 0.22 * reach;
    float shard = (hash(mid + 3.7) - 0.4) * 0.075 * reach * step(0.03, r); // cada fragmento refleja un poco distinto
    float flash = exp(-u_local * 8.0) * step(0.0, u_local) * exp(-r * 2.2);
    float chip = smoothstep(0.035, 0.0, r) * step(0.15, u_local);
    float a = clamp(crack + glow + max(shard, 0.0) + flash * 0.8 + chip * 0.6, 0.0, 1.0);
    vec3 cc = u_color * crack + u_color2 * (glow + max(shard, 0.0)) + vec3(1.0) * (flash * 0.8 + chip * 0.4);
    col = vec4(clamp(cc, 0.0, 1.0), a);
  } else if (u_mode == 22) {
    // Interferencia: estática de televisión, líneas, barra que sube y saltos.
    float fr = floor(t * 24.0);
    float burst = step(0.75, vnoise(vec2(t * 1.3, 7.0)));
    float tear = burst * (hash1(floor(c.y * 30.0) + fr) - 0.5) * 0.08;
    vec2 cc = vec2(c.x + tear, c.y);
    float n = hash(floor(cc * vec2(260.0, 150.0)) + fr * 1.37);
    float scan = 0.7 + 0.3 * sin(c.y * 900.0);
    float bar = smoothstep(0.1, 0.0, abs(fract(c.y + t * 0.25) - 0.5));
    vec3 ccol = mix(vec3(n), mix(u_color, u_color2, step(0.5, hash1(fr))), 0.25 * burst) * scan + bar * 0.25;
    col = vec4(ccol * (0.75 + 0.25 * burst), 1.0);
  } else if (u_mode == 23) {
    // Latido: la luz golpea dos veces por segundo, como un corazón.
    float bpm = max(u_param, 1.0) * 10.0;   // grosor 6 → 60 latidos por minuto
    float ph = mod(t * bpm / 60.0, 1.0);
    float env = exp(-ph * 9.0) + 0.65 * exp(-max(ph - 0.22, 0.0) * 9.0) * step(0.22, ph);
    vec2 dd = (c - 0.5) * vec2(u_aspect, 1.0);
    float v = exp(-dot(dd, dd) * 1.8);
    vec3 cc = mix(u_color2, u_color, env) * (0.15 + 0.85 * v) * (0.25 + 0.75 * env);
    col = vec4(cc, 1.0);
  } else if (u_mode == 24) {
    // Foco buscador: un círculo de luz recorre la fachada sin rumbo fijo.
    vec2 cen = vec2(0.5 + 0.38 * sin(t * 0.47) + 0.08 * sin(t * 1.3), 0.5 + 0.3 * sin(t * 0.79 + 1.0));
    vec2 pp = u_global == 1 ? vec2(qn.x * u_outAspect, qn.y) : vec2(qn.x * u_aspect, qn.y);
    vec2 cc2 = u_global == 1 ? vec2(cen.x * u_outAspect, cen.y) : vec2(cen.x * u_aspect, cen.y);
    float d = length(pp - cc2);
    float rad = 0.16;
    float spot = smoothstep(rad, rad * 0.75, d) + 0.35 * exp(-d * 6.0);
    float a = clamp(spot, 0.0, 1.0);
    col = vec4(mix(u_color2, u_color, smoothstep(rad, 0.0, d)) * a, a);
  } else if (u_mode == 25) {
    // Fuegos artificiales: cohetes que estallan en coronas de chispas con estela que caen.
    vec3 acc = vec3(0.0);
    float A = u_global == 1 ? u_outAspect : u_aspect;
    vec2 pp = vec2(qn.x * A, qn.y);
    for (int k = 0; k < 4; k++) {
      float per = 2.2 + 0.45 * float(k);
      float tk = t + float(k) * 1.13;
      float cyc = floor(tk / per);
      float lt = tk - cyc * per;
      vec2 cen = vec2((0.12 + 0.76 * hash1(cyc * 7.1 + float(k) * 3.3)) * A, 0.15 + 0.3 * hash1(cyc * 3.7 + float(k)));
      vec3 bc = mix(u_color, u_color2, hash1(cyc + float(k) * 11.0));
      if (lt < 0.5) {
        vec2 rp = vec2(cen.x, mix(1.05, cen.y, lt / 0.5));
        float dr = length((pp - rp) * vec2(1.0, 0.35));
        acc += mix(bc, vec3(1.0), 0.5) * exp(-dr * 120.0) * 1.4;
        continue;
      }
      float e = lt - 0.5;
      if (e > 1.9) continue;
      vec2 dv = pp - cen;
      dv.y -= 0.1 * e * e;
      float a = atan(dv.y, dv.x);
      float r = length(dv);
      float N = 42.0;
      float sec = floor(a / 6.2831 * N + 0.5);
      float sa = sec / N * 6.2831;
      float R = 0.34 * (1.0 - exp(-e * 3.2)) * (0.85 + 0.3 * hash1(sec + cyc * 3.0));
      vec2 dirv = vec2(cos(sa), sin(sa));
      // chispa y estela a lo largo del radio
      float along = dot(dv, dirv);
      float perp = abs(dot(dv, vec2(-dirv.y, dirv.x)));
      float trail = smoothstep(R * 0.55, R, along) * step(along, R + 0.01) * exp(-perp * 220.0);
      float spark = exp(-length(dv - dirv * R) * 140.0);
      float tw = 0.65 + 0.35 * sin(e * 35.0 + sec * 2.0);
      float fade = exp(-e * 1.4);
      acc += bc * (spark * 2.0 + trail * 0.9) * fade * tw;
      acc += mix(bc, vec3(1.0), 0.6) * exp(-r * 18.0) * exp(-e * 6.0) * 1.2;
    }
    acc = clamp(acc, 0.0, 1.0);
    col = vec4(acc, clamp(max(acc.r, max(acc.g, acc.b)), 0.0, 1.0));
  } else if (u_mode == 26) {
    // Escarcha: red de cristales de hielo que crece desde los bordes hacia el centro, con destellos.
    float grow = 0.3 * smoothstep(0.0, max(min(4.0, u_dur * 0.5), 0.1), u_local);   // deja el centro despejado
    float e = min(min(c.x * u_aspect, (1.0 - c.x) * u_aspect), min(c.y, 1.0 - c.y));
    float edgeN = e + (fbm(q * 5.0) - 0.5) * 0.22;
    float f = smoothstep(grow + 0.05, grow - 0.05, edgeN);
    float dens = smoothstep(grow, 0.0, edgeN);                  // más tupida junto al borde
    float net = 0.0;
    net += 1.0 - smoothstep(0.0, 0.035, voronoi(q * 9.0).x);
    net += (1.0 - smoothstep(0.0, 0.03, voronoi(q * 22.0 + 3.0).x)) * 0.6;
    net += (1.0 - smoothstep(0.0, 0.025, voronoi(q * 48.0 + 7.0).x)) * 0.35 * dens;
    float haze = 0.18 + 0.25 * dens;
    float gh = hash(floor(q * 70.0));
    float glint = step(0.992, gh) * (0.5 + 0.5 * sin(t * 4.0 + gh * 40.0));
    float a = clamp(f * (haze + net * 0.55) + f * glint, 0.0, 1.0);
    col = vec4(mix(u_color2, u_color, clamp(net, 0.0, 1.0)) * a + vec3(glint * f), a);
  } else if (u_mode == 27) {
    // Aurora boreal: velos de luz que ondulan despacio, con rayos suaves que cuelgan.
    vec3 acc = vec3(0.0);
    for (int l = 0; l < 3; l++) {
      float fl = float(l);
      float x = q.x * (0.7 + 0.25 * fl);
      float yc = 0.18 + 0.14 * fl + 0.09 * sin(x * 1.7 + t * 0.22 + fl * 2.0) + 0.07 * (fbm(vec2(x * 1.2, t * 0.08 + fl * 3.0)) - 0.5);
      float dy = qn.y - yc;
      float band = exp(-max(dy, 0.0) * 5.5) * smoothstep(-0.03, 0.01, dy);
      float rays = 0.7 + 0.3 * sin(x * 16.0 + fbm(vec2(x * 2.5, t * 0.15 + fl)) * 6.0);
      float shimmer = 0.75 + 0.25 * fbm(vec2(x * 3.0 - t * 0.3, dy * 4.0));
      acc += mix(u_color, u_color2, clamp(dy * 3.5 + fl * 0.25, 0.0, 1.0)) * band * rays * shimmer * (0.55 - 0.12 * fl);
    }
    acc = clamp(acc, 0.0, 1.0);
    float edge = smoothstep(0.0, 0.15, c.x) * smoothstep(1.0, 0.85, c.x) * smoothstep(1.0, 0.7, c.y);
    acc *= edge;
    col = vec4(acc, clamp(max(acc.r, max(acc.g, acc.b)) * 0.9, 0.0, 1.0));
  } else if (u_mode == 28) {
    // Estrellas fugaces sobre un cielo con estrellas tenues.
    float A = u_global == 1 ? u_outAspect : u_aspect;
    vec2 pp = vec2(qn.x * A, qn.y);
    vec2 g = pp * 40.0;
    float hs = hash(floor(g));
    float bg = step(0.93, hs) * smoothstep(0.25, 0.0, length(fract(g) - 0.5)) * (0.4 + 0.6 * sin(t * (1.0 + hs * 3.0) + hs * 50.0) * 0.5 + 0.3);
    vec3 acc = u_color2 * bg * 0.6;
    for (int k = 0; k < 3; k++) {
      float per = 3.2 + 1.1 * float(k);
      float tk = t + float(k) * 1.9;
      float cyc = floor(tk / per);
      float lt = (tk - cyc * per) / 0.9;
      if (lt > 1.0) continue;
      vec2 s0 = vec2((0.1 + 0.6 * hash1(cyc * 5.3 + float(k))) * A, 0.05 + 0.35 * hash1(cyc * 2.1 + float(k) * 4.0));
      vec2 dir = normalize(vec2(1.0, 0.45));
      vec2 head = s0 + dir * lt * 0.6 * A;
      vec2 tail = head - dir * 0.22;
      vec2 pa = pp - tail, ba = head - tail;
      float hh = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
      float dd = length(pa - ba * hh);
      float fade = sin(lt * 3.1416);
      acc += u_color * (exp(-dd * 260.0) * hh * hh * 1.6 + exp(-length(pp - head) * 60.0) * 0.6) * fade;
    }
    acc = clamp(acc, 0.0, 1.0);
    float a = clamp(max(acc.r, max(acc.g, acc.b)), 0.0, 1.0);
    col = vec4(acc, a);
  } else if (u_mode == 29) {
    // Portal mágico: un punto de luz crece, gira un remolino de estrellas y anillos recorren el marco.
    float op = openAmount(u_local, u_dur, 2.5);
    vec2 d = (c - 0.5) * vec2(u_aspect, 1.0);
    float r = length(d);
    float ang = atan(d.y, d.x);
    float R = op * 0.6 * max(u_aspect, 1.0);
    float inside = smoothstep(R, R * 0.85, r);
    float sw = ang + 3.0 / (r + 0.15) - t * 1.4;
    float arms = pow(0.5 + 0.5 * sin(sw * 3.0), 3.0) * smoothstep(0.0, 0.5, r / max(R, 0.01));
    vec2 sp = vec2(sw * 1.6, log(r + 0.02) * 4.0 + t * 0.8);
    float st = step(0.92, hash(floor(sp * 6.0))) * smoothstep(0.3, 0.0, length(fract(sp * 6.0) - 0.5));
    float core = exp(-r * 6.0 / max(op, 0.05)) * 1.2;
    float edge = min(min(c.x, 1.0 - c.x) * u_aspect, min(c.y, 1.0 - c.y));
    float rings = 0.0;
    for (int k = 0; k < 3; k++) {
      float ph = fract(t * 0.45 + float(k) / 3.0);
      rings += smoothstep(0.025, 0.0, abs(edge - ph * 0.25)) * (1.0 - ph) * op;
    }
    float flash = exp(-max(u_dur - u_local, 0.0) * 6.0) * step(2.0, u_dur);
    vec3 cc = (mix(u_color2, u_color, arms) * (0.35 + arms) + vec3(st)) * inside + mix(u_color, vec3(1.0), 0.6) * core * op + u_color * rings * 1.2;
    cc += vec3(1.0) * flash * 0.8;
    float a = clamp(max(max(cc.r, cc.g), cc.b), 0.0, 1.0);
    col = vec4(clamp(cc, 0.0, 1.0), a);
  } else if (u_mode == 30) {
    // Explosión de luz: anillos que se expanden, rayos y chispas que salen disparadas.
    float per = max(3.0, min(u_dur, 6.0));
    float lt = mod(u_local, per);
    vec2 d = (c - 0.5) * vec2(u_aspect, 1.0);
    float r = length(d), ang = atan(d.y, d.x);
    // Destello: carga breve, fogonazo blanco, onda de choque fina, rayos y estría horizontal de lente, y chispas con estela que caen.
    float cyc = floor(u_local / per);
    float seed = hash1(cyc + 3.0);
    float pre = smoothstep(0.0, 0.45, lt) * step(lt, 0.45);
    float e = max(lt - 0.45, 0.0);
    float R1 = e * 1.7;
    float shock = exp(-pow((r - R1) / 0.012, 2.0)) * exp(-e * 2.2) + 0.35 * exp(-pow((r - R1 * 0.62) / 0.03, 2.0)) * exp(-e * 3.0);
    float rays = pow(0.5 + 0.5 * sin(ang * 22.0 + seed * 6.0), 26.0) * exp(-r * 3.2) * exp(-e * 4.5) * step(0.0, e);
    float streak = exp(-abs(d.y) * 70.0) * exp(-abs(d.x) * 2.6) * exp(-e * 4.0) * step(0.0, e);
    float core = (exp(-r * 22.0) * 1.6 + 0.45 / (1.0 + pow(r / 0.09, 2.0))) * exp(-e * 7.0) * step(0.0, e);
    float charge = exp(-r * 16.0) * pre * 0.9;
    vec3 cc = vec3(1.0, 0.97, 0.9) * (core + charge)
            + mix(u_color, vec3(1.0), 0.35) * (rays * 1.2 + streak * 0.9)
            + u_color * shock * 1.3;
    // chispas: velocidades repartidas por sector, con estela y caída por gravedad
    float N = 26.0;
    for (int k = 0; k < 2; k++) {
      float sec = floor(ang / 6.2831 * N + 0.5) + float(k) * 0.0;
      float sa = sec / N * 6.2831;
      float vv = 0.55 + 0.9 * hash1(sec * 1.7 + cyc * 7.0 + float(k) * 3.0);
      vec2 vel = vec2(cos(sa), sin(sa)) * vv;
      vec2 pos = vel * e * (1.0 - 0.25 * e) + vec2(0.0, 0.55 * e * e);
      vec2 prev = vel * max(e - 0.06, 0.0) * (1.0 - 0.25 * e) + vec2(0.0, 0.55 * max(e - 0.06, 0.0) * max(e - 0.06, 0.0));
      float sp = smoothstep(0.007, 0.0, sdCapsule(d, prev, pos, 0.0)) * exp(-e * 1.4) * step(0.0, e) * step(0.35, hash1(sec + cyc * 5.0));
      cc += mix(u_color2, vec3(1.0, 0.85, 0.5), 0.5) * sp * 1.6;
    }
    float a = clamp(max(max(cc.r, cc.g), cc.b), 0.0, 1.0);
    col = vec4(clamp(cc, 0.0, 1.0), a);
  } else if (u_mode == 31) {
    // Remolino: brazos en espiral que giran y chispas que caen hacia el centro.
    vec2 d = (c - 0.5) * vec2(u_aspect, 1.0);
    float r = length(d), ang = atan(d.y, d.x);
    float sw = ang - log(r + 0.03) * 2.2 + t * 2.2;
    float arms = pow(0.5 + 0.5 * sin(sw * 4.0), 4.0) * smoothstep(0.65, 0.05, r) * smoothstep(0.0, 0.06, r);
    vec2 sp = vec2(sw * 2.0, log(r + 0.03) * 3.0 - t * 1.5);
    float dots = step(0.9, hash(floor(sp * 5.0))) * smoothstep(0.35, 0.0, length(fract(sp * 5.0) - 0.5)) * smoothstep(0.7, 0.1, r);
    vec3 cc = mix(u_color2, u_color, arms) * arms * 1.4 + vec3(1.0) * dots + u_color * exp(-r * 10.0) * 0.8;
    float a = clamp(max(max(cc.r, cc.g), cc.b), 0.0, 1.0);
    col = vec4(clamp(cc, 0.0, 1.0), a);
  } else if (u_mode == 32) {
    // Sello mágico: círculos de runas que se van activando uno tras otro hasta llenarse de luz.
    vec2 d = (c - 0.5) * vec2(u_aspect, 1.0);
    float r = length(d) / (0.48 * min(u_aspect, 1.0) + 0.02);
    float ang = atan(d.y, d.x);
    float lit = u_local / 1.1;                     // un círculo cada 1,1 s
    vec3 cc = vec3(0.0);
    for (int k = 0; k < 4; k++) {
      float fk = float(k);
      float rr = 0.25 + fk * 0.22;
      float on = smoothstep(fk, fk + 0.35, lit);
      float flashK = exp(-max(lit - fk, 0.0) * 4.0) * step(fk, lit);
      float rot = ang + t * (mod(fk, 2.0) < 1.0 ? 0.4 : -0.3);
      float line = smoothstep(0.012, 0.0, abs(r - rr)) + smoothstep(0.01, 0.0, abs(r - rr - 0.07)) * 0.7;
      float n = 10.0 + fk * 4.0;
      float cell = fract(rot / 6.2831 * n);
      float gid = floor(rot / 6.2831 * n) + fk * 13.0;
      // runa: trazos sencillos dentro de la banda entre las dos circunferencias
      float yb = (r - rr) / 0.07;
      float g = 0.0;
      if (yb > 0.15 && yb < 0.85) {
        float h1 = hash1(gid), h2 = hash1(gid + 3.3);
        g = smoothstep(0.08, 0.0, abs(cell - 0.5)) * step(h1, 0.7);
        g = max(g, smoothstep(0.08, 0.0, abs(yb - 0.5 - (cell - 0.5) * (h2 - 0.5) * 2.0)) * step(abs(cell - 0.5), 0.3));
        g = max(g, smoothstep(0.07, 0.0, abs(length(vec2((cell - 0.5) * 2.0, yb * 2.0 - 1.0)) - 0.55)) * step(0.75, h2));
      }
      cc += mix(u_color2, u_color, on) * (line + g * 0.9) * (0.15 + 0.85 * on) + vec3(1.0) * flashK * line;
    }
    float full = smoothstep(4.0, 4.6, lit);
    cc += mix(u_color, vec3(1.0), 0.5) * full * exp(-r * 2.0) * (0.8 + 0.2 * sin(t * 6.0));
    float a = clamp(max(max(cc.r, cc.g), cc.b), 0.0, 1.0);
    col = vec4(clamp(cc, 0.0, 1.0), a);
  } else if (u_mode == 33) {
    // Ojo gigante (la casa despierta): se abre, mira alrededor, parpadea y a veces bosteza de sueño.
    vec2 d = (c - 0.5) * vec2(u_aspect, 1.0);
    float ex = 0.46 * u_aspect, ey = 0.46;
    vec2 q2 = d / vec2(ex, ey);
    float eye = length(q2);
    float open = smoothstep(0.0, 1.4, u_local);
    float bl = mod(t + 1.3, 4.2);
    float blink = 1.0 - (smoothstep(0.0, 0.08, bl) - smoothstep(0.12, 0.22, bl));
    float lid = open * blink;                               // 1 abierto, 0 cerrado
    vec2 look = vec2(0.35 * sin(t * 0.7) + 0.15 * sin(t * 1.9), 0.18 * sin(t * 0.9 + 1.0));
    vec2 ip = q2 - look;
    float iris = smoothstep(0.42, 0.39, length(ip));
    float pupil = smoothstep(0.2, 0.17, length(ip * vec2(1.0, 1.0)));
    float shine = smoothstep(0.08, 0.05, length(ip - vec2(-0.12, -0.14)));
    float sclera = smoothstep(1.0, 0.96, eye);
    vec3 cc = mix(vec3(0.95, 0.93, 0.88) * mix(vec3(1.0), u_color2, 0.25), u_color * (0.6 + 0.4 * (1.0 - length(ip) / 0.42)), iris);
    cc = mix(cc, vec3(0.02), pupil);
    cc += vec3(1.0) * shine;
    cc *= 0.85 + 0.15 * (1.0 - eye);
    // párpado: la línea de cierre baja desde arriba
    float lidY = mix(1.05, -1.05, lid);          // línea del párpado: arriba del todo = abierto
    float covered = step(q2.y, lidY);
    float lash = smoothstep(0.06, 0.0, abs(q2.y - lidY)) * sclera * step(0.02, 1.0 - lid);
    vec3 outc = mix(cc, u_color2 * 0.25, covered) * sclera;
    outc = mix(outc, vec3(0.02), lash);
    float rim = smoothstep(0.05, 0.0, abs(eye - 0.98));
    outc += u_color * rim * 0.5;
    col = vec4(outc, sclera);
  } else if (u_mode == 50) {
    // Ojo de pupila vertical para rodear un foco: la pupila es un hueco (por ahí sigue saliendo la luz real del foco),
    // alrededor un iris de fibras con aro oscuro, el párpado se abre, mira a los lados, parpadea y la pupila se dilata.
    vec2 d = (c - 0.5) * vec2(u_aspect, 1.0);
    float open = smoothstep(0.0, 1.8, u_local) * (1.0 - smoothstep(max(u_dur - 1.4, 0.1), u_dur, u_local));
    float bl = mod(t + 2.1, 5.3);
    float blink = 1.0 - (smoothstep(0.0, 0.07, bl) - smoothstep(0.11, 0.21, bl));
    float lid = open * blink;
    vec2 look = vec2(0.11 * sin(t * 0.6) + 0.05 * sin(t * 1.7), 0.025 * sin(t * 0.8));
    float ax = d.x / 0.47;
    float H = 0.31 * lid * pow(max(0.0, 1.0 - ax * ax), 0.8);          // semialtura entre párpados
    float inside = step(abs(d.y), H) * step(abs(ax), 1.0);
    float edge = smoothstep(0.014, 0.0, abs(abs(d.y) - H)) * step(abs(ax), 1.0) * smoothstep(0.0, 0.06, lid);
    vec2 ip = d - look;
    float r = length(ip);
    float ang = atan(ip.y, ip.x);
    float irisMask = smoothstep(0.27, 0.25, r);
    float fib = 0.62 + 0.38 * sin(ang * 38.0 + sin(ang * 9.0 + t * 0.5) * 0.7) * (0.65 + 0.35 * sin(r * 80.0));
    vec3 iris = mix(u_color2 * 1.5, u_color, smoothstep(0.03, 0.2, r)) * fib;
    iris += u_color * 0.4 * smoothstep(0.08, 0.0, abs(r - 0.09));
    iris *= 1.0 - 0.75 * smoothstep(0.18, 0.27, r);                    // aro oscuro del iris
    float dil = 0.5 + 0.5 * sin(t * 0.8);
    float sw = mix(0.026, 0.075, dil);
    float pupil = smoothstep(sw, sw * 0.55, abs(ip.x)) * smoothstep(0.225, 0.19, abs(ip.y));
    float a = inside * irisMask * (1.0 - pupil);
    vec3 rim = (u_color * 1.3 + vec3(0.3, 0.2, 0.1)) * edge;
    float halo = exp(-r * 8.0) * 0.28 * lid;
    col = vec4(clamp(iris * a + rim + u_color * halo, 0.0, 1.0), clamp(a + edge + halo, 0.0, 1.0));
  } else if (u_mode == 34) {
    // Boca (la casa despierta): sonríe, se ríe, hace «¡oh!» y bosteza, en un ciclo de 8 s.
    vec2 d = (c - vec2(0.5, 0.45)) * vec2(u_aspect, 1.0);
    float ph = mod(t, 8.0);
    float laugh = smoothstep(1.5, 2.0, ph) * (1.0 - smoothstep(3.5, 4.0, ph));
    float oh = smoothstep(4.0, 4.4, ph) * (1.0 - smoothstep(5.2, 5.6, ph));
    float yawn = smoothstep(6.0, 6.8, ph) * (1.0 - smoothstep(7.4, 8.0, ph));
    float W = min(0.44 * u_aspect, 1.1) * mix(1.0, 0.5, oh) * mix(1.0, 0.75, yawn);
    float Hm = 0.07 + 0.22 * laugh * (0.85 + 0.15 * sin(t * 16.0)) + 0.32 * oh + 0.5 * yawn;
    float curve = 0.16 * (1.0 - oh) * (1.0 - yawn);       // sonrisa: el centro baja, las comisuras suben
    float x = d.x / W;
    float r1 = sqrt(max(1.0 - x * x, 0.0));
    float top = -Hm * 0.5 * r1 + curve * (1.0 - x * x) - curve * 0.5;
    float bot = Hm * 0.5 * r1 + curve * 1.6 * (1.0 - x * x) - curve * 0.5;
    float inMouth = step(abs(x), 1.0) * smoothstep(top - 0.004, top + 0.006, d.y) * smoothstep(bot + 0.004, bot - 0.006, d.y);
    float hgt = max(bot - top, 0.001);
    float teeth = step(d.y, top + hgt * 0.22) * step(0.1, Hm) * step(0.12, fract(x * 3.5 + 0.5));
    float tongue = smoothstep(0.5, 0.42, length(vec2(x * 1.3, (d.y - bot + hgt * 0.3) / hgt))) * step(0.12, Hm);
    vec3 cc = mix(vec3(0.16, 0.0, 0.04), vec3(0.9, 0.25, 0.35), tongue);
    cc = mix(cc, vec3(0.96, 0.95, 0.9), teeth);
    float edgeD = min(abs(d.y - top), abs(d.y - bot));
    float lip = smoothstep(0.03, 0.0, edgeD) * step(abs(x), 1.0) + smoothstep(0.06, 0.0, abs(abs(d.x) - W)) * smoothstep(0.03, 0.0, abs(d.y - (top + bot) * 0.5) - hgt * 0.5);
    lip = clamp(lip, 0.0, 1.0);
    vec3 outc = cc * inMouth * (1.0 - lip) + u_color * lip * 1.2;
    col = vec4(outc, clamp(max(inMouth, lip), 0.0, 1.0));
  } else if (u_mode == 35) {
    // Burbujas que suben tambaleándose, con su brillo.
    vec3 acc = vec3(0.0);
    float a = 0.0;
    for (int l = 0; l < 3; l++) {
      float s = 2.6 + float(l) * 1.8;
      vec2 p = q * s;
      p.y += t * (0.5 + 0.25 * float(l)) * s * 0.18;
      p.x += sin(p.y * 0.8 + float(l) * 2.0 + t) * 0.25;
      vec2 id = floor(p);
      vec2 f = fract(p) - 0.5;
      float h = hash(id + float(l) * 19.0);
      if (h < 0.62) continue;
      float rad = 0.18 + 0.2 * hash(id + 2.0);
      float dd = length(f);
      float rim = smoothstep(rad, rad - 0.04, dd) - smoothstep(rad - 0.05, rad - 0.11, dd);
      float body = smoothstep(rad, rad - 0.02, dd) * 0.12;
      float hl = smoothstep(rad * 0.3, 0.0, length(f - vec2(-rad * 0.35, -rad * 0.35)));
      vec3 bc = mix(u_color, u_color2, hash(id + 5.0));
      acc += bc * (rim * 0.9 + body) + vec3(1.0) * hl * 0.8;
      a += rim * 0.9 + body + hl * 0.8;
    }
    col = vec4(clamp(acc, 0.0, 1.0), clamp(a, 0.0, 1.0));
  } else if (u_mode == 36) {
    // Confeti: papelitos de colores que caen girando.
    vec3 acc = vec3(0.0);
    float a = 0.0;
    for (int l = 0; l < 3; l++) {
      float s = 9.0 + float(l) * 5.0;
      vec2 p = q * s;
      p.y -= t * (0.9 + 0.3 * float(l)) * s * 0.12;
      p.x += sin(p.y * 0.6 + t * 1.5 + float(l)) * 0.35;
      vec2 id = floor(p);
      vec2 f = fract(p) - 0.5;
      float h = hash(id + float(l) * 7.0);
      if (h < 0.55) continue;
      float rot = t * (2.0 + 4.0 * hash(id + 1.0)) + h * 10.0;
      vec2 rf = vec2(cos(rot) * f.x - sin(rot) * f.y, sin(rot) * f.x + cos(rot) * f.y);
      float flip = abs(cos(t * 3.0 + h * 20.0));
      float piece = step(abs(rf.x), 0.16) * step(abs(rf.y), 0.07 * flip + 0.01);
      float hue = hash(id + 9.0);
      vec3 pc = hue < 0.2 ? u_color : hue < 0.4 ? u_color2 : hue < 0.6 ? vec3(0.2, 0.8, 1.0) : hue < 0.8 ? vec3(1.0, 0.3, 0.6) : vec3(0.5, 1.0, 0.3);
      acc += pc * piece * (0.6 + 0.4 * flip);
      a += piece;
    }
    col = vec4(clamp(acc, 0.0, 1.0), clamp(a, 0.0, 1.0));
  } else if (u_mode == 37) {
    // Polvo de hada: una estela de chispas que dibuja lazos por la superficie.
    vec3 acc = vec3(0.0);
    float A = u_global == 1 ? u_outAspect : u_aspect;
    vec2 pp = vec2(qn.x * A, qn.y);
    for (int k = 0; k < 18; k++) {
      float fk = float(k);
      float tk = t - fk * 0.07;
      vec2 hp = vec2((0.5 + 0.38 * sin(tk * 0.9) * cos(tk * 0.37)) * A, 0.5 + 0.32 * sin(tk * 1.3 + 0.7));
      vec2 jit = (vec2(hash1(fk * 3.1 + floor(t * 8.0)), hash1(fk * 7.7 + floor(t * 8.0))) - 0.5) * 0.04 * fk / 18.0;
      float dd = length(pp - hp - jit);
      float fade = 1.0 - fk / 18.0;
      acc += mix(u_color, u_color2, fk / 18.0) * (exp(-dd * 70.0) * 2.2 + exp(-dd * 16.0) * 0.3) * fade;
    }
    float tw = step(0.985, hash(floor(pp * 60.0) + floor(t * 6.0)));
    acc += vec3(tw) * 0.8 * smoothstep(0.4, 0.0, length(pp - vec2((0.5 + 0.38 * sin(t * 0.9) * cos(t * 0.37)) * A, 0.5 + 0.32 * sin(t * 1.3 + 0.7))));
    acc = clamp(acc, 0.0, 1.0);
    col = vec4(acc, clamp(max(acc.r, max(acc.g, acc.b)), 0.0, 1.0));
  } else if (u_mode == 38) {
    // Corazones que suben flotando (cumpleaños, San Valentín).
    vec3 acc = vec3(0.0);
    float a = 0.0;
    for (int l = 0; l < 2; l++) {
      float s = 4.0 + float(l) * 3.0;
      vec2 p = q * s;
      p.y += t * (0.4 + 0.2 * float(l)) * s * 0.2;
      p.x += sin(p.y * 0.9 + t + float(l)) * 0.2;
      vec2 id = floor(p);
      vec2 f = fract(p) - 0.5;
      float h = hash(id + float(l) * 11.0);
      if (h < 0.55) continue;
      float beat = 1.0 + 0.08 * sin(t * 6.0 + h * 9.0);
      // corazón (distancia con signo): punta abajo, lóbulos arriba
      vec2 hp = vec2(abs(f.x), -f.y + 0.32) / (0.62 * beat);
      float dh;
      if (hp.y + hp.x > 1.0) dh = length(hp - vec2(0.25, 0.75)) - 0.35355;
      else dh = sqrt(min(dot(hp - vec2(0.0, 1.0), hp - vec2(0.0, 1.0)), dot(hp - 0.5 * max(hp.x + hp.y, 0.0), hp - 0.5 * max(hp.x + hp.y, 0.0)))) * sign(hp.x - hp.y);
      float heart = smoothstep(0.03, -0.01, dh);
      vec3 hc = mix(u_color, u_color2, hash(id + 4.0));
      acc += hc * heart * (0.8 + 0.2 * (1.0 - length(f)));
      a += heart;
    }
    col = vec4(clamp(acc, 0.0, 1.0), clamp(a, 0.0, 1.0));
  } else if (u_mode == 39) {
    // Farolillos de papel que suben despacio con su llama dentro.
    vec3 acc = vec3(0.0);
    float a = 0.0;
    for (int l = 0; l < 2; l++) {
      float s = 3.0 + float(l) * 2.5;
      vec2 p = q * s;
      p.y += t * (0.18 + 0.08 * float(l)) * s * 0.3;
      p.x += sin(p.y * 0.5 + t * 0.4 + float(l)) * 0.15;
      vec2 id = floor(p);
      vec2 f = fract(p) - 0.5;
      float h = hash(id + float(l) * 23.0);
      if (h < 0.6) continue;
      f.x += 0.04 * sin(t * 0.9 + h * 20.0);                      // se balancea
      vec2 g = f / vec2(0.15, 0.23);
      // farolillo de papel: cilindro algo abombado, más ancho abajo, con aro arriba y abajo
      float hw = 0.82 + 0.18 * cos(g.y * 1.6) + 0.06 * g.y;
      float inX = abs(g.x) / hw;
      float body = smoothstep(1.0, 0.93, inX) * smoothstep(1.0, 0.94, abs(g.y));
      float flick = 0.88 + 0.12 * sin(t * 8.0 + h * 30.0) + 0.05 * sin(t * 17.0 + h * 11.0);
      // luz de la llama a través del papel: muy clara abajo, el papel se oscurece hacia los bordes y la parte alta
      float flame = exp(-length(vec2(g.x * 1.1, g.y - 0.55)) * 2.6) * flick;
      float paper = 0.34 + 0.4 * sqrt(max(0.0, 1.0 - inX * inX)) + 0.2 * smoothstep(0.9, -0.6, g.y);
      float ribs = 0.9 + 0.1 * cos(g.x * 15.0 / max(hw, 0.2));
      float cap = smoothstep(0.78, 0.9, abs(g.y));                // aros superior e inferior
      vec3 lc = mix(u_color, u_color2, hash(id + 2.0));
      vec3 lit = lc * (paper * ribs) + mix(lc, vec3(1.0, 0.9, 0.6), 0.55) * flame * 1.1;
      lit = mix(lit, lc * 0.25, cap * 0.7);
      float halo = exp(-length(f * vec2(1.0, 0.8)) * 5.5) * 0.45 * flick;
      acc += lit * body * flick + lc * halo;
      a += body + halo;
    }
    col = vec4(clamp(acc, 0.0, 1.0), clamp(a, 0.0, 1.0));
  } else if (u_mode == 40) {
    // Sangre que gotea: rezuma por el borde de arriba y caen hilos con su gota, a distinta velocidad.
    float W = 9.0;
    float gx = q.x * W;
    float id = floor(gx);
    float fx = fract(gx) - 0.5;
    float h = hash1(id * 7.31 + 1.7);
    float h2 = hash1(id * 3.17 + 9.1);
    float lt = max(u_local, 0.0);
    float y = q.y;
    float top = 0.04 + 0.03 * vnoise(vec2(q.x * 7.0, 1.0)) + 0.012 * sin(q.x * 37.0);
    float grow = smoothstep(0.0, 1.2, lt);
    // la gota acelera como un líquido espeso (arranca despacio y coge velocidad)
    float len = top * grow + pow(max(0.0, lt - h2 * 1.5), 1.35) * (0.025 + 0.13 * h * h);
    len = mix(top * grow, len, step(0.3, h));
    float wob = 0.82 + 0.36 * vnoise(vec2(y * 16.0, id * 3.3));          // grosor irregular del hilo
    float wq = (0.12 + 0.13 * h) / W * wob * (1.0 - 0.45 * smoothstep(0.0, max(len, 0.001), y));
    float dx = fx / W + (vnoise(vec2(y * 9.0, id)) - 0.5) * 0.05 / W;    // el hilo serpentea un poco
    float body = step(y, len) * smoothstep(wq + 0.6 / W * 0.1, wq, abs(dx));
    float hr = (0.21 + 0.08 * h) / W;
    vec2 hp = vec2(dx, (y - len) * 0.78);
    float head = smoothstep(hr, hr * 0.8, length(hp)) * step(0.3, h) * step(top * grow + 0.005, len);
    float band = step(y, top * grow);
    float m = max(band, max(body, head));
    // volumen de líquido: centro más claro, bordes casi negros, brillo húmedo estrecho y reflejo en la gota
    float prof = clamp(abs(dx) / max(max(wq, hr * head), 0.0001), 0.0, 1.0);
    float thick = sqrt(max(0.0, 1.0 - prof * prof));
    vec3 bc = mix(vec3(0.07, 0.0, 0.01), u_color, 0.3 + 0.7 * thick);
    float spec = pow(clamp(1.0 - abs(dx / max(wq, 0.0001) + 0.38) * 2.6, 0.0, 1.0), 3.0) * (0.5 + 0.5 * body);
    float bulb = smoothstep(hr * 0.45, 0.0, length(hp - vec2(-hr * 0.3, -hr * 0.3))) * head;
    bc += vec3(1.0, 0.55, 0.55) * (spec * 0.4 + bulb * 0.8);
    bc = mix(bc, u_color2 * 0.5, band * 0.35 * (1.0 - body));
    bc *= 0.8 + 0.2 * (1.0 - smoothstep(0.0, 1.0, y));
    col = vec4(bc * m, m);
  } else if (u_mode == 41) {
    // Manos en el cristal: huellas que golpean una tras otra y resbalan dejando el rastro de los dedos.
    float AS = u_global == 1 ? u_outAspect : u_aspect;
    vec3 acc = vec3(0.0);
    float a = 0.0;
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      float lt = u_local - (0.3 + fi * 0.9);
      if (lt < 0.0) continue;
      vec2 cen = vec2((0.14 + 0.72 * fract(fi * 0.381966 + 0.1 + 0.08 * hash1(fi * 5.3 + 2.0))) * AS, 0.35 + 0.35 * hash1(fi * 8.1 + 4.0));
      float slide = min(lt, 5.0) * (0.01 + 0.03 * hash1(fi * 2.7 + 1.0));
      float sc = 0.22 + 0.06 * hash1(fi * 1.9);
      float ang = (hash1(fi * 4.4) - 0.5) * 0.8;
      vec2 p = (q - cen - vec2(0.0, slide)) / sc;
      p = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * p;
      if (hash1(fi * 6.6) > 0.5) p.x = -p.x;
      float d = (length(p / vec2(0.34, 0.4)) - 1.0) * 0.34;
      d = min(d, sdCapsule(p, vec2(-0.25, -0.22), vec2(-0.34, -0.7), 0.075));
      d = min(d, sdCapsule(p, vec2(-0.09, -0.3), vec2(-0.12, -0.9), 0.08));
      d = min(d, sdCapsule(p, vec2(0.09, -0.3), vec2(0.11, -0.94), 0.08));
      d = min(d, sdCapsule(p, vec2(0.25, -0.25), vec2(0.32, -0.78), 0.072));
      d = min(d, sdCapsule(p, vec2(0.28, 0.06), vec2(0.6, -0.24), 0.085));
      d += (fbm(p * 8.0 + fi * 3.0) - 0.5) * 0.06;                         // borde irregular, como una huella real
      // presión desigual: la palma se marca menos en el centro y la huella queda a trozos
      float press = (1.0 - 0.5 * exp(-dot(p - vec2(0.0, 0.02), p - vec2(0.0, 0.02)) * 9.0)) * (0.45 + 0.75 * fbm(p * 5.0 + fi * 7.0));
      float ridge = 0.85 + 0.15 * sin(length(p - vec2(0.0, -0.3)) * 90.0);
      float tex = clamp(press, 0.0, 1.0) * ridge;
      float fill = smoothstep(0.025, -0.02, d) * smoothstep(0.2, 0.55, tex) * (0.55 + 0.45 * tex);
      // al resbalar, los dedos dejan cuatro estelas irregulares que se van apagando
      float fingerX = min(min(abs(p.x + 0.34), abs(p.x + 0.12)), min(abs(p.x - 0.11), abs(p.x - 0.32)));
      float tl = slide / sc + 0.12;
      float trail = step(p.y, -0.7) * step(-0.8 - tl, p.y) * smoothstep(0.075, 0.03, fingerX) * (0.4 + 0.6 * vnoise(vec2(p.x * 26.0, p.y * 7.0))) * (1.0 - clamp((-0.7 - p.y) / tl, 0.0, 1.0)) * 0.55;
      float appear = smoothstep(0.0, 0.08, lt);
      float flash = exp(-lt * 10.0) * smoothstep(0.1, -0.05, d) * 0.6;
      float m = max(fill, trail) * appear;
      acc = max(acc, mix(u_color2, u_color, tex) * m + u_color * flash * 0.7);
      a = max(a, max(m, flash));
    }
    col = vec4(acc, clamp(a, 0.0, 1.0));
  } else if (u_mode == 42) {
    // Arañazos: zarpazos de cuatro uñas que rasgan la superficie y se quedan brillando.
    float AS = u_global == 1 ? u_outAspect : u_aspect;
    float P = 3.0;
    float lt0 = max(u_local, 0.0);
    float n = floor(lt0 / P);
    vec3 acc = vec3(0.0);
    float a = 0.0;
    for (int k = 0; k < 3; k++) {
      float nk = n - float(k);
      if (nk < 0.0) continue;
      float lt = lt0 - nk * P;
      float prog = smoothstep(0.0, 0.2, lt);
      float life = 1.0 - smoothstep(P * 1.6, P * 2.6, lt);
      vec2 A = vec2((0.1 + 0.35 * hash1(nk * 3.3 + 1.0)) * AS, 0.1 + 0.25 * hash1(nk * 7.7));
      vec2 B = vec2((0.5 + 0.4 * hash1(nk * 5.1 + 2.0)) * AS, 0.6 + 0.3 * hash1(nk * 2.9));
      if (hash1(nk * 9.1) > 0.5) { A.x = AS - A.x; B.x = AS - B.x; }
      vec2 dir = normalize(B - A);
      vec2 nor = vec2(-dir.y, dir.x);
      float L = length(B - A);
      for (int i = 0; i < 4; i++) {
        vec2 pa = q - (A + nor * (float(i) - 1.5) * 0.065 + dir * abs(float(i) - 1.5) * 0.03);
        float along = dot(pa, dir);
        float sN = clamp(along / L, 0.0, 1.0);
        float dd = abs(dot(pa, nor) - sin(sN * 3.1416) * 0.035);
        float w = 0.012 * sin(sN * 3.1416) + 0.0015;
        float drawn = step(0.0, along) * step(along, L * prog);
        float cut = smoothstep(w, w * 0.3, dd) * drawn;
        float glow = exp(-dd / (w * 2.5 + 0.004)) * drawn * 0.55;
        float hot = exp(-(L * prog - along) * 18.0) * drawn;
        acc = max(acc, (mix(u_color, u_color2, 0.35 + 0.65 * hot) * cut + u_color * glow) * life);
        a = max(a, max(cut, glow) * life);
      }
    }
    col = vec4(acc, clamp(a, 0.0, 1.0));
  } else if (u_mode == 43) {
    // Luz que falla: un fluorescente que tiembla, cada vez falla más y al final se apaga del todo.
    float k = u_dur > 0.0 ? clamp(u_local / u_dur, 0.0, 1.0) : 0.5;
    float fr = floor(t * 16.0);
    float bad = 0.12 + 0.6 * smoothstep(0.25, 0.85, k);
    float on = step(bad, hash1(fr * 1.31 + 0.7));
    float gap = step(0.8, vnoise(vec2(t * 2.5, 3.0)));
    on *= 1.0 - gap;
    float dies = 1.0 - smoothstep(0.86, 0.96, k);
    float v = (0.6 + 0.4 * hash1(fr + 9.0)) * on * dies;
    vec2 dd = qn - 0.5;
    float vig = clamp(1.0 - dot(dd, dd) * 1.2, 0.0, 1.0);
    vec3 cc = mix(u_color2, u_color, on) * v * vig;
    col = vec4(cc, max(cc.r, max(cc.g, cc.b)));
  } else if (u_mode == 44) {
    // Focos que buscan: haces de luz desde abajo que barren la fachada y a ratos coinciden en un punto.
    float AS = u_global == 1 ? u_outAspect : u_aspect;
    vec3 acc = vec3(0.0);
    float cyc = mod(t, 11.0);
    float meet = smoothstep(7.0, 8.0, cyc) * (1.0 - smoothstep(9.5, 10.5, cyc));
    vec2 target = vec2((0.35 + 0.3 * hash1(floor(t / 11.0) + 3.0)) * AS, 0.35 + 0.2 * hash1(floor(t / 11.0) + 7.0));
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      vec2 spot = vec2((0.5 + 0.42 * sin(t * (0.31 + 0.07 * fi) + fi * 2.1) + 0.08 * sin(t * 1.1 + fi)) * AS, 0.42 + 0.3 * sin(t * (0.43 + 0.05 * fi) + fi * 1.3));
      spot = mix(spot, target + vec2((fi - 1.0) * 0.03, 0.0), meet);
      vec2 org = vec2((0.15 + 0.35 * fi) * AS, 1.35);
      vec2 dir = normalize(spot - org);
      vec2 pq = q - org;
      float along = dot(pq, dir);
      float perp = abs(dot(pq, vec2(-dir.y, dir.x)));
      float L = length(spot - org);
      float wdt = 0.02 + along * 0.11;
      float cone = smoothstep(wdt, wdt * 0.4, perp) * step(0.0, along) * smoothstep(L + 0.12, L - 0.05, along) * 0.22;
      float sp = exp(-pow(length((q - spot) / vec2(1.0, 0.8)) / 0.12, 2.0));
      vec3 lc = mix(u_color, u_color2, fi / 2.0);
      acc += lc * (cone + sp * (0.9 + 0.4 * meet));
    }
    col = vec4(min(acc, vec3(1.0)), clamp(max(acc.r, max(acc.g, acc.b)), 0.0, 1.0));
  } else if (u_mode == 45) {
    // Cinta policial «NO PASAR»: dos cintas que se desenrollan y ondean con el viento.
    float AS = u_global == 1 ? u_outAspect : u_aspect;
    vec3 acc = vec3(0.0);
    float a = 0.0;
    // Tres cintas tensadas con holgura (catenaria), que ondean y se retuercen: al girar, la cinta se estrecha y
    // enseña su cara trasera, más oscura y sin letras. Plástico mate, amarillo apagado, con grano y bordes más oscuros.
    for (int b = 0; b < 3; b++) {
      float fb = float(b);
      float ang = b == 0 ? 0.13 : (b == 1 ? -0.17 : 0.05);
      vec2 cen = vec2(AS * 0.5, b == 0 ? 0.3 : (b == 1 ? 0.55 : 0.8));
      vec2 dir = vec2(cos(ang), sin(ang));
      vec2 pq = q - cen;
      float u = dot(pq, dir);
      float v = dot(pq, vec2(-dir.y, dir.x));
      float halfL = AS * 0.62;
      float x01 = clamp(u / halfL, -1.0, 1.0);
      v -= (0.045 + 0.02 * fb) * (1.0 - x01 * x01);                                     // catenaria
      float wind = 0.0035 * sin(u * 13.0 - t * 4.1 + fb * 2.0) + 0.0025 * sin(u * 29.0 - t * 6.7 + fb);
      v -= wind * (1.0 + 2.0 * abs(x01));
      float tw = cos(u * 4.6 + t * 0.8 + fb * 2.3 + sin(t * 0.37 + fb) * 1.5);          // giro de la cinta
      float W = 0.027 * (0.32 + 0.68 * abs(tw));
      float unroll = (u + AS * 0.75) / (AS * 1.5);
      float shown = step(unroll, smoothstep(0.0, 1.3, u_local - fb * 0.45) * 1.05);
      float inBand = smoothstep(W + 0.0016, W - 0.0016, abs(v)) * shown;
      if (inBand <= 0.0) continue;
      float cell = 0.027 * 2.0 * 0.62 / 9.0 * 6.0;
      float uu = (u + AS) / cell;
      int ci = int(mod(floor(uu), 10.0));
      vec2 f = vec2(fract(uu), (v + W * 0.62) / (W * 2.0 * 0.62));
      float letter = (f.y >= 0.0 && f.y < 1.0 && tw > 0.0) ? glyph57(TAPE_TEXT[ci], vec2(f.x, f.y)) : 0.0;
      float edge = smoothstep(0.72, 1.0, abs(v) / max(W, 0.0001));
      float shade = (0.55 + 0.45 * abs(tw)) * (0.9 + 0.1 * sin(u * 9.0 - t * 3.0 + fb * 2.0));
      float grain = 0.94 + 0.06 * vnoise(vec2(u * 140.0, v * 140.0));
      vec3 base = tw > 0.0 ? u_color : u_color * 0.62;
      vec3 tc = mix(base, u_color2, letter * 0.92) * shade * grain * (1.0 - 0.35 * edge);
      acc = mix(acc, tc, inBand);
      a = max(a, inBand);
    }
    col = vec4(acc * a, a);
  } else if (u_mode == 46) {
    // Sirena de policía: destellos dobles rojo y azul que se alternan y barren la casa.
    float ph = mod(t * 1.6, 2.0);
    float side = step(1.0, ph);
    float p1 = fract(ph);
    float strobe = step(p1, 0.12) + step(0.24, p1) * step(p1, 0.36);
    float sweep = 0.5 + 0.5 * sin((qn.x * 3.0 - t * 4.0) + side * 3.1416);
    float half1 = mix(smoothstep(0.65, 0.35, qn.x), smoothstep(0.35, 0.65, qn.x), side);
    vec3 c1 = mix(u_color, u_color2, side);
    float v = strobe * (0.55 + 0.45 * half1) + 0.25 * sweep * (0.5 + 0.5 * half1);
    col = vec4(c1 * v, clamp(v, 0.0, 1.0));
  } else if (u_mode == 47) {
    // Telarañas en las esquinas de arriba, que se mecen un poco.
    float AS = u_global == 1 ? u_outAspect : u_aspect;
    float m = 0.0;
    for (int k = 0; k < 2; k++) {
      vec2 corner = k == 0 ? vec2(0.0) : vec2(AS, 0.0);
      vec2 d = q - corner;
      if (k == 1) d.x = -d.x;
      float sway = 0.015 * sin(t * 1.2 + float(k) * 2.0);
      float R = 0.55 + 0.1 * float(k);
      float r = length(d);
      if (r > R) continue;
      float ang = atan(d.y, d.x) + sway * r;
      float N = 7.0;
      float sa = ang / 1.5708 * N;
      float rad = smoothstep(0.012, 0.0, abs(fract(sa) - 0.5) * 2.0 * 1.5708 / N * r);
      float seg = fract(sa);
      float rr = r / R * 9.0;
      float sag = 0.18 * sin(seg * 3.1416);
      float ring = smoothstep(0.1, 0.0, abs(fract(rr + sag) - 0.5) * 2.0) * step(0.08, r);
      float fade = 1.0 - smoothstep(R * 0.8, R, r);
      m = max(m, max(rad * step(0.02, d.x) * step(0.02, d.y), ring * 0.8) * fade);
    }
    col = vec4(u_color * m, m * 0.9);
  } else if (u_mode == 48) {
    // Murciélagos que cruzan la fachada batiendo las alas.
    float AS = u_global == 1 ? u_outAspect : u_aspect;
    vec3 acc = vec3(0.0);
    float a = 0.0;
    for (int i = 0; i < 12; i++) {
      float fi = float(i);
      float h = hash1(fi * 7.7 + 1.0);
      float sp = 0.08 + 0.1 * hash1(fi * 3.3);
      float dirx = hash1(fi * 5.9) > 0.35 ? 1.0 : -1.0;
      float x = fract(t * sp + h) * (AS + 0.6) - 0.3;
      if (dirx < 0.0) x = AS - x;
      float y = 0.15 + 0.55 * hash1(fi * 2.1 + 4.0) + 0.06 * sin(t * 1.7 + fi * 3.0);
      float sc = 0.06 + 0.07 * hash1(fi * 9.1);
      sc *= 1.35;
      vec2 p = (q - vec2(x, y)) / sc;
      // aleteo irregular (golpes rápidos y planeos cortos) y balanceo del cuerpo al batir
      float ph = t * (9.0 + 3.0 * h) + fi * 2.0;
      float flap = sin(ph) * (0.75 + 0.25 * sin(ph * 0.31 + fi)) + 0.12;
      p.y += 0.06 * flap;
      p.x *= dirx;
      p *= 1.0 + 0.0 * flap;
      float m = batMask(p, flap, 0.025);
      float inner = batMask(p * 1.1, flap, 0.03);
      float rim = clamp(m - inner, 0.0, 1.0);
      // cuerpo oscuro con membrana algo más clara hacia las puntas y el borde iluminado
      vec3 fillc = u_color2 * (0.28 + 0.16 * smoothstep(0.0, 1.0, abs(p.x)));
      acc = max(acc, fillc * m + u_color * rim * 0.9);
      a = max(a, m);
    }
    col = vec4(acc, a);
  } else if (u_mode == 49) {
    // Arañas que bajan por su hilo, suben y vuelven a bajar moviendo las patas.
    float AS = u_global == 1 ? u_outAspect : u_aspect;
    vec3 acc = vec3(0.0);
    float a = 0.0;
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float x = (0.15 + 0.7 * fract(fi * 0.381966 + 0.2)) * AS;
      float P = 5.0 + 2.0 * hash1(fi * 4.1);
      float ph = mod(t + hash1(fi) * P, P) / P;
      float drop = smoothstep(0.0, 0.35, ph) * (1.0 - smoothstep(0.75, 1.0, ph));
      float y = 0.08 + (0.35 + 0.3 * hash1(fi * 2.7)) * drop + 0.015 * sin(t * 3.0 + fi);
      float sc = 0.085 + 0.03 * hash1(fi * 8.3);
      float thread = smoothstep(0.003, 0.0, abs(q.x - x)) * step(q.y, y) * 0.6;
      vec2 p = (q - vec2(x, y)) / sc;
      float body = smoothstep(1.0, 0.85, length((p - vec2(0.0, 0.35)) / vec2(0.42, 0.5)));
      float head = smoothstep(1.0, 0.85, length((p - vec2(0.0, -0.15)) / vec2(0.25, 0.22)));
      float legs = 0.0;
      for (int k = 0; k < 4; k++) {
        float fk = float(k);
        float w = 0.12 * sin(t * 8.0 + fk * 1.7 + fi);
        float yk = -0.15 + fk * 0.15;
        for (int sgn = 0; sgn < 2; sgn++) {
          float sx = sgn == 0 ? 1.0 : -1.0;
          vec2 knee = vec2(sx * 0.6, yk - 0.35 + w);
          vec2 foot = vec2(sx * 0.95, yk + 0.2 + fk * 0.1 - w);
          legs = max(legs, smoothstep(0.06, 0.02, min(sdCapsule(p, vec2(0.0, yk), knee, 0.0), sdCapsule(p, knee, foot, 0.0))));
        }
      }
      float eyes = smoothstep(0.08, 0.03, min(length(p - vec2(-0.08, -0.2)), length(p - vec2(0.08, -0.2))));
      float m = clamp(body + head + legs, 0.0, 1.0);
      vec3 sc3 = mix(u_color, u_color2, smoothstep(0.3, 1.0, length(p)));
      acc = max(acc, max(sc3 * m, u_color * thread));
      acc = max(acc, vec3(1.0, 0.1, 0.05) * eyes);
      a = max(a, max(max(m, thread), eyes));
    }
    col = vec4(acc, clamp(a, 0.0, 1.0));
  } else {
    // Recurso ausente: rayas magenta (solo en previsualización).
    float st = step(0.5, fract((c.x + c.y) * 10.0));
    col = vec4(mix(vec3(0.35, 0.0, 0.25), vec3(0.9, 0.1, 0.6), st), 1.0);
  }
  o = col * u_opacity;
}`;

const CONTOUR_FS = `#version 300 es
precision highp float;
in vec2 v_pos;
uniform vec2 u_pts[64];
uniform float u_cum[64];
uniform int u_n;
uniform float u_total;
uniform float u_width;
uniform int u_mode;
uniform float u_time;
uniform float u_dur;
uniform vec3 u_color;
uniform vec3 u_color2;
uniform float u_opacity;
uniform vec2 u_res;
uniform float u_margin;
out vec4 o;
void main() {
  vec2 p = v_pos * u_res;
  // En el trazado solo cuenta la parte del perímetro ya dibujada.
  float prog = u_mode == 1 ? clamp(u_time / max(u_dur * 0.6, 0.1), 0.0, 1.0) * u_total : 1e9;
  float best = 1e9, sAt = 0.0;
  for (int i = 0; i < 64; i++) {
    if (i >= u_n) break;
    if (u_cum[i] >= prog) break;
    vec2 a = u_pts[i];
    vec2 b = (i + 1 < u_n) ? u_pts[i + 1] : u_pts[0];
    vec2 ab = b - a;
    float len = max(length(ab), 1e-3);
    float hmax = clamp((prog - u_cum[i]) / len, 0.0, 1.0);
    float h = clamp(dot(p - a, ab) / (len * len), 0.0, hmax);
    float d = length(p - a - ab * h);
    if (d < best) { best = d; sAt = u_cum[i] + h * len; }
  }
  float w = u_width;
  float d = best;
  float core = smoothstep(w * 0.55, w * 0.15, d);
  // El halo se apaga suavemente antes del borde del área de dibujo (sin «cajas» visibles).
  float fade = smoothstep(u_margin, u_margin * 0.45, d);
  float halo = (exp(-d / (w * 2.2)) * 0.75 + exp(-d / (w * 7.0)) * 0.25) * fade;
  vec3 c = vec3(0.0);
  if (u_mode == 0) {
    // Neón: núcleo casi blanco, halo de color y un leve zumbido.
    float hum = 0.92 + 0.08 * sin(u_time * 31.0) * sin(u_time * 7.0);
    c = (mix(u_color, u_color2, 0.65) * core * 1.2 + u_color * halo) * hum;
  } else if (u_mode == 1) {
    // Trazado: el contorno se dibuja a lo largo del perímetro con una chispa en la punta.
    float head = exp(-abs(sAt - prog) / (w * 2.5)) * step(prog, u_total - 1.0) * exp(-d / (w * 1.5));
    c = u_color2 * core + u_color * halo + vec3(1.0, 0.95, 0.8) * head * 1.6;
  } else if (u_mode == 3) {
    // Cometa: una bola de luz recorre el contorno a toda velocidad dejando una estela.
    float speed = u_total / 1.6;
    float head = mod(u_time * speed, u_total);
    float behind = mod(head - sAt + u_total, u_total);
    float trail = exp(-behind / (u_total * 0.12)) * step(behind, u_total * 0.6);
    float ball = exp(-length(vec2(min(behind, u_total - behind), d)) / (w * 1.3)) * 1.8;
    c = (u_color * trail * (core * 1.2 + halo) + mix(u_color2, vec3(1.0), 0.5) * ball) * fade;
  } else {
    // Luces de feria: bombillas que corren por el contorno alternando colores.
    float spacing = w * 4.5;
    float sp = sAt - u_time * w * 9.0;
    float idx = floor(sp / spacing);
    float along = (fract(sp / spacing) - 0.5) * spacing;
    float r = length(vec2(along, d));
    float bulb = exp(-pow(r / (w * 0.75), 2.0)) * 1.4 + exp(-r / (w * 2.2)) * 0.45;
    float on = 0.55 + 0.45 * step(0.5, fract((idx + floor(u_time * 3.0)) * 0.5));
    vec3 bc = mix(u_color, u_color2, step(0.5, fract(idx * 0.5)));
    c = bc * bulb * on * fade + u_color * 0.12 * halo;
  }
  float a = clamp(max(max(c.r, c.g), c.b), 0.0, 1.0);
  o = vec4(clamp(c, 0.0, 1.0), a) * u_opacity;
}`;

const MASK_FS = `#version 300 es
precision mediump float;
out vec4 o;
void main() { o = vec4(0.0); }`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Shader: ${gl.getShaderInfoLog(s)}`);
  return s;
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'a_pos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Programa: ${gl.getProgramInfoLog(p)}`);
  return p;
}

export function hexToRgb(hex: string | undefined, fallback: [number, number, number] = [1, 1, 1]): [number, number, number] {
  if (!hex) return fallback;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export class GLRenderer {
  readonly gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private maskProg: WebGLProgram;
  private contourProg: WebGLProgram;
  private cu: Record<string, WebGLUniformLocation | null> = {};
  private vbo: WebGLBuffer;
  private vao: WebGLVertexArrayObject;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private triCache = new Map<string, Float32Array>();
  private textures = new Set<WebGLTexture>();
  lost = false;
  /** Nombre de la GPU / implementación WebGL (para diagnóstico). */
  rendererName = '';

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: true,
      stencil: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 no está disponible en este equipo.');
    this.gl = gl;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.rendererName = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    this.prog = program(gl, VS, FS);
    this.maskProg = program(gl, VS, MASK_FS);
    this.contourProg = program(gl, VS, CONTOUR_FS);
    for (const n of ['u_pts', 'u_cum', 'u_n', 'u_total', 'u_width', 'u_mode', 'u_time', 'u_dur', 'u_color', 'u_color2', 'u_opacity', 'u_res', 'u_margin']) {
      this.cu[n] = gl.getUniformLocation(this.contourProg, n);
    }
    for (const n of ['u_toSurface', 'u_toContent', 'u_mode', 'u_tex', 'u_opacity', 'u_time', 'u_local', 'u_dur', 'u_param', 'u_surfH', 'u_surfBottom', 'u_rowSplit', 'u_sill', 'u_fromOutput', 'u_aspect', 'u_color', 'u_color2', 'u_keyMode', 'u_keyColor', 'u_keyTh', 'u_keySoft', 'u_despill', 'u_global', 'u_outAspect', 'u_tint', 'u_tintColor']) {
      this.u[n] = gl.getUniformLocation(this.prog, n);
    }
    this.vbo = gl.createBuffer()!;
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
  }

  resize(w: number, h: number) {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  createTexture(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    this.textures.add(t);
    return t;
  }

  upload(t: WebGLTexture, src: TexImageSource) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  }

  deleteTexture(t: WebGLTexture) {
    if (this.textures.delete(t)) this.gl.deleteTexture(t);
  }

  get textureCount() {
    return this.textures.size;
  }

  private tris(points: readonly Vec2[]): Float32Array {
    const key = points.map((p) => `${p.x.toFixed(5)},${p.y.toFixed(5)}`).join(';');
    let t = this.triCache.get(key);
    if (!t) {
      t = triangulateToArray(points);
      if (this.triCache.size > 500) this.triCache.clear();
      this.triCache.set(key, t);
    }
    return t;
  }

  private drawPoly(points: readonly Vec2[]) {
    const data = this.tris(points);
    if (!data.length) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, data.length / 2);
  }

  begin() {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.bindVertexArray(this.vao);
  }

  /**
   * Dibuja las capas de una superficie.
   * @param outline contorno de recorte (coordenadas de salida normalizadas)
   * @param toSurface homografía salida → uv de superficie
   * @param exclusions polígonos donde no se debe proyectar
   */
  drawSurface(outline: readonly Vec2[], toSurface: Mat3, exclusions: readonly (readonly Vec2[])[], layers: Layer[]) {
    if (!layers.length || outline.length < 3) return;
    const gl = this.gl;
    gl.enable(gl.STENCIL_TEST);
    gl.clear(gl.STENCIL_BUFFER_BIT);
    // 1) contorno → 1
    gl.useProgram(this.maskProg);
    gl.colorMask(false, false, false, false);
    gl.stencilFunc(gl.ALWAYS, 1, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    this.drawPoly(outline);
    // 2) exclusiones → 0
    gl.stencilFunc(gl.ALWAYS, 0, 0xff);
    for (const ex of exclusions) if (ex.length >= 3) this.drawPoly(ex);
    gl.colorMask(true, true, true, true);
    // 3) capas
    gl.stencilFunc(gl.EQUAL, 1, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog);
    gl.uniformMatrix3fv(this.u.u_toSurface, true, toSurface);
    gl.uniform1i(this.u.u_tex, 0);
    const data = this.tris(outline);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
    for (const l of layers) {
      if (l.opacity <= 0.001) continue;
      if (l.mode === 'texture' && !l.texture) continue;
      gl.uniformMatrix3fv(this.u.u_toContent, true, l.toContent);
      gl.uniform1i(this.u.u_mode, EFFECT_MODE[l.mode]);
      gl.uniform1f(this.u.u_opacity, Math.min(1, l.opacity));
      gl.uniform1f(this.u.u_time, l.time ?? 0);
      gl.uniform1f(this.u.u_local, l.local ?? l.time ?? 0);
      gl.uniform1f(this.u.u_dur, l.duration ?? 1e6);
      gl.uniform1f(this.u.u_param, l.param ?? 6);
      gl.uniform1f(this.u.u_surfH, l.surfH ?? 1);
      gl.uniform1f(this.u.u_surfBottom, l.surfBottom ?? 1);
      gl.uniform1f(this.u.u_rowSplit, l.rowSplit ?? -1);
      gl.uniform1f(this.u.u_sill, l.sill ?? 0);
      gl.uniform1i(this.u.u_fromOutput, l.fromOutput ? 1 : 0);
      gl.uniform1f(this.u.u_aspect, l.aspect ?? 1);
      gl.uniform3fv(this.u.u_color, l.color ?? [1, 1, 1]);
      gl.uniform3fv(this.u.u_color2, l.color2 ?? [0, 0, 0]);
      gl.uniform1i(this.u.u_keyMode, l.key?.mode ?? 0);
      gl.uniform3fv(this.u.u_keyColor, l.key?.color ?? [0, 1, 0]);
      gl.uniform1f(this.u.u_keyTh, l.key?.threshold ?? 0.3);
      gl.uniform1f(this.u.u_keySoft, l.key?.softness ?? 0.1);
      gl.uniform1i(this.u.u_despill, l.key?.despill ? 1 : 0);
      gl.uniform1i(this.u.u_global, l.global ? 1 : 0);
      gl.uniform1f(this.u.u_outAspect, this.canvas.width / Math.max(1, this.canvas.height));
      gl.uniform1i(this.u.u_tint, l.silhouette ? 1 : 0);
      gl.uniform3fv(this.u.u_tintColor, l.silhouette ?? [0, 0, 0]);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, l.texture ?? null);
      gl.drawArrays(gl.TRIANGLES, 0, data.length / 2);
    }
    gl.disable(gl.BLEND);
    gl.disable(gl.STENCIL_TEST);
  }

  /**
   * Contornos (neón, trazado, luces de feria) sobre el borde de una superficie.
   * Se dibujan con mezcla aditiva y sin recortar por la superficie (el halo ilumina la pared),
   * pero respetando las zonas de exclusión globales.
   */
  drawContour(outline: readonly Vec2[], exclusions: readonly (readonly Vec2[])[], layers: ContourLayer[]) {
    if (!layers.length || outline.length < 2) return;
    const gl = this.gl;
    const W = this.canvas.width, H = this.canvas.height;
    const scale = H / 1080;
    // Puntos en píxeles (máx. 64, se simplifica si hay más) y longitudes acumuladas.
    let pts = outline.map((p) => [p.x * W, p.y * H] as [number, number]);
    if (pts.length > 64) { const k = pts.length / 64; pts = Array.from({ length: 64 }, (_, i) => pts[Math.floor(i * k)]); }
    const flat = new Float32Array(128);
    const cum = new Float32Array(64);
    let total = 0;
    pts.forEach((p, i) => {
      flat[i * 2] = p[0]; flat[i * 2 + 1] = p[1];
      cum[i] = total;
      const q = pts[(i + 1) % pts.length];
      total += Math.hypot(q[0] - p[0], q[1] - p[1]);
    });
    const maxW = Math.max(...layers.map((l) => l.width)) * scale;
    const margin = maxW * 7; // el halo es casi nulo más allá: menos píxeles que calcular
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of pts) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    const box: Vec2[] = [
      { x: (minX - margin) / W, y: (minY - margin) / H }, { x: (maxX + margin) / W, y: (minY - margin) / H },
      { x: (maxX + margin) / W, y: (maxY + margin) / H }, { x: (minX - margin) / W, y: (maxY + margin) / H },
    ];
    gl.enable(gl.STENCIL_TEST);
    gl.clear(gl.STENCIL_BUFFER_BIT);
    gl.useProgram(this.maskProg);
    gl.colorMask(false, false, false, false);
    gl.stencilFunc(gl.ALWAYS, 1, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    this.drawPoly(box);
    gl.stencilFunc(gl.ALWAYS, 0, 0xff);
    for (const ex of exclusions) if (ex.length >= 3) this.drawPoly(ex);
    gl.colorMask(true, true, true, true);
    gl.stencilFunc(gl.EQUAL, 1, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE); // luz que se suma
    gl.useProgram(this.contourProg);
    gl.uniform2fv(this.cu.u_pts, flat);
    gl.uniform1fv(this.cu.u_cum, cum);
    gl.uniform1i(this.cu.u_n, pts.length);
    gl.uniform1f(this.cu.u_total, total);
    gl.uniform2f(this.cu.u_res, W, H);
    const data = this.tris(box);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
    for (const l of layers) {
      if (l.opacity <= 0.001) continue;
      gl.uniform1i(this.cu.u_mode, CONTOUR_MODE[l.mode]);
      gl.uniform1f(this.cu.u_width, l.width * scale);
      gl.uniform1f(this.cu.u_margin, margin);
      gl.uniform1f(this.cu.u_time, l.time);
      gl.uniform1f(this.cu.u_dur, l.duration);
      gl.uniform3fv(this.cu.u_color, l.color);
      gl.uniform3fv(this.cu.u_color2, l.color2);
      gl.uniform1f(this.cu.u_opacity, Math.min(1, l.opacity));
      gl.drawArrays(gl.TRIANGLES, 0, data.length / 2);
    }
    gl.disable(gl.BLEND);
    gl.disable(gl.STENCIL_TEST);
  }

  /** Lee un píxel (para pruebas automatizadas). Debe llamarse justo después de dibujar. */
  readPixel(x: number, y: number): [number, number, number, number] {
    const gl = this.gl;
    const out = new Uint8Array(4);
    gl.readPixels(Math.floor(x), this.canvas.height - 1 - Math.floor(y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return [out[0], out[1], out[2], out[3]];
  }

  dispose() {
    for (const t of this.textures) this.gl.deleteTexture(t);
    this.textures.clear();
    this.triCache.clear();
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
