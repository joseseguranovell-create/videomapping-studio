/**
 * Acciones de la API para agentes de IA (ver docs/AGENTES.md).
 * Todas las modificaciones pasan por el historial del editor («Agente: …») y se pueden deshacer.
 * Nombres de acciones y parámetros en español; coordenadas de superficie normalizadas 0..1
 * (o en píxeles de salida si se indica `px: true`).
 */
import { useStore } from './store';
import { afterOpen, assetFromImported, saveProject, transport, vm, refreshMissing, addPackToProject } from './services';
import { generateShow, soundKitFrom, defaultMusic, SHOW_STYLES, type ShowStyle } from '../../shared/generator';
import { protagonistOptions } from './components/ShowWizard';
import { choreography, CHOREO_KINDS, type ChoreoKind } from '../../shared/choreo';
import { orderedSurfaces } from '../../shared/templates';
import { parseProject } from '../../shared/schema';
import { createClip, createScene, createShow, createSoundCue, createSurface, createInstallation, effectSource, createLightCue, createLightDevice } from '../../shared/factory';
import { autoLights } from '../../shared/lights';
import { layoutShow } from '../../shared/timeline';
import { applyTemplate, templateSounds, TEMPLATE_KINDS, type TemplateKind } from '../../shared/templates';
import { newId } from '../../shared/ids';
import { orderQuad } from '../../shared/geometry';
import {
  Clip as ClipSchema, MOTION_PRESETS, EFFECT_KINDS, TEXT_FONTS, SURFACE_KINDS, LIGHT_ACTIONS, LIGHT_KINDS, type LightKind, type LightCue,
  type Clip, type ClipSource, type Project, type Scene, type Show, type MotionPreset, type EffectKind,
} from '../../shared/model';
import type { ImportedFile, LiveTarget, OpenedProject } from '../../shared/api';

type P = Record<string, unknown>;
const st = () => useStore.getState();

function fail(msg: string): never {
  throw new Error(msg);
}
function str(p: P, k: string, required = true): string {
  const v = p[k];
  if (v === undefined || v === null || v === '') { if (required) fail(`Falta el parámetro «${k}»`); return ''; }
  return String(v);
}
function num(p: P, k: string, def?: number): number {
  const v = p[k];
  if (v === undefined || v === null) { if (def === undefined) fail(`Falta el parámetro numérico «${k}»`); return def; }
  const n = Number(v);
  if (!Number.isFinite(n)) fail(`«${k}» debe ser un número`);
  return n;
}
function project(): Project {
  return st().project ?? fail('No hay ningún proyecto abierto');
}
function findShow(p: P): Show {
  const pr = project();
  const id = (p.espectaculoId as string) ?? st().showId ?? pr.shows[0]?.id;
  return pr.shows.find((s) => s.id === id || s.name === id) ?? fail(`No existe el espectáculo «${id}». Usa «estado» para ver los ids.`);
}
function findScene(sh: Show, p: P): Scene {
  const id = p.escenaId as string | undefined;
  if (id === undefined) return sh.scenes[sh.scenes.length - 1] ?? fail('El espectáculo no tiene escenas');
  const idx = typeof id === 'number' ? id : -1;
  return sh.scenes.find((s) => s.id === id || s.name === id) ?? sh.scenes[idx] ?? fail(`No existe la escena «${id}»`);
}
function surfaceFor(sh: Show, p: P): string {
  const pr = project();
  const inst = pr.installations.find((i) => i.id === sh.installationId) ?? fail('El espectáculo no tiene instalación asignada');
  const id = str(p, 'superficieId');
  return (inst.surfaces.find((s) => s.id === id || s.name.toLowerCase() === id.toLowerCase()) ?? fail(`No existe la superficie «${id}» en «${inst.name}»`)).id;
}
function edit(label: string, fn: (d: Project) => void) {
  project();
  st().update(`Agente: ${label}`, fn);
}
function motion(p: P) {
  const preset = (p.movimiento as string) ?? 'none';
  if (!(MOTION_PRESETS as readonly string[]).includes(preset)) fail(`Movimiento no válido. Opciones: ${MOTION_PRESETS.join(', ')}`);
  return { preset: preset as MotionPreset, intensity: num(p, 'intensidad', 1), speed: num(p, 'velocidad', 1) };
}

