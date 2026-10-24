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
} as const;

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
out vec4 o;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
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
  if (u_mode == 0) {
    col = texture(u_tex, c); // ya premultiplicado
  } else if (u_mode == 1) {
    col = vec4(u_color, 1.0);
  } else if (u_mode == 2) {
    vec2 d = (c - 0.5) * vec2(u_aspect, 1.0);
    float r = length(d) / max(0.5 * max(u_aspect, 1.0), 0.0001);
    float pulse = 0.75 + 0.25 * sin(u_time * 2.2);
    float k = smoothstep(1.05, 0.0, r) * pulse;
    col = vec4(mix(u_color2, u_color, k) * (0.25 + 0.75 * k), 1.0);
  } else if (u_mode == 3) {
    vec2 g = c * vec2(u_aspect, 1.0) * 14.0;
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
    col = vec4(hsv2rgb(vec3(fract(c.x * 0.6 + c.y * 0.2 + u_time * 0.1), 0.65, 1.0)), 1.0);
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
  } else {
    // Recurso ausente: rayas magenta (solo en previsualización).
    float st = step(0.5, fract((c.x + c.y) * 10.0));
    col = vec4(mix(vec3(0.35, 0.0, 0.25), vec3(0.9, 0.1, 0.6), st), 1.0);
  }
  o = col * u_opacity;
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
    for (const n of ['u_toSurface', 'u_toContent', 'u_mode', 'u_tex', 'u_opacity', 'u_time', 'u_aspect', 'u_color', 'u_color2']) {
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
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, l.texture ?? null);
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
