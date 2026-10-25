/** Asistente de espectáculos: elige estilo, protagonistas y duración, y compone el espectáculo entero. */
import { useMemo, useState } from 'react';
import { Wand2 } from 'lucide-react';
import { useStore } from '../store';
import { Button, Field, Modal, Select, TextInput, NumberInput } from './ui';
import { AssetThumb } from '../screens/Library';
import { addPackToProject } from '../services';
import { generateShow, soundKitFrom, defaultMusic, SHOW_STYLES, SHOW_STYLE_LABELS, type ShowStyle, type Protagonist } from '../../../shared/generator';
import type { Asset, Project } from '../../../shared/model';

const STYLE_HELP: Record<ShowStyle, string> = {
  infantil: 'Oscuro pero amable: velas, ojos que parpadean, contornos naranjas y morados, tormenta suave y luces de feria al final.',
  terror: 'Para dar miedo: luz fría, sustos con golpe de sonido, cristales rotos, ojos rojos y todos los personajes a la vez al final.',
  navidad: 'Telón que se abre, escarcha, nieve, aurora, sombras que pasan y fuegos artificiales en el final.',
};
const STYLE_TEXT: Record<ShowStyle, string> = { infantil: '¡Feliz Halloween!', terror: 'No estás solo...', navidad: '¡Feliz Navidad!' };
const SOUND_PACK: Record<ShowStyle, string[]> = { infantil: ['halloween-infantil'], terror: ['terror-sonidos', 'halloween-infantil'], navidad: ['halloween-infantil'] };

/** Recursos y personajes que pueden protagonizar una escena. */
export function protagonistOptions(p: Project): { key: string; label: string; asset: Asset; pro: Protagonist }[] {
  const out: { key: string; label: string; asset: Asset; pro: Protagonist }[] = [];
  const byId = new Map(p.assets.map((a) => [a.id, a]));
  const aspectOf = (a: Asset) => (a.width && a.height ? a.width / a.height : 1);
  // El sonido propio de un vídeo se reconoce por el nombre «<vídeo> (sonido)».
  const audioFor = (a: Asset) => p.assets.find((x) => x.kind === 'audio' && x.name === `${a.name} (sonido)`)?.id ?? null;
  for (const a of p.assets) {
    if (a.kind !== 'video') continue;
    out.push({ key: `a:${a.id}`, label: a.name, asset: a, pro: { name: a.name, assetId: a.id, aspect: aspectOf(a), duration: a.duration, audioId: audioFor(a) } });
  }
  for (const c of p.characters) {
    const an = c.animations.find((x) => x.motion.preset !== 'popIn' && x.motion.preset !== 'popOut') ?? c.animations[0];
    const a = an && byId.get(an.assetId);
    if (!an || !a) continue;
    out.push({ key: `c:${c.id}`, label: c.name, asset: a, pro: { name: c.name, assetId: a.id, aspect: aspectOf(a), duration: a.kind === 'video' ? a.duration : null, characterId: c.id, animationId: an.id, motion: an.motion } });
  }
  return out;
}

export function ShowWizard({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project)!;
  const update = useStore((s) => s.update);
  const set = useStore((s) => s.set);
  const toast = useStore((s) => s.toast);
  const [style, setStyle] = useState<ShowStyle>('infantil');
  const [name, setName] = useState('Espectáculo del asistente');
  const [instId, setInstId] = useState(useStore.getState().installationId ?? project.installations[0]?.id ?? '');
  const [duration, setDuration] = useState(120);
  const [finale, setFinale] = useState(STYLE_TEXT.infantil);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const options = useMemo(() => protagonistOptions(project), [project]);
  const toggle = (k: string) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  const run = async () => {
    const inst = project.installations.find((i) => i.id === instId);
    if (!inst || !inst.surfaces.length) { toast('error', 'Elige una instalación con superficies (en Calibración).'); return; }
    setBusy(true);
    try {
      // Se añaden los sonidos incluidos del estilo si el proyecto aún no los tiene.
      for (const pk of SOUND_PACK[style]) {
        const probe = pk === 'terror-sonidos' ? 'tr-ast-golpe' : 'hx-ast-snd-pop';
        if (!useStore.getState().project!.assets.some((a) => a.id === probe)) await addPackToProject(pk, false);
      }
      const p = useStore.getState().project!;
      const sounds = { ...soundKitFrom(p.assets), music: defaultMusic(style, p.assets) };
      const protagonists = picked.map((k) => options.find((o) => o.key === k)?.pro).filter((x): x is Protagonist => !!x);
      const sh = generateShow({ style, name: name.trim() || 'Espectáculo', installation: inst, protagonists, duration, finaleText: finale.trim() || undefined, sounds });
      update(`Asistente: ${sh.name}`, (d) => { d.shows.push(sh); });
      set({ showId: sh.id, sceneId: sh.scenes[0]?.id ?? null, clipId: null, soundId: null, musicId: null });
      toast('success', `«${sh.name}» creado con ${sh.scenes.length} escenas. Revísalo y retócalo a tu gusto.`, 6000);
      onClose();
    } catch (e) {
      toast('error', (e as Error).message, 8000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Asistente de espectáculos" onClose={onClose} wide>
      <div className="wizard">
        <div className="wizard-row">
          <Field label="Estilo">
            <Select value={style} onChange={(v) => { setStyle(v); setFinale(STYLE_TEXT[v]); }} options={SHOW_STYLES.map((s) => ({ value: s, label: SHOW_STYLE_LABELS[s] }))} data-testid="wizard-style" />
          </Field>
          <Field label="Nombre"><TextInput value={name} onCommit={setName} data-testid="wizard-name" /></Field>
          <Field label="Instalación">
            <Select value={instId} onChange={setInstId} options={project.installations.map((i) => ({ value: i.id, label: i.name }))} />
          </Field>
          <Field label="Duración aproximada">
            <NumberInput value={duration} min={60} max={300} step={10} precision={0} suffix="s" onCommit={setDuration} />
          </Field>
        </div>
        <p className="muted small">{STYLE_HELP[style]}</p>
        <Field label="Rótulo del gran final"><TextInput value={finale} onCommit={setFinale} placeholder="Por ejemplo, ¡Feliz Halloween, Leo!" data-testid="wizard-text" /></Field>
        <h4 className="sub">Protagonistas (uno por escena, en orden; vídeos de la biblioteca y personajes)</h4>
        {options.length === 0 ? (
          <p className="muted small">No hay vídeos ni personajes en el proyecto: impórtalos en Biblioteca o añade un paquete. El asistente hará igualmente un espectáculo solo con efectos.</p>
        ) : (
          <div className="wizard-grid">
            {options.map((o) => {
              const n = picked.indexOf(o.key);
              return (
                <button key={o.key} className={`wizard-item${n >= 0 ? ' on' : ''}`} onClick={() => toggle(o.key)} data-testid="wizard-pick">
                  <AssetThumb a={o.asset} />
                  <span className="wizard-label">{n >= 0 && <b>{n + 1}</b>} {o.label}</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="btn-row">
          <Button variant="primary" icon={<Wand2 size={15} />} onClick={() => void run()} disabled={busy} data-testid="wizard-run">{busy ? 'Creando…' : 'Crear espectáculo'}</Button>
          <Button onClick={onClose}>Cancelar</Button>
        </div>
      </div>
    </Modal>
  );
}
