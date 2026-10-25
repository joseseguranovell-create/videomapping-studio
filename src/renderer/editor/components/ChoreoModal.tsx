/** Coreografías entre ventanas: asomarse y pasar a otra, escondite o lanzar en arco. */
import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { Button, Field, Modal, Select, NumberInput } from './ui';
import { AssetThumb } from '../screens/Library';
import { protagonistOptions } from './ShowWizard';
import { choreography, CHOREO_KINDS, CHOREO_INFO, type ChoreoKind } from '../../../shared/choreo';
import { soundKitFrom } from '../../../shared/generator';
import { orderedSurfaces } from '../../../shared/templates';
import type { Show } from '../../../shared/model';
import { createSoundCue } from '../../../shared/factory';

export interface ChoreoPreset {
  kind?: ChoreoKind;
  /** Clave de protagonista (a:<recurso> o c:<personaje>). */
  actor?: string;
  from?: string;
}

export function ChoreoModal({ show, sceneId, start, preset, onClose }: { show: Show; sceneId: string; start: number; preset?: ChoreoPreset; onClose: () => void }) {
  const project = useStore((s) => s.project)!;
  const update = useStore((s) => s.update);
  const set = useStore((s) => s.set);
  const toast = useStore((s) => s.toast);
  const inst = project.installations.find((i) => i.id === show.installationId);
  const stages = useMemo(() => (inst ? orderedSurfaces(inst).filter((s) => s.kind !== 'wall') : []), [inst]);
  const options = useMemo(() => {
    // Además de vídeos y personajes, cualquier imagen de la biblioteca (calabazas, regalos…).
    const base = protagonistOptions(project);
    for (const a of project.assets) if (a.kind === 'image' && !base.some((o) => o.asset.id === a.id)) base.push({ key: `a:${a.id}`, label: a.name, asset: a, pro: { name: a.name, assetId: a.id, aspect: a.width && a.height ? a.width / a.height : 1, duration: null } });
    return base;
  }, [project]);
  const [kind, setKind] = useState<ChoreoKind>(preset?.kind ?? 'pasar');
  const [actor, setActor] = useState(preset?.actor ?? options[0]?.key ?? '');
  const [from, setFrom] = useState(preset?.from ?? stages[0]?.id ?? '');
  const [to, setTo] = useState(stages.find((s) => s.id !== (preset?.from ?? stages[0]?.id))?.id ?? '');
  const [at, setAt] = useState(Math.round(start * 10) / 10);

  const run = () => {
    if (!inst) return;
    const o = options.find((x) => x.key === actor);
    if (!o) { toast('error', 'Elige un protagonista.'); return; }
    const A = inst.surfaces.find((s) => s.id === from), B = inst.surfaces.find((s) => s.id === to);
    const surfaces = kind === 'escondite' ? stages : A && B && A !== B ? [A, B] : [];
    if (!surfaces.length) { toast('error', 'Elige dos superficies distintas.'); return; }
    const k = soundKitFrom(project.assets);
    const r = choreography({
      kind, installation: inst, start: at, surfaces,
      actor: { name: o.label, source: { type: 'asset', assetId: o.asset.id }, aspect: o.pro.aspect, characterId: o.pro.characterId ?? null, animationId: o.pro.animationId ?? null },
      sounds: { whoosh: k.whoosh, pop: k.pop, giggle: k.giggle },
    });
    // Si el protagonista es un vídeo con sonido, suena una vez al empezar la coreografía.
    if (o.asset.kind === 'video') r.sounds.push(createSoundCue(o.pro.audioId ?? o.asset.id, { start: at, volume: 0.9 }));
    update(`Coreografía: ${CHOREO_INFO[kind].name}`, (d) => {
      const sc = d.shows.find((x) => x.id === show.id)?.scenes.find((x) => x.id === sceneId);
      if (!sc) return;
      sc.clips.push(...r.clips);
      sc.sounds.push(...r.sounds);
      if (r.end > sc.duration) sc.duration = Math.ceil(r.end * 2) / 2;
    });
    set({ clipId: r.clips[0]?.id ?? null, soundId: null, musicId: null });
    toast('success', `${CHOREO_INFO[kind].name}: ${r.clips.length} clips añadidos (de ${at.toFixed(1)} s a ${r.end.toFixed(1)} s).`, 4000);
    onClose();
  };

  return (
    <Modal title="Coreografía entre ventanas" onClose={onClose} wide>
      <div className="template-grid">
        {CHOREO_KINDS.map((k) => (
          <button key={k} className={`template-card${k === kind ? ' on' : ''}`} onClick={() => setKind(k)} data-testid={`choreo-${k}`}>
            <b>{CHOREO_INFO[k].name}</b>
            <span>{CHOREO_INFO[k].description}</span>
          </button>
        ))}
      </div>
      <div className="wizard-row" style={{ marginTop: 12 }}>
        {kind !== 'escondite' && <Field label="Desde"><Select value={from} onChange={setFrom} options={stages.map((s) => ({ value: s.id, label: s.name }))} data-testid="choreo-from" /></Field>}
        {kind !== 'escondite' && <Field label="Hasta"><Select value={to} onChange={setTo} options={stages.map((s) => ({ value: s.id, label: s.name }))} data-testid="choreo-to" /></Field>}
        <Field label="Empieza a los"><NumberInput value={at} min={0} max={600} step={0.1} precision={1} suffix="s" onCommit={setAt} /></Field>
      </div>
      <h4 className="sub">Protagonista</h4>
      {options.length === 0 ? <p className="muted small">Importa un vídeo o una imagen, o añade un paquete con personajes.</p> : (
        <div className="wizard-grid">
          {options.map((o) => (
            <button key={o.key} className={`wizard-item${o.key === actor ? ' on' : ''}`} onClick={() => setActor(o.key)} data-testid="choreo-actor">
              <AssetThumb a={o.asset} />
              <span className="wizard-label">{o.label}</span>
            </button>
          ))}
        </div>
      )}
      <div className="btn-row">
        <Button variant="primary" onClick={run} disabled={!options.length} data-testid="choreo-run">Añadir a la escena</Button>
        <Button onClick={onClose}>Cancelar</Button>
      </div>
    </Modal>
  );
}
