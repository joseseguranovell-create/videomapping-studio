import { useEffect, useState } from 'react';
import { FolderOpen, FilePlus2, Sparkles, Clock, Trash2, Crosshair, Clapperboard, MonitorPlay, LifeBuoy, X, Copy } from 'lucide-react';
import { useStore } from '../store';
import { vm, afterOpen, openProjectFile, errMsg, saveProjectAs } from '../services';
import { Button, Badge, Empty, confirmDialog, promptDialog, formatDate } from '../components/ui';
import type { RecentEntry } from '../../../shared/api';
import type { PackInfo } from '../../../shared/pack';

export function HomeScreen() {
  const project = useStore((s) => s.project);
  const dirty = useStore((s) => s.dirty);
  const recover = useStore((s) => s.recoverAvailable);
  const set = useStore((s) => s.set);
  const toast = useStore((s) => s.toast);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [packs, setPacks] = useState<PackInfo[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setRecent(await vm.project.recent());
    const r = await vm.packs.list();
    setPacks(r.packs);
  };
  useEffect(() => {
    void refresh();
  }, [project?.id]);

  const guardUnsaved = async () => {
    if (!dirty) return true;
    return confirmDialog('Cambios sin guardar', 'El proyecto actual tiene cambios sin guardar. ¿Continuar y descartarlos? (Se conservarán en el guardado automático.)', 'Continuar', true);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast('error', errMsg(e), 8000);
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const newProject = () =>
    run(async () => {
      if (!(await guardUnsaved())) return;
      const name = await promptDialog('Nuevo proyecto', 'Mi casa', 'Nombre del proyecto (por ejemplo, la casa o el lugar).', 'Crear');
      if (!name) return;
      const o = await vm.project.create(name);
      if (o) {
        await afterOpen(o);
        set({ view: 'calibrate' });
        toast('success', `Proyecto creado en ${o.dir}`, 6000);
      }
    });

  const fromPack = (p: PackInfo) =>
    run(async () => {
      if (!(await guardUnsaved())) return;
      const name = await promptDialog('Proyecto de ejemplo', p.name, 'Se creará un proyecto nuevo con el contenido del paquete.', 'Crear');
      if (!name) return;
      const o = await vm.project.createFromPack(p.id, name);
      if (o) {
        await afterOpen(o);
        set({ view: 'shows' });
        toast('success', 'Proyecto de ejemplo creado. Ajusta las superficies en Calibración para tu fachada.', 7000);
      }
    });

  const open = () =>
    run(async () => {
      if (!(await guardUnsaved())) return;
      const o = await vm.project.openDialog();
      if (o) await afterOpen(o);
    });

  const openRecent = (r: RecentEntry) =>
    run(async () => {
      if (!(await guardUnsaved())) return;
      const o = await openProjectFile(r.file);
      if (o) await afterOpen(o);
    });

  const doRecover = () =>
    run(async () => {
      const doc = await vm.project.loadAutosave();
      if (!doc) return;
      useStore.getState().replaceDocument(doc, 'Recuperar guardado automático');
      set({ recoverAvailable: false });
      toast('success', 'Cambios recuperados. Guarda el proyecto para conservarlos.', 6000);
    });

  const discardRecover = () =>
    run(async () => {
      await vm.project.discardAutosave();
      set({ recoverAvailable: false });
    });

  const examplePacks = packs.filter((p) => p.showCount > 0);

  return (
    <div className="home">
      <div className="home-hero">
        <h1>Videomapping Studio</h1>
        <p>Calibra puertas y ventanas sobre la imagen proyectada, asigna animaciones y programa espectáculos para cualquier fachada y celebración.</p>
        <div className="home-actions">
          <Button variant="primary" icon={<FilePlus2 size={18} />} onClick={newProject} disabled={busy} data-testid="new-project">Nuevo proyecto</Button>
          <Button icon={<FolderOpen size={18} />} onClick={open} disabled={busy} data-testid="open-project">Abrir proyecto…</Button>
        </div>
      </div>

      {project && recover && (
        <div className="banner warn" data-testid="recover-banner">
          <LifeBuoy size={18} />
          <span>Hay cambios del guardado automático más recientes que el proyecto guardado (posible cierre inesperado).</span>
          <Button small variant="primary" onClick={doRecover} data-testid="recover">Recuperar</Button>
          <Button small icon={<X size={14} />} onClick={discardRecover}>Descartar</Button>
        </div>
      )}

      {project && (
        <section className="home-current">
          <h2>Proyecto abierto: {project.name}</h2>
          <div className="stats">
            <div><b>{project.installations.length}</b> instalaciones</div>
            <div><b>{project.installations.reduce((n, i) => n + i.surfaces.length, 0)}</b> superficies</div>
            <div><b>{project.assets.length}</b> recursos</div>
            <div><b>{project.characters.length}</b> personajes</div>
            <div><b>{project.shows.length}</b> espectáculos</div>
          </div>
          <div className="home-actions">
            <Button icon={<Crosshair size={16} />} onClick={() => set({ view: 'calibrate' })}>Calibrar</Button>
            <Button icon={<Clapperboard size={16} />} onClick={() => set({ view: 'shows' })}>Editar espectáculos</Button>
            <Button icon={<MonitorPlay size={16} />} onClick={() => set({ view: 'play' })}>Reproducir</Button>
            <Button
              icon={<Copy size={16} />}
              onClick={async () => {
                const n = await promptDialog('Duplicar proyecto', `${project.name} (copia)`, 'Se creará una copia completa (con recursos) en la carpeta que elijas. El original no se modifica.', 'Elegir carpeta…');
                if (n) await saveProjectAs(n);
              }}
            >
              Duplicar proyecto…
            </Button>
          </div>
        </section>
      )}

      <div className="home-grid">
        <section>
          <h2><Clock size={16} /> Proyectos recientes</h2>
          {recent.length === 0 ? (
            <Empty title="Todavía no hay proyectos recientes">Crea un proyecto nuevo o abre uno existente.</Empty>
          ) : (
            <ul className="recent" data-testid="recent-list">
              {recent.map((r) => (
                <li key={r.file} className={r.exists === false ? 'missing' : ''}>
                  <button className="recent-main" disabled={busy || r.exists === false} onClick={() => openRecent(r)}>
                    <span className="recent-name">{r.name}</span>
                    <span className="recent-path">{r.file}</span>
                  </button>
                  <span className="recent-date">{r.exists === false ? <Badge tone="error">No encontrado</Badge> : formatDate(r.openedAt)}</span>
                  <Button
                    small
                    variant="ghost"
                    icon={<Trash2 size={14} />}
                    title="Quitar de la lista (no borra archivos)"
                    onClick={async () => { await vm.project.removeRecent(r.file); void refresh(); }}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h2><Sparkles size={16} /> Empezar con un ejemplo</h2>
          {examplePacks.length === 0 ? (
            <Empty title="No hay paquetes de ejemplo instalados" />
          ) : (
            <ul className="packs">
              {examplePacks.map((p) => (
                <li key={p.id}>
                  <div>
                    <div className="pack-name">{p.name}</div>
                    <div className="pack-desc">{p.description}</div>
                    <div className="pack-meta">{p.characterCount} personajes · {p.assetCount} recursos · {p.showCount} espectáculo(s){p.license ? ` · ${p.license}` : ''}</div>
                  </div>
                  <Button onClick={() => fromPack(p)} disabled={busy} data-testid={`example-${p.id}`}>Crear proyecto</Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
