/** Selector de recursos y vista previa aislada de un clip/animación. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Upload } from 'lucide-react';
import { useStore, mediaBase } from '../store';
import { importAssets, registerPlayerInvalidator } from '../services';
import { Button, Modal } from './ui';
import { AssetThumb } from '../screens/Library';
import type { AssetKind, Clip, Project } from '../../../shared/model';
import { Player } from '../../engine/player';
import { createInstallation, createScene, createShow, createSurface } from '../../../shared/factory';

export function AssetPicker({ kinds, title, onPick, onClose }: { kinds: AssetKind[]; title: string; onPick: (id: string) => void; onClose: () => void }) {
  const project = useStore((s) => s.project)!;
  const missing = useStore((s) => s.missing);
  const [q, setQ] = useState('');
  const list = project.assets.filter((a) => kinds.includes(a.kind) && (!q || a.name.toLowerCase().includes(q.toLowerCase()) || a.tags.some((t) => t.toLowerCase().includes(q.toLowerCase()))));
  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="toolbar">
        <span className="search"><Search size={14} /><input autoFocus placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /></span>
        <Button icon={<Upload size={15} />} onClick={async () => { const a = await importAssets(); const ok = a.filter((x) => kinds.includes(x.kind)); if (ok.length === 1) onPick(ok[0].id); }}>Importar…</Button>
      </div>
      <div className="asset-grid picker" data-testid="asset-picker">
        {list.map((a) => (
          <button key={a.id} className="asset-card" onClick={() => onPick(a.id)} data-testid="pick-asset">
            <AssetThumb a={a} missing={missing.includes(a.id)} />
            <div className="asset-name" title={a.name}>{a.name}</div>
          </button>
        ))}
        {list.length === 0 && <div className="muted">No hay recursos de este tipo. Impórtalos primero.</div>}
      </div>
    </Modal>
  );
}

/**
 * Vista previa de un único clip sobre una superficie virtual, usando el mismo motor que la salida.
 */
export function ClipPreview({ clip, aspect = 16 / 9, height = 200 }: { clip: Clip; aspect?: number; height?: number }) {
  const project = useStore((s) => s.project)!;
  const projectKey = useStore((s) => s.projectKey);
  const ref = useRef<HTMLCanvasElement>(null);
  const player = useRef<Player | null>(null);

  const synthetic: Project = useMemo(() => {
    const inst = createInstallation('preview', { width: Math.round(480 * aspect), height: 480 });
    inst.id = 'preview-inst';
    const s = createSurface('preview', 'window', 0, { x: 0, y: 0, w: 1, h: 1 });
    s.id = 'preview-surface';
    s.color = '#222';
    inst.surfaces = [s];
    const show = createShow('preview', inst.id);
    show.id = 'preview-show';
    show.loopGap = 0.4;
    const sc = createScene('preview', clip.duration);
    sc.transition = { type: 'cut', duration: 0 };
    sc.clips = [{ ...clip, start: 0, surfaceId: s.id }];
    show.scenes = [sc];
    return { ...project, installations: [inst], shows: [show] };
  }, [project, clip, aspect]);

  useEffect(() => {
    if (!ref.current) return;
    let p: Player;
    try {
      p = new Player(ref.current, { audio: false, showMissing: true, maxWidth: 640 });
    } catch {
      return;
    }
    player.current = p;
    p.start();
    const off = registerPlayerInvalidator((id) => p.invalidateAsset(id));
    return () => { off(); p.dispose(); player.current = null; };
  }, []);

  useEffect(() => {
    const p = player.current;
    if (!p) return;
    p.setProject(synthetic, mediaBase(), projectKey);
    p.setMode({ kind: 'show', showId: 'preview-show' });
    void p.play();
  }, [synthetic, projectKey]);

  return <canvas ref={ref} className="clip-preview checker" style={{ height, aspectRatio: String(aspect) }} />;
}
