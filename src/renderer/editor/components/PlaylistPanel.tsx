/**
 * Listas de reproducción: varios espectáculos encadenados que se reproducen uno tras otro con la misma calibración.
 * La lista aparece en el selector de «Espectáculo en el proyector» (con ☰) y se puede grabar como vídeo.
 */
import { useMemo, useState } from 'react';
import { ListMusic, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { useStore } from '../store';
import { Button, Field, NumberInput, Panel, Select, TextInput, Toggle, confirmDialog, promptDialog } from './ui';
import { newId } from '../../../shared/ids';
import { layoutShow, formatTime } from '../../../shared/timeline';
import { playlistToShow } from '../../../shared/playlist';
import type { Playlist } from '../../../shared/model';

export function PlaylistPanel() {
  const project = useStore((s) => s.project)!;
  const update = useStore((s) => s.update);
  const [sel, setSel] = useState<string>(project.playlists[0]?.id ?? '');
  const pl = project.playlists.find((p) => p.id === sel) ?? project.playlists[0] ?? null;
  const total = useMemo(() => {
    const s = pl ? playlistToShow(project, pl) : null;
    return s ? layoutShow(s).duration : 0;
  }, [project, pl]);

  const mut = (label: string, fn: (p: Playlist) => void) => {
    if (!pl) return;
    update(label, (d) => { const x = d.playlists.find((q) => q.id === pl.id); if (x) fn(x); });
  };
  const nueva = async () => {
    const name = await promptDialog('Nueva lista de reproducción', 'Mi lista', 'Nombre de la lista');
    if (!name) return;
    const id = newId('lst');
    update('Nueva lista de reproducción', (d) => { d.playlists.push({ id, name, items: [], loop: false, loopGap: 3 }); });
    setSel(id);
  };
  const borrar = async () => {
    if (!pl || !(await confirmDialog('Eliminar lista', `¿Eliminar la lista «${pl.name}»? Los espectáculos no se borran.`, 'Eliminar', true))) return;
    update('Eliminar lista', (d) => { d.playlists = d.playlists.filter((q) => q.id !== pl.id); });
    setSel('');
  };
  const showName = (id: string) => project.shows.find((s) => s.id === id)?.name ?? '(espectáculo que ya no existe)';

  return (
    <Panel title={<span><ListMusic size={15} /> Lista de reproducción (encadenar espectáculos)</span>} actions={<Button small icon={<Plus size={14} />} onClick={() => void nueva()} data-testid="playlist-new">Nueva lista</Button>}>
      {!pl ? (
        <p className="muted small">Crea una lista para que varios espectáculos se reproduzcan seguidos, con la misma calibración. Después la eliges en «Espectáculo en el proyector» (aparecen con ☰).</p>
      ) : (
        <>
          <div className="row2">
            {project.playlists.length > 1 ? (
              <Field label="Lista"><Select value={pl.id} onChange={setSel} options={project.playlists.map((p) => ({ value: p.id, label: p.name }))} /></Field>
            ) : <span />}
            <Field label="Nombre"><TextInput value={pl.name} onCommit={(v) => mut('Renombrar lista', (x) => { x.name = v || x.name; })} data-testid="playlist-name" /></Field>
          </div>
          <div className="row2">
            <Toggle checked={pl.loop} onChange={(v) => mut('Repetir lista', (x) => { x.loop = v; })} label="Volver a empezar al terminar" data-testid="playlist-loop" />
            {pl.loop && <Field label="Pausa entre vueltas"><NumberInput value={pl.loopGap} min={0} max={120} step={1} suffix="s" onCommit={(v) => mut('Pausa de la lista', (x) => { x.loopGap = v; })} /></Field>}
          </div>
          {pl.items.length === 0 && <p className="muted small">Añade espectáculos con el selector de abajo.</p>}
          {pl.items.map((it, i) => (
            <div key={i} className="playlist-item" data-testid={`playlist-item-${i}`}>
              <b>{i + 1}.</b> <span>{showName(it.showId)}</span>
              <div className="row2">
                <Toggle checked={it.skipFirstScene && i > 0} onChange={(v) => mut('Saltar la espera', (x) => { x.items[i].skipFirstScene = v; })} label="Saltar su escena de espera" />
                {i > 0 && <Field label="Pausa antes"><NumberInput value={it.gap} min={0} max={120} step={1} suffix="s" onCommit={(v) => mut('Pausa antes', (x) => { x.items[i].gap = v; })} /></Field>}
              </div>
              <div className="btn-row">
                <Button small icon={<ArrowUp size={13} />} disabled={i === 0} title="Subir" onClick={() => mut('Subir en la lista', (x) => { const [a] = x.items.splice(i, 1); x.items.splice(i - 1, 0, a); })} />
                <Button small icon={<ArrowDown size={13} />} disabled={i === pl.items.length - 1} title="Bajar" onClick={() => mut('Bajar en la lista', (x) => { const [a] = x.items.splice(i, 1); x.items.splice(i + 1, 0, a); })} />
                <Button small icon={<Trash2 size={13} />} title="Quitar de la lista" onClick={() => mut('Quitar de la lista', (x) => { x.items.splice(i, 1); })} />
              </div>
            </div>
          ))}
          <Field label="Añadir espectáculo">
            <Select
              value=""
              onChange={(v) => { if (v) mut('Añadir a la lista', (x) => { x.items.push({ showId: v, skipFirstScene: x.items.length > 0, gap: x.items.length > 0 ? 2 : 0 }); }); }}
              options={[{ value: '', label: 'Elige un espectáculo…' }, ...project.shows.map((s) => ({ value: s.id, label: s.name }))]}
              data-testid="playlist-add"
            />
          </Field>
          <p className="muted small">Duración total: {formatTime(total)}. Los espectáculos que se añaden después del primero saltan su escena de espera y dejan 2 s de pausa en negro, pero se puede cambiar. La música de cada uno empieza con él.</p>
          <div className="btn-row"><Button small icon={<Trash2 size={14} />} onClick={() => void borrar()}>Eliminar lista</Button></div>
        </>
      )}
    </Panel>
  );
}
