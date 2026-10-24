#!/usr/bin/env node
/**
 * Servidor MCP (Model Context Protocol) de Videomapping Studio, sin dependencias.
 * Permite que un agente de IA (Claude Desktop, Claude Code…) maneje la aplicación abierta.
 *
 * Requisitos: Videomapping Studio abierto y «Control por agentes de IA» activado en Ajustes.
 * Lee la URL y la clave de agent-api.json (carpeta de datos del usuario) o de las variables
 * VMSTUDIO_API_URL y VMSTUDIO_API_TOKEN.
 *
 * Arranque con el propio ejecutable de la aplicación (no hace falta instalar Node):
 *   ELECTRON_RUN_AS_NODE=1 "Videomapping Studio.exe" "<instalación>\resources\mcp\vmstudio-mcp.cjs"
 * o con Node 18+:  node vmstudio-mcp.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const VERSION = '1.0.0';

function infoFile() {
  if (process.env.VMSTUDIO_API_FILE) return process.env.VMSTUDIO_API_FILE;
  const base = process.platform === 'win32'
    ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'Videomapping Studio', 'agent-api.json');
}

function connection() {
  if (process.env.VMSTUDIO_API_URL && process.env.VMSTUDIO_API_TOKEN) return { url: process.env.VMSTUDIO_API_URL, token: process.env.VMSTUDIO_API_TOKEN };
  const f = infoFile();
  if (!fs.existsSync(f)) throw new Error(`Videomapping Studio no está abierto o el control por agentes está desactivado (no existe ${f}). Ábrelo y actívalo en Ajustes → Control por agentes de IA.`);
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

async function call(accion, parametros) {
  const { url, token } = connection();
  let res;
  try {
    res = await fetch(`${url}/api`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ accion, parametros: parametros || {} }),
    });
  } catch (e) {
    throw new Error(`No se puede conectar con Videomapping Studio en ${url}: ¿está abierto? (${e.message})`);
  }
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || `Error HTTP ${res.status}`);
  return j.resultado;
}

const S = (props, required = []) => ({ type: 'object', properties: props, required });
const str = (d) => ({ type: 'string', description: d });
const num = (d) => ({ type: 'number', description: d });
const bool = (d) => ({ type: 'boolean', description: d });

const CLIP_PROPS = {
  espectaculoId: str('Id o nombre del espectáculo (por defecto, el seleccionado)'),
  escenaId: str('Id o nombre de la escena (por defecto, la última)'),
  superficieId: str('Id o nombre de la superficie (ventana, puerta…)'),
  inicio: num('Segundo de la escena en que aparece'),
  duracion: num('Duración en segundos'),
  movimiento: str('Movimiento: none, float, bounce, wave, lookAround, pulse, shake, spin, popIn, popOut, peekLeft, peekRight, peekBottom, peekTop, enterLeft, enterRight, exitLeft, exitRight, crossLeftToRight, crossRightToLeft, rise, grow, shrink'),
  intensidad: num('Intensidad del movimiento (1 = normal)'),
  velocidad: num('Rapidez del movimiento (1 = normal)'),
  x: num('Centro horizontal dentro de la superficie, 0..1'),
  y: num('Centro vertical dentro de la superficie, 0..1'),
  escala: num('Escala (1 = encaja en la superficie)'),
  rotacion: num('Grados'),
  opacidad: num('0..1'),
  fundidoEntrada: num('Segundos'),
  fundidoSalida: num('Segundos'),
  bucle: bool('Repetir el recurso en bucle'),
  voltear: bool('Espejo horizontal'),
};

const TOOLS = [
  { name: 'estado', description: 'Resumen del proyecto abierto: instalaciones y superficies (ids), espectáculos y escenas, recursos, personajes y estado de la salida. Llámalo primero.', inputSchema: S({}), accion: 'estado' },
  { name: 'captura', description: 'Imagen de lo que se está proyectando (o del editor si la salida está cerrada). Úsala para comprobar visualmente el resultado.', inputSchema: S({ de: str('«salida» (por defecto) o «editor»') }), accion: 'captura' },
  { name: 'obtener_escena', description: 'Detalle completo (JSON) de una escena: clips, posiciones, tiempos y sonidos.', inputSchema: S({ espectaculoId: str('Id o nombre'), escenaId: str('Id o nombre') }), accion: 'obtener_escena' },
  { name: 'abrir_proyecto', description: 'Abre un proyecto (ruta al archivo project.vmsp o a su carpeta).', inputSchema: S({ ruta: str('Ruta absoluta') }, ['ruta']), accion: 'abrir_proyecto' },
  { name: 'crear_espectaculo', description: 'Crea un espectáculo nuevo asignado a una instalación.', inputSchema: S({ nombre: str('Nombre'), instalacionId: str('Id de instalación (por defecto la primera)') }, ['nombre']), accion: 'crear_espectaculo' },
  { name: 'crear_escena', description: 'Añade una escena a un espectáculo.', inputSchema: S({ espectaculoId: str('Id o nombre'), nombre: str('Nombre'), duracion: num('Segundos'), transicion: str('cut, fade o crossfade'), posicion: num('Índice (por defecto, al final)') }, ['nombre']), accion: 'crear_escena' },
  { name: 'editar_escena', description: 'Cambia nombre, duración, transición, notas o activación de una escena.', inputSchema: S({ espectaculoId: str(''), escenaId: str(''), nombre: str(''), duracion: num(''), transicion: str('cut, fade, crossfade'), activa: bool(''), notas: str('') }, ['escenaId']), accion: 'editar_escena' },
  { name: 'anadir_rotulo', description: 'Añade un rótulo de texto animado a una superficie (p. ej. «¡Feliz Halloween!»).', inputSchema: S({ ...CLIP_PROPS, texto: str('Texto (\\n para varias líneas)'), letra: str('divertida, gruesa, elegante, manuscrita o simple'), color: str('#rrggbb'), contorno: str('#rrggbb'), halo: bool('Halo luminoso') }, ['superficieId', 'texto']), accion: 'anadir_rotulo' },
  { name: 'anadir_clip', description: 'Añade a una superficie un recurso (recursoId), un personaje (personajeId + animacion) o un efecto (efecto: solid, glow, stars, flicker, rainbow).', inputSchema: S({ ...CLIP_PROPS, recursoId: str('Id o nombre del recurso'), personajeId: str('Id o nombre del personaje'), animacion: str('Id o nombre de la animación'), efecto: str('solid, glow, stars, flicker, rainbow'), color: str('#rrggbb (efectos)'), color2: str('#rrggbb (efectos)') }, ['superficieId']), accion: 'anadir_clip' },
  { name: 'editar_clip', description: 'Modifica un clip existente (tiempos, posición, movimiento, superficie, texto…).', inputSchema: S({ ...CLIP_PROPS, clipId: str('Id del clip'), texto: str(''), color: str(''), contorno: str(''), letra: str('') }, ['clipId']), accion: 'editar_clip' },
  { name: 'eliminar_clip', description: 'Elimina un clip.', inputSchema: S({ espectaculoId: str(''), clipId: str('') }, ['clipId']), accion: 'eliminar_clip' },
  { name: 'anadir_sonido', description: 'Añade un efecto de sonido a una escena en un instante.', inputSchema: S({ espectaculoId: str(''), escenaId: str(''), recursoId: str('Id o nombre del audio'), inicio: num('Segundo'), volumen: num('0..2'), bucle: bool(''), continuar: bool('Seguir sonando tras la escena') }, ['recursoId']), accion: 'anadir_sonido' },
  { name: 'anadir_musica', description: 'Añade música de fondo continua al espectáculo.', inputSchema: S({ espectaculoId: str(''), recursoId: str('Id o nombre del audio'), volumen: num('0..2'), inicio: num('Segundo del espectáculo'), bucle: bool('') }, ['recursoId']), accion: 'anadir_musica' },
  { name: 'importar_recurso', description: 'Importa al proyecto un archivo del disco (imagen, vídeo o audio).', inputSchema: S({ ruta: str('Ruta absoluta'), nombre: str('Nombre a mostrar') }, ['ruta']), accion: 'importar_recurso' },
  { name: 'quitar_fondo', description: 'Quita el fondo de un recurso al reproducirlo (croma verde, blanco o negro).', inputSchema: S({ recursoId: str(''), modo: str('color, dark o none'), color: str('#rrggbb del fondo'), tolerancia: num('0..1'), suavidad: num('0..1') }, ['recursoId']), accion: 'quitar_fondo' },
  { name: 'crear_superficie', description: 'Crea una superficie rectangular (ventana, puerta…). Coordenadas normalizadas 0..1 (o píxeles con px=true).', inputSchema: S({ instalacionId: str(''), nombre: str(''), tipo: str('window, door, garage, wall, roof, shopwindow, stage, decor, other'), x: num('Izquierda'), y: num('Arriba'), ancho: num(''), alto: num(''), px: bool('Coordenadas en píxeles de salida') }, ['nombre', 'x', 'y', 'ancho', 'alto']), accion: 'crear_superficie' },
  { name: 'mover_esquinas', description: 'Fija las 4 esquinas de una superficie (perspectiva). [[x,y]×4] normalizadas 0..1 o en píxeles con px=true.', inputSchema: S({ instalacionId: str(''), superficieId: str(''), esquinas: { type: 'array', items: { type: 'array', items: { type: 'number' } } }, px: bool('') }, ['superficieId', 'esquinas']), accion: 'mover_esquinas' },
  { name: 'pantallas', description: 'Lista las pantallas conectadas (para elegir la del proyector).', inputSchema: S({}), accion: 'pantallas' },
  { name: 'abrir_salida', description: 'Abre la salida al proyector a pantalla completa (por defecto en la pantalla sin el editor).', inputSchema: S({ pantallaId: num('Id de pantalla'), pantallaCompleta: bool('') }), accion: 'abrir_salida' },
  { name: 'cerrar_salida', description: 'Cierra la salida al proyector.', inputSchema: S({}), accion: 'cerrar_salida' },
  { name: 'modo_salida', description: 'Qué muestra la salida: negro, calibracion o espectaculo.', inputSchema: S({ modo: str('negro, calibracion, espectaculo'), espectaculoId: str('') }, ['modo']), accion: 'modo_salida' },
  { name: 'reproducir', description: 'Reproduce un espectáculo en la salida (debe estar abierta).', inputSchema: S({ espectaculoId: str(''), desde: num('Segundo inicial') }), accion: 'reproducir' },
  { name: 'pausar', description: 'Pausa la reproducción.', inputSchema: S({}), accion: 'pausar' },
  { name: 'detener', description: 'Detiene y vuelve al principio.', inputSchema: S({}), accion: 'detener' },
  { name: 'ir_a', description: 'Salta a un segundo del espectáculo.', inputSchema: S({ segundos: num('') }, ['segundos']), accion: 'ir_a' },
  { name: 'guardar', description: 'Guarda el proyecto.', inputSchema: S({}), accion: 'guardar' },
  { name: 'deshacer', description: 'Deshace el último cambio.', inputSchema: S({}), accion: 'deshacer' },
  { name: 'accion', description: 'Llamada genérica a cualquier acción de la API (ver docs/AGENTES.md), p. ej. obtener_proyecto o reemplazar_proyecto.', inputSchema: S({ accion: str('Nombre de la acción'), parametros: { type: 'object' } }, ['accion']), accion: null },
];

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}
function replyError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return reply(id, {
      protocolVersion: (params && params.protocolVersion) || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'videomapping-studio', version: VERSION },
      instructions: 'Controla Videomapping Studio (videomapping de fachadas). Empieza con «estado» para conocer ids de superficies, espectáculos y escenas. Todos los cambios se pueden deshacer. Usa «captura» para ver el resultado y «guardar» al terminar.',
    });
  }
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') return reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  if (method === 'tools/call') {
    const t = TOOLS.find((x) => x.name === (params && params.name));
    if (!t) return replyError(id, -32602, `Herramienta desconocida: ${params && params.name}`);
    const args = (params && params.arguments) || {};
    try {
      const accion = t.accion || args.accion;
      const result = await call(accion, t.accion ? args : args.parametros || {});
      if (accion === 'captura' && result && result.png) {
        return reply(id, { content: [{ type: 'image', data: result.png, mimeType: 'image/png' }, { type: 'text', text: `Captura de ${result.de} (${result.ancho}×${result.alto})` }] });
      }
      return reply(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
    } catch (e) {
      return reply(id, { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
    }
  }
  if (id !== undefined) replyError(id, -32601, `Método no admitido: ${method}`);
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    pending++;
    handle(msg)
      .catch((e) => msg.id !== undefined && replyError(msg.id, -32603, e.message))
      .finally(() => { pending--; if (ended && !pending) process.exit(0); });
  }
});
let pending = 0;
let ended = false;
process.stdin.on('end', () => { ended = true; if (!pending) process.exit(0); });
// Si el cliente cierra la conexión, terminar sin errores.
process.stdout.on('error', () => process.exit(0));
