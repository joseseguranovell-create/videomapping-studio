/**
 * Interacción directa sobre la ventana de salida (útil con una sola pantalla o para calibrar «in situ»):
 * - Siempre: Espacio reproducir/pausa · Inicio volver al principio · B negro · F/F11/doble clic pantalla completa
 *            Esc salir de pantalla completa · H mostrar/ocultar ayuda · C calibración · P espectáculo
 * - En espectáculo (modo directo): 1-9 escena en bucle · →/AvPág siguiente · ←/RePág anterior
 *            L dejar en bucle la escena actual · Intro seguir con el espectáculo (los mandos de presentación sirven)
 * - En calibración: arrastrar esquinas o vértices · arrastrar dentro de una superficie para moverla
 *            Tab/Mayús+Tab cambiar de superficie · 1-4 elegir esquina · flechas mover 1 px (Mayús: 10 px)
 *            R añadir ventana · D añadir puerta · Ctrl+Z/Ctrl+Y deshacer/rehacer · Ctrl+S guardar
 * El editor es quien modifica el documento; aquí solo se envían peticiones.
 */
import type { Player } from '../engine/player';
import type { LiveTarget, VmOutputApi } from '../../shared/api';
import type { Surface, Vec2 } from '../../shared/model';
import { pointInPolygon, surfaceOutline } from '../../shared/geometry';

type Target = 'quad' | 'polygon' | 'move';

