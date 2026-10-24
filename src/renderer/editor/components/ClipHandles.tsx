/**
 * Edición directa del clip seleccionado sobre la previsualización:
 * arrastrar = mover dentro de la superficie · rueda = escalar · Mayús+rueda = girar.
 * La posición se guarda en el espacio uv de la superficie, así que sigue siendo válida
 * aunque luego se recalibre la ventana.
 */
import { useRef } from 'react';
import { useStore, selScene, selShow } from '../store';
import type { Clip, Project, Vec2 } from '../../../shared/model';
import { applyH, invert3, outputToSurfaceUV, squareToQuad, surfaceAspect } from '../../../shared/geometry';
import { contentMatrix } from '../../../shared/timeline';

export function ClipHandles({ width, height }: { width: number; height: number }) {
  const project = useStore((s) => s.project)!;
  const show = useStore(selShow);
  const scene = useStore(selScene);
  const clipId = useStore((s) => s.clipId);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ startUv: Vec2; x0: number; y0: number } | null>(null);
  const wheelTimer = useRef<number | null>(null);

  const clip = scene?.clips.find((c) => c.id === clipId) ?? null;
  const inst = show ? project.installations.find((i) => i.id === show.installationId) : null;
  const surface = clip && inst ? inst.surfaces.find((s) => s.id === clip.surfaceId) : null;
  if (!clip || !inst || !surface) return null;

  const A = surfaceAspect(surface, inst.output);
  let C = A;
  if (clip.source.type === 'asset') {
    const id = clip.source.assetId;
    const a = project.assets.find((x) => x.id === id);
    if (a?.width && a?.height) C = a.width / a.height;
  }
  // Contorno del contenido (sin movimiento animado) en coordenadas de salida.
  let corners: Vec2[] = [];
  try {
    const Mi = invert3(contentMatrix(clip, A, C));
    const H = squareToQuad(surface.quad);
    corners = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }].map((c) => applyH(H, applyH(Mi, c)));
  } catch {
    return null;
  }
  const toUv = outputToSurfaceUV(surface);
  if (!toUv) return null;

  const st = useStore.getState;
  const mutClip = (live: boolean, fn: (c: Clip) => void, label: string) => {
    const apply = (d: Project) => {
      const sh = d.shows.find((x) => x.id === show!.id);
      const sc = sh?.scenes.find((x) => x.id === scene!.id);
      const c = sc?.clips.find((x) => x.id === clip.id);
      if (c) fn(c);
    };
    live ? st().dragUpdate(apply) : st().update(label, apply);
  };
  const norm = (e: { clientX: number; clientY: number }): Vec2 => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    st().beginDrag();
    drag.current = { startUv: applyH(toUv, norm(e)), x0: clip.x, y0: clip.y };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const uv = applyH(toUv, norm(e));
    const k = e.shiftKey ? 0.2 : 1;
    mutClip(true, (c) => {
      c.x = d.x0 + (uv.x - d.startUv.x) * k;
      c.y = d.y0 + (uv.y - d.startUv.y) * k;
    }, 'Mover clip');
  };
  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    st().endDrag('Mover clip en la superficie');
  };
  const onWheel = (e: React.WheelEvent) => {
    e.stopPropagation();
    // Con Mayús, Chromium convierte la rueda en desplazamiento horizontal (deltaX).
    const dy = e.deltaY || e.deltaX;
    if (!dy) return;
    if (!st().dragBase) st().beginDrag();
    if (e.shiftKey) mutClip(true, (c) => { c.rotation = Math.round((c.rotation + Math.sign(dy) * 3) * 10) / 10; }, 'Girar');
    else mutClip(true, (c) => { c.scale = Math.max(0.02, Math.min(10, c.scale * Math.exp(-dy * 0.0012))); }, 'Escalar');
    if (wheelTimer.current) clearTimeout(wheelTimer.current);
    wheelTimer.current = window.setTimeout(() => st().endDrag(e.shiftKey ? 'Girar clip' : 'Escalar clip'), 350);
  };

  const pts = corners.map((p) => `${p.x * width},${p.y * height}`).join(' ');
  const outline = (surface.shape === 'polygon' && surface.polygon.length >= 3 ? surface.polygon : surface.quad).map((p) => `${p.x * width},${p.y * height}`).join(' ');
  return (
    <svg ref={svgRef} className="clip-handles" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" data-testid="clip-handles">
      <polygon points={outline} className="surf-outline" />
      <polygon
        points={pts}
        className="clip-box"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onWheel={onWheel}
        data-testid="clip-box"
      >
        <title>Arrastra para mover · rueda para escalar · Mayús+rueda para girar</title>
      </polygon>
    </svg>
  );
}