function summary() {
  const s = st();
  const pr = s.project;
  if (!pr) return { proyecto: null, aviso: 'No hay proyecto abierto. Usa «abrir_proyecto» con la ruta de project.vmsp.' };
  return {
    proyecto: { nombre: pr.name, archivo: s.file, cambiosSinGuardar: s.dirty, recursosAusentes: s.missing.length },
    instalaciones: pr.installations.map((i) => ({
      id: i.id, nombre: i.name, salida: i.output, calibrada: i.calibratedAt,
      superficies: i.surfaces.map((x) => ({ id: x.id, nombre: x.name, tipo: x.kind, forma: x.shape, esquinas: x.quad.map((q) => [round(q.x), round(q.y)]) })),
    })),
    espectaculos: pr.shows.map((sh) => ({
      id: sh.id, nombre: sh.name, instalacionId: sh.installationId, duracion: layoutShow(sh).duration, bucle: sh.loop,
      musica: sh.music.map((m) => m.assetId),
      escenas: sh.scenes.map((sc) => ({ id: sc.id, nombre: sc.name, duracion: sc.duration, clips: sc.clips.length, sonidos: sc.sounds.length, luces: sc.lights.length })),
    })),
    recursos: pr.assets.map((a) => ({ id: a.id, nombre: a.name, tipo: a.kind, duracion: a.duration, transparencia: a.hasAlpha })),
    luces: pr.lights.map((d) => ({ id: d.id, nombre: d.name, tipo: d.kind, conectada: !!d.entityId })),
    personajes: pr.characters.map((c) => ({ id: c.id, nombre: c.name, animaciones: c.animations.map((a) => ({ id: a.id, nombre: a.name, movimiento: a.motion.preset })) })),
    salida: { abierta: s.output.open, modo: s.outputMode, espectaculoId: s.outputShowId, reproduciendo: s.outputStatus?.playing ?? false, tiempo: s.outputStatus?.cycleTime ?? 0, escena: s.outputStatus?.sceneName ?? null },
    opciones: { movimientos: MOTION_PRESETS, efectos: EFFECT_KINDS, letras: TEXT_FONTS, tiposSuperficie: SURFACE_KINDS, plantillas: TEMPLATE_KINDS, efectosLuz: LIGHT_ACTIONS },
  };
}
const round = (n: number) => Math.round(n * 10000) / 10000;

function sceneDetail(sh: Show, sc: Scene) {
  return { espectaculoId: sh.id, escena: sc };
}

function buildSource(p: P): { source: ClipSource; extra: Partial<Clip> } {
  const pr = project();
  if (p.texto !== undefined) {
    const font = (p.letra as string) ?? 'terror';
    if (!(TEXT_FONTS as readonly string[]).includes(font)) fail(`Letra no válida: ${TEXT_FONTS.join(', ')}`);
    return { source: { type: 'text', text: String(p.texto), font: font as any, color: (p.color as string) ?? '#ffb347', outline: (p.contorno as string) ?? '#2b1240', glow: p.halo !== false, bold: true }, extra: {} };
  }
  if (p.efecto !== undefined) {
    const e = String(p.efecto);
    if (!(EFFECT_KINDS as readonly string[]).includes(e)) fail(`Efecto no válido: ${EFFECT_KINDS.join(', ')}`);
    const over: Record<string, unknown> = {};
    if (p.color !== undefined) over.color = String(p.color);
    if (p.color2 !== undefined) over.color2 = String(p.color2);
    if (p.grosor !== undefined) over.width = num(p, 'grosor');
    if (p.espacio !== undefined) over.space = p.espacio === 'fachada' || p.espacio === 'facade' ? 'facade' : 'surface';
    return { source: effectSource(e as EffectKind, over), extra: { fit: 'stretch' } };
  }
  if (p.personajeId !== undefined) {
    const ch = pr.characters.find((c) => c.id === p.personajeId || c.name === p.personajeId) ?? fail(`No existe el personaje «${p.personajeId}»`);
    const an = ch.animations.find((a) => a.id === p.animacion || a.name === p.animacion) ?? ch.animations[0] ?? fail('El personaje no tiene animaciones');
    return { source: { type: 'asset', assetId: an.assetId }, extra: { name: `${ch.name}: ${an.name}`, characterId: ch.id, animationId: an.id, motion: { ...an.motion }, loop: an.loop, fit: an.fit, scale: an.scale, duration: an.duration } };
  }
  const id = str(p, 'recursoId');
  const a = pr.assets.find((x) => x.id === id || x.name === id) ?? fail(`No existe el recurso «${id}»`);
  if (a.kind === 'audio') fail('Ese recurso es audio: usa «anadir_sonido» o «anadir_musica»');
  return { source: { type: 'asset', assetId: a.id }, extra: a.duration && a.kind !== 'image' ? { duration: a.duration } : {} };
}

