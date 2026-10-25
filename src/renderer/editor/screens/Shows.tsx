/** Editor de espectáculos: escenas, línea de tiempo por superficie, clips, sonidos y música. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Copy, Trash2, ChevronLeft, ChevronRight, Clapperboard, Film, Ghost, Sparkles, Music, Volume2, Shuffle, MonitorPlay, Type, Wand2,
} from 'lucide-react';
import { useStore, selShow, selScene } from '../store';
import { Button, Field, TextInput, NumberInput, Select, Toggle, Panel, Empty, Modal, confirmDialog, promptDialog, openMenu, type MenuItem } from '../components/ui';
import { AssetPicker } from '../components/pickers';
import { ShowPreview, previewControl, usePreview } from '../components/ShowPreview';
import { AssetThumb } from './Library';
import {
  createShow, createScene, createClip, createSoundCue, duplicateScene, duplicateShow, suggestSurfaceMap, remapShowSurfaces, effectSource,
} from '../../../shared/factory';
import { newId } from '../../../shared/ids';
import {
  MOTION_PRESETS, MOTION_LABELS, EFFECT_KINDS, EFFECT_LABELS, TEXT_FONTS, TEXT_FONT_LABELS, CONTOUR_EFFECTS, FACADE_EFFECTS, type EffectKind, type Clip, type Scene, type Show, type SoundCue, type MusicTrack, type Project,
} from '../../../shared/model';
import { layoutShow, formatTime } from '../../../shared/timeline';
import { applyTemplate, TEMPLATE_KINDS, TEMPLATE_INFO } from '../../../shared/templates';
import { transport } from '../services';
import { ShowWizard } from '../components/ShowWizard';
import { ChoreoModal, type ChoreoPreset } from '../components/ChoreoModal';
import { cloneDeep } from '../../../shared/factory';

function useShowMut() {
  const update = useStore((s) => s.update);
  const showId = useStore((s) => s.showId);
  return (label: string, fn: (sh: Show, d: Project) => void) =>
    update(label, (d) => {
      const sh = d.shows.find((x) => x.id === showId);
      if (sh) { fn(sh, d); sh.updatedAt = new Date().toISOString(); }
    });
}

function useSceneMut() {
  const mutShow = useShowMut();
  const sceneId = useStore((s) => s.sceneId);
  return (label: string, fn: (sc: Scene, sh: Show) => void) =>
    mutShow(label, (sh) => {
      const sc = sh.scenes.find((x) => x.id === sceneId);
      if (sc) fn(sc, sh);
    });
}

export function ShowsScreen() {
  const project = useStore((s) => s.project)!;
  const show = useStore(selShow);
  const set = useStore((s) => s.set);
  const update = useStore((s) => s.update);
  const [wizard, setWizard] = useState(false);

  // atajo: espacio = reproducir/pausar previsualización
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.tagName === 'BUTTON')) return;
      if (document.querySelector('.modal-back')) return;
      if (e.key === ' ') { e.preventDefault(); previewControl.toggle(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const newShow = async () => {
    const name = await promptDialog('Nuevo espectáculo', `Espectáculo ${project.shows.length + 1}`, 'Por ejemplo «Halloween 2026» o «Navidad 2026».');
    if (!name) return;
    const sh = createShow(name, project.installations[0]?.id ?? null);
    const sc = createScene('Escena 1', 10);
    sh.scenes.push(sc);
    update('Nuevo espectáculo', (d) => { d.shows.push(sh); });
    set({ showId: sh.id, sceneId: sc.id, clipId: null, soundId: null, musicId: null });
  };

  if (!show) {
    return (
      <div className="screen center">
        <Empty icon={<Clapperboard size={40} />} title="No hay espectáculos">
          Un espectáculo es una secuencia de escenas que usa una instalación y sus superficies.
          <div style={{ marginTop: 16 }}>
            <Button variant="primary" icon={<Wand2 size={16} />} onClick={() => setWizard(true)} data-testid="open-wizard">Asistente de espectáculos</Button>{' '}
            <Button icon={<Plus size={16} />} onClick={newShow} data-testid="new-show">Nuevo espectáculo vacío</Button>
          </div>
        </Empty>
        {wizard && <ShowWizard onClose={() => setWizard(false)} />}
      </div>
    );
  }

  return (
    <div className="screen shows">
      <ShowBar show={show} onNew={newShow} onWizard={() => setWizard(true)} />
      {wizard && <ShowWizard onClose={() => setWizard(false)} />}
      <div className="shows-body">
        <div className="shows-preview"><ShowPreview /></div>
        <aside className="side right"><ShowInspector show={show} /></aside>
      </div>
      <SceneStrip show={show} />
      <SceneTimeline show={show} />
    </div>
  );
}

function ShowBar({ show, onNew, onWizard }: { show: Show; onNew: () => void; onWizard: () => void }) {
  const project = useStore((s) => s.project)!;
  const set = useStore((s) => s.set);
  const update = useStore((s) => s.update);
  const output = useStore((s) => s.output);
  const [remap, setRemap] = useState<string | null>(null);
  const L = useMemo(() => layoutShow(show), [show]);
  return (
    <div className="toolbar showbar">
      <div className="group">
        <select value={show.id} onChange={(e) => { const sh = project.shows.find((x) => x.id === e.target.value)!; set({ showId: sh.id, sceneId: sh.scenes[0]?.id ?? null, clipId: null, soundId: null, musicId: null }); }} data-testid="show-select">
          {project.shows.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <Button small variant="ghost" icon={<Plus size={15} />} onClick={onNew} title="Nuevo espectáculo" data-testid="new-show" />
        <Button small variant="ghost" icon={<Wand2 size={15} />} onClick={onWizard} title="Asistente de espectáculos: compone uno entero con estilo y protagonistas" data-testid="open-wizard" />
        <Button
          small
          variant="ghost"
          icon={<Copy size={15} />}
          title="Duplicar espectáculo (para otro año u otra versión)"
          data-testid="dup-show"
          onClick={async () => {
            const name = await promptDialog('Duplicar espectáculo', `${show.name} (copia)`, 'El original no se modifica.');
            if (!name) return;
            const d2 = duplicateShow(show, { name });
            update('Duplicar espectáculo', (d) => { d.shows.push(d2); });
            set({ showId: d2.id, sceneId: d2.scenes[0]?.id ?? null, clipId: null });
          }}
        />
        <Button
          small
          variant="ghost"
          icon={<Trash2 size={15} />}
          title="Eliminar espectáculo"
          onClick={async () => {
            if (!(await confirmDialog(`Eliminar «${show.name}»`, 'Se eliminarán sus escenas. Puedes deshacerlo con Ctrl+Z.', 'Eliminar', true))) return;
            update('Eliminar espectáculo', (d) => { d.shows = d.shows.filter((s) => s.id !== show.id); });
            const next = project.shows.find((s) => s.id !== show.id);
            set({ showId: next?.id ?? null, sceneId: next?.scenes[0]?.id ?? null, clipId: null });
          }}
        />
      </div>
      <div className="group">
        <span className="muted small">Instalación:</span>
        <select
          value={show.installationId ?? ''}
          data-testid="show-installation"
          onChange={(e) => {
            const v = e.target.value || null;
            if (v === show.installationId) return;
            const hasClips = show.scenes.some((s) => s.clips.length);
            if (hasClips && v) setRemap(v);
            else update('Asignar instalación', (d) => { d.shows.find((s) => s.id === show.id)!.installationId = v; });
          }}
        >
          <option value="">(ninguna)</option>
          {project.installations.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        {show.installationId && (
          <Button small variant="ghost" icon={<Shuffle size={15} />} title="Reasignar clips a otras superficies" onClick={() => setRemap(show.installationId)} />
        )}
      </div>
      <div className="group right">
        <span className="muted small">Duración total: {formatTime(L.duration)} · {show.scenes.length} escenas</span>
        <Button
          small
          icon={<MonitorPlay size={15} />}
          disabled={!output.open}
          title={output.open ? 'Reproducir este espectáculo en el proyector desde el principio' : 'Abre primero la salida (barra superior)'}
          onClick={() => {
            set({ outputMode: 'show', outputShowId: show.id });
            setTimeout(() => transport('play', 0), 100);
          }}
        >
          En el proyector
        </Button>
      </div>
      {remap && <RemapModal show={show} targetInstallationId={remap} onClose={() => setRemap(null)} />}
    </div>
  );
}

function RemapModal({ show, targetInstallationId, onClose }: { show: Show; targetInstallationId: string; onClose: () => void }) {
  const project = useStore((s) => s.project)!;
  const update = useStore((s) => s.update);
  const set = useStore((s) => s.set);
  const from = project.installations.find((i) => i.id === show.installationId);
  const to = project.installations.find((i) => i.id === targetInstallationId)!;
  // superficies realmente usadas por el espectáculo
  const usedIds = [...new Set(show.scenes.flatMap((s) => s.clips.map((c) => c.surfaceId)))];
  const allSurfaces = project.installations.flatMap((i) => i.surfaces);
  const used = usedIds.map((id) => allSurfaces.find((s) => s.id === id) ?? { id, name: '(superficie eliminada)', kind: 'other' as const }) as typeof allSurfaces;
  const [map, setMap] = useState<Record<string, string | null>>(() => {
    const sameInst = from?.id === to.id;
    if (sameInst) return Object.fromEntries(usedIds.map((id) => [id, to.surfaces.some((s) => s.id === id) ? id : null]));
    return suggestSurfaceMap(used, to.surfaces);
  });
  const [asCopy, setAsCopy] = useState(from?.id !== to.id);
  const [name, setName] = useState(`${show.name} – ${to.name}`);
  const apply = () => {
    if (asCopy) {
      const copy = remapShowSurfaces(duplicateShow(show, { name }), Object.fromEntries(Object.entries(map)), to.id);
      // duplicateShow conserva surfaceId; remapShowSurfaces aplica el mapa
      update('Copiar espectáculo para otra instalación', (d) => { d.shows.push(copy); });
      set({ showId: copy.id, sceneId: copy.scenes[0]?.id ?? null, clipId: null });
    } else {
      update('Reasignar superficies', (d) => {
        const i = d.shows.findIndex((s) => s.id === show.id);
        d.shows[i] = remapShowSurfaces(d.shows[i], map, to.id);
      });
    }
    onClose();
  };
  return (
    <Modal
      title={`Reasignar superficies → «${to.name}»`}
      onClose={onClose}
      wide
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={apply} data-testid="remap-apply">{asCopy ? 'Crear copia adaptada' : 'Aplicar'}</Button></>}
    >
      <p className="muted small">Elige en qué superficie de la nueva instalación se mostrará el contenido de cada superficie original. Las animaciones se adaptan a la forma de cada superficie, pero conviene revisar la posición y escala de los personajes después.</p>
      <table className="map-table">
        <thead><tr><th>Superficie original</th><th>Clips</th><th>Nueva superficie</th></tr></thead>
        <tbody>
          {used.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>{show.scenes.reduce((n, sc) => n + sc.clips.filter((c) => c.surfaceId === s.id).length, 0)}</td>
              <td>
                <select value={map[s.id] ?? ''} onChange={(e) => setMap({ ...map, [s.id]: e.target.value || null })}>
                  <option value="">(no mostrar — eliminar clips)</option>
                  {to.surfaces.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Toggle checked={asCopy} onChange={setAsCopy} label="Crear una copia del espectáculo (no modificar el original)" />
      {asCopy && <Field label="Nombre de la copia"><input className="full" value={name} onChange={(e) => setName(e.target.value)} /></Field>}
    </Modal>
  );
}

function SceneStrip({ show }: { show: Show }) {
  const sceneId = useStore((s) => s.sceneId);
  const set = useStore((s) => s.set);
  const mutShow = useShowMut();
  const L = useMemo(() => layoutShow(show), [show]);
  const total = Math.max(1, show.scenes.reduce((n, s) => n + s.duration, 0));
  const idx = show.scenes.findIndex((s) => s.id === sceneId);
  const time = usePreview((s) => s.time);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const press = useRef<{ id: string; x: number; moved: boolean } | null>(null);
  // Arrastre con el puntero (más fiable que el arrastre HTML en Electron): al pasar de 6 px empieza a mover.
  const dropIndexAt = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y)?.closest('[data-scene-index]') as HTMLElement | null;
    if (!el) return null;
    const i = parseInt(el.dataset.sceneIndex!, 10);
    const r = el.getBoundingClientRect();
    return x < r.left + r.width / 2 ? i : i + 1;
  };
  const onBlockDown = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    press.current = { id, x: e.clientX, moved: false };
    const move = (ev: PointerEvent) => {
      const p = press.current;
      if (!p) return;
      if (!p.moved && Math.abs(ev.clientX - p.x) > 6) { p.moved = true; setDragId(p.id); }
      if (p.moved) setDropAt(dropIndexAt(ev.clientX, ev.clientY));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const p = press.current;
      if (p?.moved) drop(dropIndexAt(ev.clientX, ev.clientY), p.id);
      setDragId(null); setDropAt(null);
      setTimeout(() => { press.current = null; }, 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const addScene = (at: number, fromTemplate = false) => {
    const sc = createScene(`Escena ${show.scenes.length + 1}`, 10);
    mutShow('Añadir escena', (sh) => { sh.scenes.splice(at, 0, sc); });
    set({ sceneId: sc.id, clipId: null, soundId: null, musicId: null });
    if (fromTemplate) setTimeout(() => window.dispatchEvent(new CustomEvent('vm-picker', { detail: 'template' })), 50);
  };
  const removeScene = async (i: number) => {
    const sc = show.scenes[i];
    if (sc.clips.length + sc.sounds.length > 0 && !(await confirmDialog(`Eliminar «${sc.name}»`, `Contiene ${sc.clips.length} clips y ${sc.sounds.length} sonidos. Puedes deshacerlo con Ctrl+Z.`, 'Eliminar', true))) return;
    mutShow('Eliminar escena', (sh) => { sh.scenes.splice(i, 1); });
    set({ sceneId: show.scenes[i + 1]?.id ?? show.scenes[i - 1]?.id ?? null, clipId: null });
  };
  const duplicateAt = (i: number) => {
    const d = duplicateScene(show.scenes[i]);
    mutShow('Duplicar escena', (sh) => { sh.scenes.splice(i + 1, 0, d); });
    set({ sceneId: d.id, clipId: null });
  };
  const rename = async (i: number) => {
    const n = await promptDialog('Nombre de la escena', show.scenes[i].name);
    if (n) mutShow('Renombrar escena', (sh) => { sh.scenes[i].name = n; });
  };
  const sceneMenu = (e: React.MouseEvent, i: number) => {
    const sc = show.scenes[i];
    set({ sceneId: sc.id, clipId: null, soundId: null, musicId: null });
    openMenu(e, [
      { label: 'Renombrar…', onClick: () => void rename(i) },
      { label: 'Duplicar', icon: <Copy size={14} />, onClick: () => duplicateAt(i) },
      { label: sc.enabled ? 'Desactivar (no se reproduce)' : 'Activar', onClick: () => mutShow(sc.enabled ? 'Desactivar escena' : 'Activar escena', (sh) => { sh.scenes[i].enabled = !sh.scenes[i].enabled; }) },
      { separator: true, label: '' },
      { label: 'Escena vacía después', icon: <Plus size={14} />, onClick: () => addScene(i + 1) },
      { label: 'Escena con plantilla después…', icon: <Wand2 size={14} />, onClick: () => addScene(i + 1, true) },
      { separator: true, label: '' },
      { label: 'Mover antes', icon: <ChevronLeft size={14} />, disabled: i === 0, onClick: () => mutShow('Reordenar escenas', (sh) => { const [x] = sh.scenes.splice(i, 1); sh.scenes.splice(i - 1, 0, x); }) },
      { label: 'Mover después', icon: <ChevronRight size={14} />, disabled: i >= show.scenes.length - 1, onClick: () => mutShow('Reordenar escenas', (sh) => { const [x] = sh.scenes.splice(i, 1); sh.scenes.splice(i + 1, 0, x); }) },
      { separator: true, label: '' },
      { label: 'Eliminar', icon: <Trash2 size={14} />, danger: true, onClick: () => void removeScene(i) },
    ]);
  };
  const drop = (target: number | null, id: string) => {
    const from = show.scenes.findIndex((x) => x.id === id);
    if (target === null || from < 0 || target === from || target === from + 1) return;
    mutShow('Reordenar escenas', (sh) => { const [x] = sh.scenes.splice(from, 1); sh.scenes.splice(target > from ? target - 1 : target, 0, x); });
  };
  return (
    <div className="scene-strip">
      <div className="scene-strip-actions">
        <Button
          small
          icon={<Plus size={14} />}
          data-testid="add-scene"
          onClick={() => {
            const sc = createScene(`Escena ${show.scenes.length + 1}`, 10);
            mutShow('Añadir escena', (sh) => { sh.scenes.splice(idx >= 0 ? idx + 1 : sh.scenes.length, 0, sc); });
            set({ sceneId: sc.id, clipId: null, soundId: null, musicId: null });
          }}
        >
          Escena
        </Button>
        <Button small icon={<Copy size={14} />} disabled={idx < 0} title="Duplicar escena" data-testid="dup-scene" onClick={() => {
          const d = duplicateScene(show.scenes[idx]);
          mutShow('Duplicar escena', (sh) => { sh.scenes.splice(idx + 1, 0, d); });
          set({ sceneId: d.id, clipId: null });
        }} />
        <Button small icon={<ChevronLeft size={14} />} disabled={idx <= 0} title="Mover antes" onClick={() => mutShow('Reordenar escenas', (sh) => { const [x] = sh.scenes.splice(idx, 1); sh.scenes.splice(idx - 1, 0, x); })} />
        <Button small icon={<ChevronRight size={14} />} disabled={idx < 0 || idx >= show.scenes.length - 1} title="Mover después" onClick={() => mutShow('Reordenar escenas', (sh) => { const [x] = sh.scenes.splice(idx, 1); sh.scenes.splice(idx + 1, 0, x); })} />
        <Button small icon={<Trash2 size={14} />} disabled={idx < 0} title="Eliminar escena" onClick={async () => {
          const sc = show.scenes[idx];
          if (!(await confirmDialog(`Eliminar «${sc.name}»`, `Contiene ${sc.clips.length} clips y ${sc.sounds.length} sonidos. Puedes deshacerlo con Ctrl+Z.`, 'Eliminar', true))) return;
          mutShow('Eliminar escena', (sh) => { sh.scenes.splice(idx, 1); });
          set({ sceneId: show.scenes[idx + 1]?.id ?? show.scenes[idx - 1]?.id ?? null, clipId: null });
        }} />
      </div>
      <div className="scene-blocks" data-testid="scene-blocks">
        {show.scenes.map((sc, i) => {
          const slot = L.slots.find((s) => s.scene.id === sc.id);
          const activeNow = slot && time >= slot.start && time < slot.end;
          return (
            <button
              key={sc.id}
              className={`scene-block${sc.id === sceneId ? ' sel' : ''}${sc.enabled ? '' : ' off'}${activeNow ? ' now' : ''}${dragId === sc.id ? ' dragging' : ''}${dropAt === i ? ' drop-before' : ''}${dropAt === i + 1 && i === show.scenes.length - 1 ? ' drop-after' : ''}`}
              style={{ flexGrow: sc.duration / total }}
              onClick={() => { if (press.current?.moved) return; set({ sceneId: sc.id, clipId: null, soundId: null, musicId: null }); if (slot) previewControl.seek(slot.start); }}
              onDoubleClick={() => void rename(i)}
              onContextMenu={(e) => sceneMenu(e, i)}
              onPointerDown={(e) => onBlockDown(e, sc.id)}
              data-scene-index={i}
              title={`${sc.name} · ${sc.duration}s · transición: ${sc.transition.type}\nArrastra para reordenar · doble clic: renombrar · clic derecho: más opciones`}
              data-testid={`scene-block-${i}`}
            >
              <span className="sb-name">{i + 1}. {sc.name}</span>
              <span className="sb-meta">{sc.duration}s{sc.transition.type !== 'cut' ? ` · ${sc.transition.type === 'fade' ? 'fundido' : 'cruzado'}` : ''}{sc.enabled ? '' : ' · desactivada'}</span>
            </button>
          );
        })}
        <button
          className="scene-block add"
          onClick={(e) => openMenu(e, [
            { label: 'Escena vacía', icon: <Plus size={14} />, onClick: () => addScene(show.scenes.length) },
            { label: 'Escena con plantilla…', icon: <Wand2 size={14} />, onClick: () => addScene(show.scenes.length, true) },
            { label: 'Duplicar la seleccionada', icon: <Copy size={14} />, disabled: idx < 0, onClick: () => duplicateAt(idx) },
          ])}
          title="Añadir escena"
          data-testid="add-scene-end"
        >
          <Plus size={18} />
        </button>
      </div>
    </div>
  );
}

/** Portapapeles de clips (Ctrl+C / Ctrl+V entre escenas). */
let clipboard: Clip | null = null;

