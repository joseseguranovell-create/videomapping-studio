/**
 * Lienzo de calibración: muestra exactamente lo que se envía al proyector (mismo motor WebGL)
 * y encima los controles de edición (SVG en píxeles de salida).
 *
 * Ratón:   clic = seleccionar · arrastrar superficie = mover · arrastrar punto = ajustar
 *          Mayús mientras se arrastra = movimiento de precisión (10× más lento)
 *          Alt+clic o clic derecho en un vértice = eliminarlo · clic en «+» = insertar vértice
 *          rueda = zoom · botón central o Espacio+arrastrar = desplazar la vista
 * Teclado: flechas = mover 1 px (Mayús: 10 px) · Tab = siguiente punto · Supr = borrar punto
 *          Intro = cerrar polígono · Esc = cancelar
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore, selInstallation, mediaBase } from '../store';
import { Player } from '../../engine/player';
import { mediaUrl } from '../../engine/media';
import { registerPlayerInvalidator } from '../services';
import type { Installation, Mask, Surface, Vec2, Quad } from '../../../shared/model';
import { centroid, clampPoint, pointInPolygon, surfaceOutline, translateGroup, translatePoints, isGroupMaster, followGroupQuad, quadFromBBox } from '../../../shared/geometry';
import { createMask, createPolygonSurface, createSurface } from '../../../shared/factory';
import { SURFACE_KIND_LABELS } from '../../../shared/model';
import { cropStyle } from '../../../shared/crop';
import { confirmDialog } from './ui';

type Target = 'quad' | 'polygon' | 'mask';
interface ActiveVertex { target: Target; index: number }

type Drag =
  | { kind: 'vertex'; target: Target; index: number; start: Vec2; orig: Vec2; precise: boolean; grp?: { masterId: string; origs: Surface[] } }
  | { kind: 'move'; what: 'surface' | 'mask'; start: Vec2; solo?: boolean }
  | { kind: 'pan'; sx: number; sy: number; px: number; py: number }
  | { kind: 'rect'; start: Vec2; cur: Vec2 };

const CORNER_COLORS = ['#ff4040', '#40ff60', '#4080ff', '#ffe030'];

function maskOf(inst: Installation, surfaceId: string | null, maskId: string | null): { mask: Mask; owner: 'installation' | 'surface' } | null {
  if (!maskId) return null;
  const g = inst.masks.find((m) => m.id === maskId);
  if (g) return { mask: g, owner: 'installation' };
  for (const s of inst.surfaces) {
    const m = s.masks.find((x) => x.id === maskId);
    if (m) return { mask: m, owner: 'surface' };
  }
  void surfaceId;
  return null;
}

export function SurfaceCanvas() {
  const inst = useStore(selInstallation)!;
  const project = useStore((s) => s.project)!;
  const projectKey = useStore((s) => s.projectKey);
  const surfaceId = useStore((s) => s.surfaceId);
  const maskId = useStore((s) => s.maskId);
  const calib = useStore((s) => s.calib);
  const set = useStore((s) => s.set);
  const setCalib = useStore((s) => s.setCalib);

  const wrapRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const playerRef = useRef<Player | null>(null);
  const [size, setSize] = useState({ w: 800, h: 450 });
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [active, setActive] = useState<ActiveVertex | null>(null);
  const [poly, setPoly] = useState<Vec2[]>([]);
  const [hover, setHover] = useState<Vec2 | null>(null);
  const [rect, setRect] = useState<{ a: Vec2; b: Vec2 } | null>(null);
  const drag = useRef<Drag | null>(null);
  const spaceDown = useRef(false);

  const W = inst.output.width, H = inst.output.height;
  const surface = inst.surfaces.find((s) => s.id === surfaceId) ?? null;
  const selMask = maskOf(inst, surfaceId, maskId);

  // ── Motor de previsualización (idéntico a la salida) ──
  useEffect(() => {
    if (!glRef.current) return;
    let p: Player;
    try {
      p = new Player(glRef.current, { audio: false, showMissing: true, maxWidth: 1920 });
    } catch (e) {
      useStore.getState().toast('error', `No se pudo iniciar la vista previa: ${(e as Error).message}`, 10000);
      return;
    }
    playerRef.current = p;
    (window as any).__vmCalibPlayer = p;
    p.start();
    const off = registerPlayerInvalidator((id) => p.invalidateAsset(id));
    return () => {
      off();
      p.dispose();
      playerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    p.setProject(project, mediaBase(), projectKey);
    p.setMode({
      kind: 'calibration',
      installationId: inst.id,
      selectedSurfaceId: surfaceId,
      showGrid: false,
      showLabels: false,
      pattern: calib.pattern,
      soloSelected: calib.soloSelected,
    });
  }, [project, projectKey, inst.id, surfaceId, calib.pattern, calib.soloSelected]);

  // ── Tamaño del escenario (manteniendo la proporción de la salida) ──
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const A = W / H;
      let w = Math.max(100, r.width - 32), h = w / A;
      if (h > r.height - 32) { h = Math.max(60, r.height - 32); w = h * A; }
      setSize({ w: Math.floor(w), h: Math.floor(h) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, H]);

  // Escala píxel de salida → píxel de pantalla (para dibujar asas de tamaño constante).
  const unit = W / (size.w * view.zoom);

  const toNorm = useCallback((clientX: number, clientY: number): Vec2 => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (clientX - r.left) / r.width, y: (clientY - r.top) / r.height };
  }, []);

  // ── Mutaciones ──
  const st = useStore.getState;
  const mutSurface = (live: boolean, fn: (s: Surface) => void, label = 'Editar superficie') => {
    const apply = (d: typeof project) => {
      const i = d.installations.find((x) => x.id === inst.id);
      const s = i?.surfaces.find((x) => x.id === surfaceId);
      if (s) fn(s);
    };
    live ? st().dragUpdate(apply) : st().update(label, apply);
  };
  /** Mueve la superficie seleccionada y las de su grupo (Ctrl: solo ella). */
  const mutGroup = (live: boolean, solo: boolean, dx: number, dy: number, label = 'Mover superficie') => {
    const apply = (d: typeof project) => {
      const i = d.installations.find((x) => x.id === inst.id);
      if (i && surfaceId) translateGroup(i.surfaces, surfaceId, dx, dy, solo);
    };
    live ? st().dragUpdate(apply) : st().update(label, apply);
  };
  const mutMask = (live: boolean, fn: (m: Mask) => void, label = 'Editar máscara') => {
    const apply = (d: typeof project) => {
      const i = d.installations.find((x) => x.id === inst.id);
      if (!i) return;
      let m = i.masks.find((x) => x.id === maskId);
      if (!m) for (const s of i.surfaces) { m = s.masks.find((x) => x.id === maskId); if (m) break; }
      if (m) fn(m);
    };
    live ? st().dragUpdate(apply) : st().update(label, apply);
  };

  const pointsFor = (t: Target): Vec2[] => {
    if (t === 'mask') return selMask?.mask.points ?? [];
    if (!surface) return [];
    return t === 'quad' ? surface.quad : surface.polygon;
  };

  const setPoint = (t: Target, index: number, p: Vec2, live: boolean) => {
    const q = clampPoint(p);
    if (t === 'mask') mutMask(live, (m) => { m.points[index] = q; });
    else mutSurface(live, (s) => {
      if (t === 'quad') {
        s.quad[index] = q;
        // en superficies rectangulares el contorno es el propio cuadrilátero
      } else s.polygon[index] = q;
    });
  };

  // ── Teclado ──
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (document.querySelector('.modal-back')) return;
      if (e.key === ' ') { spaceDown.current = true; return; }
      if (e.key === 'Escape') {
        if (poly.length) setPoly([]);
        else if (calib.tool !== 'select') setCalib({ tool: 'select' });
        else if (active) setActive(null);
        else set({ surfaceId: null, maskId: null });
        return;
      }
      if (e.key === 'Enter' && poly.length >= 3) { e.preventDefault(); finishPolygon(); return; }
      const locked = surface?.locked && !selMask;
      if (e.key.startsWith('Arrow') && (surface || selMask) && !locked) {
        e.preventDefault();
        const step = (e.shiftKey ? 10 : 1);
        const dx = (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0) / W;
        const dy = (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0) / H;
        if (active) {
          const pts = pointsFor(active.target);
          const p = pts[active.index];
          if (p) setPoint(active.target, active.index, { x: p.x + dx, y: p.y + dy }, false);
        } else if (selMask) {
          mutMask(false, (m) => { m.points = translatePoints(m.points, dx, dy); }, 'Mover máscara');
        } else if (surface) {
          mutGroup(false, e.ctrlKey, dx, dy, 'Mover superficie');
        }
        return;
      }
      if (e.key === 'Tab' && (surface || selMask)) {
        e.preventDefault();
        const order: Target[] = selMask ? ['mask'] : surface?.shape === 'polygon' ? ['quad', 'polygon'] : ['quad'];
        let t = active?.target && order.includes(active.target) ? active.target : order[0];
        let i = active ? active.index + (e.shiftKey ? -1 : 1) : 0;
        const n = pointsFor(t).length;
        if (i >= n) { const k = (order.indexOf(t) + 1) % order.length; t = order[k]; i = 0; }
        if (i < 0) { const k = (order.indexOf(t) - 1 + order.length) % order.length; t = order[k]; i = pointsFor(t).length - 1; }
        setActive({ target: t, index: i });
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && (surface || selMask)) {
        e.preventDefault();
        if (active && active.target !== 'quad') {
          deleteVertex(active.target, active.index);
          return;
        }
        if (selMask) {
          if (await confirmDialog('Eliminar máscara', `¿Eliminar la máscara «${selMask.mask.name}»?`, 'Eliminar', true)) deleteMask();
        } else if (surface && !surface.locked) {
          if (await confirmDialog('Eliminar superficie', `¿Eliminar la superficie «${surface.name}»? Los clips asignados a ella dejarán de mostrarse.`, 'Eliminar', true)) {
            st().update('Eliminar superficie', (d) => {
              const i = d.installations.find((x) => x.id === inst.id)!;
              i.surfaces = i.surfaces.filter((x) => x.id !== surface.id);
            });
            set({ surfaceId: null });
          }
        }
      }
    };
    const onUp = (e: KeyboardEvent) => { if (e.key === ' ') spaceDown.current = false; };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onUp); };
  });

  function deleteVertex(t: Target, index: number) {
    const pts = pointsFor(t);
    if (pts.length <= 3) {
      st().toast('warning', 'Un contorno necesita al menos 3 vértices.');
      return;
    }
    if (t === 'mask') mutMask(false, (m) => { m.points.splice(index, 1); }, 'Eliminar vértice');
    else mutSurface(false, (s) => { s.polygon.splice(index, 1); }, 'Eliminar vértice');
    setActive(null);
  }

  function deleteMask() {
    st().update('Eliminar máscara', (d) => {
      const i = d.installations.find((x) => x.id === inst.id)!;
      i.masks = i.masks.filter((m) => m.id !== maskId);
      i.surfaces.forEach((s) => (s.masks = s.masks.filter((m) => m.id !== maskId)));
    });
    set({ maskId: null });
  }

  function insertVertex(t: Target, afterIndex: number, p: Vec2) {
    if (t === 'mask') mutMask(false, (m) => { m.points.splice(afterIndex + 1, 0, p); }, 'Añadir vértice');
    else mutSurface(false, (s) => { s.polygon.splice(afterIndex + 1, 0, p); }, 'Añadir vértice');
    setActive({ target: t, index: afterIndex + 1 });
  }

  function finishPolygon() {
    const pts = poly;
    setPoly([]);
    if (pts.length < 3) return;
    if (calib.tool === 'mask') {
      const toSurface = calib.maskTarget === 'surface' && surface;
      const m = createMask(toSurface ? `Máscara de ${surface!.name}` : `Exclusión ${inst.masks.length + 1}`, pts);
      st().update('Añadir máscara', (d) => {
        const i = d.installations.find((x) => x.id === inst.id)!;
        if (toSurface) i.surfaces.find((s) => s.id === surface!.id)!.masks.push(m);
        else i.masks.push(m);
      });
      set({ maskId: m.id });
    } else {
      const n = inst.surfaces.length;
      const s = createPolygonSurface(`Zona ${n + 1}`, 'decor', n, pts);
      st().update('Añadir superficie poligonal', (d) => {
        d.installations.find((x) => x.id === inst.id)!.surfaces.push(s);
      });
      set({ surfaceId: s.id, maskId: null });
    }
    setCalib({ tool: 'select' });
  }

  // ── Ratón ──
  const onPointerDown = (e: React.PointerEvent) => {
    const p = toNorm(e.clientX, e.clientY);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (e.button === 1 || (e.button === 0 && spaceDown.current)) {
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, px: view.x, py: view.y };
      return;
    }
    if (e.button !== 0) return;
    if (calib.tool === 'rect') {
      drag.current = { kind: 'rect', start: p, cur: p };
      setRect({ a: p, b: p });
      return;
    }
    if (calib.tool === 'polygon' || calib.tool === 'mask') {
      if (poly.length >= 3) {
        const f = poly[0];
        if (Math.hypot((f.x - p.x) * W, (f.y - p.y) * H) < 12 * unit) { finishPolygon(); return; }
      }
      setPoly([...poly, p]);
      return;
    }
    // Selección: primero máscaras (están encima), después superficies de arriba a abajo.
    const hitMask = [...inst.masks, ...inst.surfaces.flatMap((s) => s.masks)].reverse().find((m) => m.points.length >= 3 && pointInPolygon(p, m.points));
    if (hitMask && (maskId === hitMask.id || e.altKey)) {
      set({ maskId: hitMask.id });
      st().beginDrag();
      drag.current = { kind: 'move', what: 'mask', start: p };
      return;
    }
    const hit = [...inst.surfaces].reverse().find((s) => (s.visible || s.id === surfaceId) && pointInPolygon(p, surfaceOutline(s)));
    if (hit) {
      set({ surfaceId: hit.id, maskId: null, view: 'calibrate' });
      setActive(null);
      if (!hit.locked) {
        st().beginDrag();
        drag.current = { kind: 'move', what: 'surface', start: p, solo: e.ctrlKey };
      }
      return;
    }
    if (hitMask) {
      set({ maskId: hitMask.id });
      return;
    }
    set({ surfaceId: null, maskId: null });
    setActive(null);
  };

  const startVertexDrag = (e: React.PointerEvent, target: Target, index: number) => {
    e.stopPropagation();
    if (e.button === 2 || e.altKey) {
      e.preventDefault();
      if (target !== 'quad') deleteVertex(target, index);
      return;
    }
    if (e.button !== 0) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toNorm(e.clientX, e.clientY);
    setActive({ target, index });
    st().beginDrag();
    // La esquina de la pieza principal de un grupo (p. ej. el fondo de la balaustrada) arrastra a todo el grupo; Ctrl: solo ella.
    const grp = target === 'quad' && surface && !e.ctrlKey && isGroupMaster(inst.surfaces, surface.id)
      ? { masterId: surface.id, origs: structuredClone(inst.surfaces.filter((x) => x.group === surface.group)) as Surface[] }
      : undefined;
    drag.current = { kind: 'vertex', target, index, start: p, orig: { ...pointsFor(target)[index] }, precise: e.shiftKey, grp };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toNorm(e.clientX, e.clientY);
    setHover(p);
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') {
      setView((v) => ({ ...v, x: d.px + (e.clientX - d.sx), y: d.py + (e.clientY - d.sy) }));
    } else if (d.kind === 'rect') {
      d.cur = p;
      setRect({ a: d.start, b: p });
    } else if (d.kind === 'vertex') {
      const k = e.shiftKey ? 0.1 : 1;
      const q = { x: d.orig.x + (p.x - d.start.x) * k, y: d.orig.y + (p.y - d.start.y) * k };
      if (d.grp) {
        const { masterId, origs } = d.grp;
        st().dragUpdate((doc: typeof project) => {
          const i = doc.installations.find((x) => x.id === inst.id);
          const m = i?.surfaces.find((x) => x.id === masterId);
          if (!i || !m) return;
          m.quad[d.index] = clampPoint(q);
          followGroupQuad(i.surfaces, masterId, origs, m.quad);
        });
      } else setPoint(d.target, d.index, q, true);
    } else if (d.kind === 'move') {
      const k = e.shiftKey ? 0.1 : 1;
      const dx = (p.x - d.start.x) * k, dy = (p.y - d.start.y) * k;
      d.start = p;
      if (d.what === 'surface') mutGroup(true, !!d.solo, dx, dy);
      else mutMask(true, (m) => { m.points = translatePoints(m.points, dx, dy); });
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'vertex') st().endDrag('Ajustar punto');
    else if (d.kind === 'move') st().endDrag(d.what === 'surface' ? 'Mover superficie' : 'Mover máscara');
    else if (d.kind === 'rect') {
      setRect(null);
      const x = Math.min(d.start.x, d.cur.x), y = Math.min(d.start.y, d.cur.y);
      const w = Math.abs(d.cur.x - d.start.x), h = Math.abs(d.cur.y - d.start.y);
      if (w * W < 8 || h * H < 8) return;
      const n = inst.surfaces.length;
      const windows = inst.surfaces.filter((s) => s.kind === 'window').length;
      const s = createSurface(`Ventana ${windows + 1}`, 'window', n, { x, y, w, h });
      st().update('Añadir superficie', (dd) => { dd.installations.find((i) => i.id === inst.id)!.surfaces.push(s); });
      set({ surfaceId: s.id, maskId: null });
      setCalib({ tool: 'select' });
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const wrap = wrapRef.current!.getBoundingClientRect();
    const factor = Math.exp(-e.deltaY * 0.0015);
    setView((v) => {
      const zoom = Math.min(8, Math.max(0.5, v.zoom * factor));
      // zoom centrado en el cursor
      const cx = e.clientX - wrap.left - wrap.width / 2 - v.x;
      const cy = e.clientY - wrap.top - wrap.height / 2 - v.y;
      const k = zoom / v.zoom;
      return { zoom, x: v.x - cx * (k - 1), y: v.y - cy * (k - 1) };
    });
  };

  const refAsset = inst.referenceImageAssetId ? project.assets.find((a) => a.id === inst.referenceImageAssetId) : null;
  const P = (p: Vec2) => `${p.x * W},${p.y * H}`;
  const path = (pts: readonly Vec2[]) => pts.map(P).join(' ');
  const r = 7 * unit;

  const gridLines = useMemo(() => {
    const lines: React.ReactNode[] = [];
    for (let i = 1; i < 16; i++) lines.push(<line key={`v${i}`} x1={(i / 16) * W} y1={0} x2={(i / 16) * W} y2={H} className={i % 4 ? 'g' : 'g major'} />);
    for (let j = 1; j < 9; j++) lines.push(<line key={`h${j}`} x1={0} y1={(j / 9) * H} x2={W} y2={(j / 9) * H} className={j % 3 ? 'g' : 'g major'} />);
    return lines;
  }, [W, H]);

  const renderHandles = (pts: readonly Vec2[], target: Target, closedEditable: boolean) => (
    <g className={`handles ${target}`}>
      {closedEditable &&
        pts.map((p, i) => {
          const q = pts[(i + 1) % pts.length];
          const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
          return (
            <g key={`m${i}`} className="mid" onPointerDown={(e) => { e.stopPropagation(); insertVertex(target, i, m); }}>
              <circle cx={m.x * W} cy={m.y * H} r={r * 0.75} />
              <path d={`M${m.x * W - r * 0.4},${m.y * H} h${r * 0.8} M${m.x * W},${m.y * H - r * 0.4} v${r * 0.8}`} />
            </g>
          );
        })}
      {pts.map((p, i) =>
        target === 'quad' ? (
          <g key={i} className={`corner${active?.target === target && active.index === i ? ' active' : ''}`} onPointerDown={(e) => startVertexDrag(e, target, i)} onContextMenu={(e) => e.preventDefault()} data-testid={`corner-${i}`}>
            <circle cx={p.x * W} cy={p.y * H} r={r * 1.25} fill={CORNER_COLORS[i]} />
            <text x={p.x * W} y={p.y * H} fontSize={r * 1.4} dy="0.35em" textAnchor="middle">{i + 1}</text>
          </g>
        ) : (
          <rect
            key={i}
            className={`vertex${active?.target === target && active.index === i ? ' active' : ''}`}
            x={p.x * W - r * 0.8}
            y={p.y * H - r * 0.8}
            width={r * 1.6}
            height={r * 1.6}
            onPointerDown={(e) => startVertexDrag(e, target, i)}
            onContextMenu={(e) => e.preventDefault()}
            data-testid={`${target}-vertex-${i}`}
          />
        ),
      )}
    </g>
  );

  const cursor = calib.tool === 'select' ? 'default' : 'crosshair';
  const activePoint = active ? pointsFor(active.target)[active.index] : null;

  return (
    <div className="stage-wrap" ref={wrapRef} onWheel={onWheel} data-testid="calib-stage-wrap">
      <div
        className="stage"
        style={{ width: size.w, height: size.h, transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
      >
        <canvas ref={glRef} className="stage-gl" data-testid="calib-gl" />
        {refAsset && (
          <div className="stage-ref-box" style={{ opacity: inst.referenceImageOpacity }}>
            <img className="stage-ref-img" src={mediaUrl(mediaBase(), refAsset.file, projectKey)} style={cropStyle(inst.referenceCrop)} alt="" draggable={false} />
          </div>
        )}
        <svg
          ref={svgRef}
          className="stage-svg"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          style={{ cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => setHover(null)}
          onDoubleClick={() => (calib.tool === 'polygon' || calib.tool === 'mask') && poly.length >= 3 && finishPolygon()}
          onContextMenu={(e) => e.preventDefault()}
          data-testid="calib-svg"
        >
          <style>{`.g{stroke:rgba(255,255,255,.12);stroke-width:${unit}px}.g.major{stroke:rgba(255,255,255,.25)}`}</style>
          {calib.showGrid && gridLines}
          <rect x={0} y={0} width={W} height={H} fill="none" stroke="rgba(255,255,255,.35)" strokeWidth={unit * 1.5} />
          {/* máscaras globales */}
          {inst.masks.map((m) => (
            <polygon key={m.id} points={path(m.points)} className={`mask${m.id === maskId ? ' sel' : ''}${m.enabled ? '' : ' off'}`} strokeWidth={unit * 2} />
          ))}
          {inst.surfaces.map((s, idx) => {
            const sel = s.id === surfaceId;
            const outline = surfaceOutline(s);
            const c = centroid(outline);
            return (
              <g key={s.id} className={`surf${sel ? ' sel' : ''}${s.visible ? '' : ' hidden'}${s.locked ? ' locked' : ''}`} data-testid={`surface-shape-${idx}`}>
                <polygon points={path(outline)} stroke={s.color} strokeWidth={unit * (sel ? 3 : 1.75)} />
                {s.shape === 'polygon' && sel && <polygon points={path(s.quad)} className="quadguide" strokeWidth={unit} />}
                {s.masks.map((m) => (
                  <polygon key={m.id} points={path(m.points)} className={`mask${m.id === maskId ? ' sel' : ''}${m.enabled ? '' : ' off'}`} strokeWidth={unit * 2} />
                ))}
                {calib.showLabels && (
                  <text x={c.x * W} y={c.y * H} className="label" fontSize={13 * unit} textAnchor="middle" dy="0.35em" fill={sel ? '#fff' : s.color}>
                    {idx + 1}. {s.name}{s.locked ? ' 🔒' : ''}
                  </text>
                )}
              </g>
            );
          })}
          {surface && !surface.locked && !selMask && (
            <>
              {surface.shape === 'polygon' && renderHandles(surface.polygon, 'polygon', true)}
              {renderHandles(surface.quad, 'quad', false)}
            </>
          )}
          {selMask && renderHandles(selMask.mask.points, 'mask', true)}
          {rect && (
            <rect
              className="drawing"
              x={Math.min(rect.a.x, rect.b.x) * W}
              y={Math.min(rect.a.y, rect.b.y) * H}
              width={Math.abs(rect.b.x - rect.a.x) * W}
              height={Math.abs(rect.b.y - rect.a.y) * H}
              strokeWidth={unit * 2}
            />
          )}
          {poly.length > 0 && (
            <g className={`drawing ${calib.tool}`}>
              <polyline points={path(hover ? [...poly, hover] : poly)} strokeWidth={unit * 2} fill="none" />
              {poly.map((p, i) => (
                <circle key={i} cx={p.x * W} cy={p.y * H} r={r * (i === 0 ? 1.1 : 0.7)} />
              ))}
            </g>
          )}
        </svg>
      </div>
      <div className="stage-hud">
        {hover && <span data-testid="hud-pos">x {Math.round(hover.x * W)} · y {Math.round(hover.y * H)} px</span>}
        {activePoint && (
          <span>
            {active!.target === 'quad' ? `Esquina ${active!.index + 1}` : `Vértice ${active!.index + 1}`}: {Math.round(activePoint.x * W)}, {Math.round(activePoint.y * H)}
          </span>
        )}
        {surface && <span>{SURFACE_KIND_LABELS[surface.kind]} «{surface.name}»{surface.locked ? ' (bloqueada)' : ''}</span>}
        {(calib.tool === 'polygon' || calib.tool === 'mask') && (
          <span className="hint">Clic para añadir puntos · Intro o doble clic para cerrar · Esc para cancelar</span>
        )}
        {calib.tool === 'rect' && <span className="hint">Arrastra para dibujar un rectángulo</span>}
        <span className="zoom">
          <button onClick={() => setView({ zoom: 1, x: 0, y: 0 })} title="Ajustar a la ventana">{Math.round(view.zoom * 100)}%</button>
        </span>
      </div>
    </div>
  );
}

/** Convierte un cuadrilátero a rectángulo alineado (útil para empezar de nuevo). */
export function resetToRect(q: Quad): Quad {
  return quadFromBBox(q);
}