const CLIP_FIELDS: Record<string, keyof Clip> = {
  inicio: 'start', duracion: 'duration', bucle: 'loop', x: 'x', y: 'y', escala: 'scale', rotacion: 'rotation',
  opacidad: 'opacity', fundidoEntrada: 'fadeIn', fundidoSalida: 'fadeOut', capa: 'z', voltear: 'flipX', ajuste: 'fit', velocidadReproduccion: 'playbackRate', nombre: 'name', silueta: 'silhouette', colorSilueta: 'silhouetteColor',
};

function applyClipFields(c: Clip, p: P) {
  for (const [k, f] of Object.entries(CLIP_FIELDS)) if (p[k] !== undefined) (c as any)[f] = p[k];
  if (p.movimiento !== undefined) c.motion = motion(p);
  if (p.superficieId !== undefined) (c as any).__surface = p.superficieId;
}

export async function handleAgentRequest(action: string, p: P): Promise<unknown> {
  switch (action) {
    case 'estado':
      return summary();
    case 'obtener_proyecto': {
      const pr = project();
      return { ...pr, assets: pr.assets.map((a) => ({ ...a, thumbnail: '' })) };
    }
    case 'obtener_escena': {
      const sh = findShow(p);
      return sceneDetail(sh, findScene(sh, p));
    }
    case 'reemplazar_proyecto': {
      // Mantiene las miniaturas actuales si el agente las envía vacías.
      const { project: doc } = parseProject(p.proyecto);
      const cur = project();
      doc.assets = doc.assets.map((a) => (a.thumbnail ? a : { ...a, thumbnail: cur.assets.find((x) => x.id === a.id)?.thumbnail ?? '' }));
      st().replaceDocument(doc, 'Agente: reemplazar proyecto');
      await refreshMissing();
      return { ok: true };
    }
    case 'crear_instalacion': {
      const inst = createInstallation(str(p, 'nombre'), { width: num(p, 'ancho', 1920), height: num(p, 'alto', 1080) });
      edit('crear instalación', (d) => { d.installations.push(inst); });
      st().set({ installationId: inst.id });
      return { instalacionId: inst.id };
    }
    case 'crear_superficie': {
      const pr = project();
      const inst = pr.installations.find((i) => i.id === (p.instalacionId ?? st().installationId)) ?? pr.installations[0] ?? fail('No hay instalaciones');
      const k = (p.tipo as string) ?? 'window';
      if (!(SURFACE_KINDS as readonly string[]).includes(k)) fail(`Tipo no válido: ${SURFACE_KINDS.join(', ')}`);
      const sx = p.px ? 1 / inst.output.width : 1, sy = p.px ? 1 / inst.output.height : 1;
      const s = createSurface(str(p, 'nombre'), k as any, inst.surfaces.length, { x: num(p, 'x') * sx, y: num(p, 'y') * sy, w: num(p, 'ancho') * sx, h: num(p, 'alto') * sy });
      edit('crear superficie', (d) => { d.installations.find((i) => i.id === inst.id)!.surfaces.push(s); });
      return { superficieId: s.id };
    }
    case 'mover_esquinas': {
      // esquinas: [[x,y] ×4] en orden sup.izq, sup.der, inf.der, inf.izq
      const pr = project();
      const inst = pr.installations.find((i) => i.id === (p.instalacionId ?? st().installationId)) ?? pr.installations[0] ?? fail('No hay instalaciones');
      const s = inst.surfaces.find((x) => x.id === p.superficieId || x.name === p.superficieId) ?? fail(`No existe la superficie «${p.superficieId}»`);
      const pts = p.esquinas as number[][];
      if (!Array.isArray(pts) || pts.length !== 4) fail('«esquinas» debe ser una lista de 4 puntos [x, y]');
      const sx = p.px ? 1 / inst.output.width : 1, sy = p.px ? 1 / inst.output.height : 1;
      const quad = orderQuad(pts.map(([x, y]) => ({ x: Number(x) * sx, y: Number(y) * sy })));
      edit('mover esquinas', (d) => { const x = d.installations.find((i) => i.id === inst.id)!.surfaces.find((y) => y.id === s.id)!; x.quad = quad; });
      return { esquinas: quad };
    }
    case 'crear_espectaculo': {
      const pr = project();
      const sh = createShow(str(p, 'nombre'), (p.instalacionId as string) ?? pr.installations[0]?.id ?? null);
      edit('crear espectáculo', (d) => { d.shows.push(sh); });
      st().set({ showId: sh.id, sceneId: null });
      return { espectaculoId: sh.id };
    }
    case 'crear_escena': {
      const sh = findShow(p);
      const sc = createScene(str(p, 'nombre'), num(p, 'duracion', 10));
      if (p.transicion) sc.transition = { type: p.transicion as any, duration: num(p, 'duracionTransicion', 1) };
      edit('crear escena', (d) => {
        const s = d.shows.find((x) => x.id === sh.id)!;
        const pos = p.posicion !== undefined ? Math.max(0, Math.min(s.scenes.length, num(p, 'posicion'))) : s.scenes.length;
        s.scenes.splice(pos, 0, sc);
      });
      st().set({ showId: sh.id, sceneId: sc.id });
      return { escenaId: sc.id };
    }
    case 'editar_escena': {
      const sh = findShow(p);
      const sc = findScene(sh, p);
      edit('editar escena', (d) => {
        const x = d.shows.find((s) => s.id === sh.id)!.scenes.find((s) => s.id === sc.id)!;
        if (p.nombre !== undefined) x.name = String(p.nombre);
        if (p.duracion !== undefined) x.duration = num(p, 'duracion');
        if (p.transicion !== undefined) x.transition = { type: p.transicion as any, duration: num(p, 'duracionTransicion', x.transition.duration) };
        if (p.activa !== undefined) x.enabled = !!p.activa;
        if (p.notas !== undefined) x.notes = String(p.notas);
      });
      return { ok: true };
    }
    case 'eliminar_escena': {
      const sh = findShow(p);
      const sc = findScene(sh, p);
      edit('eliminar escena', (d) => { const s = d.shows.find((x) => x.id === sh.id)!; s.scenes = s.scenes.filter((x) => x.id !== sc.id); });
      return { ok: true };
    }
    case 'anadir_clip':
    case 'anadir_rotulo': {
      const sh = findShow(p);
      const sc = findScene(sh, p);
      const surfaceId = surfaceFor(sh, p);
      if (action === 'anadir_rotulo' && p.texto === undefined) fail('Falta «texto»');
      const { source, extra } = buildSource(p);
      const c = createClip(surfaceId, source, { ...extra, start: num(p, 'inicio', 0) });
      if (action === 'anadir_rotulo') { c.scale = 0.9; c.motion = { preset: 'popIn', intensity: 1, speed: 1 }; }
      applyClipFields(c, { ...p, superficieId: undefined });
      if (c.start + c.duration > sc.duration && p.duracion === undefined) c.duration = Math.max(0.5, sc.duration - c.start);
      const valid = ClipSchema.parse(c);
      edit(action === 'anadir_rotulo' ? 'añadir rótulo' : 'añadir clip', (d) => { d.shows.find((x) => x.id === sh.id)!.scenes.find((x) => x.id === sc.id)!.clips.push(valid); });
      st().set({ showId: sh.id, sceneId: sc.id, clipId: valid.id });
      return { clipId: valid.id, escenaId: sc.id };
    }
    case 'editar_clip': {
      const sh = findShow(p);
      const id = str(p, 'clipId');
      let found = false;
      edit('editar clip', (d) => {
        for (const sc of d.shows.find((x) => x.id === sh.id)!.scenes) {
          const c = sc.clips.find((x) => x.id === id);
          if (!c) continue;
          found = true;
          applyClipFields(c, p);
          if ((c as any).__surface) { c.surfaceId = surfaceFor(sh, { superficieId: (c as any).__surface }); delete (c as any).__surface; }
          if (p.efecto !== undefined) {
            if (!(EFFECT_KINDS as readonly string[]).includes(String(p.efecto))) fail(`Efecto no válido. Opciones: ${EFFECT_KINDS.join(', ')}`);
            c.source = effectSource(p.efecto as any);
          }
          if (c.source.type === 'effect') {
            if (p.color !== undefined) c.source.color = String(p.color);
            if (p.color2 !== undefined) c.source.color2 = String(p.color2);
            if (p.grosor !== undefined) c.source.width = num(p, 'grosor');
            if (p.espacio !== undefined) c.source.space = p.espacio === 'fachada' ? 'facade' : 'surface';
          }
          if (c.source.type === 'text') {
            if (p.texto !== undefined) c.source.text = String(p.texto);
            if (p.color !== undefined) c.source.color = String(p.color);
            if (p.contorno !== undefined) c.source.outline = String(p.contorno);
            if (p.letra !== undefined) c.source.font = p.letra as any;
          }
          ClipSchema.parse(c);
        }
      });
      if (!found) fail(`No existe el clip «${id}»`);
      return { ok: true };
    }
    case 'eliminar_clip': {
      const sh = findShow(p);
      const id = str(p, 'clipId');
      edit('eliminar clip', (d) => { for (const sc of d.shows.find((x) => x.id === sh.id)!.scenes) sc.clips = sc.clips.filter((c) => c.id !== id); });
      return { ok: true };
    }
    case 'generar_espectaculo': {
      // Asistente: compone un espectáculo entero (estilo, protagonistas, duración y rótulo final).
      const pr = project();
      const style = ((p.estilo as string) ?? 'infantil') as ShowStyle;
      if (!SHOW_STYLES.includes(style)) fail(`«estilo» debe ser ${SHOW_STYLES.join(', ')}`);
      const instId = (p.instalacionId as string) ?? st().installationId ?? pr.installations[0]?.id;
      const inst = pr.installations.find((i) => i.id === instId || i.name === instId) ?? fail('No hay instalación: crea una o indica «instalacionId»');
      for (const pk of style === 'terror' ? ['terror-sonidos', 'halloween-infantil'] : ['halloween-infantil']) {
        const probe = pk === 'terror-sonidos' ? 'tr-ast-golpe' : 'hx-ast-snd-pop';
        if (!project().assets.some((a) => a.id === probe)) await addPackToProject(pk, false);
      }
      const opts = protagonistOptions(project());
      const wanted = Array.isArray(p.protagonistas) ? (p.protagonistas as unknown[]).map(String) : [];
      const protagonists = wanted.map((w) => {
        const o = opts.find((x) => x.label === w || x.asset.id === w || x.key.slice(2) === w);
        if (!o) fail(`No encuentro el protagonista «${w}» (nombre de un vídeo o de un personaje). Opciones: ${opts.map((x) => x.label).join(', ')}`);
        return o!.pro;
      });
      const assets = project().assets;
      const sh = generateShow({
        style, name: (p.nombre as string) ?? 'Espectáculo del asistente', installation: inst, protagonists,
        duration: p.duracion !== undefined ? num(p, 'duracion') : undefined, finaleText: p.rotulo as string | undefined, endText: p.despedida as string | undefined,
        sounds: { ...soundKitFrom(assets), music: defaultMusic(style, assets) },
      });
      edit(`generar espectáculo «${sh.name}»`, (d) => { d.shows.push(sh); });
      st().set({ showId: sh.id, sceneId: sh.scenes[0]?.id ?? null, clipId: null });
      return { ok: true, espectaculoId: sh.id, escenas: sh.scenes.map((x) => x.name), duracion: layoutShow(sh).duration };
    }
    case 'coreografia': {
      // Un personaje que se asoma y pasa a otra ventana, juega al escondite o vuela en arco.
      const sh = findShow(p);
      const sc = findScene(sh, p);
      const kind = str(p, 'tipo') as ChoreoKind;
      if (!CHOREO_KINDS.includes(kind)) fail(`«tipo» debe ser ${CHOREO_KINDS.join(', ')}`);
      const pr = project();
      const inst = pr.installations.find((i) => i.id === sh.installationId) ?? fail('El espectáculo no tiene instalación');
      const who = str(p, 'protagonista');
      const opt = protagonistOptions(pr).find((o) => o.label === who || o.asset.id === who) ?? null;
      const img = opt ? null : pr.assets.find((a) => (a.id === who || a.name === who) && (a.kind === 'image' || a.kind === 'video' || a.kind === 'sequence'));
      if (!opt && !img) fail(`No encuentro «${who}» (nombre de un vídeo, imagen o personaje)`);
      const asset = opt ? opt.asset : img!;
      const surf = (k: string) => { const id = p[k] as string; return inst.surfaces.find((s) => s.id === id || s.name.toLowerCase() === String(id).toLowerCase()) ?? fail(`No existe la superficie «${id}»`); };
      const surfaces = kind === 'escondite' ? orderedSurfaces(inst).filter((s) => s.kind !== 'wall') : [surf('desde'), surf('hasta')];
      const kit = soundKitFrom(pr.assets);
      const r = choreography({
        kind, installation: inst, surfaces, start: p.inicio !== undefined ? num(p, 'inicio') : 0,
        actor: { name: opt?.label ?? asset.name, source: { type: 'asset', assetId: asset.id }, aspect: asset.width && asset.height ? asset.width / asset.height : 1, characterId: opt?.pro.characterId ?? null, animationId: opt?.pro.animationId ?? null },
        sounds: { whoosh: kit.whoosh, pop: kit.pop, giggle: kit.giggle },
      });
      edit(`coreografía ${kind}`, (d) => {
        const x = d.shows.find((y) => y.id === sh.id)?.scenes.find((y) => y.id === sc.id);
        if (!x) return;
        x.clips.push(...r.clips);
        x.sounds.push(...r.sounds);
        if (r.end > x.duration) x.duration = Math.ceil(r.end * 2) / 2;
      });
      return { ok: true, clips: r.clips.map((c) => c.id), termina: r.end };
    }
    case 'aplicar_plantilla': {
      const sh = findShow(p);
      const sc = findScene(sh, p);
      const kind = str(p, 'plantilla') as TemplateKind;
      if (!(TEMPLATE_KINDS as readonly string[]).includes(kind)) fail(`Plantilla no válida. Opciones: ${TEMPLATE_KINDS.join(', ')}`);
      const inst = project().installations.find((i) => i.id === sh.installationId) ?? fail('El espectáculo no tiene instalación');
      const thunder = project().assets.find((a) => a.kind === 'audio' && (a.tags.includes('trueno') || /trueno/i.test(a.name)));
      const r = applyTemplate(kind, inst, sc, { start: num(p, 'inicio', 0), thunderAssetId: thunder?.id ?? null, sounds: templateSounds(project().assets) });
      edit(`plantilla ${kind}`, (d) => { const x = d.shows.find((s) => s.id === sh.id)!.scenes.find((s) => s.id === sc.id)!; x.clips.push(...r.clips); x.sounds.push(...r.sounds); });
      return { clips: r.clips.length, sonidos: r.sounds.length };
    }
    case 'crear_luz': {
      // Solo la luz del proyecto: conectarla a una luz real lo hace la persona en la pantalla Luces.
      const kind = (p.tipo as string) ?? 'color';
      if (!(LIGHT_KINDS as readonly string[]).includes(kind)) fail(`Tipo no válido: ${LIGHT_KINDS.join(', ')}`);
      const d = createLightDevice(str(p, 'nombre'), kind as LightKind);
      edit('añadir luz', (x) => { x.lights.push(d); });
      return { luzId: d.id };
    }
    case 'anadir_luz': {
      const sh = findShow(p);
      const sc = findScene(sh, p);
      const target = (p.luzId as string) ?? '*';
      const dev = target === '*' ? null : project().lights.find((d) => d.id === target || d.name === target) ?? fail(`No existe la luz «${target}». Usa «crear_luz» o «*» para todas.`);
      const action = (p.efecto as string) ?? 'color';
      if (!(LIGHT_ACTIONS as readonly string[]).includes(action)) fail(`Efecto de luz no válido: ${LIGHT_ACTIONS.join(', ')}`);
      const over: Record<string, unknown> = { action, start: num(p, 'inicio', 0) };
      if (p.duracion !== undefined) over.duration = num(p, 'duracion');
      if (p.color !== undefined) over.color = String(p.color);
      if (p.color2 !== undefined) over.color2 = String(p.color2);
      if (p.brillo !== undefined) over.brightness = Math.max(0, Math.min(1, num(p, 'brillo')));
      if (p.ritmo !== undefined) over.rate = Math.max(0.2, Math.min(3, num(p, 'ritmo')));
      if (p.transicion !== undefined) over.transition = num(p, 'transicion');
      const cue = createLightCue(dev?.id ?? '*', over as Partial<LightCue>);
      edit('añadir luz', (d) => { d.shows.find((x) => x.id === sh.id)!.scenes.find((x) => x.id === sc.id)!.lights.push(cue); });
      return { efectoLuzId: cue.id };
    }
    case 'luces_automaticas': {
      const sh = findShow(p);
      if (!project().lights.length) fail('El proyecto no tiene luces: usa «crear_luz» primero.');
      const auto = autoLights(sh, project().lights);
      edit('luces automáticas', (d) => { const x = d.shows.find((y) => y.id === sh.id)!; for (const sc of x.scenes) sc.lights = auto.scenes.find((y) => y.id === sc.id)?.lights ?? sc.lights; });
      return { escenasConLuces: auto.scenes.filter((x) => x.lights.length).length, efectos: auto.scenes.reduce((n, x) => n + x.lights.length, 0) };
    }
    case 'anadir_sonido': {
      const sh = findShow(p);
      const sc = findScene(sh, p);
      const a = project().assets.find((x) => (x.id === p.recursoId || x.name === p.recursoId) && x.kind === 'audio') ?? fail(`No existe el audio «${p.recursoId}»`);
      const cue = createSoundCue(a.id, { start: num(p, 'inicio', 0), volume: num(p, 'volumen', 1), loop: !!p.bucle, continueAfterScene: !!p.continuar });
      edit('añadir sonido', (d) => { d.shows.find((x) => x.id === sh.id)!.scenes.find((x) => x.id === sc.id)!.sounds.push(cue); });
      return { sonidoId: cue.id };
    }
    case 'anadir_musica': {
      const sh = findShow(p);
      const a = project().assets.find((x) => (x.id === p.recursoId || x.name === p.recursoId) && x.kind === 'audio') ?? fail(`No existe el audio «${p.recursoId}»`);
      const m = { id: newId('mus'), assetId: a.id, start: num(p, 'inicio', 0), volume: num(p, 'volumen', 0.8), fadeIn: 1, fadeOut: 2, loop: p.bucle !== false };
      edit('añadir música', (d) => { d.shows.find((x) => x.id === sh.id)!.music.push(m); });
      return { musicaId: m.id };
    }
    case 'importar_recurso_copiado': {
      const f = p.archivo as ImportedFile;
      const { asset, warning } = await assetFromImported(f);
      if (p.nombre) asset.name = String(p.nombre);
      edit('importar recurso', (d) => { d.assets.push(asset); });
      return { recursoId: asset.id, nombre: asset.name, tipo: asset.kind, duracion: asset.duration, aviso: warning ?? null };
    }
    case 'quitar_fondo': {
      const id = str(p, 'recursoId');
      const a = project().assets.find((x) => x.id === id || x.name === id) ?? fail(`No existe el recurso «${id}»`);
      const mode = (p.modo as string) ?? 'color';
      if (!['none', 'color', 'dark'].includes(mode)) fail('«modo» debe ser none, color o dark');
      edit('quitar fondo', (d) => {
        const k = d.assets.find((x) => x.id === a.id)!.key;
        k.mode = mode as any;
        if (p.color !== undefined) k.color = String(p.color);
        if (p.tolerancia !== undefined) k.threshold = num(p, 'tolerancia');
        if (p.suavidad !== undefined) k.softness = num(p, 'suavidad');
      });
      return { ok: true };
    }
    case 'proyecto_abierto':
      await afterOpen(p.abierto as OpenedProject);
      return summary().proyecto;
    case 'modo_salida': {
      const m = str(p, 'modo');
      if (!['black', 'calibration', 'show', 'negro', 'calibracion', 'espectaculo'].includes(m)) fail('«modo» debe ser negro, calibracion o espectaculo');
      const mode = m === 'negro' ? 'black' : m === 'calibracion' ? 'calibration' : m === 'espectaculo' ? 'show' : m;
      if (mode === 'show') st().set({ outputShowId: findShow(p).id });
      st().set({ outputMode: mode as any });
      return { ok: true };
    }
    case 'reproducir': {
      const sh = findShow(p);
      st().set({ outputShowId: sh.id, outputMode: 'show' });
      if (!st().output.open) fail('La salida está cerrada: usa primero «abrir_salida»');
      setTimeout(() => transport('play', p.desde !== undefined ? num(p, 'desde') : undefined), 250);
      return { ok: true };
    }
    case 'pausar':
      transport('pause');
      return { ok: true };
    case 'detener':
      transport('stop');
      return { ok: true };
    case 'ir_a':
      vm.output.send({ type: 'seek', time: num(p, 'segundos') });
      return { ok: true };
    case 'escena_en_bucle': {
      // Modo directo: la escena se repite hasta que se pida otra.
      if (!st().output.open) fail('La salida está cerrada: usa primero «abrir_salida»');
      const sh = findShow(p);
      const active = sh.scenes.filter((x) => x.enabled);
      const acc = (p.accion as string | undefined) ?? (p.escena === undefined ? 'mantener' : 'escena');
      let target: LiveTarget;
      if (acc === 'siguiente') target = 'next';
      else if (acc === 'anterior') target = 'prev';
      else if (acc === 'mantener') target = 'hold';
      else if (acc === 'salir') target = null;
      else if (acc === 'escena') {
        const e = p.escena;
        const idx = typeof e === 'number' ? e - 1 : active.findIndex((x) => x.id === e || x.name === e);
        if (idx < 0 || idx >= active.length) fail(`No existe la escena «${String(e)}» (número desde 1 o nombre de una escena activa)`);
        target = idx;
      } else fail('«accion» debe ser escena, siguiente, anterior, mantener o salir');
      if (st().outputMode !== 'show' || st().outputShowId !== sh.id) st().set({ outputShowId: sh.id, outputMode: 'show' });
      setTimeout(() => vm.output.send({ type: 'live', target }), 250);
      return { ok: true };
    }
    case 'guardar':
      if (!(await saveProject())) fail('No se pudo guardar');
      return { ok: true, archivo: st().file };
    case 'deshacer':
      st().undo();
      return { ok: true };
    case 'rehacer':
      st().redo();
      return { ok: true };
    default:
      throw new Error(`Acción desconocida «${action}». Consulta docs/AGENTES.md.`);
  }
}
