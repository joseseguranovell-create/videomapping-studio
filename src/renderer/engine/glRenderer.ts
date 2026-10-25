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
} as const;

export const CONTOUR_MODE = { neon: 0, drawOn: 1, chase: 2 } as const;

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
  /** Alto de la superficie en la salida (0..1): para efectos de fachada con tamaño de ventana. */
  surfH?: number;
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
float openAmount(float lt, float dur, float tin) {
  float k = min(tin, dur * 0.3);
  return smoothstep(0.0, k, lt) * (1.0 - smoothstep(dur - k, dur, lt));
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

void main() {
  vec3 s = u_toSurface * vec3(v_pos, 1.0);
  if (s.z <= 0.0) discard;
  vec2 uv = s.xy / s.z;
  vec2 c = (u_toContent * vec3(uv, 1.0)).xy;
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
    // Fuego: ruido deformado (domain warping) que sube y se apaga con la altura.
    float h = 1.0 - qn.y;
    vec2 p = vec2(q.x * 3.2, h * 2.6);
    vec2 warp = vec2(fbm(p * 0.8 + vec2(0.0, -t * 0.9)), fbm(p * 0.8 + vec2(5.2, -t * 1.1)));
    float n = fbm(p + warp * 1.4 - vec2(0.0, t * 2.4));
    float inten = n * (1.25 - h * 1.35);
    inten = pow(clamp(inten * 1.7 - 0.15, 0.0, 1.0), 1.5);
    vec3 fc = mix(u_color * 0.35, u_color, smoothstep(0.0, 0.35, inten));
    fc = mix(fc, u_color2, smoothstep(0.35, 0.75, inten));
    fc = mix(fc, vec3(1.0, 0.95, 0.8), smoothstep(0.85, 1.0, inten) * 0.7);
    col = vec4(fc * inten, inten);
  } else if (u_mode == 11) {
    // Niebla que se desliza.
    float n = fbm(q * 2.2 + vec2(t * 0.06, t * 0.015)) * 0.65 + fbm(q * 4.5 - vec2(t * 0.11, 0.0)) * 0.35;
    float edge = smoothstep(0.0, 0.12, c.x) * smoothstep(1.0, 0.88, c.x) * smoothstep(0.0, 0.15, c.y);
    float a = smoothstep(0.32, 0.85, n) * 0.8 * (0.55 + 0.45 * qn.y) * edge;
    col = vec4(mix(u_color2, u_color, n) * a, a);
  } else if (u_mode == 12) {
    // Lluvia: gotas alargadas cayendo en diagonal.
    float a = 0.0;
    for (int l = 0; l < 2; l++) {
      float s = 24.0 + float(l) * 18.0;
      vec2 p = q * vec2(s, s * 0.35);
      p.x += p.y * 0.12;
      float cx = floor(p.x);
      float off = hash1(cx * 1.7 + float(l) * 13.0);
      float y = fract(p.y * 0.25 - t * (1.3 + off) + off * 10.0);
      float dx = abs(fract(p.x) - 0.5);
      a += smoothstep(0.08, 0.0, dx) * smoothstep(0.0, 0.25, y) * smoothstep(0.45, 0.25, y) * (0.5 + 0.5 * off);
    }
    a = clamp(a, 0.0, 1.0) * 0.85;
    col = vec4(u_color * a, a);
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
      float sep = 0.26 + 0.06 * h;
      float rx = 0.1 + 0.03 * h3, ry = 0.075;
      float look = 0.35 * sin(t * 0.9 + h * 20.0);
      vec3 ec = h3 > 0.5 ? u_color : u_color2;
      for (int k = 0; k < 2; k++) {
        vec2 e = cen + vec2(k == 0 ? -sep * 0.5 : sep * 0.5, 0.0);
        vec2 d = (f - e) / vec2(rx, ry * max(o, 0.001));
        // forma almendrada: más estrecha en los extremos
        float dist = length(vec2(d.x, d.y * (1.0 + 0.6 * d.x * d.x)));
        float iris = smoothstep(1.0, 0.75, dist) * step(0.02, o);
        float px = d.x - look;
        float slit = h > 0.7 ? smoothstep(0.22, 0.12, abs(px)) : smoothstep(0.45, 0.32, length(vec2(px, d.y * 0.8)));
        float glow = exp(-length((f - e) / vec2(rx, ry)) * 1.1) * 0.7 * o;
        acc += ec * (iris * (1.0 - 0.92 * slit) * (0.8 + 0.4 * (1.0 - dist))) + ec * glow;
        a += iris + glow;
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
      p = vec2((v_pos.x * u_outAspect - X) / (Hf * u_surfH), (c.y - 1.02) / Hf);
    } else {
      float X = (-0.25 + lp * 1.5) * u_aspect;
      if (dir < 0.0) X = u_aspect - X;
      p = (vec2(c.x * u_aspect, c.y) - vec2(X, 1.02)) / Hf; // pies en (0,0); arriba es -y
    }
    p.x *= dir;
    float w = tt * 7.0;
    float bob = abs(sin(w)) * 0.015;
    p.y += bob;
    float d = length(p - vec2(0.0, -0.86)) - 0.085;                       // cabeza
    d = min(d, sdCapsule(p, vec2(0.0, -0.74), vec2(0.0, -0.42), 0.1));    // tronco
    d = min(d, sdCapsule(p, vec2(0.0, -0.44), vec2(0.13 * sin(w), -0.02), 0.045));
    d = min(d, sdCapsule(p, vec2(0.0, -0.44), vec2(-0.13 * sin(w), -0.02), 0.045));
    d = min(d, sdCapsule(p, vec2(0.0, -0.7), vec2(-0.12 * sin(w), -0.44), 0.035));
    d = min(d, sdCapsule(p, vec2(0.0, -0.7), vec2(0.12 * sin(w), -0.44), 0.035));
    float sh = smoothstep(0.03, -0.01, d) * 0.92;                          // sombra suave, como sobre una cortina
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
    vec2 d = q - p0;
    float r = length(d);
    float ang = atan(d.y, d.x) / 6.2831 + 0.5;
    float R = 1.6 * smoothstep(0.0, 0.35, u_local);
    float N = 13.0;
    float jag = (vnoise(vec2(r * 18.0, floor(ang * N))) - 0.5) * 0.35 / N;
    float sa = fract(ang * N + jag * N);
    float radial = smoothstep(0.012, 0.0, min(sa, 1.0 - sa) / N * 6.2831 * max(r, 0.02)) * step(r, R);
    float ring = smoothstep(0.012, 0.0, abs(fract(r * 4.0 + vnoise(vec2(ang * 40.0, 2.0)) * 0.3) - 0.5) * 0.25) * step(r, min(R, 0.9)) * step(0.06, r);
    float lines = clamp(radial + ring * 0.7, 0.0, 1.0) * (1.0 - smoothstep(0.6, 1.4, r));
    float flash = exp(-u_local * 7.0) * step(0.0, u_local);
    float a = clamp(lines + flash * 0.9, 0.0, 1.0);
    col = vec4(mix(u_color2, u_color, lines) * a + vec3(flash), a);
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
    for (const n of ['u_toSurface', 'u_toContent', 'u_mode', 'u_tex', 'u_opacity', 'u_time', 'u_local', 'u_dur', 'u_param', 'u_surfH', 'u_aspect', 'u_color', 'u_color2', 'u_keyMode', 'u_keyColor', 'u_keyTh', 'u_keySoft', 'u_despill', 'u_global', 'u_outAspect', 'u_tint', 'u_tintColor']) {
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
