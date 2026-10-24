/** Control de la salida de proyección: pantalla, abrir/cerrar y modo (negro / calibración / espectáculo). */
import { useMemo, useState } from 'react';
import { Projector, Power, MonitorOff } from 'lucide-react';
import { useStore, type OutputModeChoice } from '../store';
import { openOutput, closeOutput } from '../services';
import { Button } from './ui';

export function OutputControl() {
  const displays = useStore((s) => s.displays);
  const output = useStore((s) => s.output);
  const mode = useStore((s) => s.outputMode);
  const status = useStore((s) => s.outputStatus);
  const settings = useStore((s) => s.settings);
  const set = useStore((s) => s.set);
  const project = useStore((s) => s.project);

  // Preselección: la última pantalla usada, si no la primera que no tenga el editor.
  const defaultDisplay = useMemo(() => {
    const byLabel = displays.find((d) => settings?.lastOutputDisplayLabel && d.label === settings.lastOutputDisplayLabel && !d.hasEditor);
    return (byLabel ?? displays.find((d) => !d.hasEditor) ?? null)?.id ?? -1;
  }, [displays, settings?.lastOutputDisplayLabel]);
  const [choice, setChoice] = useState<number | null>(null);
  const selected = choice ?? defaultDisplay;
  const sel = displays.find((d) => d.id === selected);

  const setMode = (m: OutputModeChoice) => set({ outputMode: m });

  return (
    <div className="output-control" data-testid="output-control">
      <Projector size={18} className={output.open ? 'live' : 'muted'} />
      <select
        value={output.open ? output.displayId ?? -1 : selected}
        disabled={output.open}
        onChange={(e) => setChoice(parseInt(e.target.value, 10))}
        title="Pantalla del proyector"
        data-testid="display-select"
      >
        {displays.map((d, i) => (
          <option key={d.id} value={d.id}>
            {`${i + 1}. ${d.label} · ${d.pixelSize.width}×${d.pixelSize.height}${d.hasEditor ? ' (editor)' : ''}${d.primary ? ' · principal' : ''}`}
          </option>
        ))}
        <option value={-1}>Ventana de prueba (sin proyector)</option>
      </select>
      {output.open ? (
        <Button small icon={<Power size={14} />} onClick={() => void closeOutput()} data-testid="output-close" title="Cerrar la salida de proyección">
          Cerrar salida
        </Button>
      ) : (
        <Button
          small
          variant="primary"
          icon={<Power size={14} />}
          disabled={!project}
          data-testid="output-open"
          title={sel?.hasEditor ? 'Atención: esta pantalla es la del editor; la salida la cubrirá.' : 'Abrir la salida a pantalla completa en el proyector'}
          onClick={() => void openOutput(selected >= 0 ? selected : null, selected >= 0)}
        >
          Abrir salida
        </Button>
      )}
      <div className="seg" role="radiogroup" aria-label="Contenido de la salida">
        {(
          [
            ['black', 'Negro'],
            ['calibration', 'Calibración'],
            ['show', 'Espectáculo'],
          ] as [OutputModeChoice, string][]
        ).map(([m, l]) => (
          <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)} data-testid={`outmode-${m}`} disabled={!project}>
            {m === 'black' && <MonitorOff size={13} />} {l}
          </button>
        ))}
      </div>
      {output.open && status && (
        <span className="output-fps" title="Fotogramas por segundo en la salida">{Math.round(status.fps)} fps</span>
      )}
    </div>
  );
}
