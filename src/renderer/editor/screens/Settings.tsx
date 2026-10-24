/** Ajustes de la aplicación, copias de seguridad y diagnóstico. */
import { useEffect, useState } from 'react';
import { RefreshCw, FolderOpen, Archive, History, Download } from 'lucide-react';
import { useStore } from '../store';
import { vm, startAutosave, sendAudioSettings, errMsg, saveProject } from '../services';
import { Button, Field, NumberInput, Panel, Toggle, confirmDialog, promptDialog, formatBytes } from '../components/ui';
import type { AgentApiStatus, AppInfo, AppSettings, BackupEntry, UpdateCheck } from '../../../shared/api';

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
        <UpdatesPanel />
        <AgentPanel />
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

function UpdatesPanel() {
  const [info, setInfo] = useState<{ current: { sha: string; date: string }; hasToken: boolean; canInstall: boolean } | null>(null);
  const [res, setRes] = useState<UpdateCheck | null>(null);
  const [busy, setBusy] = useState<'' | 'check' | 'download'>('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const toast = useStore((s) => s.toast);
  const dirty = useStore((s) => s.dirty);
  const load = () => vm.updates.info().then(setInfo);
  useEffect(() => { void load(); return vm.updates.onProgress((done, total) => setProgress({ done, total })); }, []);
  if (!info) return null;
  const fmtDate = (d: string) => (d ? new Date(d).toLocaleString() : '—');
  const check = async () => {
    setBusy('check');
    try { setRes(await vm.updates.check()); } catch (e) { toast('error', errMsg(e), 8000); } finally { setBusy(''); }
  };
  const install = async () => {
    setBusy('download');
    setProgress(null);
    try {
      const file = await vm.updates.download();
      const ok = await confirmDialog(
        'Instalar la actualización',
        `Descargada y comprobada (${formatBytes(res?.latest?.size ?? 0)}). Se abrirá el instalador y el programa se cerrará.${dirty ? ' Antes se guardará el proyecto.' : ''} Tus proyectos y paquetes no se modifican.`,
        'Instalar y cerrar',
      );
      if (!ok) return;
      if (dirty && !(await saveProject())) { toast('error', 'No se pudo guardar el proyecto: no se instala.'); return; }
      await vm.updates.install(file);
    } catch (e) {
      toast('error', errMsg(e), 10000);
    } finally {
      setBusy('');
    }
  };
  const saveToken = async (t: string | null) => {
    try { await vm.updates.setToken(t); setTokenInput(''); await load(); toast('success', t ? 'Clave guardada (cifrada en este PC)' : 'Clave borrada', 2000); } catch (e) { toast('error', errMsg(e), 8000); }
  };
  return (
    <Panel title="Actualizaciones" className="wide">
      <p className="muted small">Busca en GitHub la última versión compilada y probada en Windows. Solo se conecta cuando pulsas el botón. El instalador se comprueba (suma SHA-256) antes de abrirlo; tus proyectos y paquetes no se tocan.</p>
      <dl className="info" data-testid="update-info">
        <dt>Esta versión</dt><dd>{info.current.sha === 'dev' ? 'desarrollo' : info.current.sha.slice(0, 7)} · {fmtDate(info.current.date)}</dd>
        {res?.latest && <><dt>Publicada</dt><dd>{res.latest.sha.slice(0, 7)} · {fmtDate(res.latest.date)}</dd></>}
      </dl>
      {res?.error && <div className="banner error small">{res.error}</div>}
      {res && !res.error && (
        <div className={`banner ${res.available ? 'warn' : 'ok'} small`} data-testid="update-result">
          {res.available ? 'Hay una versión nueva.' : 'Tienes la última versión.'}
          {res.available && !res.canInstall && ' Descárgala desde GitHub (la instalación automática solo funciona en el programa instalado en Windows).'}
        </div>
      )}
      {busy === 'download' && progress && progress.total > 0 && (
        <div className="play-progress"><div className="bar"><div className="fill" style={{ width: `${Math.min(100, (progress.done / progress.total) * 100)}%` }} /></div></div>
      )}
      <div className="btn-row">
        <Button icon={<RefreshCw size={15} />} onClick={() => void check()} disabled={!!busy} data-testid="update-check">{busy === 'check' ? 'Buscando…' : 'Buscar actualizaciones'}</Button>
        {res?.available && res.canInstall && res.latest?.installer && (
          <Button variant="primary" icon={<Download size={15} />} onClick={() => void install()} disabled={!!busy} data-testid="update-install">{busy === 'download' ? 'Descargando…' : 'Descargar e instalar'}</Button>
        )}
      </div>
      <details className="small" style={{ marginTop: 10 }}>
        <summary>Repositorio privado: clave de acceso {info.hasToken ? '(guardada)' : ''}</summary>
        <p className="muted small">Solo hace falta si el repositorio de GitHub es privado. Crea en GitHub → Settings → Developer settings → Fine-grained tokens una clave con acceso únicamente a este repositorio y permiso de <b>lectura</b> de «Contents». Se guarda cifrada en este PC; nunca en los proyectos.</p>
        <div className="schedule-row">
          <input type="password" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} placeholder="github_pat_…" autoComplete="off" spellCheck={false} />
          <Button small onClick={() => void saveToken(tokenInput)} disabled={!tokenInput.trim()}>Guardar clave</Button>
          {info.hasToken && <Button small variant="ghost" onClick={() => void saveToken(null)}>Borrar clave</Button>}
        </div>
      </details>
    </Panel>
  );
}

