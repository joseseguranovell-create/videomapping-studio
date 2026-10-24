/** Pantalla de instalaciones y calibración de superficies. */
import React from 'react';
import {
  Plus, Copy, Trash2, Eye, EyeOff, Lock, Unlock, ChevronUp, ChevronDown, Square, Pentagon, MousePointer2, Grid3x3, Tag,
  Ban, Projector, CheckCircle2, AlertTriangle, Image as ImageIcon, RotateCcw, Shuffle, Focus, Building2,
} from 'lucide-react';
import { useStore, selInstallation, type Pattern } from '../store';
import { SurfaceCanvas } from '../components/SurfaceCanvas';
import { Button, Field, TextInput, NumberInput, Select, Toggle, Panel, Empty, confirmDialog, promptDialog, Slider, formatDate } from '../components/ui';
import { createInstallation, createSurface, duplicateInstallation, cloneDeep } from '../../../shared/factory';
import { newId } from '../../../shared/ids';
import { SURFACE_KINDS, SURFACE_KIND_LABELS, type Installation, type Surface } from '../../../shared/model';
import { orderQuad, quadFromBBox, rescaleInstallation, surfaceAspect, validateInstallation, sortByAngle, isValidQuad } from '../../../shared/geometry';
import { vm, openOutput, assetFromImported, errMsg } from '../services';

const RES_PRESETS = [
  { w: 1920, h: 1080, l: '1920 × 1080 (Full HD 16:9)' },
  { w: 1280, h: 720, l: '1280 × 720 (HD 16:9)' },
  { w: 1280, h: 800, l: '1280 × 800 (WXGA 16:10)' },
  { w: 1920, h: 1200, l: '1920 × 1200 (WUXGA 16:10)' },
  { w: 1024, h: 768, l: '1024 × 768 (XGA 4:3)' },
  { w: 3840, h: 2160, l: '3840 × 2160 (4K)' },
  { w: 854, h: 480, l: '854 × 480 (WVGA)' },
];

export function CalibrateScreen() {
  const project = useStore((s) => s.project)!;
  const inst = useStore(selInstallation);
  const set = useStore((s) => s.set);
  const update = useStore((s) => s.update);

  if (!project.installations.length || !inst) {
    return (
      <div className="screen center">
        <Empty icon={<Building2 size={40} />} title="Crea una instalación para empezar">
          Una instalación representa el lugar donde se proyecta: una fachada, un escaparate, un escenario…
          <div style={{ marginTop: 16 }}>
            <Button
              variant="primary"
              icon={<Plus size={16} />}
              data-testid="create-installation"
              onClick={async () => {
                const name = await promptDialog('Nueva instalación', 'Fachada principal', 'Nombre del lugar o fachada.');
                if (!name) return;
                const i = createInstallation(name);
                update('Crear instalación', (d) => { d.installations.push(i); });
                set({ installationId: i.id, surfaceId: null });
              }}
            >
              Nueva instalación
            </Button>
          </div>
        </Empty>
      </div>
    );
  }

  return (
    <div className="screen calibrate">
      <aside className="side left">
        <InstallationPicker inst={inst} />
        <SurfaceList inst={inst} />
      </aside>
      <section className="center-col">
        <CalibToolbar inst={inst} />
        <SurfaceCanvas />
      </section>
      <aside className="side right">
        <Inspector inst={inst} />
      </aside>
    </div>
  );
}