const SNAP = 0.1;
const snap = (t: number) => Math.round(t / SNAP) * SNAP;

function SceneTimeline({ show }: { show: Show }) {
  const project = useStore((s) => s.project)!;
  const scene = useStore(selScene);
  const clipId = useStore((s) => s.clipId);
  const soundId = useStore((s) => s.soundId);
  const set = useStore((s) => s.set);
  const st = useStore.getState;
  const time = usePreview((s) => s.time);
  const inst = project.installations.find((i) => i.id === show.installationId) ?? null;
  const L = useMemo(() => layoutShow(show), [show]);
  const slot = scene ? L.slots.find((s) => s.scene.id === scene.id) : null;
  const trackRef = useRef<HTMLDivElement>(null);
  const [picker, setPickerRaw] = useState<null | 'asset' | 'sound' | 'character' | 'effect' | 'template' | 'choreo'>(null);
  const [choreoPreset, setChoreoPreset] = useState<ChoreoPreset | undefined>(undefined);
  const [rowSurface, setRowSurface] = useState<string | null>(null);
  /** Instante elegido con doble clic en la línea de tiempo (si no, el cabezal). */
  const pendingStart = useRef<number | null>(null);
  const setPicker = (p: typeof picker) => { if (!p) pendingStart.current = null; setPickerRaw(p); };
  // La tira de escenas puede pedir abrir un selector (p. ej. «nueva escena desde plantilla»).
  useEffect(() => {
    const h = (e: Event) => setPickerRaw((e as CustomEvent).detail);
    window.addEventListener('vm-picker', h);
    return () => window.removeEventListener('vm-picker', h);
  }, []);
  // Atajos: Supr borra, Ctrl+D duplica, Ctrl+C / Ctrl+V copia y pega clips; Alt+flechas mueve 0,1 s.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (document.querySelector('.modal-back')) return;
      const s0 = useStore.getState();
      const sh = s0.project?.shows.find((x) => x.id === show.id);
      const sc = sh?.scenes.find((x) => x.id === s0.sceneId);
      if (!sc) return;
      const mod = e.ctrlKey || e.metaKey;
      const clip = sc.clips.find((c) => c.id === s0.clipId);
      if ((e.key === 'Delete' || e.key === 'Backspace') && (clip || s0.soundId)) {
        e.preventDefault();
        if (clip) clipActions(clip).remove(); else soundRemove(s0.soundId!);
      } else if (mod && e.key.toLowerCase() === 'd' && clip) { e.preventDefault(); clipActions(clip).duplicate(); }
      else if (mod && e.key.toLowerCase() === 'c' && clip) { clipboard = cloneDeep(clip); s0.toast('info', 'Clip copiado. Ctrl+V lo pega en la fila elegida, en el cabezal.', 2500); }
      else if (mod && e.key.toLowerCase() === 'v' && clipboard) { e.preventDefault(); pasteClip(); }
      else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && clip) {
        e.preventDefault();
        const dt = e.key === 'ArrowLeft' ? -0.1 : 0.1;
        mutSceneById(sc.id, (x) => { const c = x.clips.find((y) => y.id === clip.id); if (c) c.start = Math.max(0, Math.round((c.start + dt) * 10) / 10); }, 'Mover clip');
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  const drag = useRef<null | { kind: 'move' | 'resize'; id: string; isSound: boolean; x0: number; start0: number; dur0: number; pxPerSec: number; rowY0: number }>(null);

  if (!scene) return <div className="timeline empty-tl muted">Añade o selecciona una escena.</div>;
  const D = scene.duration;
  const local = slot && time >= slot.start && time < slot.end ? time - slot.start : null;
  const surfaces = inst?.surfaces ?? [];
  const orphan = scene.clips.filter((c) => !surfaces.some((s) => s.id === c.surfaceId));
  const ticks: number[] = [];
  const step = D > 60 ? 10 : D > 20 ? 5 : D > 8 ? 1 : 0.5;
  for (let t = 0; t <= D + 1e-6; t += step) ticks.push(t);

  const mutScene = (live: boolean, fn: (sc: Scene) => void, label = 'Editar escena') => {
    const apply = (d: Project) => {
      const sh = d.shows.find((x) => x.id === show.id);
      const sc = sh?.scenes.find((x) => x.id === scene.id);
      if (sc) fn(sc);
    };
    live ? st().dragUpdate(apply) : st().update(label, apply);
  };

  const defaultSurface = rowSurface ?? surfaces[0]?.id ?? null;
  const startAt = pendingStart.current ?? (local !== null ? snap(local) : 0);

  function mutSceneById(id: string, fn: (sc: Scene) => void, label: string) {
    st().update(label, (d) => { const sc = d.shows.find((x) => x.id === show.id)?.scenes.find((x) => x.id === id); if (sc) fn(sc); });
  }
  function clipActions(c: Clip) {
    return {
      duplicate: () => {
        const d2 = { ...cloneDeep(c), id: newId('clp'), start: Math.min(c.start + c.duration, Math.max(0, D - 0.5)) };
        mutScene(false, (sc) => { sc.clips.push(d2); }, 'Duplicar clip');
        set({ clipId: d2.id, soundId: null, musicId: null });
      },
      remove: () => {
        mutScene(false, (sc) => { sc.clips = sc.clips.filter((x) => x.id !== c.id); }, 'Eliminar clip');
        set({ clipId: null });
      },
      moveTo: (surfaceId: string) => mutScene(false, (sc) => { const x = sc.clips.find((y) => y.id === c.id); if (x) x.surfaceId = surfaceId; }, 'Mover clip a otra superficie'),
    };
  }
  function soundRemove(id: string) {
    mutScene(false, (sc) => { sc.sounds = sc.sounds.filter((x) => x.id !== id); }, 'Eliminar sonido');
    set({ soundId: null });
  }
  function pasteClip() {
    if (!clipboard) return;
    const c = { ...cloneDeep(clipboard), id: newId('clp'), start: startAt, surfaceId: rowSurface ?? clipboard.surfaceId };
    if (!surfaces.some((s) => s.id === c.surfaceId)) c.surfaceId = defaultSurface ?? c.surfaceId;
    c.duration = Math.max(0.2, Math.min(c.duration, D - c.start));
    mutScene(false, (sc) => { sc.clips.push(c); }, 'Pegar clip');
    set({ clipId: c.id, soundId: null, musicId: null });
  }
  /** Menú del clic derecho sobre un clip. */
  const clipMenu = (e: React.MouseEvent, c: Clip) => {
    set({ clipId: c.id, soundId: null, musicId: null });
    const a = clipActions(c);
    const items: MenuItem[] = [
      { label: 'Duplicar', icon: <Copy size={14} />, hint: 'Ctrl+D', onClick: a.duplicate },
      { label: 'Copiar', hint: 'Ctrl+C', onClick: () => { clipboard = cloneDeep(c); } },
    ];
    if (c.source.type === 'asset') {
      items.push({ separator: true, label: '' });
      items.push({ label: 'Pasar a otra ventana…', icon: <Shuffle size={14} />, onClick: () => { pendingStart.current = c.start + c.duration; setChoreoPreset({ kind: 'pasar', actor: c.characterId ? `c:${c.characterId}` : `a:${c.source.type === 'asset' ? c.source.assetId : ''}`, from: c.surfaceId }); setPicker('choreo'); } });
      items.push({ label: c.silhouette ? 'Quitar silueta' : 'Convertir en silueta', onClick: () => mutScene(false, (sc) => { const x = sc.clips.find((y) => y.id === c.id); if (x) x.silhouette = !x.silhouette; }, 'Silueta') });
    }
    items.push({ separator: true, label: '' });
    for (const s of surfaces) if (s.id !== c.surfaceId) items.push({ label: `Mover a «${s.name}»`, onClick: () => a.moveTo(s.id) });
    items.push({ separator: true, label: '' });
    items.push({ label: 'Eliminar', icon: <Trash2 size={14} />, hint: 'Supr', danger: true, onClick: a.remove });
    openMenu(e, items);
  };
  /** Doble clic (o clic derecho) en un hueco de una fila: añadir algo justo ahí. */
  const gapMenu = (e: React.MouseEvent, surfaceId: string) => {
    if ((e.target as HTMLElement).closest('.tl-bar')) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const t = snap(Math.max(0, Math.min(D - 0.1, ((e.clientX - r.left) / r.width) * D)));
    pendingStart.current = t;
    setRowSurface(surfaceId);
    if (slot) previewControl.seek(slot.start + t);
    const name = surfaces.find((s) => s.id === surfaceId)?.name ?? '';
    openMenu(e, [
      { label: `Añadir en «${name}» a los ${t.toFixed(1)} s`, disabled: true },
      { label: 'Personaje…', icon: <Ghost size={14} />, disabled: !project.characters.length, onClick: () => setPicker('character') },
      { label: 'Imagen o vídeo…', icon: <Film size={14} />, onClick: () => setPicker('asset') },
      { label: 'Efecto…', icon: <Sparkles size={14} />, onClick: () => setPicker('effect') },
      { label: 'Rótulo', icon: <Type size={14} />, onClick: () => addText(surfaceId, t) },
      { label: 'Coreografía entre ventanas…', icon: <Shuffle size={14} />, onClick: () => { setChoreoPreset({ from: surfaceId }); setPicker('choreo'); } },
      { label: 'Plantilla en toda la casa…', icon: <Wand2 size={14} />, onClick: () => setPicker('template') },
      ...(clipboard ? [{ separator: true, label: '' }, { label: 'Pegar clip aquí', hint: 'Ctrl+V', onClick: pasteClip }] : []),
    ]);
  };
  function addText(surfaceId: string, at: number) {
    addClip(createClip(surfaceId, { type: 'text', text: '¡Feliz Halloween!', font: 'terror', color: '#ff8a1c', outline: '#1a0526', glow: true, bold: true }, {
      name: '', start: at, duration: Math.max(0.5, Math.min(5, D - at)), scale: 0.9, motion: { preset: 'popIn', intensity: 1, speed: 1 },
    }));
  }

  const addClip = (c: Clip) => {
    mutScene(false, (sc) => { sc.clips.push(c); }, 'Añadir clip');
    set({ clipId: c.id, soundId: null, musicId: null });
    pendingStart.current = null;
  };

  const onBarDown = (e: React.PointerEvent, id: string, isSound: boolean, kind: 'move' | 'resize') => {
    e.stopPropagation();
    if (e.button !== 0) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    const item = isSound ? scene.sounds.find((s) => s.id === id)! : scene.clips.find((c) => c.id === id)!;
    const width = trackRef.current!.getBoundingClientRect().width;
    const dur = isSound ? (item as SoundCue).duration ?? soundLength(item as SoundCue) : (item as Clip).duration;
    st().beginDrag();
    drag.current = { kind, id, isSound, x0: e.clientX, start0: item.start, dur0: dur, pxPerSec: width / D, rowY0: e.clientY };
    set(isSound ? { soundId: id, clipId: null, musicId: null } : { clipId: id, soundId: null, musicId: null });
  };

  const soundLength = (s: SoundCue) => project.assets.find((a) => a.id === s.assetId)?.duration ?? 3;

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dt = (e.clientX - d.x0) / d.pxPerSec;
    // cambio de fila (superficie) al arrastrar verticalmente un clip
    let targetSurface: string | null = null;
    if (!d.isSound && d.kind === 'move') {
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-surface-row]') as HTMLElement | null;
      targetSurface = el?.dataset.surfaceRow ?? null;
    }
    mutScene(true, (sc) => {
      if (d.isSound) {
        const s = sc.sounds.find((x) => x.id === d.id)!;
        if (d.kind === 'move') s.start = Math.max(0, Math.min(D - 0.1, snap(d.start0 + dt)));
        else s.duration = Math.max(0.1, snap(d.dur0 + dt));
      } else {
        const c = sc.clips.find((x) => x.id === d.id)!;
        if (d.kind === 'move') {
          c.start = Math.max(0, Math.min(D - 0.1, snap(d.start0 + dt)));
          if (targetSurface) c.surfaceId = targetSurface;
        } else c.duration = Math.max(0.1, snap(d.dur0 + dt));
      }
    });
  };

  const onUp = () => {
    if (!drag.current) return;
    st().endDrag(drag.current.kind === 'move' ? 'Mover clip' : 'Cambiar duración');
    drag.current = null;
  };

  const onRulerDown = (e: React.PointerEvent) => {
    if (!slot) return;
    const r = trackRef.current!.getBoundingClientRect();
    const t = Math.max(0, Math.min(D, ((e.clientX - r.left) / r.width) * D));
    previewControl.seek(slot.start + t);
  };

  const pct = (t: number) => `${(t / D) * 100}%`;
  const clipLabel = (c: Clip) => {
    if (c.name) return c.name;
    if (c.source.type === 'effect') return EFFECT_LABELS[c.source.effect];
    if (c.source.type === 'text') return `«${c.source.text.replace(/\n/g, ' ')}»`;
    return project.assets.find((a) => a.id === (c.source as { assetId: string }).assetId)?.name ?? '(recurso ausente)';
  };

  const row = (surfaceId: string, label: React.ReactNode, color: string, clips: Clip[]) => (
    <div className={`tl-row${rowSurface === surfaceId ? ' focus' : ''}`} key={surfaceId} data-surface-row={surfaceId}>
      <div className="tl-label" onClick={() => setRowSurface(surfaceId)} title="Los clips nuevos se añadirán a esta superficie">
        <span className="dot" style={{ background: color }} />{label}
      </div>
      <div className="tl-track" onPointerDown={(e) => { setRowSurface(surfaceId); onRulerDown(e); }} onDoubleClick={(e) => gapMenu(e, surfaceId)} onContextMenu={(e) => gapMenu(e, surfaceId)}>
        {clips.map((c) => (
          <div
            key={c.id}
            className={`tl-bar${c.id === clipId ? ' sel' : ''}${c.source.type === 'effect' ? ' fx' : c.source.type === 'text' ? ' txt' : ''}${c.characterId ? ' chr' : ''}`}
            style={{ left: pct(c.start), width: pct(Math.min(c.duration, D - c.start)) }}
            onPointerDown={(e) => onBarDown(e, c.id, false, 'move')}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onContextMenu={(e) => clipMenu(e, c)}
            title={`${clipLabel(c)} · ${c.start.toFixed(1)}s → ${(c.start + c.duration).toFixed(1)}s${c.travel ? ' · viaja por la fachada' : ''} · clic derecho: más opciones`}
            data-testid="tl-clip"
          >
            <span>{c.travel ? '↔ ' : ''}{clipLabel(c)}</span>
            {c.motion.preset !== 'none' && <em>{MOTION_LABELS[c.motion.preset]}</em>}
            <i className="tl-resize" onPointerDown={(e) => onBarDown(e, c.id, false, 'resize')} onPointerMove={onMove} onPointerUp={onUp} />
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="timeline" data-testid="timeline">
      <div className="tl-toolbar">
        <span className="tl-title">{scene.name} · {D}s</span>
        <Button small icon={<Film size={14} />} disabled={!surfaces.length} onClick={() => setPicker('asset')} data-testid="add-clip">Recurso</Button>
        <Button small icon={<Ghost size={14} />} disabled={!surfaces.length || !project.characters.length} onClick={() => setPicker('character')} data-testid="add-character">Personaje</Button>
        <Button small icon={<Sparkles size={14} />} disabled={!surfaces.length} onClick={() => setPicker('effect')} data-testid="add-effect">Efecto</Button>
        <Button small variant="primary" icon={<Wand2 size={14} />} disabled={!surfaces.length} onClick={() => setPicker('template')} data-testid="add-template" title="Coreografías listas en todas las superficies">Plantilla</Button>
        <Button
          small
          icon={<Type size={14} />}
          disabled={!surfaces.length}
          data-testid="add-text"
          onClick={() => addText(defaultSurface!, startAt)}
        >
          Rótulo
        </Button>
        <Button small icon={<Shuffle size={14} />} disabled={surfaces.filter((s) => s.kind !== 'wall').length < 2} onClick={() => { setChoreoPreset(rowSurface ? { from: rowSurface } : undefined); setPicker('choreo'); }} data-testid="add-choreo" title="Un personaje que se asoma y pasa a otra ventana, escondite, lanzar en arco…">Coreografía</Button>
        <Button small icon={<Volume2 size={14} />} onClick={() => setPicker('sound')} data-testid="add-sound">Sonido</Button>
        <span className="muted small">Se añade en {surfaces.find((s) => s.id === defaultSurface)?.name ?? '—'} a los {startAt.toFixed(1)}s. Doble clic en un hueco para añadir ahí · clic derecho en un clip para más opciones · Supr borra · Ctrl+D duplica.</span>
      </div>
      <div className="tl-grid">
        <div className="tl-row ruler">
          <div className="tl-label" />
          <div className="tl-track" ref={trackRef} onPointerDown={onRulerDown}>
            {ticks.map((t) => <span key={t} className="tick" style={{ left: pct(t) }}>{t % 1 === 0 ? `${t}s` : ''}</span>)}
          </div>
        </div>
        {!inst && <div className="muted small pad">El espectáculo no tiene instalación asignada.</div>}
        {surfaces.map((s, i) => row(s.id, <>{i + 1}. {s.name}</>, s.color, scene.clips.filter((c) => c.surfaceId === s.id)))}
        {orphan.length > 0 && row('__orphan', <span className="warn-text">Sin superficie</span>, '#f55', orphan)}
        <div className="tl-row sounds">
          <div className="tl-label"><Volume2 size={13} /> Sonidos</div>
          <div className="tl-track" onPointerDown={onRulerDown}>
            {scene.sounds.map((s) => {
              const a = project.assets.find((x) => x.id === s.assetId);
              const len = s.duration ?? (s.continueAfterScene ? a?.duration ?? 3 : Math.min(a?.duration ?? 3, D - s.start));
              return (
                <div
                  key={s.id}
                  className={`tl-bar snd${s.id === soundId ? ' sel' : ''}`}
                  style={{ left: pct(s.start), width: pct(Math.min(len, D - s.start)) }}
                  onPointerDown={(e) => onBarDown(e, s.id, true, 'move')}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  data-testid="tl-sound"
                >
                  <span>{a?.name ?? '(audio ausente)'}</span>
                  <i className="tl-resize" onPointerDown={(e) => onBarDown(e, s.id, true, 'resize')} onPointerMove={onMove} onPointerUp={onUp} />
                </div>
              );
            })}
          </div>
        </div>
        {local !== null && (
          <div className="tl-playhead-layer"><div className="tl-playhead" style={{ left: pct(local) }} /></div>
        )}
      </div>

      {picker === 'asset' && (
        <AssetPicker
          kinds={['image', 'video', 'sequence']}
          title="Añadir recurso a la escena"
          onClose={() => setPicker(null)}
          onPick={(id) => {
            const a = project.assets.find((x) => x.id === id)!;
            const dur = a.kind !== 'image' && a.duration ? Math.min(a.duration, D - startAt) : Math.min(5, D - startAt);
            addClip(createClip(defaultSurface!, { type: 'asset', assetId: id }, { start: startAt, duration: Math.max(0.5, dur), loop: true }));
            setPicker(null);
          }}
        />
      )}
      {picker === 'sound' && (
        <AssetPicker
          kinds={['audio']}
          title="Añadir sonido a la escena"
          onClose={() => setPicker(null)}
          onPick={(id) => {
            const s = createSoundCue(id, { start: startAt });
            mutScene(false, (sc) => { sc.sounds.push(s); }, 'Añadir sonido');
            set({ soundId: s.id, clipId: null, musicId: null });
            setPicker(null);
          }}
        />
      )}
      {picker === 'character' && (
        <CharacterPicker
          onClose={() => setPicker(null)}
          onPick={(chId, animId) => {
            const ch = project.characters.find((c) => c.id === chId)!;
            const an = ch.animations.find((a) => a.id === animId)!;
            addClip(createClip(defaultSurface!, { type: 'asset', assetId: an.assetId }, {
              name: `${ch.name}: ${an.name}`,
              characterId: ch.id,
              animationId: an.id,
              start: startAt,
              duration: Math.max(0.5, Math.min(an.duration, D - startAt)),
              loop: an.loop,
              motion: { ...an.motion },
              fit: an.fit,
              scale: an.scale,
            }));
            setPicker(null);
          }}
        />
      )}
      {picker === 'choreo' && (
        <ChoreoModal show={show} sceneId={scene.id} start={startAt} preset={choreoPreset} onClose={() => setPicker(null)} />
      )}
      {picker === 'template' && inst && (
        <Modal title="Plantillas de escena" onClose={() => setPicker(null)} wide>
          <p className="muted small">Se añaden a esta escena, en todas las superficies visibles, escalonadas de izquierda a derecha a partir de {startAt.toFixed(1)} s. Después puedes retocar cada clip (o deshacer con Ctrl+Z).</p>
          <div className="template-grid">
            {TEMPLATE_KINDS.map((k) => (
              <button
                key={k}
                className="template-card"
                data-testid={`template-${k}`}
                onClick={() => {
                  const thunder = project.assets.find((a) => a.kind === 'audio' && (a.tags.includes('trueno') || /trueno/i.test(a.name)));
                  const r = applyTemplate(k, inst, scene, { start: startAt, thunderAssetId: thunder?.id ?? null });
                  mutScene(false, (sc) => { sc.clips.push(...r.clips); sc.sounds.push(...r.sounds); }, `Plantilla: ${TEMPLATE_INFO[k].name}`);
                  if (k === 'tormenta' && !thunder) useStore.getState().toast('info', 'Añade un sonido con «trueno» en el nombre (el paquete Halloween incluye uno) para que suenen truenos.', 7000);
                  setPicker(null);
                }}
              >
                <b>{TEMPLATE_INFO[k].name}</b>
                <span>{TEMPLATE_INFO[k].description}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {picker === 'effect' && (
        <Modal title="Añadir efecto" onClose={() => setPicker(null)} wide>
          {EFFECT_GROUPS.map((g) => (
            <div key={g.title}>
              <h4 className="sub">{g.title}</h4>
              <div className="effect-grid">
                {g.kinds.map((k) => (
                  <Button key={k} onClick={() => {
                    addClip(createClip(defaultSurface!, effectSource(k), { start: startAt, duration: Math.min(k === 'drawOn' ? 3 : 4, D - startAt), fit: 'stretch', fadeIn: k === 'lightning' ? 0 : 0.5 }));
                    setPicker(null);
                  }} data-testid={`effect-${k}`}>{EFFECT_LABELS[k]}</Button>
                ))}
              </div>
            </div>
          ))}
        </Modal>
      )}
    </div>
  );
}

const EFFECT_GROUPS: { title: string; kinds: EffectKind[] }[] = [
  { title: 'Bordes y contornos (brillan fuera de la superficie)', kinds: ['neon', 'drawOn', 'chase', 'comet'] },
  { title: 'Magia', kinds: ['portal', 'vortex', 'runes', 'burst', 'fairyDust', 'bubbles'] },
  { title: 'La casa despierta', kinds: ['bigEye', 'mouth'] },
  { title: 'Fiesta', kinds: ['confetti', 'hearts', 'lanterns'] },
  { title: 'Luz y color', kinds: ['flicker', 'glow', 'sweep', 'rainbow', 'solid'] },
  { title: 'Ventanas falsas (sobre las reales)', kinds: ['shadowPass', 'curtains', 'shutters', 'stainedGlass'] },
  { title: 'Impacto', kinds: ['lightning', 'cracks', 'glitch', 'pulse', 'searchlight', 'fireworks'] },
  { title: 'Halloween', kinds: ['eyes', 'spirits', 'fog', 'fire'] },
  { title: 'Navidad e invierno', kinds: ['snow', 'frost', 'aurora', 'shootingStars', 'stars'] },
  { title: 'Ambiente', kinds: ['rain', 'fireflies'] },
];

function CharacterPicker({ onPick, onClose }: { onPick: (chId: string, animId: string) => void; onClose: () => void }) {
  const project = useStore((s) => s.project)!;
  return (
    <Modal title="Añadir personaje" onClose={onClose} wide>
      <div className="char-pick">
        {project.characters.map((c) => (
          <div key={c.id} className="char-pick-row">
            <div className="char-pick-name">{c.name}</div>
            <div className="char-pick-anims">
              {c.animations.map((a) => {
                const as = project.assets.find((x) => x.id === a.assetId);
                return (
                  <button key={a.id} className="asset-card" onClick={() => onPick(c.id, a.id)} data-testid="pick-animation">
                    {as && <AssetThumb a={as} />}
                    <div className="asset-name">{a.name}</div>
                    <div className="asset-meta">{MOTION_LABELS[a.motion.preset]}</div>
                  </button>
                );
              })}
              {c.animations.length === 0 && <span className="muted small">Sin animaciones</span>}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function ShowInspector({ show }: { show: Show }) {
  const clipId = useStore((s) => s.clipId);
  const soundId = useStore((s) => s.soundId);
  const musicId = useStore((s) => s.musicId);
  const scene = useStore(selScene);
  const clip = scene?.clips.find((c) => c.id === clipId);
  const sound = scene?.sounds.find((s) => s.id === soundId);
  const music = show.music.find((m) => m.id === musicId);
  if (clip && scene) return <ClipInspector clip={clip} />;
  if (sound && scene) return <SoundInspector s={sound} />;
  if (music) return <MusicInspector m={music} />;
  return (
    <div className="inspector">
      {scene && <SceneInspector scene={scene} />}
      <ShowSettings show={show} />
    </div>
  );
}

function SceneInspector({ scene }: { scene: Scene }) {
  const mut = useSceneMut();
  return (
    <Panel title="Escena">
      <Field label="Nombre"><TextInput value={scene.name} onCommit={(v) => mut('Renombrar escena', (s) => { s.name = v; })} data-testid="scene-name" /></Field>
      <div className="row2">
        <Field label="Duración"><NumberInput value={scene.duration} min={0.5} max={3600} step={0.5} suffix="s" onCommit={(v) => mut('Duración de escena', (s) => { s.duration = v; })} data-testid="scene-duration" /></Field>
        <Field label="Activa"><Toggle checked={scene.enabled} onChange={(v) => mut('Activar escena', (s) => { s.enabled = v; })} label={scene.enabled ? 'Sí' : 'No'} /></Field>
      </div>
      <div className="row2">
        <Field label="Transición de entrada">
          <Select value={scene.transition.type} onChange={(v) => mut('Transición', (s) => { s.transition.type = v; })} options={[{ value: 'cut', label: 'Corte' }, { value: 'fade', label: 'Fundido a negro' }, { value: 'crossfade', label: 'Fundido cruzado' }]} />
        </Field>
        <Field label="Duración"><NumberInput value={scene.transition.duration} min={0} max={10} step={0.1} suffix="s" onCommit={(v) => mut('Duración transición', (s) => { s.transition.duration = v; })} /></Field>
      </div>
      <Field label="Notas"><TextInput multiline value={scene.notes} onCommit={(v) => mut('Notas', (s) => { s.notes = v; })} placeholder="Qué ocurre en esta escena" /></Field>
    </Panel>
  );
}

function ShowSettings({ show }: { show: Show }) {
  const mut = useShowMut();
  const project = useStore((s) => s.project)!;
  const set = useStore((s) => s.set);
  const [pick, setPick] = useState(false);
  return (
    <>
      <Panel title="Espectáculo">
        <Field label="Nombre"><TextInput value={show.name} onCommit={(v) => mut('Renombrar espectáculo', (s) => { s.name = v; })} data-testid="show-name" /></Field>
        <Field label="Etiquetas" hint="Temporada, año, cliente… (separadas por comas)"><TextInput value={show.tags.join(', ')} onCommit={(v) => mut('Etiquetas', (s) => { s.tags = v.split(',').map((x) => x.trim()).filter(Boolean); })} /></Field>
        <div className="row2">
          <Toggle checked={show.loop} onChange={(v) => mut('Bucle', (s) => { s.loop = v; })} label="Repetir en bucle" />
          <Field label="Pausa entre repeticiones"><NumberInput value={show.loopGap} min={0} max={600} step={1} suffix="s" onCommit={(v) => mut('Pausa', (s) => { s.loopGap = v; })} /></Field>
        </div>
        <Field label={`Volumen general ${Math.round(show.masterVolume * 100)}%`}>
          <NumberInput value={Math.round(show.masterVolume * 100)} min={0} max={200} step={5} suffix="%" precision={0} onCommit={(v) => mut('Volumen', (s) => { s.masterVolume = v / 100; })} />
        </Field>
      </Panel>
      <Panel title="Música del espectáculo" actions={<Button small icon={<Plus size={14} />} onClick={() => setPick(true)} data-testid="add-music">Música</Button>}>
        {show.music.length === 0 ? (
          <p className="muted small">La música del espectáculo suena de forma continua por encima de las escenas. Para sonidos puntuales usa «Sonido» en la línea de tiempo.</p>
        ) : (
          <ul className="music-list">
            {show.music.map((m) => (
              <li key={m.id} onClick={() => set({ musicId: m.id, clipId: null, soundId: null })}>
                <Music size={14} /> {project.assets.find((a) => a.id === m.assetId)?.name ?? '(ausente)'} <span className="muted small">desde {m.start}s · {Math.round(m.volume * 100)}%{m.loop ? ' · bucle' : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {pick && (
        <AssetPicker
          kinds={['audio']}
          title="Música del espectáculo"
          onClose={() => setPick(false)}
          onPick={(id) => {
            const m: MusicTrack = { id: newId('mus'), assetId: id, start: 0, volume: 0.8, fadeIn: 1, fadeOut: 2, loop: true };
            mut('Añadir música', (s) => { s.music.push(m); });
            set({ musicId: m.id, clipId: null, soundId: null });
            setPick(false);
          }}
        />
      )}
    </>
  );
}

function ClipInspector({ clip }: { clip: Clip }) {
  const project = useStore((s) => s.project)!;
  const show = useStore(selShow)!;
  const set = useStore((s) => s.set);
  const sceneMut = useSceneMut();
  const [pick, setPick] = useState(false);
  const inst = project.installations.find((i) => i.id === show.installationId);
  const mut = (label: string, fn: (c: Clip) => void) => sceneMut(label, (sc) => { const c = sc.clips.find((x) => x.id === clip.id); if (c) fn(c); });
  const asset = clip.source.type === 'asset' ? project.assets.find((a) => a.id === (clip.source as { assetId: string }).assetId) : null;
  return (
    <div className="inspector" data-testid="clip-inspector">
      <Panel title="Clip" actions={<Button small variant="ghost" onClick={() => set({ clipId: null })}>Cerrar</Button>}>
        <Field label="Nombre"><TextInput value={clip.name} onCommit={(v) => mut('Renombrar clip', (c) => { c.name = v; })} placeholder={asset?.name ?? ''} /></Field>
        {clip.source.type === 'asset' ? (
          <Field label="Recurso">
            <div className="row2">
              {asset ? <AssetThumb a={asset} /> : <span className="warn-text">Recurso ausente</span>}
              <Button small onClick={() => setPick(true)}>Cambiar…</Button>
            </div>
          </Field>
        ) : clip.source.type === 'text' ? (
          <>
            <Field label="Texto" hint="Intro para cambiar de línea">
              <TextInput multiline value={clip.source.text} onCommit={(v) => mut('Texto del rótulo', (c) => { if (c.source.type === 'text') c.source.text = v; })} data-testid="text-content" />
            </Field>
            <div className="row2">
              <Field label="Letra">
                <Select value={clip.source.font} onChange={(v) => mut('Letra', (c) => { if (c.source.type === 'text') c.source.font = v; })} options={TEXT_FONTS.map((f) => ({ value: f, label: TEXT_FONT_LABELS[f] }))} />
              </Field>
              <Toggle checked={clip.source.glow} onChange={(v) => mut('Halo', (c) => { if (c.source.type === 'text') c.source.glow = v; })} label="Halo luminoso" />
            </div>
            <div className="row2">
              <Field label="Color"><input type="color" value={clip.source.color} onChange={(e) => mut('Color', (c) => { if (c.source.type === 'text') c.source.color = e.target.value; })} /></Field>
              <Field label="Contorno"><input type="color" value={clip.source.outline} onChange={(e) => mut('Contorno', (c) => { if (c.source.type === 'text') c.source.outline = e.target.value; })} /></Field>
            </div>
          </>
        ) : (
          <>
            <Field label="Efecto">
              <Select value={clip.source.effect} onChange={(v) => mut('Efecto', (c) => { if (c.source.type === 'effect') c.source.effect = v; })} options={EFFECT_KINDS.map((k) => ({ value: k, label: EFFECT_LABELS[k] }))} />
            </Field>
            <div className="row2">
              <Field label="Color"><input type="color" value={clip.source.color} onChange={(e) => mut('Color', (c) => { if (c.source.type === 'effect') c.source.color = e.target.value; })} /></Field>
              <Field label="Color 2"><input type="color" value={clip.source.color2} onChange={(e) => mut('Color', (c) => { if (c.source.type === 'effect') c.source.color2 = e.target.value; })} /></Field>
            </div>
            {(CONTOUR_EFFECTS as readonly string[]).includes(clip.source.effect) && (
              <Field label="Grosor del contorno"><NumberInput value={clip.source.width} min={0.5} max={80} step={0.5} suffix="px" onCommit={(v) => mut('Grosor', (c) => { if (c.source.type === 'effect') c.source.width = v; })} /></Field>
            )}
            {(FACADE_EFFECTS as readonly string[]).includes(clip.source.effect) && (
              <Toggle checked={clip.source.space === 'facade'} onChange={(v) => mut('Espacio del efecto', (c) => { if (c.source.type === 'effect') c.source.space = v ? 'facade' : 'surface'; })} label="Continuo en toda la fachada (sincronizado entre ventanas)" />
            )}
          </>
        )}
        <Field label="Superficie">
          <Select value={clip.surfaceId} onChange={(v) => mut('Cambiar superficie', (c) => { c.surfaceId = v; })} options={(inst?.surfaces ?? []).map((s) => ({ value: s.id, label: s.name }))} data-testid="clip-surface" />
        </Field>
      </Panel>
      <Panel title="Tiempo">
        <div className="row2">
          <Field label="Inicio"><NumberInput value={clip.start} min={0} step={0.1} suffix="s" onCommit={(v) => mut('Inicio', (c) => { c.start = v; })} data-testid="clip-start" /></Field>
          <Field label="Duración"><NumberInput value={clip.duration} min={0.1} step={0.1} suffix="s" onCommit={(v) => mut('Duración', (c) => { c.duration = v; })} data-testid="clip-duration" /></Field>
        </div>
        <div className="row2">
          <Field label="Fundido entrada"><NumberInput value={clip.fadeIn} min={0} step={0.1} suffix="s" onCommit={(v) => mut('Fundido', (c) => { c.fadeIn = v; })} /></Field>
          <Field label="Fundido salida"><NumberInput value={clip.fadeOut} min={0} step={0.1} suffix="s" onCommit={(v) => mut('Fundido', (c) => { c.fadeOut = v; })} /></Field>
        </div>
        <div className="row2">
          <Toggle checked={clip.loop} onChange={(v) => mut('Bucle', (c) => { c.loop = v; })} label="Bucle" />
          <Field label="Velocidad"><NumberInput value={clip.playbackRate} min={0.1} max={4} step={0.1} suffix="×" onCommit={(v) => mut('Velocidad', (c) => { c.playbackRate = v; })} /></Field>
        </div>
      </Panel>
      <Panel title="Movimiento y posición">
        <Field label="Movimiento">
          <Select value={clip.motion.preset} onChange={(v) => mut('Movimiento', (c) => { c.motion.preset = v; })} options={MOTION_PRESETS.map((m) => ({ value: m, label: MOTION_LABELS[m] }))} data-testid="clip-motion" />
        </Field>
        <div className="row2">
          <Field label="Intensidad"><NumberInput value={clip.motion.intensity} min={0} max={3} step={0.1} onCommit={(v) => mut('Intensidad', (c) => { c.motion.intensity = v; })} /></Field>
          <Field label="Rapidez"><NumberInput value={clip.motion.speed} min={0.05} max={10} step={0.1} onCommit={(v) => mut('Rapidez', (c) => { c.motion.speed = v; })} /></Field>
        </div>
        <Field label="Ajuste">
          <Select value={clip.fit} onChange={(v) => mut('Ajuste', (c) => { c.fit = v; })} options={[{ value: 'contain', label: 'Encajar (sin recortar)' }, { value: 'cover', label: 'Cubrir (recorta)' }, { value: 'stretch', label: 'Estirar a la superficie' }]} />
        </Field>
        <div className="row2">
          <Field label="Posición X"><NumberInput value={clip.x * 100} step={1} suffix="%" precision={1} onCommit={(v) => mut('Posición', (c) => { c.x = v / 100; })} /></Field>
          <Field label="Posición Y"><NumberInput value={clip.y * 100} step={1} suffix="%" precision={1} onCommit={(v) => mut('Posición', (c) => { c.y = v / 100; })} /></Field>
        </div>
        <div className="row2">
          <Field label="Escala"><NumberInput value={clip.scale * 100} min={1} max={1000} step={5} suffix="%" precision={0} onCommit={(v) => mut('Escala', (c) => { c.scale = v / 100; })} data-testid="clip-scale" /></Field>
          <Field label="Rotación"><NumberInput value={clip.rotation} step={1} suffix="°" precision={1} onCommit={(v) => mut('Rotación', (c) => { c.rotation = v; })} /></Field>
        </div>
        <div className="row2">
          <Field label="Opacidad"><NumberInput value={clip.opacity * 100} min={0} max={100} step={5} suffix="%" precision={0} onCommit={(v) => mut('Opacidad', (c) => { c.opacity = v / 100; })} /></Field>
          <Field label="Capa"><NumberInput value={clip.z} step={1} precision={0} onCommit={(v) => mut('Capa', (c) => { c.z = v; })} /></Field>
        </div>
        <Toggle checked={clip.flipX} onChange={(v) => mut('Voltear', (c) => { c.flipX = v; })} label="Voltear horizontalmente" />
        {clip.source.type === 'asset' && (
          <div className="row2">
            <Toggle checked={clip.silhouette} onChange={(v) => mut('Silueta', (c) => { c.silhouette = v; })} label="Silueta (sombra chinesca)" data-testid="clip-silhouette" />
            {clip.silhouette && <input type="color" value={clip.silhouetteColor} onChange={(e) => mut('Color de silueta', (c) => { c.silhouetteColor = e.target.value; })} />}
          </div>
        )}
        {clip.source.type !== 'effect' && <TravelEditor clip={clip} mut={mut} />}
      </Panel>
      <div className="btn-row">
        <Button icon={<Copy size={15} />} onClick={() => {
          const c = { ...JSON.parse(JSON.stringify(clip)), id: newId('clp') } as Clip;
          sceneMut('Duplicar clip', (sc) => { sc.clips.push(c); });
          set({ clipId: c.id });
        }}>Duplicar</Button>
        <Button variant="danger" icon={<Trash2 size={15} />} data-testid="delete-clip" onClick={() => {
          sceneMut('Eliminar clip', (sc) => { sc.clips = sc.clips.filter((x) => x.id !== clip.id); });
          set({ clipId: null });
        }}>Eliminar</Button>
      </div>
      {pick && (
        <AssetPicker kinds={['image', 'video', 'sequence']} title="Cambiar recurso" onClose={() => setPick(false)} onPick={(id) => { mut('Cambiar recurso', (c) => { c.source = { type: 'asset', assetId: id }; }); setPick(false); }} />
      )}
    </div>
  );
}

/** Viaje por la fachada: el clip va de una superficie a otra y se ve a través de las que elijas. */
function TravelEditor({ clip, mut }: { clip: Clip; mut: (label: string, fn: (c: Clip) => void) => void }) {
  const project = useStore((s) => s.project)!;
  const show = useStore(selShow);
  const inst = show ? project.installations.find((i) => i.id === show.installationId) : null;
  if (!inst) return null;
  const center = (id: string) => {
    const s = inst.surfaces.find((x) => x.id === id);
    if (!s) return { x: 0.5, y: 0.5 };
    const xs = s.quad.map((p) => p.x), ys = s.quad.map((p) => p.y);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  };
  const nearest = (p: { x: number; y: number }) => inst.surfaces.slice().sort((a, b) => Math.hypot(center(a.id).x - p.x, center(a.id).y - p.y) - Math.hypot(center(b.id).x - p.x, center(b.id).y - p.y))[0]?.id ?? '';
  const tr = clip.travel;
  const opts = inst.surfaces.map((s) => ({ value: s.id, label: s.name }));
  return (
    <div className="travel-box">
      <Toggle
        checked={!!tr}
        onChange={(v) => mut(v ? 'Viajar por la fachada' : 'Quitar viaje', (c) => {
          if (!v) { c.travel = null; return; }
          const other = inst.surfaces.find((s) => s.id !== c.surfaceId && s.kind !== 'wall') ?? inst.surfaces[0];
          c.travel = { from: center(c.surfaceId), to: center(other.id), arc: 0, surfaces: [] };
        })}
        label="Viajar por la fachada (de una superficie a otra)"
        data-testid="clip-travel"
      />
      {tr && (
        <>
          <div className="row2">
            <Field label="Desde"><Select value={nearest(tr.from)} onChange={(id) => mut('Viaje: desde', (c) => { if (c.travel) c.travel.from = center(id); })} options={opts} /></Field>
            <Field label="Hasta"><Select value={nearest(tr.to)} onChange={(id) => mut('Viaje: hasta', (c) => { if (c.travel) c.travel.to = center(id); })} options={opts} /></Field>
          </div>
          <div className="row2">
            <Field label="Arco"><NumberInput value={tr.arc * 100} min={0} max={100} step={5} suffix="%" precision={0} onCommit={(v) => mut('Viaje: arco', (c) => { if (c.travel) c.travel.arc = v / 100; })} /></Field>
            <Field label="Se ve">
              <Select value={tr.surfaces.length === inst.surfaces.length ? 'all' : tr.surfaces.length ? 'custom' : 'noWalls'} onChange={(v) => mut('Viaje: dónde se ve', (c) => { if (!c.travel) return; c.travel.surfaces = v === 'all' ? inst.surfaces.map((s) => s.id) : []; })}
                options={[{ value: 'noWalls', label: 'Solo en ventanas y puertas (pasa por detrás)' }, { value: 'all', label: 'En toda la fachada (vuela por delante)' }, ...(tr.surfaces.length && tr.surfaces.length !== inst.surfaces.length ? [{ value: 'custom', label: 'Selección propia' }] : [])]} />
            </Field>
          </div>
          <p className="muted small">El tamaño es relativo al alto de su superficie; la duración del clip marca la velocidad.</p>
        </>
      )}
    </div>
  );
}

function SoundInspector({ s }: { s: SoundCue }) {
  const project = useStore((st) => st.project)!;
  const set = useStore((st) => st.set);
  const sceneMut = useSceneMut();
  const mut = (label: string, fn: (x: SoundCue) => void) => sceneMut(label, (sc) => { const x = sc.sounds.find((y) => y.id === s.id); if (x) fn(x); });
  const a = project.assets.find((x) => x.id === s.assetId);
  return (
    <div className="inspector">
      <Panel title="Sonido" actions={<Button small variant="ghost" onClick={() => set({ soundId: null })}>Cerrar</Button>}>
        <div className="muted">{a?.name ?? '(audio ausente)'}{a?.duration ? ` · ${formatTime(a.duration)}` : ''}</div>
        <div className="row2">
          <Field label="Inicio"><NumberInput value={s.start} min={0} step={0.1} suffix="s" onCommit={(v) => mut('Inicio', (x) => { x.start = v; })} /></Field>
          <Field label="Duración" hint="Vacío = completo"><NumberInput value={s.duration ?? 0} min={0} step={0.1} suffix="s" onCommit={(v) => mut('Duración', (x) => { x.duration = v > 0 ? v : null; })} /></Field>
        </div>
        <Field label="Volumen"><NumberInput value={Math.round(s.volume * 100)} min={0} max={200} step={5} suffix="%" precision={0} onCommit={(v) => mut('Volumen', (x) => { x.volume = v / 100; })} /></Field>
        <div className="row2">
          <Field label="Fundido entrada"><NumberInput value={s.fadeIn} min={0} step={0.1} suffix="s" onCommit={(v) => mut('Fundido', (x) => { x.fadeIn = v; })} /></Field>
          <Field label="Fundido salida"><NumberInput value={s.fadeOut} min={0} step={0.1} suffix="s" onCommit={(v) => mut('Fundido', (x) => { x.fadeOut = v; })} /></Field>
        </div>
        <Toggle checked={s.loop} onChange={(v) => mut('Bucle', (x) => { x.loop = v; })} label="Repetir en bucle" />
        <Toggle checked={s.continueAfterScene} onChange={(v) => mut('Continuar', (x) => { x.continueAfterScene = v; })} label="Seguir sonando al terminar la escena" />
      </Panel>
      <Button variant="danger" icon={<Trash2 size={15} />} onClick={() => { sceneMut('Eliminar sonido', (sc) => { sc.sounds = sc.sounds.filter((x) => x.id !== s.id); }); set({ soundId: null }); }}>Eliminar sonido</Button>
    </div>
  );
}

function MusicInspector({ m }: { m: MusicTrack }) {
  const project = useStore((st) => st.project)!;
  const set = useStore((st) => st.set);
  const showMut = useShowMut();
  const mut = (label: string, fn: (x: MusicTrack) => void) => showMut(label, (sh) => { const x = sh.music.find((y) => y.id === m.id); if (x) fn(x); });
  const a = project.assets.find((x) => x.id === m.assetId);
  return (
    <div className="inspector">
      <Panel title="Música" actions={<Button small variant="ghost" onClick={() => set({ musicId: null })}>Cerrar</Button>}>
        <div className="muted">{a?.name ?? '(audio ausente)'}{a?.duration ? ` · ${formatTime(a.duration)}` : ''}</div>
        <Field label="Empieza en (tiempo del espectáculo)"><NumberInput value={m.start} min={0} step={0.5} suffix="s" onCommit={(v) => mut('Inicio', (x) => { x.start = v; })} /></Field>
        <Field label="Volumen"><NumberInput value={Math.round(m.volume * 100)} min={0} max={200} step={5} suffix="%" precision={0} onCommit={(v) => mut('Volumen', (x) => { x.volume = v / 100; })} /></Field>
        <div className="row2">
          <Field label="Fundido entrada"><NumberInput value={m.fadeIn} min={0} step={0.5} suffix="s" onCommit={(v) => mut('Fundido', (x) => { x.fadeIn = v; })} /></Field>
          <Field label="Fundido salida"><NumberInput value={m.fadeOut} min={0} step={0.5} suffix="s" onCommit={(v) => mut('Fundido', (x) => { x.fadeOut = v; })} /></Field>
        </div>
        <Toggle checked={m.loop} onChange={(v) => mut('Bucle', (x) => { x.loop = v; })} label="Repetir hasta el final del espectáculo" />
      </Panel>
      <Button variant="danger" icon={<Trash2 size={15} />} onClick={() => { showMut('Quitar música', (sh) => { sh.music = sh.music.filter((x) => x.id !== m.id); }); set({ musicId: null }); }}>Quitar música</Button>
    </div>
  );
}

