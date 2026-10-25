/**
 * Vídeo de demostración: graba el espectáculo (imagen y sonido) en tiempo real, opcionalmente sobre la
 * foto de la fachada oscurecida como si fuera de noche, para enviarlo por WhatsApp o enseñarlo.
 * Usa un reproductor propio, oculto: no toca el proyector ni las luces de casa.
 */
import { useEffect, useRef, useState } from 'react';
import { Video, FolderOpen } from 'lucide-react';
import { useStore, mediaBase } from '../store';
import { vm, errMsg } from '../services';
import { mediaUrl } from '../../engine/media';
import { Player } from '../../engine/player';
import { Button, Field, Modal, Select, Toggle } from './ui';
import { layoutShow, formatTime } from '../../../shared/timeline';

const TYPES: { mime: string; ext: 'mp4' | 'webm' }[] = [
  { mime: 'video/mp4;codecs=avc1.42E01F,mp4a.40.2', ext: 'mp4' },
  { mime: 'video/mp4;codecs=avc1,mp4a.40.2', ext: 'mp4' },
  { mime: 'video/mp4;codecs=avc1,opus', ext: 'mp4' },
  { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
  { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
  { mime: 'video/webm', ext: 'webm' },
];
export function demoFormat(): { mime: string; ext: 'mp4' | 'webm' } | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return TYPES.find((t) => MediaRecorder.isTypeSupported(t.mime)) ?? null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = src;
  });
}

