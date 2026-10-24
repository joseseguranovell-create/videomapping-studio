/** Ajustes de la aplicación, copias de seguridad y diagnóstico. */
import { useEffect, useState } from 'react';
import { RefreshCw, FolderOpen, Archive, History, Download } from 'lucide-react';
import { useStore } from '../store';
import { vm, startAutosave, sendAudioSettings, errMsg } from '../services';
import { Button, Field, NumberInput, Panel, Toggle, confirmDialog, promptDialog, formatBytes } from '../components/ui';
import type { AppInfo, AppSettings, BackupEntry } from '../../../shared/api';

export function SettingsScreen() {
  const settings = useStore((s) => s.settings);
  const project = useStore((s) => s.project);
  const displays = useStore((s) => s.displays);
  const set = useStore((s) => s.set);
  const toast = useStore((s) => s.toast);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [log, setLog] = useState('');
  const [backups, setBackups] = useState<BackupEntry[]>([]);

  const loadBackups = async () => { if (project) setBackups(await vm.project.listBackups()); };
  useEffect(() => {
    void vm.app.info().then(setInfo);
    void vm.app.readLog().then(setLog);
    void loadBackups();
  }, [project?.id]);

  const save = async (p: Partial<AppSettings>) => {
    const s = await vm.app.setSettings(p);
    set({ settings: s });
    if (p.autosaveSeconds) startAutosave();
    if (p.audioEnabled !== undefined) sendAudioSettings();
  };

  if (!settings) return null;
  return (
    <div className="screen settings scroll">
      <div className="settings-grid">
        <Panel title="General">
          <Toggle checked={settings.reopenLastProject} onChange={(v) => void save({ reopenLastProject: v })} label="Abrir el último proyecto al iniciar" />
          <Field label="Guardado automático cada" hint="Se guarda una copia de recuperación (autosave.vmsp) sin sobrescribir el proyecto.">
            <NumberInput value={settings.autosaveSeconds} min={10} max={600} step={5} precision={0} suffix="s" onCommit={(v) => void save({ autosaveSeconds: v })} />
          </Field>
        </Panel>
        <Panel title="Audio">
          <Toggle checked={settings.audioEnabled} onChange={(v) => void save({ audioEnabled: v })} label="Audio activado (desactívalo para pruebas silenciosas)" data-testid="audio-enabled" />
          <Toggle checked={settings.previewAudio} onChange={(v) => void save({ previewAudio: v })} label="Sonido en la previsualización del editor" />
          <p className="muted small">El sonido sale por el dispositivo de audio predeterminado de Windows. Si el proyector tiene altavoces por HDMI, elígelo en la configuración de sonido de Windows.</p>
        </Panel>
        {project && (
          <Panel title="Copias de seguridad" actions={<Button small icon={<RefreshCw size={14} />} onClick={() => void loadBackups()} />}>
            <p className="muted small">Al guardar se crea automáticamente una copia como máximo cada 10 minutos (se conservan las 30 más recientes). También puedes crear copias con nombre o exportar el proyecto completo a otra carpeta o disco.</p>
            <div className="btn-row">
              <Button small icon={<Archive size={14} />} onClick={async () => {
                const label = await promptDialog('Copia de seguridad', 'antes de cambios', 'Nombre descriptivo de la copia.');
                if (!label || !project) return;
                try { await vm.project.createBackup(project, label); toast('success', 'Copia de seguridad creada'); void loadBackups(); } catch (e) { toast('error', errMsg(e)); }
              }}>Crear copia ahora</Button>
              <Button small icon={<Download size={14} />} onClick={async () => {
                if (!project) return;
                try { const dir = await vm.project.exportCopy(project); if (dir) toast('success', `Proyecto exportado en ${dir}`, 8000); } catch (e) { toast('error', errMsg(e)); }
              }}>Exportar proyecto completo…</Button>
            </div>
            <ul className="backups">
              {backups.slice(0, 40).map((b) => (
                <li key={b.name}>
                  <History size={13} />
                  <span className="name" title={b.name}>{b.name.replace(/\.vmsp$/, '')}</span>
                  <span className="muted small">{formatBytes(b.size)}</span>
                  <Button small onClick={async () => {
                    if (!(await confirmDialog('Restaurar copia', `Se cargará «${b.name}» en el editor (podrás deshacerlo con Ctrl+Z). No se guardará hasta que pulses Guardar.`, 'Restaurar'))) return;
                    try {
                      const doc = await vm.project.readBackup(b.name);
                      useStore.getState().replaceDocument(doc, 'Restaurar copia de seguridad');
                      toast('success', 'Copia restaurada. Revisa y guarda para conservarla.');
                    } catch (e) { toast('error', errMsg(e)); }
                  }}>Restaurar</Button>
                </li>
              ))}
              {backups.length === 0 && <li className="muted small">Todavía no hay copias.</li>}
            </ul>
          </Panel>
        )}
        <Panel title="Pantallas detectadas" actions={<Button small icon={<RefreshCw size={14} />} onClick={async () => set({ displays: await vm.displays.list() })} />}>
          <ul className="displays">
            {displays.map((d, i) => (
              <li key={d.id}>
                <b>{i + 1}. {d.label}</b> — {d.bounds.width}×{d.bounds.height} lógicos, {d.pixelSize.width}×{d.pixelSize.height} px, escala {Math.round(d.scaleFactor * 100)}%
                {d.primary ? ' · principal' : ''}{d.hasEditor ? ' · editor' : ''}{d.internal ? ' · interna' : ''}
              </li>
            ))}
          </ul>
          <p className="muted small">Si el proyector no aparece, pulsa Win+P y elige «Extender». Para una imagen nítida, en Windows ajusta la escala de esa pantalla al 100% y su resolución a la nativa del proyector.</p>
        </Panel>
        <Panel title="Información">
          {info && (
            <dl className="info">
              <dt>Versión</dt><dd>{info.version}</dd>
              <dt>Electron / Chromium</dt><dd>{info.electron} / {info.chrome}</dd>
              <dt>Sistema</dt><dd>{info.platform}</dd>
              <dt>Proyectos</dt><dd className="path">{info.projectsDir}</dd>
              <dt>Paquetes de usuario</dt><dd className="path">{info.userPacksDir}</dd>
              <dt>Registros</dt><dd className="path">{info.logsDir}</dd>
            </dl>
          )}
        </Panel>
        <Panel title="Registro técnico" className="wide" actions={<><Button small icon={<RefreshCw size={14} />} onClick={() => void vm.app.readLog().then(setLog)} /><Button small icon={<FolderOpen size={14} />} onClick={() => void vm.app.openLogsFolder()}>Abrir carpeta</Button></>}>
          <pre className="log" data-testid="log">{log.split('\n').slice(-200).join('\n') || 'Vacío'}</pre>
        </Panel>
      </div>
    </div>
  );
}
