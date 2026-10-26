/** Asistente «Fachada desde una foto»: foto → encuadre del proyector → ventanas y puertas → instalación lista. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ImageIcon, Trash2, Check } from 'lucide-react';
import { useStore, mediaBase } from '../store';
import { mediaUrl } from '../../engine/media';
import { vm, assetFromImported, errMsg } from '../services';
import { Button, Field, Modal, Slider, TextInput, Toggle } from './ui';
import { createInstallation, createSurface } from '../../../shared/factory';
import { fitCrop, type Crop } from '../../../shared/crop';
import { detectSurfaces, toGray } from '../../../shared/detect';
import { SURFACE_KINDS, SURFACE_KIND_LABELS, type Asset, type Surface } from '../../../shared/model';
import { newId } from '../../../shared/ids';

const RES = [
  { w: 1920, h: 1080, l: '1920 × 1080 (Full HD)' },
  { w: 1280, h: 720, l: '1280 × 720 (HD)' },
  { w: 1920, h: 1200, l: '1920 × 1200 (16:10)' },
  { w: 3840, h: 2160, l: '3840 × 2160 (4K)' },
  { w: 1024, h: 768, l: '1024 × 768 (4:3)' },
];

interface Cand { id: string; x: number; y: number; w: number; h: number; kind: Surface['kind']; name: string; on: boolean }

function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('No se pudo leer la foto'));
    im.src = url;
  });
}

export function FacadeWizard({ onClose }: { onClose: () => void }) {
  const projectKey = useStore((s) => s.projectKey);
  const update = useStore((s) => s.update);
  const set = useStore((s) => s.set);
  const toast = useStore((s) => s.toast);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [resIdx, setResIdx] = useState(0);
  const [vertical, setVertical] = useState(false);
  const [center, setCenter] = useState({ x: 0.5, y: 0.5 });
  const [zoom, setZoom] = useState(1);
  const [name, setName] = useState('Mi fachada');
  const [cands, setCands] = useState<Cand[]>([]);
  const [sens, setSens] = useState(10);
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const out = vertical ? { width: RES[resIdx].h, height: RES[resIdx].w } : { width: RES[resIdx].w, height: RES[resIdx].h };
  const outAspect = out.width / out.height;
  const crop: Crop | null = asset?.width && asset?.height ? fitCrop(asset.width, asset.height, outAspect, center.x, center.y, zoom) : null;
  const url = asset ? mediaUrl(mediaBase(), asset.file, projectKey) : '';

  const pick = async () => {
    try {
      const f = await vm.assets.pickImage();
      if (!f) return;
      const { asset: a } = await assetFromImported(f);
      a.tags = ['referencia'];
      setAsset(a);
      setCenter({ x: 0.5, y: 0.5 });
      setZoom(1);
      // Una foto vertical sugiere un proyector en vertical solo si es muy alargada; en el resto se recorta.
      if (a.width && a.height && a.height / a.width > 1.6) setVertical(true);
    } catch (e) {
      toast('error', errMsg(e));
    }
  };

  // ───── Paso 2: mover el encuadre arrastrando
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ sx: number; sy: number; cx: number; cy: number } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { sx: e.clientX, sy: e.clientY, cx: center.x, cy: center.y };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current, r = boxRef.current?.getBoundingClientRect();
    if (!d || !r) return;
    setCenter({ x: d.cx + (e.clientX - d.sx) / r.width, y: d.cy + (e.clientY - d.sy) / r.height });
  };

  // ───── Paso 3: detectar y editar candidatos
  const [frameUrl, setFrameUrl] = useState('');
  const runDetect = async (contrast: number) => {
    if (!asset || !crop) return;
    setBusy(true);
    try {
      const im = await loadImg(url);
      const W = 640, H = Math.round(W / outAspect);
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(im, crop.x * im.naturalWidth, crop.y * im.naturalHeight, crop.w * im.naturalWidth, crop.h * im.naturalHeight, 0, 0, W, H);
      setFrameUrl(c.toDataURL('image/jpeg', 0.85));
      const k = 480 / Math.max(W, H);
      const w = Math.round(W * k), h = Math.round(H * k);
      const s = document.createElement('canvas');
      s.width = w; s.height = h;
      const sg = s.getContext('2d', { willReadFrequently: true })!;
      sg.drawImage(c, 0, 0, w, h);
      const found = detectSurfaces(toGray(sg.getImageData(0, 0, w, h).data, w, h), w, h, { contrast, radius: 0.08, minArea: 0.003 });
      let nW = 0, nD = 0;
      setCands((old) => {
        const manual = old.filter((o) => o.id.startsWith('m'));
        return [
          ...found.map((f): Cand => ({ id: newId('c'), x: f.x, y: f.y, w: f.w, h: f.h, kind: f.kind, name: f.kind === 'door' ? `Puerta ${++nD}` : `Ventana ${++nW}`, on: true })),
          ...manual,
        ];
      });
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (step === 3) void runDetect(sens);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const svgRef = useRef<SVGSVGElement>(null);
  const draw = useRef<{ x: number; y: number; id: string } | null>(null);
  const pt = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const onDrawDown = (e: React.PointerEvent) => {
    if ((e.target as Element).tagName !== 'svg' && (e.target as Element).getAttribute('data-bg') !== '1') return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const p = pt(e);
    const id = newId('m');
    draw.current = { ...p, id };
    setCands((c) => [...c, { id, x: p.x, y: p.y, w: 0, h: 0, kind: 'window', name: `Superficie ${c.length + 1}`, on: true }]);
    setSel(id);
  };
  const onDrawMove = (e: React.PointerEvent) => {
    const d = draw.current;
    if (!d) return;
    const p = pt(e);
    setCands((c) => c.map((q) => q.id === d.id ? { ...q, x: Math.min(d.x, p.x), y: Math.min(d.y, p.y), w: Math.abs(p.x - d.x), h: Math.abs(p.y - d.y) } : q));
  };
  const onDrawUp = () => {
    const d = draw.current;
    draw.current = null;
    if (d) setCands((c) => c.filter((q) => q.id !== d.id || (q.w > 0.02 && q.h > 0.02)));
  };

  const chosen = useMemo(() => cands.filter((c) => c.on), [cands]);
  const patch = (id: string, p: Partial<Cand>) => setCands((c) => c.map((q) => q.id === id ? { ...q, ...p } : q));

  const finish = () => {
    if (!asset || !crop) return;
    const inst = createInstallation(name.trim() || 'Mi fachada', out);
    inst.referenceImageAssetId = asset.id;
    inst.referenceImageOpacity = 0.7;
    inst.referenceCrop = crop;
    inst.surfaces = chosen.map((c, i) => createSurface(c.name, c.kind, i, { x: c.x, y: c.y, w: c.w, h: c.h }));
    update('Fachada desde foto', (d) => {
      if (!d.assets.some((a) => a.id === asset.id)) d.assets.push(asset);
      d.installations.push(inst);
    });
    set({ installationId: inst.id, surfaceId: inst.surfaces[0]?.id ?? null });
    toast('success', `Fachada «${inst.name}» creada con ${inst.surfaces.length} superficies. Ajusta las esquinas con el proyector encendido.`);
    onClose();
  };

  const title = step === 1 ? 'Fachada desde una foto · 1 de 3: la foto' : step === 2 ? 'Fachada desde una foto · 2 de 3: encuadre del proyector' : 'Fachada desde una foto · 3 de 3: ventanas y puertas';
  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      footer={
        <>
          {step > 1 && <Button onClick={() => setStep((step - 1) as 1 | 2)}>Atrás</Button>}
          <Button onClick={onClose}>Cancelar</Button>
          {step === 1 && <Button variant="primary" disabled={!asset} onClick={() => setStep(2)} data-testid="fw-next1">Siguiente</Button>}
          {step === 2 && <Button variant="primary" onClick={() => setStep(3)} data-testid="fw-next2">Siguiente: buscar ventanas</Button>}
          {step === 3 && <Button variant="primary" icon={<Check size={15} />} disabled={!chosen.length} onClick={finish} data-testid="fw-finish">Crear fachada ({chosen.length})</Button>}
        </>
      }
    >
      {step === 1 && (
        <div className="fw-body">
          <p className="muted">Haz una foto de la fachada <b>desde donde irá el proyector</b>, de noche o con poca luz si puedes. El asistente te ayudará a marcar las ventanas y puertas sin salir a proyectar.</p>
          <div className="btn-row">
            <Button variant="primary" icon={<ImageIcon size={15} />} onClick={() => void pick()} data-testid="fw-pick">{asset ? 'Cambiar foto' : 'Elegir foto…'}</Button>
            {asset && <span className="muted small">{asset.name} · {asset.width}×{asset.height}</span>}
          </div>
          {asset && <img className="fw-photo" src={url} alt="" />}
          <div className="row2">
            <Field label="Resolución del proyector">
              <select className="full" value={resIdx} onChange={(e) => setResIdx(Number(e.target.value))}>
                {RES.map((r, i) => <option key={r.l} value={i}>{r.l}</option>)}
              </select>
            </Field>
            <Field label="Colocación"><Toggle checked={vertical} onChange={setVertical} label="Proyector en vertical (imagen más alta que ancha)" /></Field>
          </div>
          <Field label="Nombre de la fachada"><TextInput value={name} onCommit={setName} /></Field>
        </div>
      )}
      {step === 2 && asset && crop && (
        <div className="fw-body">
          <p className="muted">El proyector proyecta un rectángulo de proporción {out.width}:{out.height}. <b>Arrastra el recuadro</b> sobre la zona de la foto que cubre y ajusta el zoom si la casa es más pequeña.</p>
          <div className="fw-crop" ref={boxRef}>
            <img src={url} alt="" draggable={false} />
            <div
              className="fw-rect"
              style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={() => { drag.current = null; }}
            />
          </div>
          <Field label={`Acercar el encuadre: ${Math.round((1 - zoom) / 0.7 * 100)}%`} hint="Acercar reduce la zona que ves; úsalo si el proyector cubre solo una parte de la foto. Si la casa no cabe, vuelve atrás y marca «Proyector en vertical».">`n            <Slider value={1 - zoom} min={0} max={0.7} step={0.02} onChange={(v) => setZoom(1 - v)} onCommit={() => {}} />`n          </Field>
        </div>
      )}
      {step === 3 && crop && (
        <div className="fw-body fw-step3">
          <div>
            <p className="muted small">Se han buscado ventanas y puertas por contraste. <b>Pulsa un recuadro para quitarlo o ponerlo</b> y <b>arrastra sobre la imagen</b> para dibujar el que falte. Luego afinarás las esquinas con el proyector.</p>
            <div className="fw-frame" style={{ aspectRatio: `${out.width} / ${out.height}` }}>
              {frameUrl && <img src={frameUrl} alt="" draggable={false} />}
              <svg ref={svgRef} viewBox="0 0 1 1" preserveAspectRatio="none" onPointerDown={onDrawDown} onPointerMove={onDrawMove} onPointerUp={onDrawUp}>
                <rect data-bg="1" x="0" y="0" width="1" height="1" fill="transparent" />
                {cands.map((c, i) => (
                  <g key={c.id} onClick={(e) => { e.stopPropagation(); setSel(c.id); }}>
                    <rect x={c.x} y={c.y} width={c.w} height={c.h} className={`fw-cand${c.on ? ' on' : ''}${sel === c.id ? ' sel' : ''}`} vectorEffect="non-scaling-stroke" />
                    <text x={c.x + 0.006} y={c.y + 0.03} className="fw-num" fontSize="0.03">{i + 1}</text>
                  </g>
                ))}
              </svg>
              {busy && <div className="fw-busy">Buscando…</div>}
            </div>
            <Field label={`Sensibilidad (más a la derecha = más candidatos)`}>
              <Slider value={24 - sens} min={4} max={20} step={1} onChange={(v) => setSens(24 - v)} onCommit={() => void runDetect(sens)} />
            </Field>
          </div>
          <div className="fw-list">
            <b>Superficies ({chosen.length} de {cands.length})</b>
            {cands.length === 0 && <p className="muted small">No he encontrado nada claro: dibuja las ventanas arrastrando sobre la imagen.</p>}
            {cands.map((c, i) => (
              <div key={c.id} className={`fw-item${sel === c.id ? ' sel' : ''}`} onClick={() => setSel(c.id)}>
                <input type="checkbox" checked={c.on} onChange={(e) => patch(c.id, { on: e.target.checked })} />
                <span className="num">{i + 1}</span>
                <input className="fw-name" value={c.name} onChange={(e) => patch(c.id, { name: e.target.value })} />
                <select value={c.kind} onChange={(e) => patch(c.id, { kind: e.target.value as Surface['kind'] })}>
                  {SURFACE_KINDS.map((k) => <option key={k} value={k}>{SURFACE_KIND_LABELS[k]}</option>)}
                </select>
                <button title="Quitar" onClick={(e) => { e.stopPropagation(); setCands((x) => x.filter((q) => q.id !== c.id)); }}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
