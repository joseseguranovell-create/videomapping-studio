/** Biblioteca de recursos del proyecto + paquetes reutilizables. */
import React, { useEffect, useMemo, useState } from 'react';
import { Upload, Film, Image as ImageIcon, Music, Layers, Search, AlertTriangle, Trash2, FolderSearch, FolderOpen, Package, PackagePlus, Sparkles, Eraser } from 'lucide-react';
import { useStore } from '../store';
import { importAssets, importSequence, relinkAsset, assetUsage, addPackToProject, vm, errMsg, unusedAssetIds, refreshMissing } from '../services';
import { Button, Field, TextInput, NumberInput, Panel, Empty, Badge, Modal, confirmDialog, formatBytes, Toggle } from '../components/ui';
import type { Asset, AssetKind } from '../../../shared/model';
import type { PackInfo } from '../../../shared/pack';
import { formatTime } from '../../../shared/timeline';

const KIND_ICON: Record<AssetKind, React.ReactNode> = {
  image: <ImageIcon size={14} />,
  video: <Film size={14} />,
  audio: <Music size={14} />,
  sequence: <Layers size={14} />,
};
const KIND_LABEL: Record<AssetKind, string> = { image: 'Imagen', video: 'Vídeo', audio: 'Audio', sequence: 'Secuencia' };

export function AssetThumb({ a, missing }: { a: Asset; missing?: boolean }) {
  return (
    <div className={`thumb${a.hasAlpha ? ' checker' : ''}`}>
      {a.thumbnail ? <img src={a.thumbnail} alt="" draggable={false} /> : <span className="thumb-ico">{KIND_ICON[a.kind]}</span>}
      {missing && <span className="thumb-missing"><AlertTriangle size={16} /></span>}
    </div>
  );
}

