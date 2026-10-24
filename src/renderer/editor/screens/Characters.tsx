/** Biblioteca de personajes: un personaje agrupa varias animaciones (recurso + movimiento). */
import { useState } from 'react';
import { Plus, Trash2, Copy, Ghost, Image as ImageIcon, Film } from 'lucide-react';
import { useStore } from '../store';
import { Button, Field, TextInput, NumberInput, Select, Toggle, Panel, Empty, confirmDialog, promptDialog } from '../components/ui';
import { AssetPicker, ClipPreview } from '../components/pickers';
import { AssetThumb } from './Library';
import { createCharacter, createClip, cloneDeep } from '../../../shared/factory';
import { newId } from '../../../shared/ids';
import { MOTION_PRESETS, MOTION_LABELS, type Character, type CharacterAnimation } from '../../../shared/model';

export function CharactersScreen() {
  const project = useStore((s) => s.project)!;
  const update = useStore((s) => s.update);
  const [sel, setSel] = useState<string | null>(project.characters[0]?.id ?? null);
  const ch = project.characters.find((c) => c.id === sel) ?? null;

  return (
    <div className="screen characters">
      <aside className="side left">
        <Panel
          title={`Personajes (${project.characters.length})`}
          className="grow"
          actions={
            <Button
              small
              variant="ghost"
              icon={<Plus size={15} />}
              title="Nuevo personaje"
              data-testid="new-character"
              onClick={async () => {
                const name = await promptDialog('Nuevo personaje', 'Fantasma');
                if (!name) return;
                const c = createCharacter(name);
                update('Nuevo personaje', (d) => { d.characters.push(c); });
                setSel(c.id);
              }}
            />
          }
        >
          {project.characters.length === 0 ? (
            <p className="muted small">Un personaje agrupa sus animaciones (aparecer, saludar, saltar…). Crea uno o añade el paquete de Halloween desde la Biblioteca.</p>
          ) : (
            <ul className="char-list">
              {project.characters.map((c) => {
                const ref = project.assets.find((a) => a.id === (c.referenceAssetId ?? c.animations[0]?.assetId));
                return (
                  <li key={c.id} className={c.id === sel ? 'sel' : ''} onClick={() => setSel(c.id)}>
                    {ref ? <AssetThumb a={ref} /> : <div className="thumb"><Ghost size={18} /></div>}
                    <div>
                      <div className="name">{c.name}</div>
                      <div className="muted small">{c.animations.length} animaciones</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </aside>
      <section className="center-col scroll">
        {ch ? <CharacterEditor ch={ch} onDeleted={() => setSel(null)} /> : (
          <Empty icon={<Ghost size={40} />} title="Selecciona o crea un personaje">
            Los personajes se pueden añadir a cualquier escena con una de sus animaciones.
          </Empty>
        )}
      </section>
    </div>
  );
}

function CharacterEditor({ ch, onDeleted }: { ch: Character; onDeleted: () => void }) {
  const project = useStore((s) => s.project)!;
  const update = useStore((s) => s.update);
  const [picker, setPicker] = useState<null | { for: 'ref' } | { for: 'anim'; animId: string | null }>(null);
  const [selAnim, setSelAnim] = useState<string | null>(ch.animations[0]?.id ?? null);
  const mut = (label: string, fn: (c: Character) => void) => update(label, (d) => { const c = d.characters.find((x) => x.id === ch.id); if (c) fn(c); });
  const mutAnim = (id: string, label: string, fn: (a: CharacterAnimation) => void) => mut(label, (c) => { const a = c.animations.find((x) => x.id === id); if (a) fn(a); });
  const anim = ch.animations.find((a) => a.id === selAnim) ?? null;
  const refAsset = project.assets.find((a) => a.id === ch.referenceAssetId);

  return (
    <div className="char-editor">
      <div className="char-head">
        <div className="char-ref" onClick={() => setPicker({ for: 'ref' })} title="Imagen de referencia">
          {refAsset ? <AssetThumb a={refAsset} /> : <div className="thumb"><ImageIcon size={22} /></div>}
        </div>
        <div className="grow">
          <Field label="Nombre"><TextInput value={ch.name} onCommit={(v) => mut('Renombrar personaje', (c) => { c.name = v; })} /></Field>
          <Field label="Descripción"><TextInput value={ch.description} onCommit={(v) => mut('Descripción', (c) => { c.description = v; })} placeholder="Personalidad, estilo, notas de uso…" /></Field>
          <Field label="Etiquetas" hint="Separadas por comas"><TextInput value={ch.tags.join(', ')} onCommit={(v) => mut('Etiquetas', (c) => { c.tags = v.split(',').map((x) => x.trim()).filter(Boolean); })} /></Field>
        </div>
        <div className="btn-col">
          <Button
            icon={<Copy size={15} />}
            onClick={() => {
              const c = cloneDeep(ch);
              c.id = newId('chr');
              c.name = `${ch.name} (variante)`;
              c.animations = c.animations.map((a) => ({ ...a, id: newId('anm') }));
              update('Duplicar personaje', (d) => { d.characters.push(c); });
            }}
          >
            Crear variante
          </Button>
          <Button
            variant="danger"
            icon={<Trash2 size={15} />}
            onClick={async () => {
              if (!(await confirmDialog(`Eliminar «${ch.name}»`, 'Los clips ya colocados en escenas se conservan (usan directamente sus recursos).', 'Eliminar', true))) return;
              update('Eliminar personaje', (d) => { d.characters = d.characters.filter((c) => c.id !== ch.id); });
              onDeleted();
            }}
          >
            Eliminar
          </Button>
        </div>
      </div>

      <Panel
        title="Animaciones"
        actions={<Button small icon={<Plus size={14} />} onClick={() => setPicker({ for: 'anim', animId: null })} data-testid="add-animation">Añadir animación</Button>}
      >
        {ch.animations.length === 0 ? (
          <p className="muted small">Cada animación es un recurso (imagen, vídeo o secuencia) con un movimiento opcional. Un mismo dibujo puede tener varias: «aparece», «saluda», «salta»…</p>
        ) : (
          <div className="anim-layout">
            <ul className="anim-list">
              {ch.animations.map((a) => {
                const as = project.assets.find((x) => x.id === a.assetId);
                return (
                  <li key={a.id} className={a.id === selAnim ? 'sel' : ''} onClick={() => setSelAnim(a.id)}>
                    {as ? <AssetThumb a={as} /> : <div className="thumb"><Film size={16} /></div>}
                    <div>
                      <div className="name">{a.name}</div>
                      <div className="muted small">{MOTION_LABELS[a.motion.preset]} · {a.duration}s{a.loop ? ' · bucle' : ''}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
            {anim && (
              <div className="anim-detail">
                <ClipPreview
                  clip={createClip('x', { type: 'asset', assetId: anim.assetId }, { id: `prev-${anim.id}`, duration: anim.duration, loop: anim.loop, motion: anim.motion, fit: anim.fit, scale: anim.scale, fadeIn: 0.3, fadeOut: 0.3 })}
                  aspect={4 / 3}
                  height={220}
                />
                <div className="form-grid">
                  <Field label="Nombre"><TextInput value={anim.name} onCommit={(v) => mutAnim(anim.id, 'Renombrar animación', (a) => { a.name = v; })} /></Field>
                  <Field label="Recurso">
                    <Button small onClick={() => setPicker({ for: 'anim', animId: anim.id })}>{project.assets.find((x) => x.id === anim.assetId)?.name ?? '(falta)'} …</Button>
                  </Field>
                  <Field label="Movimiento">
                    <Select value={anim.motion.preset} onChange={(v) => mutAnim(anim.id, 'Movimiento', (a) => { a.motion.preset = v; })} options={MOTION_PRESETS.map((m) => ({ value: m, label: MOTION_LABELS[m] }))} />
                  </Field>
                  <Field label="Intensidad"><NumberInput value={anim.motion.intensity} min={0} max={3} step={0.1} onCommit={(v) => mutAnim(anim.id, 'Intensidad', (a) => { a.motion.intensity = v; })} /></Field>
                  <Field label="Velocidad"><NumberInput value={anim.motion.speed} min={0.05} max={10} step={0.1} onCommit={(v) => mutAnim(anim.id, 'Velocidad', (a) => { a.motion.speed = v; })} /></Field>
                  <Field label="Duración"><NumberInput value={anim.duration} min={0.2} max={600} step={0.5} suffix="s" onCommit={(v) => mutAnim(anim.id, 'Duración', (a) => { a.duration = v; })} /></Field>
                  <Field label="Escala"><NumberInput value={anim.scale} min={0.05} max={5} step={0.05} onCommit={(v) => mutAnim(anim.id, 'Escala', (a) => { a.scale = v; })} /></Field>
                  <Field label="Ajuste">
                    <Select value={anim.fit} onChange={(v) => mutAnim(anim.id, 'Ajuste', (a) => { a.fit = v; })} options={[{ value: 'contain', label: 'Encajar' }, { value: 'cover', label: 'Cubrir' }, { value: 'stretch', label: 'Estirar' }]} />
                  </Field>
                  <Toggle checked={anim.loop} onChange={(v) => mutAnim(anim.id, 'Bucle', (a) => { a.loop = v; })} label="Repetir en bucle" />
                </div>
                <Button small variant="danger" icon={<Trash2 size={14} />} onClick={() => { mut('Eliminar animación', (c) => { c.animations = c.animations.filter((a) => a.id !== anim.id); }); setSelAnim(null); }}>Eliminar animación</Button>
              </div>
            )}
          </div>
        )}
      </Panel>

      {picker && (
        <AssetPicker
          kinds={picker.for === 'ref' ? ['image', 'video', 'sequence'] : ['image', 'video', 'sequence']}
          title={picker.for === 'ref' ? 'Imagen de referencia' : 'Recurso de la animación'}
          onClose={() => setPicker(null)}
          onPick={(id) => {
            if (picker.for === 'ref') mut('Imagen de referencia', (c) => { c.referenceAssetId = id; });
            else if (picker.animId) mutAnim(picker.animId, 'Cambiar recurso', (a) => { a.assetId = id; });
            else {
              const asset = project.assets.find((a) => a.id === id)!;
              const a: CharacterAnimation = {
                id: newId('anm'),
                name: asset.name,
                assetId: id,
                motion: { preset: 'float', intensity: 1, speed: 1 },
                duration: asset.duration && asset.kind !== 'image' ? Math.round(asset.duration * 10) / 10 : 4,
                loop: true,
                fit: 'contain',
                scale: 0.8,
              };
              mut('Añadir animación', (c) => { c.animations.push(a); if (!c.referenceAssetId) c.referenceAssetId = id; });
              setSelAnim(a.id);
            }
            setPicker(null);
          }}
        />
      )}
    </div>
  );
}