export function setupInteraction(player: Player, api: VmOutputApi, wrap: HTMLElement, events: HTMLElement, hud: HTMLElement) {
  let drag: { surfaceId: string; target: Target; index: number; start: Vec2; last: Vec2 } | null = null;
  let active: { surfaceId: string; target: Target; index: number } | null = null;
  let helpPinned = false;
  let hudTimer = 0;
  let lastKind = '';

  const mode = () => player.mode;
  const inst = () => player.currentInstallation();
  const selected = (): Surface | null => {
    const m = mode();
    if (m.kind !== 'calibration') return null;
    return inst()?.surfaces.find((s) => s.id === m.selectedSurfaceId) ?? null;
  };
  const norm = (e: { clientX: number; clientY: number }): Vec2 => {
    const r = wrap.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const pxDist = (a: Vec2, b: Vec2) => {
    const r = wrap.getBoundingClientRect();
    return Math.hypot((a.x - b.x) * r.width, (a.y - b.y) * r.height);
  };

  // ── Ayuda en pantalla ──
  const K = (k: string) => `<kbd>${k}</kbd>`;
  function hudText(): string {
    const m = mode();
    if (m.kind === 'calibration') {
      const s = selected();
      const corner = active && s && active.surfaceId === s.id && active.target !== 'move' ? ` · ${active.target === 'quad' ? 'esquina' : 'vértice'} ${active.index + 1}` : '';
      return `<b>Calibración</b> ${s ? `· «${s.name}»${corner}${s.locked ? ' (bloqueada)' : ''}` : '· haz clic en una superficie'}<br>`
        + `Arrastra las esquinas · ${K('Tab')} siguiente superficie · ${K('1')}–${K('4')} esquina · ${K('←↑→↓')} 1 px (${K('Mayús')} 10 px) · ${K('R')} ventana · ${K('D')} puerta · ${K('Ctrl+Z')} deshacer · ${K('Ctrl+S')} guardar · ${K('P')} espectáculo · ${K('H')} ocultar ayuda · ${K('Esc')} salir de pantalla completa`;
    }
    if (m.kind === 'show') {
      const live = player.liveInfo();
      const state = live
        ? `<b>Directo</b> · escena ${live.index + 1}/${live.count} «${live.name}» en bucle${player.playing ? '' : ' (en pausa)'}`
        : player.playing ? '<b>Reproduciendo</b>' : '<b>Preparado</b> — pulsa ' + K('Espacio') + ' para empezar o ' + K('1') + '–' + K('9') + ' para una escena';
      return `${state}<br>`
        + `${K('Espacio')} reproducir/pausa · ${K('1')}–${K('9')} escena en bucle · ${K('→')} ${K('←')} siguiente/anterior · ${K('L')} repetir esta escena · ${K('Intro')} seguir el espectáculo · ${K('Inicio')} al principio · ${K('B')} negro · ${K('C')} calibrar · ${K('F')} pantalla completa · ${K('H')} ayuda`;
    }
    return `<b>Salida en negro</b><br>${K('P')} espectáculo · ${K('C')} calibrar · ${K('F')} pantalla completa · ${K('Esc')} salir de pantalla completa · ${K('H')} ayuda`;
  }
  function showHud(ms = 5000) {
    hud.innerHTML = hudText();
    hud.classList.remove('hidden');
    clearTimeout(hudTimer);
    if (!helpPinned && ms > 0) hudTimer = window.setTimeout(() => hud.classList.add('hidden'), ms);
  }
  // En calibración la ayuda se queda fija (salvo que se oculte con H); en reproducción desaparece sola.
  setInterval(() => {
    const li = player.liveInfo();
    const k = `${mode().kind}:${player.playing}:${li ? li.index : '-'}`;
    document.body.classList.toggle('calib', mode().kind === 'calibration');
    if (k !== lastKind) {
      lastKind = k;
      if (mode().kind === 'calibration') { helpPinned = true; showHud(0); }
      else { helpPinned = false; showHud(player.playing ? 2500 : 6000); }
    } else if (!hud.classList.contains('hidden')) hud.innerHTML = hudText();
    if (mode().kind === 'calibration') player.invalidate(); // resaltar la esquina activa
  }, 250);

  // ── Teclado ──
  window.addEventListener('keydown', (e) => {
    const k = e.key;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && k.toLowerCase() === 'z') { e.preventDefault(); api.request({ type: 'undo' }); return; }
    if (mod && k.toLowerCase() === 'y') { e.preventDefault(); api.request({ type: 'redo' }); return; }
    if (mod && k.toLowerCase() === 's') { e.preventDefault(); api.request({ type: 'save' }); return; }
    if (k === 'Escape') { api.fullscreen('exit'); return; }
    if (k === 'F11' || k.toLowerCase() === 'f') { e.preventDefault(); api.fullscreen('toggle'); return; }
    if (k.toLowerCase() === 'h') {
      if (hud.classList.contains('hidden')) { helpPinned = mode().kind === 'calibration'; showHud(helpPinned ? 0 : 8000); }
      else { helpPinned = false; hud.classList.add('hidden'); }
      return;
    }
    if (k === ' ') { e.preventDefault(); api.request({ type: 'key', action: 'playPause' }); return; }
    if (k === 'Home' || k === '0') { api.request({ type: 'key', action: 'restart' }); return; }
    if (k.toLowerCase() === 'b') { api.request({ type: 'key', action: 'black' }); return; }
    if (k.toLowerCase() === 'c') { api.request({ type: 'key', action: 'calibration' }); return; }
    if (k.toLowerCase() === 'p') { api.request({ type: 'key', action: 'show' }); return; }
    if (mode().kind === 'show') {
      if (/^[1-9]$/.test(k)) { live(parseInt(k, 10) - 1); return; }
      if (k === 'ArrowRight' || k === 'PageDown') { e.preventDefault(); live('next'); return; }
      if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); live('prev'); return; }
      if (k.toLowerCase() === 'l') { live(player.liveInfo() ? null : 'hold'); return; }
      if (k === 'Enter') { live(null); return; }
      return;
    }
    if (mode().kind !== 'calibration') return;
    const s = selected();
    if (k === 'Tab') { e.preventDefault(); active = null; api.request({ type: 'selectNext', dir: e.shiftKey ? -1 : 1 }); return; }
    if (k.toLowerCase() === 'r' || k.toLowerCase() === 'd') {
      const at = lastPointer ?? { x: 0.5, y: 0.5 };
      api.request({ type: 'addSurface', kind: k.toLowerCase() === 'r' ? 'window' : 'door', at });
      return;
    }
    if (!s) return;
    if (/^[1-4]$/.test(k)) { active = { surfaceId: s.id, target: 'quad', index: parseInt(k, 10) - 1 }; showHud(0); return; }
    if (k.startsWith('Arrow')) {
      e.preventDefault();
      const out = inst()!.output;
      const step = e.shiftKey ? 10 : 1;
      const dx = (k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0) / out.width;
      const dy = (k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0) / out.height;
      const a = active && active.surfaceId === s.id ? active : { surfaceId: s.id, target: 'move' as Target, index: 0 };
      api.request({ type: 'nudge', surfaceId: s.id, target: a.target, index: a.index, dx, dy });
    }
  });

  /** Cambio de escena en directo; elegir una escena estando preparado la pone en marcha. */
  function live(target: LiveTarget) {
    if (mode().kind !== 'show') return;
    const count = player.currentShow()?.scenes.filter((s) => s.enabled).length ?? 0;
    if (typeof target === 'number' && target >= count) return;
    player.setLive(target);
    if (target !== null && target !== 'hold' && !player.playing) void player.play();
    showHud(2500);
  }

  // ── Ratón ──
  let lastPointer: Vec2 | null = null;
  events.addEventListener('dblclick', () => api.fullscreen('toggle'));
  events.addEventListener('pointerdown', (e) => {
    if (mode().kind !== 'calibration' || e.button !== 0) return;
    const p = norm(e);
    const i = inst();
    if (!i) return;
    // 1) puntos de la superficie seleccionada; 2) puntos de cualquier superficie; 3) interior.
    const sel = selected();
    const ordered = sel ? [sel, ...i.surfaces.filter((x) => x.id !== sel.id)] : [...i.surfaces];
    let hit: { s: Surface; target: Target; index: number } | null = null;
    for (const s of ordered) {
      if (!s.visible && s.id !== sel?.id) continue;
      const cands: [Target, Vec2[]][] = [['quad', s.quad], ['polygon', s.shape === 'polygon' ? s.polygon : []]];
      for (const [t, pts] of cands) pts.forEach((q, idx) => { if (!hit && pxDist(p, q) < 22) hit = { s, target: t, index: idx }; });
      if (hit) break;
    }
    if (!hit) {
      const inside = [...i.surfaces].reverse().find((s) => s.visible && pointInPolygon(p, surfaceOutline(s)));
      if (inside) hit = { s: inside, target: 'move', index: 0 };
    }
    if (!hit) { api.request({ type: 'select', surfaceId: null }); active = null; return; }
    const h = hit as { s: Surface; target: Target; index: number };
    if (h.s.id !== sel?.id) api.request({ type: 'select', surfaceId: h.s.id });
    active = { surfaceId: h.s.id, target: h.target, index: h.index };
    if (h.s.locked) return;
    events.setPointerCapture(e.pointerId);
    document.body.classList.add('grab');
    drag = { surfaceId: h.s.id, target: h.target, index: h.index, start: p, last: p };
    const orig = h.target === 'move' ? p : (h.target === 'quad' ? h.s.quad : h.s.polygon)[h.index];
    api.request({ type: 'drag', phase: 'start', surfaceId: h.s.id, target: h.target, index: h.index, point: { ...orig } });
    (drag as any).orig = { ...orig };
  });
  events.addEventListener('pointermove', (e) => {
    lastPointer = norm(e);
    if (!drag) return;
    const p = norm(e);
    const k = e.shiftKey ? 0.1 : 1; // Mayús = precisión
    const orig = (drag as any).orig as Vec2;
    if (drag.target === 'move') {
      const delta = { x: (p.x - drag.last.x) * k, y: (p.y - drag.last.y) * k };
      drag.last = p;
      api.request({ type: 'drag', phase: 'move', surfaceId: drag.surfaceId, target: 'move', index: 0, point: p, delta });
    } else {
      const point = { x: orig.x + (p.x - drag.start.x) * k, y: orig.y + (p.y - drag.start.y) * k };
      api.request({ type: 'drag', phase: 'move', surfaceId: drag.surfaceId, target: drag.target, index: drag.index, point });
    }
  });
  const end = () => {
    if (!drag) return;
    api.request({ type: 'drag', phase: 'end', surfaceId: drag.surfaceId, target: drag.target, index: drag.index, point: drag.last });
    drag = null;
    document.body.classList.remove('grab');
  };
  events.addEventListener('pointerup', end);
  events.addEventListener('pointercancel', end);

  return { showHud, live, activeVertex: () => active };
}