export function LibraryScreen() {
  const project = useStore((s) => s.project)!;
  const missing = useStore((s) => s.missing);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<AssetKind | 'all'>('all');
  const [coll, setColl] = useState<string>('');
  const [sel, setSel] = useState<string | null>(null);
  const [packsOpen, setPacksOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const update = useStore((s) => s.update);
  const toast = useStore((s) => s.toast);

  useEffect(() => { void refreshMissing(); }, []);

  const collections = useMemo(() => {
    const set = new Set<string>(project.collections);
    project.assets.forEach((a) => a.collections.forEach((c) => set.add(c)));
    return [...set].sort();
  }, [project]);

  const list = project.assets.filter((a) => {
    if (kind !== 'all' && a.kind !== kind) return false;
    if (coll && !a.collections.includes(coll)) return false;
    if (q) {
      const s = q.toLowerCase();
      return a.name.toLowerCase().includes(s) || a.tags.some((t) => t.toLowerCase().includes(s));
    }
    return true;
  });
  const asset = project.assets.find((a) => a.id === sel) ?? null;

  return (
    <div className="screen library">
      <section className="center-col">
        <div className="toolbar">
          <div className="group">
            <Button variant="primary" icon={<Upload size={15} />} onClick={() => void importAssets()} data-testid="import-assets">Importar archivos…</Button>
            <Button icon={<Layers size={15} />} onClick={() => void importSequence()} title="Carpeta con imágenes PNG numeradas (admite transparencia)">Importar secuencia…</Button>
            <Button icon={<Package size={15} />} onClick={() => setPacksOpen(true)} data-testid="open-packs">Paquetes…</Button>
            <Button icon={<PackagePlus size={15} />} onClick={() => setExportOpen(true)} title="Exportar recursos y personajes como paquete reutilizable">Exportar paquete…</Button>
          </div>
          <div className="group right">
            <span className="search"><Search size={14} /><input placeholder="Buscar por nombre o etiqueta" value={q} onChange={(e) => setQ(e.target.value)} data-testid="asset-search" /></span>
            <select value={kind} onChange={(e) => setKind(e.target.value as AssetKind | 'all')}>
              <option value="all">Todos los tipos</option>
              <option value="image">Imágenes</option>
              <option value="video">Vídeos</option>
              <option value="sequence">Secuencias</option>
              <option value="audio">Audio</option>
            </select>
            <select value={coll} onChange={(e) => setColl(e.target.value)}>
              <option value="">Todas las colecciones</option>
              {collections.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        {missing.length > 0 && (
          <div className="banner warn"><AlertTriangle size={16} /> Faltan {missing.length} archivo(s). Selecciona los marcados y usa «Localizar archivo…».</div>
        )}
        {project.assets.length === 0 ? (
          <Empty icon={<ImageIcon size={40} />} title="La biblioteca está vacía">
            Importa vídeos (MP4, WebM), imágenes (PNG, SVG, JPG), secuencias PNG o audio (MP3, WAV, OGG), o añade un paquete de contenido.
          </Empty>
        ) : (
          <div className="asset-grid" data-testid="asset-grid">
            {list.map((a) => (
              <button key={a.id} className={`asset-card${a.id === sel ? ' sel' : ''}`} onClick={() => setSel(a.id)} data-testid="asset-card">
                <AssetThumb a={a} missing={missing.includes(a.id)} />
                <div className="asset-name" title={a.name}>{a.name}</div>
                <div className="asset-meta">
                  {KIND_ICON[a.kind]} {KIND_LABEL[a.kind]}
                  {a.duration ? ` · ${formatTime(a.duration)}` : ''}
                  {a.hasAlpha ? <Badge tone="accent" title="Tiene transparencia">α</Badge> : null}
                </div>
              </button>
            ))}
            {list.length === 0 && <div className="muted">Ningún recurso coincide con el filtro.</div>}
          </div>
        )}
      </section>
      <aside className="side right">
        {asset ? (
          <AssetDetails a={asset} missing={missing.includes(asset.id)} onDeleted={() => setSel(null)} />
        ) : (
          <Panel title="Detalles">
            <p className="muted small">Selecciona un recurso para ver sus propiedades, etiquetas y uso.</p>
            <h4 className="sub">Formatos recomendados</h4>
            <ul className="tips">
              <li><b>Personajes con transparencia</b>: WebM VP9 con canal alfa, PNG o secuencia de PNG.</li>
              <li><b>Fondos y escenas completas</b>: MP4 H.264 (no admite transparencia).</li>
              <li><b>Ilustraciones</b>: SVG o PNG grandes (se ven nítidos al proyectar).</li>
              <li><b>Audio</b>: MP3, OGG o WAV.</li>
              <li>MOV ProRes y HEVC con alfa no se pueden reproducir: conviértelos a WebM VP9 (ver guía).</li>
            </ul>
            <div className="btn-row">
              <Button
                small
                icon={<Eraser size={14} />}
                onClick={async () => {
                  const ids = unusedAssetIds(project);
                  if (!ids.length) { toast('info', 'No hay recursos sin usar.'); return; }
                  if (!(await confirmDialog('Quitar recursos sin usar', `Se quitarán ${ids.length} recurso(s) del proyecto que no usa ningún espectáculo ni personaje. Los archivos permanecen en la carpeta del proyecto.`, 'Quitar', true))) return;
                  update('Quitar recursos sin usar', (d) => { d.assets = d.assets.filter((a) => !ids.includes(a.id)); });
                }}
              >
                Quitar no usados
              </Button>
            </div>
          </Panel>
        )}
      </aside>
      {packsOpen && <PacksModal onClose={() => setPacksOpen(false)} />}
      {exportOpen && <ExportPackModal onClose={() => setExportOpen(false)} />}
    </div>
  );
}

function AssetDetails({ a, missing, onDeleted }: { a: Asset; missing: boolean; onDeleted: () => void }) {
  const project = useStore((s) => s.project)!;
  const update = useStore((s) => s.update);
  const mut = (label: string, fn: (x: Asset) => void) => update(label, (d) => { const x = d.assets.find((y) => y.id === a.id); if (x) fn(x); });
  const usage = assetUsage(project, a.id);
  const toList = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean);
  return (
    <div className="inspector" data-testid="asset-details">
      <Panel title="Recurso">
        <div className="detail-thumb"><AssetThumb a={a} missing={missing} /></div>
        {missing && <div className="banner error small"><AlertTriangle size={14} /> Falta el archivo: {a.file}</div>}
        <Field label="Nombre"><TextInput value={a.name} onCommit={(v) => mut('Renombrar recurso', (x) => { x.name = v; })} /></Field>
        <Field label="Etiquetas" hint="Separadas por comas"><TextInput value={a.tags.join(', ')} onCommit={(v) => mut('Etiquetas', (x) => { x.tags = toList(v); })} /></Field>
        <Field label="Colecciones" hint="Separadas por comas (p. ej. «Halloween, Infantil»)"><TextInput value={a.collections.join(', ')} onCommit={(v) => mut('Colecciones', (x) => { x.collections = toList(v); })} /></Field>
        <Field label="Licencia / procedencia"><TextInput value={a.license} onCommit={(v) => mut('Licencia', (x) => { x.license = v; })} placeholder="CC0, generado con…, comprado en…" /></Field>
        {a.kind === 'sequence' && (
          <Field label="Fotogramas por segundo">
            <NumberInput value={a.fps} min={1} max={120} step={1} precision={0} onCommit={(v) => mut('FPS', (x) => { x.fps = v; x.duration = x.frames.length / v; })} />
          </Field>
        )}
        <Toggle checked={!!a.hasAlpha} onChange={(v) => mut('Transparencia', (x) => { x.hasAlpha = v; })} label="Tiene transparencia" />
      </Panel>
      <Panel title="Información">
        <dl className="info">
          <dt>Tipo</dt><dd>{KIND_LABEL[a.kind]} ({a.format || '—'})</dd>
          <dt>Resolución</dt><dd>{a.width && a.height ? `${a.width} × ${a.height} (${(a.width / a.height).toFixed(2)}:1)` : '—'}</dd>
          <dt>Duración</dt><dd>{a.duration ? formatTime(a.duration) : '—'}</dd>
          {a.kind === 'sequence' && (<><dt>Fotogramas</dt><dd>{a.frames.length}</dd></>)}
          <dt>Tamaño</dt><dd>{formatBytes(a.size)}</dd>
          <dt>Transparencia</dt><dd>{a.hasAlpha === null ? 'Desconocida' : a.hasAlpha ? 'Sí' : 'No'}</dd>
          <dt>Archivo</dt><dd className="path">{a.file}</dd>
          <dt>Origen</dt><dd>{a.source || '—'}</dd>
          <dt>Uso</dt><dd>{usage ? `${usage} vez/veces` : 'Sin usar'}</dd>
        </dl>
        {a.kind === 'video' && a.format === 'mp4' && <p className="muted small">Los MP4 no tienen transparencia: el fondo del vídeo se proyectará. Para personajes recortados usa WebM con alfa o PNG.</p>}
        {a.kind === 'video' && (a.format === 'mov' || a.format === 'mkv') && <p className="warn-text small">MOV/MKV pueden no reproducirse según el códec. Si no ves el vídeo, conviértelo a MP4 H.264 o WebM VP9.</p>}
      </Panel>
      <div className="btn-col">
        <Button icon={<FolderSearch size={15} />} onClick={() => void relinkAsset(a.id)} data-testid="relink-asset">Localizar / reemplazar archivo…</Button>
        <Button icon={<FolderOpen size={15} />} disabled={missing} onClick={() => void vm.assets.reveal(a.file)}>Mostrar en la carpeta</Button>
        <Button
          variant="danger"
          icon={<Trash2 size={15} />}
          onClick={async () => {
            const msg = usage ? `Este recurso se usa ${usage} vez/veces en espectáculos o personajes; esos clips dejarán de verse.` : 'El archivo permanece en la carpeta del proyecto. Puedes deshacerlo con Ctrl+Z.';
            if (!(await confirmDialog(`Quitar «${a.name}»`, msg, 'Quitar', true))) return;
            update('Quitar recurso', (d) => { d.assets = d.assets.filter((x) => x.id !== a.id); });
            onDeleted();
          }}
        >
          Quitar del proyecto
        </Button>
      </div>
    </div>
  );
}

function PacksModal({ onClose }: { onClose: () => void }) {
  const [packs, setPacks] = useState<PackInfo[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [withShows, setWithShows] = useState(false);
  const toast = useStore((s) => s.toast);
  const load = async () => {
    const r = await vm.packs.list();
    setPacks(r.packs);
    setErrors(r.errors);
  };
  useEffect(() => { void load(); }, []);
  return (
    <Modal title="Paquetes de contenido" onClose={onClose} wide>
      <p className="muted small">Los paquetes reúnen personajes, animaciones, sonidos y espectáculos de ejemplo reutilizables. Al añadirlos, sus archivos se copian dentro del proyecto.</p>
      <Toggle checked={withShows} onChange={setWithShows} label="Incluir instalaciones y espectáculos de ejemplo del paquete" />
      {packs === null ? <p>Cargando…</p> : packs.length === 0 ? <Empty title="No hay paquetes" /> : (
        <ul className="packs">
          {packs.map((p) => (
            <li key={p.id}>
              <div>
                <div className="pack-name"><Sparkles size={14} /> {p.name} <span className="muted small">v{p.version}{p.builtIn ? ' · incluido' : ' · usuario'}</span></div>
                <div className="pack-desc">{p.description}</div>
                <div className="pack-meta">{p.characterCount} personajes · {p.assetCount} recursos · {p.showCount} espectáculos{p.license ? ` · Licencia: ${p.license}` : ''}</div>
              </div>
              <Button variant="primary" onClick={async () => { await addPackToProject(p.id, withShows); onClose(); }} data-testid={`add-pack-${p.id}`}>Añadir al proyecto</Button>
            </li>
          ))}
        </ul>
      )}
      {errors.map((e, i) => <div key={i} className="banner error small">{e}</div>)}
      <div className="btn-row">
        <Button icon={<FolderOpen size={15} />} onClick={async () => {
          try { const p = await vm.packs.importPackFolder(); if (p) { toast('success', `Paquete «${p.name}» instalado`); void load(); } } catch (e) { toast('error', errMsg(e), 8000); }
        }}>Instalar paquete desde carpeta…</Button>
        <Button onClick={() => void vm.packs.openUserPacksFolder()}>Abrir carpeta de paquetes</Button>
      </div>
    </Modal>
  );
}

function ExportPackModal({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project)!;
  const toast = useStore((s) => s.toast);
  const [name, setName] = useState(`${project.name} – recursos`);
  const [desc, setDesc] = useState('');
  const [chars, setChars] = useState<string[]>(project.characters.map((c) => c.id));
  const [assets, setAssets] = useState<string[]>([]);
  const [shows, setShows] = useState<string[]>([]);
  const toggle = (arr: string[], id: string, set: (v: string[]) => void) => set(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
  return (
    <Modal
      title="Exportar paquete reutilizable"
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            disabled={!name.trim()}
            onClick={async () => {
              try {
                const dir = await vm.packs.exportPack(project, { name: name.trim(), description: desc, assetIds: assets, characterIds: chars, includeShows: shows });
                if (dir) toast('success', `Paquete exportado en ${dir}`, 8000);
                onClose();
              } catch (e) {
                toast('error', errMsg(e), 8000);
              }
            }}
          >
            Exportar
          </Button>
        </>
      }
    >
      <Field label="Nombre del paquete"><input className="full" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Descripción"><input className="full" value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
      <div className="cols3">
        <div>
          <h4 className="sub">Personajes</h4>
          {project.characters.map((c) => <Toggle key={c.id} checked={chars.includes(c.id)} onChange={() => toggle(chars, c.id, setChars)} label={c.name} />)}
        </div>
        <div>
          <h4 className="sub">Recursos sueltos</h4>
          <div className="scroll-list">{project.assets.map((a) => <Toggle key={a.id} checked={assets.includes(a.id)} onChange={() => toggle(assets, a.id, setAssets)} label={a.name} />)}</div>
        </div>
        <div>
          <h4 className="sub">Espectáculos (como plantilla)</h4>
          {project.shows.map((s) => <Toggle key={s.id} checked={shows.includes(s.id)} onChange={() => toggle(shows, s.id, setShows)} label={s.name} />)}
        </div>
      </div>
      <p className="muted small">Los recursos usados por los personajes y espectáculos elegidos se incluyen automáticamente. El paquete se guarda en la carpeta de paquetes del usuario.</p>
    </Modal>
  );
}