function AgentPanel() {
  const [st, setSt] = useState<AgentApiStatus | null>(null);
  const [showToken, setShowToken] = useState(false);
  const toast = useStore((s) => s.toast);
  useEffect(() => { void vm.agent.status().then(setSt); }, []);
  if (!st) return null;
  const configure = async (p: { enabled: boolean; port?: number; regenerate?: boolean }) => {
    const r = await vm.agent.configure(p);
    setSt(r);
    if (r.error) toast('error', r.error, 8000);
  };
  const desktopConfig = JSON.stringify({
    mcpServers: {
      'videomapping-studio': { command: st.exePath, args: [st.mcpScript], env: { ELECTRON_RUN_AS_NODE: '1' } },
    },
  }, null, 2);
  const codeCmd = `claude mcp add videomapping-studio -e ELECTRON_RUN_AS_NODE=1 -- "${st.exePath}" "${st.mcpScript}"`;
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); toast('success', 'Copiado al portapapeles', 1500); } catch { toast('error', 'No se pudo copiar'); } };
  return (
    <Panel title="Control por agentes de IA" className="wide">
      <p className="muted small">Permite que un asistente de IA (Claude Desktop, Claude Code u otro compatible con MCP) consulte y modifique el proyecto, añada escenas y rótulos, y controle la proyección. Solo acepta conexiones desde este PC y con la clave. Todo lo que haga se puede deshacer con Ctrl+Z. Guía completa: docs/AGENTES.md.</p>
      <div className="schedule-row">
        <Toggle checked={st.running} onChange={(v) => void configure({ enabled: v })} label={st.running ? `Activo en ${st.url}` : 'Desactivado'} data-testid="agent-enabled" />
        <Field label="Puerto" inline><NumberInput value={st.port} min={1024} max={65535} step={1} precision={0} onCommit={(v) => void configure({ enabled: st.running, port: v })} /></Field>
        <Button small onClick={() => setShowToken(!showToken)}>{showToken ? 'Ocultar clave' : 'Ver clave'}</Button>
        <Button small onClick={() => void configure({ enabled: st.running, regenerate: true })}>Nueva clave</Button>
      </div>
      {showToken && <pre className="log">{st.token || '(se genera al activar)'}</pre>}
      {st.running && (
        <>
          <h4 className="sub">Claude Desktop</h4>
          <p className="muted small">Ajustes de Claude Desktop → Desarrollador → Editar configuración, pega esto en <code>claude_desktop_config.json</code> y reinicia Claude Desktop:</p>
          <pre className="log">{desktopConfig}</pre>
          <Button small onClick={() => void copy(desktopConfig)}>Copiar configuración</Button>
          <h4 className="sub">Claude Code</h4>
          <pre className="log">{codeCmd}</pre>
          <Button small onClick={() => void copy(codeCmd)}>Copiar orden</Button>
          <p className="muted small">La conexión (URL y clave) se guarda en {st.infoFile}.</p>
        </>
      )}
    </Panel>
  );
}
