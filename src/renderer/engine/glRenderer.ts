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
    float k = smoothstep(1.05, 0.0, r) * pulse;
    col = vec4(mix(u_color2, u_color, k) * (0.25 + 0.75 * k), 1.0);
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
    float n = 0.65 + 0.2 * sin(u_time * 7.3) + 0.1 * sin(u_time * 13.1 + 1.3) + 0.05 * sin(u_time * 23.7);
    float v = smoothstep(1.2, 0.0, length((c - vec2(0.5, 0.65)) * vec2(u_aspect, 1.0)));
    col = vec4(u_color * n * (0.35 + 0.65 * v), 1.0);
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
    float k = exp(-pow((x - b) / 0.09, 2.0)) + 0.5 * exp(-pow((x - b + 0.22) / 0.06, 2.0));
    col = vec4(u_color2 * 0.22 + u_color * k * 1.2, 1.0);
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
    float a = smoothstep(0.32, 0.85, n) * 0.8 * (0.55 + 0.45 * qn.y);
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
    for (const n of ['u_toSurface', 'u_toContent', 'u_mode', 'u_tex', 'u_opacity', 'u_time', 'u_aspect', 'u_color', 'u_color2', 'u_keyMode', 'u_keyColor', 'u_keyTh', 'u_keySoft', 'u_despill', 'u_global', 'u_outAspect', 'u_tint', 'u_tintColor']) {
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