function InstallationPicker({ inst }: { inst: Installation }) {
  const project = useStore((s) => s.project)!;
  const set = useStore((s) => s.set);
  const update = useStore((s) => s.update);
  return (
    <Panel
      title="Instalación"
      actions={
        <>
          <Button
            small
            variant="ghost"
            icon={<Plus size={15} />}
            title="Nueva instalación (otra casa o fachada)"
            data-testid="new-installation"
            onClick={async () => {
              const name = await promptDialog('Nueva instalación', `Instalación ${project.installations.length + 1}`, 'Por ejemplo: «Casa de los abuelos», «Fachada lateral»…');
              if (!name) return;
              const i = createInstallation(name, { ...inst.output });
              update('Crear instalación', (d) => { d.installations.push(i); });
              set({ installationId: i.id, surfaceId: null, maskId: null });
            }}
          />
          <Button
            small
            variant="ghost"
            icon={<Copy size={15} />}
            title="Duplicar instalación"
            data-testid="dup-installation"
            onClick={async () => {
              const name = await promptDialog('Duplicar instalación', `${inst.name} (copia)`);
              if (!name) return;
              const { installation } = duplicateInstallation(inst, name);
              update('Duplicar instalación', (d) => { d.installations.push(installation); });
              set({ installationId: installation.id, surfaceId: null });
            }}
          />
          <Button
            small
            variant="ghost"
            icon={<Trash2 size={15} />}
            title="Eliminar instalación"
            onClick={async () => {
              const used = project.shows.filter((s) => s.installationId === inst.id);
              const msg = used.length
                ? `La usan ${used.length} espectáculo(s): ${used.map((s) => `«${s.name}»`).join(', ')}. Quedarán sin instalación asignada.`
                : 'Esta acción se puede deshacer con Ctrl+Z.';
              if (!(await confirmDialog(`Eliminar «${inst.name}»`, msg, 'Eliminar', true))) return;
              update('Eliminar instalación', (d) => {
                d.installations = d.installations.filter((i) => i.id !== inst.id);
                d.shows.forEach((s) => { if (s.installationId === inst.id) s.installationId = null; });
              });
              set({ installationId: project.installations.find((i) => i.id !== inst.id)?.id ?? null, surfaceId: null });
            }}
          />
        </>
      }
    >
      <select
        className="full"
        value={inst.id}
        onChange={(e) => set({ installationId: e.target.value, surfaceId: null, maskId: null })}
        data-testid="installation-select"
      >
        {project.installations.map((i) => (
          <option key={i.id} value={i.id}>{i.name}</option>
        ))}
      </select>
      <div className="muted small" style={{ marginTop: 6 }}>
        {inst.output.width}×{inst.output.height} · {inst.surfaces.length} superficies · calibrada: {inst.calibratedAt ? formatDate(inst.calibratedAt) : 'nunca'}
      </div>
    </Panel>
  );
}

