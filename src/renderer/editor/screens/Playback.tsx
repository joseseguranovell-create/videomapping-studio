/** Reproducción en directo: control del espectáculo en el proyector y comprobaciones previas. */
import { useMemo, useState } from 'react';
import { Play, Pause, Square, MonitorOff, Projector, CheckCircle2, AlertTriangle, XCircle, Activity } from 'lucide-react';
import { useStore } from '../store';
import { openOutput, closeOutput, transport, vm } from '../services';
import { Button, Panel } from '../components/ui';
import { formatTime, layoutShow } from '../../../shared/timeline';
import { validateInstallation } from '../../../shared/geometry';

export function PlaybackScreen() {
  const project = useStore((s) => s.project)!;
  const output = useStore((s) => s.output);
  const status = useStore((s) => s.outputStatus);
  const outputMode = useStore((s) => s.outputMode);
  const outputShowId = useStore((s) => s.outputShowId);
  const displays = useStore((s) => s.displays);
  const missing = useStore((s) => s.missing);
  const settings = useStore((s) => s.settings);
  const set = useStore((s) => s.set);
  const [displayChoice, setDisplayChoice] = useState<number>(displays.find((d) => !d.hasEditor)?.id ?? -1);

  const show = project.shows.find((s) => s.id === outputShowId) ?? project.shows[0] ?? null;
  const inst = show ? project.installations.find((i) => i.id === show.installationId) : null;
  const L = useMemo(() => (show ? layoutShow(show) : null), [show]);

  const checks: { level: 'ok' | 'warn' | 'error'; text: string }[] = [];
  if (!show) checks.push({ level: 'error', text: 'No hay ningún espectáculo.' });
  else {
    if (!inst) checks.push({ level: 'error', text: 'El espectáculo no tiene instalación asignada.' });
    else {
      const issues = validateInstallation(inst);
      if (issues.some((i) => i.level === 'error')) checks.push({ level: 'error', text: 'La calibración tiene errores de geometría (revisa Calibración).' });
      else checks.push({ level: 'ok', text: `Instalación «${inst.name}» con ${inst.surfaces.length} superficies.` });
      if (!inst.calibratedAt) checks.push({ level: 'warn', text: 'La instalación no se ha marcado como calibrada.' });
      const orphan = show.scenes.reduce((n, sc) => n + sc.clips.filter((c) => !inst.surfaces.some((s) => s.id === c.surfaceId)).length, 0);
      if (orphan) checks.push({ level: 'warn', text: `${orphan} clip(s) apuntan a superficies que no existen en esta instalación.` });
    }
    if (!L?.duration) checks.push({ level: 'error', text: 'El espectáculo no tiene escenas activas.' });
    else checks.push({ level: 'ok', text: `${L.slots.length} escenas · ${formatTime(L.duration)}${show.loop ? ' · en bucle' : ''}.` });
    const used = new Set<string>();
    show.music.forEach((m) => used.add(m.assetId));
    show.scenes.forEach((sc) => { sc.clips.forEach((c) => c.source.type === 'asset' && used.add(c.source.assetId)); sc.sounds.forEach((s) => used.add(s.assetId)); });
    const miss = [...used].filter((id) => missing.includes(id) || !project.assets.some((a) => a.id === id));
    if (miss.length) checks.push({ level: 'error', text: `Faltan ${miss.length} archivo(s) que usa este espectáculo.` });
    else checks.push({ level: 'ok', text: 'Todos los recursos están disponibles.' });
  }
  if (!settings?.audioEnabled) checks.push({ level: 'warn', text: 'El audio está desactivado en Ajustes.' });
  if (!output.open) checks.push({ level: 'warn', text: 'La salida de proyección está cerrada.' });
  const extDisplays = displays.filter((d) => !d.hasEditor);
  if (!extDisplays.length) checks.push({ level: 'warn', text: 'Solo se detecta una pantalla: conecta el proyector (modo «Extender» en Windows: Win+P).' });

  const live = output.open && outputMode === 'show' && status?.mode === 'show';
  const playing = live && status?.playing;
  const progress = status && status.duration ? Math.min(1, status.cycleTime / status.duration) : 0;

  const startShow = async () => {
    if (!show) return;
    set({ outputMode: 'show', outputShowId: show.id });
    if (!output.open) await openOutput(displayChoice >= 0 ? displayChoice : null, displayChoice >= 0);
    // dar tiempo a que la salida reciba el documento y el modo
    setTimeout(() => transport('play'), 300);
  };

  return (
    <div className="screen playback">
      <div className="play-main">
        <Panel title="Espectáculo en el proyector">
          <div className="play-row">
            <select
              value={show?.id ?? ''}
              onChange={(e) => set({ outputShowId: e.target.value })}
              data-testid="play-show-select"
            >
              {project.shows.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {!output.open && (
              <select value={displayChoice} onChange={(e) => setDisplayChoice(parseInt(e.target.value, 10))}>
                {displays.map((d, i) => <option key={d.id} value={d.id}>{`${i + 1}. ${d.label} ${d.pixelSize.width}×${d.pixelSize.height}${d.hasEditor ? ' (editor)' : ''}`}</option>)}
                <option value={-1}>Ventana de prueba</option>
              </select>
            )}
          </div>
          <div className="big-transport">
            <Button variant="primary" icon={<Play size={20} />} onClick={startShow} disabled={!show} data-testid="play-start">
              {playing ? 'Reiniciar' : live ? 'Continuar' : 'Reproducir'}
            </Button>
            <Button icon={<Pause size={20} />} onClick={() => transport('pause')} disabled={!playing} data-testid="play-pause">Pausa</Button>
            <Button icon={<Square size={18} />} onClick={() => transport('stop')} disabled={!live} data-testid="play-stop">Detener</Button>
            <Button icon={<MonitorOff size={18} />} onClick={() => set({ outputMode: 'black' })} disabled={!output.open} data-testid="play-black">Negro</Button>
            {output.open ? (
              <Button icon={<Projector size={18} />} onClick={() => void closeOutput()}>Cerrar salida</Button>
            ) : null}
          </div>
          <div className="play-progress">
            <div className="bar"><div className="fill" style={{ width: `${progress * 100}%` }} /></div>
            <input
              type="range"
              className="slider"
              min={0}
              max={Math.max(0.1, status?.duration ?? L?.duration ?? 0)}
              step={0.1}
              value={status?.cycleTime ?? 0}
              disabled={!live}
              onChange={(e) => vm.output.send({ type: 'seek', time: parseFloat(e.target.value) })}
            />
            <div className="play-time">
              <span data-testid="play-time">{formatTime(status?.cycleTime ?? 0)}</span> / {formatTime(status?.duration ?? L?.duration ?? 0)}
              <span className="scene">{live ? status?.sceneName ?? '(pausa entre repeticiones)' : '—'}</span>
            </div>
          </div>
          {L && (
            <div className="play-scenes">
              {L.slots.map((s) => (
                <button key={s.scene.id} className={`chip${live && status?.sceneName === s.scene.name ? ' on' : ''}`} disabled={!live} onClick={() => vm.output.send({ type: 'seek', time: s.start })} title="Saltar a esta escena">
                  {s.scene.name}
                </button>
              ))}
            </div>
          )}
        </Panel>
      </div>
      <aside className="side right">
        <Panel title="Comprobaciones previas">
          <ul className="checks" data-testid="checks">
            {checks.map((c, i) => (
              <li key={i} className={c.level}>
                {c.level === 'ok' ? <CheckCircle2 size={15} /> : c.level === 'warn' ? <AlertTriangle size={15} /> : <XCircle size={15} />} {c.text}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title={<><Activity size={14} /> Diagnóstico de la salida</>}>
          {status ? (
            <dl className="info" data-testid="output-diag">
              <dt>Estado</dt><dd>{status.mode === 'show' ? (status.playing ? 'Reproduciendo' : 'En pausa') : status.mode === 'calibration' ? 'Calibración' : 'Negro'}</dd>
              <dt>Fotogramas/s</dt><dd>{status.fps.toFixed(1)}</dd>
              <dt>Tiempo de dibujo</dt><dd>{status.frameMs.toFixed(2)} ms</dd>
              <dt>Resolución</dt><dd>{status.width}×{status.height}</dd>
              <dt>Vídeos activos</dt><dd>{status.activeVideos}</dd>
              <dt>Texturas</dt><dd>{status.textures}</dd>
              <dt>Gráficos</dt><dd className="path">{status.gpu || '—'}{/swiftshader|llvmpipe|software/i.test(status.gpu) ? ' (por software: puede ir lento; actualiza los controladores de la GPU)' : ''}</dd>
            </dl>
          ) : <p className="muted small">Abre la salida para ver estadísticas.</p>}
          {status?.errors.length ? (
            <>
              <h4 className="sub">Errores de reproducción</h4>
              <ul className="issues">{status.errors.map((e, i) => <li key={i} className="error"><AlertTriangle size={13} /> {e}</li>)}</ul>
            </>
          ) : null}
        </Panel>
        <p className="muted small help">La salida reproduce de forma independiente: puedes seguir editando, aunque los cambios del espectáculo se aplican en directo. Para una noche completa activa «Repetir en bucle» en el espectáculo.</p>
      </aside>
    </div>
  );
}
