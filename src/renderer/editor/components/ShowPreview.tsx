/** Previsualización del espectáculo dentro del editor (mismo motor que la salida). */
import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { Play, Pause, Square, SkipBack, Volume2, VolumeX, Scan } from 'lucide-react';
import { useStore, mediaBase, selShow } from '../store';
import { Player } from '../../engine/player';
import { registerPlayerInvalidator } from '../services';
import { formatTime } from '../../../shared/timeline';
import { Button } from './ui';

interface PreviewState {
  time: number;
  playing: boolean;
  duration: number;
  sceneName: string | null;
  outlines: boolean;
  muted: boolean;
}

export const usePreview = create<PreviewState>(() => ({ time: 0, playing: false, duration: 0, sceneName: null, outlines: true, muted: false }));

let current: Player | null = null;
export const previewControl = {
  play: () => { if (current) { void current.play(); usePreview.setState({ playing: true }); } },
  pause: () => { current?.pause(); usePreview.setState({ playing: false }); },
  stop: () => { current?.stop(); usePreview.setState({ playing: false, time: 0 }); },
  seek: (t: number) => { current?.seek(t); usePreview.setState({ time: Math.max(0, t) }); },
  toggle: () => (usePreview.getState().playing ? previewControl.pause() : previewControl.play()),
  time: () => current?.time ?? 0,
};

export function ShowPreview() {
  const project = useStore((s) => s.project)!;
  const projectKey = useStore((s) => s.projectKey);
  const show = useStore(selShow);
  const settings = useStore((s) => s.settings);
  const surfaceId = useStore((s) => s.surfaceId);
  const { time, playing, duration, sceneName, outlines, muted } = usePreview();
  const glRef = useRef<HTMLCanvasElement>(null);
  const ovRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!glRef.current) return;
    let p: Player;
    try {
      p = new Player(glRef.current, { audio: true, showMissing: true, overlay: ovRef.current, maxWidth: 1280 });
    } catch (e) {
      useStore.getState().toast('error', `No se pudo iniciar la vista previa: ${(e as Error).message}`);
      return;
    }
    current = p;
    (window as any).__vmPreviewPlayer = p;
    let last = 0;
    p.setOnFrame((pl) => {
      const now = performance.now();
      if (now - last < 66) return;
      last = now;
      const st = pl.status();
      usePreview.setState({ time: st.cycleTime, playing: pl.playing, duration: st.duration, sceneName: st.sceneName });
    });
    p.start();
    const off = registerPlayerInvalidator((id) => p.invalidateAsset(id));
    return () => {
      off();
      p.dispose();
      if (current === p) current = null;
      usePreview.setState({ playing: false });
    };
  }, []);

  useEffect(() => {
    if (!current) return;
    current.setProject(project, mediaBase(), projectKey);
    current.setMode(show ? { kind: 'show', showId: show.id } : { kind: 'black' });
  }, [project, projectKey, show?.id]);

  useEffect(() => {
    if (!current) return;
    current.overlay = { outlines, labels: outlines, grid: false, selectedSurfaceId: surfaceId };
  }, [outlines, surfaceId]);

  useEffect(() => {
    // Si la salida está reproduciendo, la previsualización se silencia para no duplicar el sonido.
    const enabled = (settings?.audioEnabled ?? true) && (settings?.previewAudio ?? true) && !muted;
    current?.setAudio(enabled, 1);
  }, [settings?.audioEnabled, settings?.previewAudio, muted]);

  const inst = show ? project.installations.find((i) => i.id === show.installationId) : null;
  const aspect = inst ? inst.output.width / inst.output.height : 16 / 9;

  return (
    <div className="preview">
      <div className="preview-frame" style={{ aspectRatio: String(aspect) }}>
        <canvas ref={glRef} data-testid="preview-gl" />
        <canvas ref={ovRef} className="ov" />
        {!inst && <div className="preview-msg">Asigna una instalación al espectáculo para previsualizarlo.</div>}
        <span className="preview-tag">PREVISUALIZACIÓN</span>
      </div>
      <div className="transport">
        <Button small icon={<SkipBack size={15} />} onClick={() => previewControl.seek(0)} title="Al principio" />
        <Button small variant="primary" icon={playing ? <Pause size={15} /> : <Play size={15} />} onClick={previewControl.toggle} title="Reproducir / pausa (Espacio)" data-testid="preview-play" />
        <Button small icon={<Square size={14} />} onClick={previewControl.stop} title="Detener" />
        <input
          type="range"
          className="slider grow"
          min={0}
          max={Math.max(0.1, duration)}
          step={0.05}
          value={Math.min(time, duration)}
          onChange={(e) => previewControl.seek(parseFloat(e.target.value))}
          data-testid="preview-seek"
        />
        <span className="time" data-testid="preview-time">{formatTime(time)} / {formatTime(duration)}</span>
        <span className="scene-name muted small">{sceneName ?? '—'}</span>
        <Button small active={!muted} icon={muted ? <VolumeX size={15} /> : <Volume2 size={15} />} onClick={() => usePreview.setState({ muted: !muted })} title="Sonido de la previsualización" />
        <Button small active={outlines} icon={<Scan size={15} />} onClick={() => usePreview.setState({ outlines: !outlines })} title="Mostrar contornos de superficies" />
      </div>
    </div>
  );
}