function SurfaceList({ inst }: { inst: Installation }) {
  const surfaceId = useStore((s) => s.surfaceId);
  const maskId = useStore((s) => s.maskId);
  const set = useStore((s) => s.set);
  const update = useStore((s) => s.update);
  const setCalib = useStore((s) => s.setCalib);
  const mut = (label: string, fn: (i: Installation) => void) =>
    update(label, (d) => { fn(d.installations.find((x) => x.id === inst.id)!); });

  const addRect = (kind: Surface['kind']) => {
    const count = inst.surfaces.filter((s) => s.kind === kind).length + 1;
    const s = createSurface(`${SURFACE_KIND_LABELS[kind]} ${count}`, kind, inst.surfaces.length, kind === 'door' ? { x: 0.45, y: 0.55, w: 0.1, h: 0.35 } : undefined);
    mut('Añadir superficie', (i) => { i.surfaces.push(s); });
    set({ surfaceId: s.id, maskId: null });
  };

  return (
    <Panel
      title={`Superficies (${inst.surfaces.length})`}
      className="grow"
      actions={
        <>
          <Button small variant="ghost" icon={<Square size={15} />} title="Añadir ventana rectangular" onClick={() => addRect('window')} data-testid="add-window" />
          <Button small variant="ghost" icon={<Plus size={15} />} title="Añadir puerta" onClick={() => addRect('door')} data-testid="add-door" />
          <Button small variant="ghost" icon={<Pentagon size={15} />} title="Dibujar polígono" onClick={() => setCalib({ tool: 'polygon' })} />
        </>
      }
    >
      {inst.surfaces.length === 0 ? (
        <div className="muted small">
          Abre la salida en el proyector y dibuja cada ventana o puerta encima de la imagen proyectada: usa la herramienta rectángulo o polígono, o los botones de arriba.
        </div>
      ) : (
        <ul className="surface-list" data-testid="surface-list">
          {inst.surfaces.map((s, idx) => (
            <li key={s.id} className={s.id === surfaceId && !maskId ? 'sel' : ''} onClick={() => set({ surfaceId: s.id, maskId: null })} data-testid={`surface-item-${idx}`}>
              <span className="dot" style={{ background: s.color }} />
              <span className="num">{idx + 1}</span>
              <span className="name" title={s.name}>{s.name}</span>
              <span className="kind">{SURFACE_KIND_LABELS[s.kind]}</span>
              <span className="row-actions" onClick={(e) => e.stopPropagation()}>
                <button title={s.visible ? 'Ocultar' : 'Mostrar'} onClick={() => mut(s.visible ? 'Ocultar superficie' : 'Mostrar superficie', (i) => { i.surfaces[idx].visible = !s.visible; })}>
                  {s.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
                <button title={s.locked ? 'Desbloquear geometría' : 'Bloquear geometría'} onClick={() => mut(s.locked ? 'Desbloquear' : 'Bloquear', (i) => { i.surfaces[idx].locked = !s.locked; })}>
                  {s.locked ? <Lock size={14} /> : <Unlock size={14} />}
                </button>
                <button title="Subir" disabled={idx === 0} onClick={() => mut('Reordenar', (i) => { const [x] = i.surfaces.splice(idx, 1); i.surfaces.splice(idx - 1, 0, x); })}>
                  <ChevronUp size={14} />
                </button>
                <button title="Bajar" disabled={idx === inst.surfaces.length - 1} onClick={() => mut('Reordenar', (i) => { const [x] = i.surfaces.splice(idx, 1); i.surfaces.splice(idx + 1, 0, x); })}>
                  <ChevronDown size={14} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {(inst.masks.length > 0 || inst.surfaces.some((s) => s.masks.length)) && (
        <>
          <h4 className="sub">Zonas de exclusión</h4>
          <ul className="surface-list">
            {[...inst.masks.map((m) => ({ m, owner: null as Surface | null })), ...inst.surfaces.flatMap((s) => s.masks.map((m) => ({ m, owner: s })))].map(({ m, owner }) => (
              <li key={m.id} className={m.id === maskId ? 'sel' : ''} onClick={() => set({ maskId: m.id, surfaceId: owner?.id ?? null })}>
                <Ban size={13} className="mask-ico" />
                <span className="name">{m.name}</span>
                <span className="kind">{owner ? owner.name : 'global'}</span>
                <span className="row-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    title={m.enabled ? 'Desactivar' : 'Activar'}
                    onClick={() => update('Activar máscara', (d) => {
                      const i = d.installations.find((x) => x.id === inst.id)!;
                      const mm = i.masks.find((x) => x.id === m.id) ?? i.surfaces.flatMap((s) => s.masks).find((x) => x.id === m.id);
                      if (mm) mm.enabled = !mm.enabled;
                    })}
                  >
                    {m.enabled ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

function CalibToolbar({ inst }: { inst: Installation }) {
  const calib = useStore((s) => s.calib);
  const setCalib = useStore((s) => s.setCalib);
  const output = useStore((s) => s.output);
  const outputMode = useStore((s) => s.outputMode);
  const displays = useStore((s) => s.displays);
  const set = useStore((s) => s.set);
  const surfaceId = useStore((s) => s.surfaceId);
  const update = useStore((s) => s.update);

  const tool = (t: typeof calib.tool, icon: React.ReactNode, label: string, testid: string) => (
    <Button small active={calib.tool === t} icon={icon} onClick={() => setCalib({ tool: t })} title={label} data-testid={testid}>
      {label}
    </Button>
  );

  return (
    <div className="toolbar">
      <div className="group">
        {tool('select', <MousePointer2 size={15} />, 'Seleccionar', 'tool-select')}
        {tool('rect', <Square size={15} />, 'Rectángulo', 'tool-rect')}
        {tool('polygon', <Pentagon size={15} />, 'Polígono', 'tool-polygon')}
        <Button
          small
          active={calib.tool === 'mask'}
          icon={<Ban size={15} />}
          data-testid="tool-mask"
          title="Dibujar una zona donde no se proyectará nada"
          onClick={() => setCalib({ tool: 'mask', maskTarget: surfaceId ? 'surface' : 'installation' })}
        >
          Exclusión{calib.tool === 'mask' ? (calib.maskTarget === 'surface' ? ' (superficie)' : ' (global)') : ''}
        </Button>
      </div>
      <div className="group">
        <span className="muted small">Patrón:</span>
        <Select<Pattern>
          value={calib.pattern}
          onChange={(v) => setCalib({ pattern: v })}
          options={[
            { value: 'test', label: 'Cuadrícula de prueba' },
            { value: 'color', label: 'Color de superficie' },
            { value: 'white', label: 'Blanco' },
            { value: 'none', label: 'Solo contornos' },
          ]}
          data-testid="pattern-select"
        />
        <Button small active={calib.showGrid} icon={<Grid3x3 size={15} />} onClick={() => setCalib({ showGrid: !calib.showGrid })} title="Rejilla de referencia" />
        <Button small active={calib.showLabels} icon={<Tag size={15} />} onClick={() => setCalib({ showLabels: !calib.showLabels })} title="Nombres de superficies" />
        <Button small active={calib.soloSelected} icon={<Focus size={15} />} onClick={() => setCalib({ soloSelected: !calib.soloSelected })} title="Mostrar solo la superficie seleccionada" />
      </div>
      <div className="group right">
        {output.open ? (
          outputMode !== 'calibration' ? (
            <Button small variant="primary" icon={<Projector size={15} />} onClick={() => set({ outputMode: 'calibration' })} data-testid="calib-to-output">
              Mostrar calibración en el proyector
            </Button>
          ) : (
            <span className="live-pill" data-testid="calib-live"><span className="pulse" /> En directo en el proyector</span>
          )
        ) : (
          <Button
            small
            variant="primary"
            icon={<Projector size={15} />}
            data-testid="calib-open-output"
            onClick={async () => {
              const target = displays.find((d) => !d.hasEditor);
              set({ outputMode: 'calibration' });
              await openOutput(target?.id ?? null, !!target);
              if (!target) useStore.getState().toast('info', 'No se detecta un segundo monitor o proyector: se abre una ventana de prueba.', 6000);
            }}
          >
            Proyectar calibración
          </Button>
        )}
        <Button
          small
          icon={<CheckCircle2 size={15} />}
          title="Registrar la fecha de esta calibración"
          onClick={() => {
            update('Marcar calibrada', (d) => { d.installations.find((i) => i.id === inst.id)!.calibratedAt = new Date().toISOString(); });
            useStore.getState().toast('success', 'Calibración registrada. Recuerda guardar (Ctrl+S).');
          }}
        >
          Marcar calibrada
        </Button>
      </div>
    </div>
  );
}

function Inspector({ inst }: { inst: Installation }) {
  const surfaceId = useStore((s) => s.surfaceId);
  const maskId = useStore((s) => s.maskId);
  const s = inst.surfaces.find((x) => x.id === surfaceId);
  const mask = maskId ? inst.masks.find((m) => m.id === maskId) ?? inst.surfaces.flatMap((x) => x.masks).find((m) => m.id === maskId) : null;
  if (mask) return <MaskProps inst={inst} maskId={mask.id} />;
  if (s) return <SurfaceProps inst={inst} s={s} />;
  return <InstallationProps inst={inst} />;
}

function MaskProps({ inst, maskId }: { inst: Installation; maskId: string }) {
  const update = useStore((s) => s.update);
  const set = useStore((s) => s.set);
  const mask = inst.masks.find((m) => m.id === maskId) ?? inst.surfaces.flatMap((x) => x.masks).find((m) => m.id === maskId)!;
  const mut = (label: string, fn: (m: typeof mask) => void) =>
    update(label, (d) => {
      const i = d.installations.find((x) => x.id === inst.id)!;
      const m = i.masks.find((x) => x.id === maskId) ?? i.surfaces.flatMap((x) => x.masks).find((x) => x.id === maskId);
      if (m) fn(m);
    });
  return (
    <Panel title="Zona de exclusión">
      <Field label="Nombre"><TextInput value={mask.name} onCommit={(v) => mut('Renombrar máscara', (m) => { m.name = v; })} /></Field>
      <Toggle checked={mask.enabled} onChange={(v) => mut('Activar máscara', (m) => { m.enabled = v; })} label="Activa" />
      <p className="muted small">{mask.points.length} vértices. Arrastra los puntos para ajustarla; clic en «+» para añadir vértices; Alt+clic para quitarlos.</p>
      <Button
        variant="danger"
        icon={<Trash2 size={15} />}
        onClick={async () => {
          if (!(await confirmDialog('Eliminar máscara', `¿Eliminar «${mask.name}»?`, 'Eliminar', true))) return;
          update('Eliminar máscara', (d) => {
            const i = d.installations.find((x) => x.id === inst.id)!;
            i.masks = i.masks.filter((m) => m.id !== maskId);
            i.surfaces.forEach((x) => (x.masks = x.masks.filter((m) => m.id !== maskId)));
          });
          set({ maskId: null });
        }}
      >
        Eliminar máscara
      </Button>
    </Panel>
  );
}

function SurfaceProps({ inst, s }: { inst: Installation; s: Surface }) {
  const update = useStore((st) => st.update);
  const set = useStore((st) => st.set);
  const setCalib = useStore((st) => st.setCalib);
  const project = useStore((st) => st.project)!;
  const idx = inst.surfaces.findIndex((x) => x.id === s.id);
  const mut = (label: string, fn: (x: Surface) => void) =>
    update(label, (d) => {
      const x = d.installations.find((i) => i.id === inst.id)!.surfaces.find((y) => y.id === s.id);
      if (x) fn(x);
    });
  const W = inst.output.width, H = inst.output.height;
  const usage = project.shows.reduce((n, sh) => n + sh.scenes.reduce((m, sc) => m + sc.clips.filter((c) => c.surfaceId === s.id).length, 0), 0);
  const validQuad = isValidQuad(s.quad);
  return (
    <div className="inspector" data-testid="surface-props">
      <Panel title={`Superficie ${idx + 1}`}>
        <Field label="Nombre"><TextInput value={s.name} onCommit={(v) => mut('Renombrar superficie', (x) => { x.name = v; })} data-testid="surface-name" /></Field>
        <div className="row2">
          <Field label="Tipo">
            <Select value={s.kind} onChange={(v) => mut('Tipo de superficie', (x) => { x.kind = v; })} options={SURFACE_KINDS.map((k) => ({ value: k, label: SURFACE_KIND_LABELS[k] }))} />
          </Field>
          <Field label="Color">
            <input type="color" value={s.color} onChange={(e) => mut('Color', (x) => { x.color = e.target.value; })} />
          </Field>
        </div>
        <Field label="Grupo" hint="Opcional: «planta alta», «garaje»…"><TextInput value={s.group} onCommit={(v) => mut('Grupo', (x) => { x.group = v; })} /></Field>
        <div className="row2">
          <Toggle checked={s.visible} onChange={(v) => mut('Visibilidad', (x) => { x.visible = v; })} label="Visible" />
          <Toggle checked={s.locked} onChange={(v) => mut('Bloqueo', (x) => { x.locked = v; })} label="Bloqueada" data-testid="surface-lock" />
        </div>
        {!validQuad && (
          <div className="banner error small"><AlertTriangle size={14} /> Las esquinas están cruzadas: usa «Reordenar esquinas».</div>
        )}
      </Panel>
      <Panel title="Geometría">
        <Field label="Forma de recorte">
          <Select
            value={s.shape}
            onChange={(v) =>
              mut('Forma', (x) => {
                x.shape = v;
                if (v === 'polygon' && x.polygon.length < 3) x.polygon = x.quad.map((p) => ({ ...p }));
              })
            }
            options={[
              { value: 'quad', label: '4 esquinas (perspectiva)' },
              { value: 'polygon', label: 'Polígono libre (arco, zona irregular)' },
            ]}
            data-testid="surface-shape"
          />
        </Field>
        <table className="coords">
          <thead><tr><th>Esquina</th><th>x (px)</th><th>y (px)</th></tr></thead>
          <tbody>
            {s.quad.map((p, i) => (
              <tr key={i}>
                <td><span className="cdot" style={{ background: ['#ff4040', '#40ff60', '#4080ff', '#ffe030'][i] }} />{['Sup. izq.', 'Sup. der.', 'Inf. der.', 'Inf. izq.'][i]}</td>
                <td><NumberInput value={p.x * W} step={1} precision={1} onCommit={(v) => mut('Coordenada', (x) => { x.quad[i].x = v / W; })} /></td>
                <td><NumberInput value={p.y * H} step={1} precision={1} onCommit={(v) => mut('Coordenada', (x) => { x.quad[i].y = v / H; })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {s.shape === 'polygon' && <p className="muted small">Contorno: {s.polygon.length} vértices. Las 4 esquinas de color definen la perspectiva del contenido; el contorno blanco define el recorte.</p>}
        <Field label="Proporción del contenido" hint={`Estimada: ${surfaceAspect({ ...s, aspect: null }, inst.output).toFixed(2)} (ancho/alto). Indícala si conoces la medida real.`}>
          <div className="row2">
            <NumberInput value={s.aspect ?? surfaceAspect(s, inst.output)} min={0.05} max={20} step={0.01} onCommit={(v) => mut('Proporción', (x) => { x.aspect = v; })} />
            <Button small onClick={() => mut('Proporción automática', (x) => { x.aspect = null; })} disabled={s.aspect === null}>Automática</Button>
          </div>
        </Field>
        <div className="btn-col">
          <Button small icon={<Shuffle size={14} />} onClick={() => mut('Reordenar esquinas', (x) => { x.quad = orderQuad(x.quad); if (x.shape === 'polygon') x.polygon = sortByAngle(x.polygon); })}>Reordenar esquinas</Button>
          <Button small icon={<RotateCcw size={14} />} onClick={() => mut('Restablecer rectángulo', (x) => { x.quad = quadFromBBox(x.quad); })}>Enderezar a rectángulo</Button>
          {s.shape === 'polygon' && (
            <Button small icon={<Square size={14} />} onClick={() => mut('Ajustar esquinas al contorno', (x) => { x.quad = quadFromBBox(x.polygon); })}>Ajustar esquinas al contorno</Button>
          )}
          <Button small icon={<Ban size={14} />} onClick={() => setCalib({ tool: 'mask', maskTarget: 'surface' })}>Añadir máscara a esta superficie</Button>
        </div>
      </Panel>
      <Panel title="Notas">
        <TextInput multiline value={s.notes} onCommit={(v) => mut('Notas', (x) => { x.notes = v; })} placeholder="Observaciones (persianas, cortinas, reflejos…)" />
      </Panel>
      <div className="btn-row">
        <Button
          icon={<Copy size={15} />}
          onClick={() => {
            const c = cloneDeep(s);
            c.id = newId('srf');
            c.name = `${s.name} (copia)`;
            c.masks = c.masks.map((m) => ({ ...m, id: newId('msk') }));
            const off = 0.02;
            c.quad = c.quad.map((p) => ({ x: p.x + off, y: p.y + off })) as Surface['quad'];
            c.polygon = c.polygon.map((p) => ({ x: p.x + off, y: p.y + off }));
            update('Duplicar superficie', (d) => { d.installations.find((i) => i.id === inst.id)!.surfaces.splice(idx + 1, 0, c); });
            set({ surfaceId: c.id });
          }}
        >
          Duplicar
        </Button>
        <Button
          variant="danger"
          icon={<Trash2 size={15} />}
          data-testid="delete-surface"
          onClick={async () => {
            const msg = usage ? `Hay ${usage} clip(s) de espectáculos asignados a esta superficie; dejarán de mostrarse hasta que los reasignes.` : 'Puedes deshacerlo con Ctrl+Z.';
            if (!(await confirmDialog(`Eliminar «${s.name}»`, msg, 'Eliminar', true))) return;
            update('Eliminar superficie', (d) => {
              const i = d.installations.find((x) => x.id === inst.id)!;
              i.surfaces = i.surfaces.filter((x) => x.id !== s.id);
            });
            set({ surfaceId: null });
          }}
        >
          Eliminar
        </Button>
      </div>
    </div>
  );
}

function InstallationProps({ inst }: { inst: Installation }) {
  const update = useStore((s) => s.update);
  const project = useStore((s) => s.project)!;
  const toast = useStore((s) => s.toast);
  const mut = (label: string, fn: (i: Installation) => void) => update(label, (d) => { fn(d.installations.find((x) => x.id === inst.id)!); });
  const issues = validateInstallation(inst);
  const preset = RES_PRESETS.find((p) => p.w === inst.output.width && p.h === inst.output.height);
  const ref = inst.referenceImageAssetId ? project.assets.find((a) => a.id === inst.referenceImageAssetId) : null;

  const changeRes = async (w: number, h: number) => {
    if (w === inst.output.width && h === inst.output.height) return;
    const sameAspect = Math.abs(w / h - inst.output.width / inst.output.height) < 0.01;
    let mode: 'keep-relative' | 'keep-pixels' = 'keep-relative';
    if (!sameAspect && inst.surfaces.length) {
      const ok = await confirmDialog(
        'Cambiar resolución',
        'La nueva resolución tiene otra proporción. ¿Conservar las superficies en la misma posición en píxeles? (Elige «Cancelar» para mantenerlas relativas al fotograma; revisa la calibración después en cualquier caso.)',
        'Conservar píxeles',
      );
      mode = ok ? 'keep-pixels' : 'keep-relative';
    }
    update('Cambiar resolución', (d) => {
      const idx = d.installations.findIndex((x) => x.id === inst.id);
      d.installations[idx] = rescaleInstallation(d.installations[idx], { width: w, height: h }, mode);
    });
  };

  return (
    <div className="inspector" data-testid="installation-props">
      <Panel title="Instalación">
        <Field label="Nombre"><TextInput value={inst.name} onCommit={(v) => mut('Renombrar instalación', (i) => { i.name = v; })} data-testid="installation-name" /></Field>
        <Field label="Descripción"><TextInput multiline value={inst.description} onCommit={(v) => mut('Descripción', (i) => { i.description = v; })} placeholder="Dirección, posición del proyector, distancia…" /></Field>
      </Panel>
      <Panel title="Salida del proyector">
        <Field label="Resolución" hint="Usa la resolución nativa del proyector para obtener la mejor nitidez.">
          <select
            className="full"
            value={preset ? `${preset.w}x${preset.h}` : 'custom'}
            onChange={(e) => {
              if (e.target.value === 'custom') return;
              const [w, h] = e.target.value.split('x').map(Number);
              void changeRes(w, h);
            }}
          >
            {RES_PRESETS.map((p) => <option key={p.l} value={`${p.w}x${p.h}`}>{p.l}</option>)}
            <option value="custom">Personalizada…</option>
          </select>
        </Field>
        <div className="row2">
          <Field label="Ancho"><NumberInput value={inst.output.width} step={1} precision={0} min={160} max={8192} onCommit={(v) => void changeRes(Math.round(v), inst.output.height)} /></Field>
          <Field label="Alto"><NumberInput value={inst.output.height} step={1} precision={0} min={120} max={8192} onCommit={(v) => void changeRes(inst.output.width, Math.round(v))} /></Field>
        </div>
      </Panel>
      <Panel title="Foto de referencia (opcional)">
        <p className="muted small">Una foto de la fachada tomada desde el proyector ayuda a preparar las superficies sin estar delante. Solo se ve en el editor.</p>
        <div className="btn-row">
          <Button
            small
            icon={<ImageIcon size={14} />}
            onClick={async () => {
              try {
                const f = await vm.assets.pickImage();
                if (!f) return;
                const { asset } = await assetFromImported(f);
                asset.tags = ['referencia'];
                update('Foto de referencia', (d) => {
                  d.assets.push(asset);
                  d.installations.find((x) => x.id === inst.id)!.referenceImageAssetId = asset.id;
                });
              } catch (e) {
                toast('error', errMsg(e));
              }
            }}
          >
            {ref ? 'Cambiar foto' : 'Elegir foto'}
          </Button>
          {ref && <Button small onClick={() => mut('Quitar foto', (i) => { i.referenceImageAssetId = null; })}>Quitar</Button>}
        </div>
        {ref && (
          <Field label={`Opacidad ${Math.round(inst.referenceImageOpacity * 100)}%`}>
            <Slider
              value={inst.referenceImageOpacity}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => {
                const s = useStore.getState();
                if (!s.dragBase) s.beginDrag();
                s.dragUpdate((d) => { d.installations.find((x) => x.id === inst.id)!.referenceImageOpacity = v; });
              }}
              onCommit={() => useStore.getState().endDrag('Opacidad de la foto')}
            />
          </Field>
        )}
      </Panel>
      <Panel title="Comprobaciones">
        {issues.length === 0 ? (
          <div className="ok-line"><CheckCircle2 size={15} /> Geometría correcta</div>
        ) : (
          <ul className="issues">{issues.map((i, k) => <li key={k} className={i.level}><AlertTriangle size={13} /> {i.message}</li>)}</ul>
        )}
      </Panel>
      <Panel title="Notas">
        <TextInput multiline value={inst.notes} onCommit={(v) => mut('Notas', (i) => { i.notes = v; })} placeholder="Altura del proyector, zoom, keystone desactivado…" />
      </Panel>
      <p className="muted small help">
        Consejo: desactiva la corrección trapezoidal (keystone) del proyector y fija su zoom antes de calibrar. Selecciona una superficie y usa las flechas del teclado para ajustes de 1 píxel (Mayús: 10 px).
      </p>
    </div>
  );
}
