import React, { useEffect } from 'react';
import { Home as HomeIcon, Crosshair, Images, Ghost, Clapperboard, MonitorPlay, Settings as SettingsIcon, Save, Undo2, Redo2 } from 'lucide-react';
import { useStore, type View } from './store';
import { vm, saveProject, startAutosave, startScheduler, handleOutputRequest, scheduleOutputSync, sendAudioSettings, openProjectFile, afterOpen } from './services';
import { Button, DialogHost } from './components/ui';
import { OutputControl } from './components/OutputControl';
import { Toasts } from './components/Toasts';
import { HomeScreen } from './screens/Home';
import { handleAgentRequest } from './agent';
import { CalibrateScreen } from './screens/Calibrate';
import { LibraryScreen } from './screens/Library';
import { CharactersScreen } from './screens/Characters';
import { ShowsScreen } from './screens/Shows';
import { PlaybackScreen } from './screens/Playback';
import { SettingsScreen } from './screens/Settings';

const NAV: { view: View; label: string; icon: React.ReactNode; needsProject: boolean; key: string }[] = [
  { view: 'home', label: 'Inicio', icon: <HomeIcon size={20} />, needsProject: false, key: '1' },
  { view: 'calibrate', label: 'Calibración', icon: <Crosshair size={20} />, needsProject: true, key: '2' },
  { view: 'library', label: 'Biblioteca', icon: <Images size={20} />, needsProject: true, key: '3' },
  { view: 'characters', label: 'Personajes', icon: <Ghost size={20} />, needsProject: true, key: '4' },
  { view: 'shows', label: 'Espectáculos', icon: <Clapperboard size={20} />, needsProject: true, key: '5' },
  { view: 'play', label: 'Reproducción', icon: <MonitorPlay size={20} />, needsProject: true, key: '6' },
  { view: 'settings', label: 'Ajustes', icon: <SettingsIcon size={20} />, needsProject: false, key: '7' },
];

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

export function App() {
  const view = useStore((s) => s.view);
  const project = useStore((s) => s.project);
  const dirty = useStore((s) => s.dirty);
  const past = useStore((s) => s.past.length);
  const future = useStore((s) => s.future.length);
  const set = useStore((s) => s.set);

  // Arranque: preferencias, pantallas, estado de la salida y reapertura del último proyecto.
  useEffect(() => {
    (async () => {
      const settings = await vm.app.getSettings();
      set({ settings, displays: await vm.displays.list(), output: await vm.output.state() });
      startAutosave();
      if (settings.reopenLastProject && settings.lastProject) {
        const o = await openProjectFile(settings.lastProject);
        if (o) await afterOpen(o);
      }
      startScheduler();
    })();
    const offD = vm.displays.onChanged((d) => set({ displays: d }));
    const offS = vm.output.onStatus((s) => set({ outputStatus: s }));
    const offR = vm.output.onRequest((r) => handleOutputRequest(r));
    const offO = vm.output.onState((o) => {
      set({ output: o });
      if (o.open) {
        scheduleOutputSync(true);
        sendAudioSettings();
      } else set({ outputStatus: null });
    });
    vm.app.onRequestSave(() => saveProject());
    vm.agent.onRequest((action, params) => handleAgentRequest(action, params));
    const onErr = (e: ErrorEvent) => vm.app.log('error', `${e.message} @ ${e.filename}:${e.lineno}`);
    const onRej = (e: PromiseRejectionEvent) => vm.app.log('error', `Promesa rechazada: ${String(e.reason?.stack ?? e.reason)}`);
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onRej);
    return () => {
      offD(); offS(); offO(); offR();
      window.removeEventListener('error', onErr);
      window.removeEventListener('unhandledrejection', onRej);
    };
  }, [set]);

  // Cualquier cambio del documento o de la selección se refleja en el proyector.
  useEffect(() => useStore.subscribe(() => scheduleOutputSync()), []);

  useEffect(() => {
    vm.app.setDirty(dirty);
  }, [dirty]);

  useEffect(() => {
    vm.app.setTitle(project ? `${project.name}${dirty ? ' •' : ''} — Videomapping Studio` : 'Videomapping Studio');
  }, [project?.name, dirty]);

  // Atajos globales.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveProject();
        return;
      }
      if (isTyping(e)) return;
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); useStore.getState().undo(); }
      else if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); useStore.getState().redo(); }
      else if (mod && /^[1-7]$/.test(e.key)) {
        const n = NAV.find((x) => x.key === e.key);
        if (n && (!n.needsProject || useStore.getState().project)) set({ view: n.view });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [set]);

  return (
    <div className="app">
      <nav className="rail">
        <div className="rail-logo" title="Videomapping Studio">
          <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden>
            <path d="M4 26 L16 6 L28 26 Z" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M10 26 L16 16 L22 26" fill="currentColor" opacity="0.5" />
          </svg>
        </div>
        {NAV.map((n) => (
          <button
            key={n.view}
            className={`rail-btn${view === n.view ? ' active' : ''}`}
            disabled={n.needsProject && !project}
            onClick={() => set({ view: n.view })}
            title={`${n.label} (Ctrl+${n.key})`}
            data-testid={`nav-${n.view}`}
          >
            {n.icon}
            <span>{n.label}</span>
          </button>
        ))}
      </nav>
      <div className="main">
        <header className="topbar">
          <div className="topbar-project">
            {project ? (
              <>
                <span className="project-name" data-testid="project-name">{project.name}</span>
                <span className={`save-state${dirty ? ' dirty' : ''}`} data-testid="save-state">{dirty ? 'Cambios sin guardar' : 'Guardado'}</span>
              </>
            ) : (
              <span className="project-name muted">Sin proyecto abierto</span>
            )}
          </div>
          {project && (
            <div className="topbar-actions">
              <Button icon={<Undo2 size={16} />} onClick={() => useStore.getState().undo()} disabled={!past} title="Deshacer (Ctrl+Z)" data-testid="undo" />
              <Button icon={<Redo2 size={16} />} onClick={() => useStore.getState().redo()} disabled={!future} title="Rehacer (Ctrl+Y)" data-testid="redo" />
              <Button icon={<Save size={16} />} variant={dirty ? 'primary' : 'default'} onClick={() => void saveProject()} title="Guardar (Ctrl+S)" data-testid="save">
                Guardar
              </Button>
            </div>
          )}
          <OutputControl />
        </header>
        <main className="content" data-view={view}>
          {view === 'home' && <HomeScreen />}
          {project && view === 'calibrate' && <CalibrateScreen />}
          {project && view === 'library' && <LibraryScreen />}
          {project && view === 'characters' && <CharactersScreen />}
          {project && view === 'shows' && <ShowsScreen />}
          {project && view === 'play' && <PlaybackScreen />}
          {view === 'settings' && <SettingsScreen />}
        </main>
      </div>
      <Toasts />
      <DialogHost />
    </div>
  );
}