export function DemoRecorder({ showId, onClose }: { showId: string | null; onClose: () => void }) {
  const project = useStore((s) => s.project)!;
  const projectKey = useStore((s) => s.projectKey);
  const toast = useStore((s) => s.toast);
  const [sid, setSid] = useState(showId ?? project.shows[0]?.id ?? '');
  const [length, setLength] = useState<'full' | '10' | '30' | '60'>('full');
  const [quality, setQuality] = useState<'720' | '1080'>('720');
  const show = project.shows.find((s) => s.id === sid) ?? null;
  const inst = show ? project.installations.find((i) => i.id === show.installationId) ?? null : null;
  const photo = inst?.referenceImageAssetId ? project.assets.find((a) => a.id === inst.referenceImageAssetId) ?? null : null;
  const [onPhoto, setOnPhoto] = useState(!!photo);
  const [monitor, setMonitor] = useState(true);
  const [state, setState] = useState<{ phase: 'idle' | 'prep' | 'rec' | 'saving' | 'done'; t: number; total: number; file?: string | null }>({ phase: 'idle', t: 0, total: 0 });
  const cancel = useRef(false);
  const fmt = demoFormat();
  const total = show ? layoutShow(show).duration : 0;
  const recTotal = length === 'full' ? total : Math.min(total, Number(length));

  useEffect(() => () => { cancel.current = true; }, []);

  const run = async () => {
    if (!show || !fmt) return;
    cancel.current = false;
    setState({ phase: 'prep', t: 0, total: recTotal });
    const gl = document.createElement('canvas');
    let p: Player | null = null;
    let id: string | null = null;
    try {
      p = new Player(gl, { audio: true, showMissing: false, maxWidth: quality === '1080' ? 1920 : 1280 });
      p.setProject(project, mediaBase(), `${projectKey}-demo`);
      p.setMode({ kind: 'show', showId: show.id });
      await p.fontsReady();
      // Precarga: unos fotogramas al principio para que lleguen imágenes y vídeos.
      p.seek(0);
      for (let i = 0; i < 12 && !cancel.current; i++) { p.renderFrame(); await sleep(120); }
      const W = gl.width, H = gl.height;
      const comp = document.createElement('canvas');
      comp.width = W;
      comp.height = H;
      const c2 = comp.getContext('2d')!;
      const img = onPhoto && photo ? await loadImage(mediaUrl(mediaBase(), photo.file, projectKey)) : null;
      const draw = () => {
        p!.renderFrame();
        c2.globalCompositeOperation = 'source-over';
        if (img) {
          // La casa de noche y, encima, la luz del proyector.
          c2.filter = 'brightness(0.45) saturate(0.85)';
          c2.drawImage(img, 0, 0, W, H);
          c2.filter = 'none';
          c2.globalCompositeOperation = 'screen';
        } else {
          c2.fillStyle = '#000';
          c2.fillRect(0, 0, W, H);
        }
        c2.drawImage(gl, 0, 0, W, H);
      };
      draw();
      const tracks = [...comp.captureStream(30).getVideoTracks(), ...(p.audio.captureStream(monitor)?.getAudioTracks() ?? [])];
      const rec = new MediaRecorder(new MediaStream(tracks), { mimeType: fmt.mime, videoBitsPerSecond: quality === '1080' ? 12_000_000 : 7_000_000, audioBitsPerSecond: 160_000 });
      id = await vm.demo.begin(fmt.ext);
      let writing: Promise<void> = Promise.resolve();
      const recId = id;
      rec.ondataavailable = (e) => {
        if (!e.data.size) return;
        writing = writing.then(async () => vm.demo.chunk(recId, new Uint8Array(await e.data.arrayBuffer())));
      };
      const stopped = new Promise<void>((r) => { rec.onstop = () => r(); });
      rec.start(1000);
      await p.play();
      setState({ phase: 'rec', t: 0, total: recTotal });
      await new Promise<void>((resolve) => {
        let lastUi = 0;
        const tick = () => {
          if (cancel.current || p!.time >= recTotal) { resolve(); return; }
          draw();
          const now = performance.now();
          if (now - lastUi > 250) { lastUi = now; setState({ phase: 'rec', t: p!.time, total: recTotal }); }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      // Un poco de margen para que el último sonido no se corte.
      if (!cancel.current) { for (let i = 0; i < 8; i++) { draw(); await sleep(33); } }
      rec.stop();
      await stopped;
      await writing;
      p.dispose();
      p = null;
      if (cancel.current) { await vm.demo.cancel(id); id = null; setState({ phase: 'idle', t: 0, total: 0 }); return; }
      setState({ phase: 'saving', t: recTotal, total: recTotal });
      const file = await vm.demo.finish(id, show.name);
      id = null;
      setState({ phase: file ? 'done' : 'idle', t: recTotal, total: recTotal, file });
      if (file) toast('success', `Vídeo guardado: ${file}`, 6000);
    } catch (e) {
      toast('error', `No se pudo grabar: ${errMsg(e)}`, 10000);
      if (id) await vm.demo.cancel(id).catch(() => {});
      setState({ phase: 'idle', t: 0, total: 0 });
    } finally {
      p?.dispose();
    }
  };

  const busy = state.phase === 'prep' || state.phase === 'rec' || state.phase === 'saving';
  return (
    <Modal title="Grabar vídeo de demostración" onClose={() => { if (!busy) onClose(); }}>
      <p className="muted small">Graba el espectáculo con su sonido para enviarlo o enseñarlo. Se graba en tiempo real (tarda lo mismo que dura); no se proyecta nada ni se tocan las luces de casa.</p>
      {!fmt && <div className="banner error small">Este equipo no permite grabar vídeo.</div>}
      {state.phase === 'idle' && (
        <>
          <div className="row2">
            <Field label="Espectáculo"><Select value={sid} onChange={setSid} options={project.shows.map((s) => ({ value: s.id, label: s.name }))} /></Field>
            <Field label="Duración"><Select value={length} onChange={setLength} options={[{ value: 'full', label: `Completo (${formatTime(total)})` }, { value: '10', label: 'Primeros 10 s (prueba rápida)' }, { value: '30', label: 'Primeros 30 s' }, { value: '60', label: 'Primer minuto' }]} data-testid="demo-length" /></Field>
          </div>
          <Field label="Calidad"><Select value={quality} onChange={setQuality} options={[{ value: '720', label: '720p (ideal para WhatsApp)' }, { value: '1080', label: '1080p' }]} /></Field>
          {photo ? <Toggle checked={onPhoto} onChange={setOnPhoto} label="Sobre la foto de la fachada, de noche (se ve cómo quedaría en la casa)" data-testid="demo-photo" /> : <p className="muted small">Consejo: si pones una foto de la fachada en Calibración, el vídeo se graba sobre la casa, de noche.</p>}
          <Toggle checked={monitor} onChange={setMonitor} label="Oírlo mientras se graba" />
          <p className="muted small">Formato: {fmt ? (fmt.ext === 'mp4' ? 'MP4 (se ve en cualquier móvil)' : 'WebM (si el móvil no lo abre, conviértelo a MP4)') : '—'}.</p>
          <div className="btn-row">
            <Button variant="primary" icon={<Video size={15} />} onClick={() => void run()} disabled={!show || !fmt || !recTotal} data-testid="demo-start">Grabar</Button>
            <Button onClick={onClose}>Cerrar</Button>
          </div>
        </>
      )}
      {busy && (
        <>
          <p data-testid="demo-progress">{state.phase === 'prep' ? 'Preparando…' : state.phase === 'saving' ? 'Guardando…' : `Grabando ${formatTime(state.t)} de ${formatTime(state.total)}`}</p>
          <div className="play-progress"><div className="bar"><div className="fill" style={{ width: `${state.total ? Math.min(100, (state.t / state.total) * 100) : 0}%` }} /></div></div>
          <p className="muted small">Deja esta ventana a la vista hasta que termine.</p>
          {state.phase !== 'saving' && <div className="btn-row"><Button onClick={() => { cancel.current = true; }} data-testid="demo-cancel">Cancelar</Button></div>}
        </>
      )}
      {state.phase === 'done' && (
        <>
          <div className="banner ok small" data-testid="demo-done">Vídeo guardado en {state.file}</div>
          <div className="btn-row">
            <Button icon={<FolderOpen size={15} />} onClick={() => void vm.demo.reveal()}>Mostrar en la carpeta</Button>
            <Button variant="primary" onClick={onClose}>Cerrar</Button>
          </div>
        </>
      )}
    </Modal>
  );
}
