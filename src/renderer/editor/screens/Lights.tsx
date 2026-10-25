/**
 * Luces de casa: conexión opcional con Home Assistant, luces que puede tocar el programa,
 * luces del proyecto y pista de luces automática para un espectáculo.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Lightbulb, Plug, RefreshCw, Wand2, Trash2, Plus, ShieldCheck, Undo2, Zap } from 'lucide-react';
import { useStore } from '../store';
import { vm, errMsg } from '../services';
import { Button, Field, Panel, Select, TextInput, Toggle, Badge, confirmDialog } from '../components/ui';
import { createLightDevice } from '../../../shared/factory';
import { autoLights, RESTORE, type LightState } from '../../../shared/lights';
import { LIGHT_KINDS, LIGHT_KIND_LABELS, type LightDevice, type LightKind } from '../../../shared/model';
import type { HaEntity, HaStatus } from '../../../shared/api';

/** Color con que se dibuja una luz en pantalla según su estado. */
export function lightSwatch(s: LightState | undefined): { background: string; opacity: number; title: string } {
  if (!s || 'restore' in s) return { background: 'transparent', opacity: 1, title: 'Como estaba en casa' };
  if (!s.on) return { background: '#111', opacity: 1, title: 'Apagada' };
  return { background: s.color, opacity: 0.35 + 0.65 * s.brightness, title: `${s.color} · ${Math.round(s.brightness * 100)} %` };
}

export function LightDots({ devices, states, testid }: { devices: LightDevice[]; states: Record<string, LightState> | Map<string, LightState> | undefined; testid?: string }) {
  const get = (id: string) => (states instanceof Map ? states.get(id) : states?.[id]);
  return (
    <div className="light-dots" data-testid={testid}>
      {devices.map((d) => {
        const sw = lightSwatch(get(d.id));
        return (
          <span key={d.id} className="light-dot" title={`${d.name}: ${sw.title}`}>
            <i style={{ background: sw.background, opacity: sw.opacity, boxShadow: sw.background !== 'transparent' && sw.background !== '#111' ? `0 0 10px ${sw.background}` : undefined }} />
            {d.name}
          </span>
        );
      })}
    </div>
  );
}

const TESTS: { label: string; state: (d: LightDevice) => LightState }[] = [
  { label: 'Naranja', state: () => ({ on: true, color: '#ff6a00', brightness: 1, transition: 0.3 }) },
  { label: 'Morado', state: () => ({ on: true, color: '#7a2cff', brightness: 1, transition: 0.3 }) },
  { label: 'Apagar', state: () => ({ on: false, transition: 0.3 }) },
];

export function LightsScreen() {
  const project = useStore((s) => s.project)!;
  const update = useStore((s) => s.update);
  const toast = useStore((s) => s.toast);
  const outputStatus = useStore((s) => s.outputStatus);
  const [st, setSt] = useState<HaStatus | null>(null);
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [entities, setEntities] = useState<HaEntity[] | null>(null);
  const [busy, setBusy] = useState('');
  const [showId, setShowId] = useState(project.shows[0]?.id ?? '');

  const load = async () => { const s = await vm.lights.status(); setSt(s); setUrl(s.url); };
  useEffect(() => { void load(); }, []);
  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    try { await fn(); } catch (e) { toast('error', errMsg(e), 8000); } finally { setBusy(''); }
  };

  const devices = project.lights;
  const allowed = st?.allowed ?? [];
  const mutDevices = (label: string, fn: (l: LightDevice[]) => void) => update(label, (d) => fn(d.lights));

  const test = (d: LightDevice, state: LightState) => run('test', async () => {
    if (!d.entityId) { toast('info', 'Esta luz no está conectada a Home Assistant: solo se simula en pantalla.', 3000); return; }
    if (!st?.enabled) { toast('info', 'Activa primero la conexión con Home Assistant.', 3000); return; }
    await vm.lights.apply([{ entityId: d.entityId, kind: d.kind, state }]);
    setTimeout(() => void load(), 800);
  });

  const search = () => run('search', async () => {
    const list = await vm.lights.entities();
    setEntities(list);
    if (!list.length) toast('info', 'Home Assistant no tiene luces ni enchufes (entidades light.* o switch.*).', 5000);
    await load();
  });

  const allowedRef = useRef(allowed);
  allowedRef.current = allowed;
  const toggleAllowed = (e: HaEntity, on: boolean) => {
    const cur = allowedRef.current;
    const next = on ? [...cur.filter((a) => a.entityId !== e.entityId), { entityId: e.entityId, name: e.name, kind: e.kind }] : cur.filter((a) => a.entityId !== e.entityId);
    // Se marca al momento; se guarda en segundo plano.
    allowedRef.current = next;
    setSt((s) => (s ? { ...s, allowed: next } : s));
    void vm.lights.setAllowed(next).then(setSt, (err) => { toast('error', errMsg(err), 8000); void load(); });
  };

  const addFromAllowed = () => {
    const have = new Set(devices.map((d) => d.entityId));
    const add = allowed.filter((a) => !have.has(a.entityId)).map((a) => createLightDevice(a.name, a.kind, a.entityId));
    if (!add.length) { toast('info', 'Todas las luces permitidas ya están en el proyecto.', 3000); return; }
    mutDevices('Añadir luces', (l) => { l.push(...add); });
    toast('success', `${add.length} luz(ces) añadida(s) al proyecto.`, 3000);
  };

  const show = project.shows.find((s) => s.id === showId) ?? null;
  const cuesInShow = show ? show.scenes.reduce((n, sc) => n + sc.lights.length, 0) : 0;
  const makeAuto = async () => {
    if (!show) return;
    if (!devices.length) { toast('error', 'Añade primero alguna luz al proyecto.'); return; }
    if (cuesInShow && !(await confirmDialog('Luces automáticas', `«${show.name}» ya tiene ${cuesInShow} efecto(s) de luz. Se sustituirán por los automáticos (puedes deshacerlo con Ctrl+Z).`, 'Sustituir'))) return;
    const auto = autoLights(show, devices);
    update(`Luces automáticas: ${show.name}`, (d) => {
      const sh = d.shows.find((x) => x.id === show.id);
      if (!sh) return;
      for (const sc of sh.scenes) sc.lights = auto.scenes.find((x) => x.id === sc.id)?.lights ?? sc.lights;
    });
    toast('success', `Pista de luces creada en ${auto.scenes.filter((s) => s.lights.length).length} escenas. Retócala en Espectáculos (fila «Luces»).`, 6000);
  };

  const sim = outputStatus?.lights;
  const ok = st?.connected === true;

  return (
    <div className="screen settings scroll">
      <div className="settings-grid">
        <Panel title={<><Lightbulb size={14} /> Luces del espectáculo (este proyecto)</>} className="wide">
          <p className="muted small">Las luces de casa siguen el espectáculo: relámpagos con la tormenta, color de la escena, parpadeo en la fiesta… Sin Home Assistant también funcionan: se <b>simulan en pantalla</b> (útil para preparar y para enseñarlo). Cada luz puede estar conectada a una luz o enchufe real de Home Assistant.</p>
          {devices.length === 0 ? (
            <p className="muted small">Aún no hay luces. Añade una (por ejemplo «Tira LED del porche») o, si ya conectaste Home Assistant, añade de golpe las permitidas.</p>
          ) : (
            <table className="light-table" data-testid="light-devices">
              <thead><tr><th>Nombre</th><th>Tipo</th><th>Luz real (Home Assistant)</th><th>Probar</th><th /></tr></thead>
              <tbody>
                {devices.map((d) => (
                  <tr key={d.id} data-testid="light-device">
                    <td><TextInput value={d.name} onCommit={(v) => mutDevices('Renombrar luz', (l) => { const x = l.find((y) => y.id === d.id); if (x && v.trim()) x.name = v.trim(); })} /></td>
                    <td><Select value={d.kind} onChange={(v: LightKind) => mutDevices('Tipo de luz', (l) => { const x = l.find((y) => y.id === d.id); if (x) x.kind = v; })} options={LIGHT_KINDS.map((k) => ({ value: k, label: LIGHT_KIND_LABELS[k] }))} /></td>
                    <td>
                      <Select
                        value={d.entityId}
                        onChange={(v) => mutDevices('Conectar luz', (l) => { const x = l.find((y) => y.id === d.id); if (x) { x.entityId = v; const a = allowed.find((y) => y.entityId === v); if (a) x.kind = a.kind; } })}
                        options={[{ value: '', label: 'Sin conectar (solo simulación)' }, ...allowed.map((a) => ({ value: a.entityId, label: `${a.name} (${a.entityId})` })), ...(d.entityId && !allowed.some((a) => a.entityId === d.entityId) ? [{ value: d.entityId, label: `${d.entityId} (no permitida en este PC)` }] : [])]}
                        data-testid="light-entity"
                      />
                    </td>
                    <td className="btn-row tight">
                      {TESTS.filter((t) => d.kind === 'color' || t.label !== 'Morado').map((t) => <Button key={t.label} small onClick={() => void test(d, t.state(d))} disabled={!!busy}>{d.kind === 'plug' && t.label === 'Naranja' ? 'Encender' : t.label}</Button>)}
                      <Button small variant="ghost" icon={<Undo2 size={13} />} onClick={() => void test(d, RESTORE)} title="Como estaba" disabled={!!busy} />
                    </td>
                    <td><Button small variant="ghost" icon={<Trash2 size={14} />} title="Quitar del proyecto" onClick={() => mutDevices('Quitar luz', (l) => { const i = l.findIndex((y) => y.id === d.id); if (i >= 0) l.splice(i, 1); })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="btn-row">
            <Button icon={<Plus size={15} />} onClick={() => mutDevices('Añadir luz', (l) => { l.push(createLightDevice(`Luz ${l.length + 1}`, 'color')); })} data-testid="light-add">Añadir luz</Button>
            <Button icon={<Plus size={15} />} onClick={addFromAllowed} disabled={!allowed.length} data-testid="light-add-allowed" title="Una luz del proyecto por cada luz permitida de Home Assistant">Añadir las permitidas de Home Assistant</Button>
            <Button small variant="ghost" icon={<Undo2 size={14} />} onClick={() => void run('release', async () => { await vm.lights.release(); await load(); })} disabled={!st?.inUse}>Devolver las luces a como estaban{st?.inUse ? ` (${st.inUse})` : ''}</Button>
          </div>
          {sim && devices.length > 0 && <><h4 className="sub">Ahora mismo en el espectáculo</h4><LightDots devices={devices} states={sim} testid="light-sim" /></>}
        </Panel>

        <Panel title={<><Wand2 size={14} /> Luces automáticas</>}>
          <p className="muted small">Crea la pista de luces de un espectáculo según lo que pasa en cada escena: <b>relámpagos</b> en las tormentas, <b>parpadeo</b> de colores en la fiesta y los fuegos artificiales, <b>vela</b> con el fuego, <b>apagadas</b> en los sustos y el color de los efectos en el resto. Al final, todo vuelve a como estaba.</p>
          <Field label="Espectáculo"><Select value={showId} onChange={setShowId} options={project.shows.map((s) => ({ value: s.id, label: s.name }))} data-testid="light-auto-show" /></Field>
          <Button variant="primary" icon={<Wand2 size={15} />} onClick={() => void makeAuto()} disabled={!show || !devices.length} data-testid="light-auto">Crear luces automáticas</Button>
          {show && <p className="muted small">{cuesInShow ? `Tiene ${cuesInShow} efecto(s) de luz.` : 'Aún no tiene efectos de luz.'}</p>}
        </Panel>

        <Panel title={<><Plug size={14} /> Home Assistant (opcional)</>}>
          <p className="muted small">Conecta con tu Home Assistant de casa. El programa <b>solo enciende, apaga y cambia el color</b> de las luces y enchufes que marques abajo, y al terminar las deja <b>como estaban</b>. No crea escenas ni automatizaciones ni cambia nada de tu configuración. No sale nada a Internet: habla directamente con tu Home Assistant.</p>
          <Toggle checked={!!st?.enabled} onChange={(v) => void run('cfg', async () => setSt(await vm.lights.configure({ enabled: v })))} label="Usar las luces de Home Assistant en los espectáculos" data-testid="ha-enabled" />
          <Field label="Dirección" hint="La de tu Home Assistant en casa, por ejemplo http://homeassistant.local:8123 o http://192.168.1.50:8123">
            <div className="schedule-row">
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://homeassistant.local:8123" spellCheck={false} data-testid="ha-url" />
              <Button small onClick={() => void run('cfg', async () => { const s = await vm.lights.configure({ url }); setSt(s); setUrl(s.url); })} disabled={url === st?.url} data-testid="ha-url-save">Guardar</Button>
            </div>
          </Field>
          <Field label={`Clave de acceso ${st?.hasToken ? '(guardada)' : ''}`} hint="En Home Assistant: tu perfil → Seguridad → «Tokens de acceso de larga duración» → Crear. Se guarda cifrada en este PC, nunca en los proyectos.">
            <div className="schedule-row">
              <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="eyJhbGciOi…" autoComplete="off" spellCheck={false} data-testid="ha-token" />
              <Button small onClick={() => void run('tok', async () => { setSt(await vm.lights.setToken(token)); setToken(''); toast('success', 'Clave guardada (cifrada en este PC)', 2000); })} disabled={!token.trim()} data-testid="ha-token-save">Guardar clave</Button>
              {st?.hasToken && <Button small variant="ghost" onClick={() => void run('tok', async () => setSt(await vm.lights.setToken(null)))}>Borrar</Button>}
            </div>
          </Field>
          <div className="btn-row">
            <Button icon={<RefreshCw size={15} />} onClick={() => void run('test', async () => setSt(await vm.lights.test()))} disabled={!st?.url || !st?.hasToken || !!busy} data-testid="ha-test">{busy === 'test' ? 'Probando…' : 'Probar conexión'}</Button>
            {st?.connected !== null && st && <Badge tone={ok ? 'ok' : 'error'}>{ok ? `Conectado${st.location ? ` a «${st.location}»` : ''}${st.version ? ` · HA ${st.version}` : ''}` : 'Sin conexión'}</Badge>}
          </div>
          {st?.lastError && !ok && <div className="banner error small" data-testid="ha-error">{st.lastError}</div>}
        </Panel>

        <Panel title={<><ShieldCheck size={14} /> Luces que puede tocar el programa</>}>
          <p className="muted small">Por seguridad, el programa solo puede usar las luces (light.*) y enchufes (switch.*) que marques aquí. Las cerraduras, alarmas, calefacción y todo lo demás no se tocan nunca. Si un proyecto de otra persona usa luces que no has permitido, se ignoran.</p>
          <Button icon={<Zap size={15} />} onClick={() => void search()} disabled={!st?.url || !st?.hasToken || !!busy} data-testid="ha-search">{busy === 'search' ? 'Buscando…' : 'Buscar luces en Home Assistant'}</Button>
          <EntityList entities={entities} allowed={allowed.map((a) => a.entityId)} onToggle={toggleAllowed} fallback={allowed} />
        </Panel>
      </div>
    </div>
  );
}

function EntityList({ entities, allowed, onToggle, fallback }: { entities: HaEntity[] | null; allowed: string[]; onToggle: (e: HaEntity, on: boolean) => void; fallback: { entityId: string; name: string; kind: LightKind }[] }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const base: HaEntity[] = entities ?? fallback.map((a) => ({ entityId: a.entityId, name: a.name, kind: a.kind, state: '' }));
    const f = q.trim().toLowerCase();
    return f ? base.filter((e) => e.name.toLowerCase().includes(f) || e.entityId.includes(f)) : base;
  }, [entities, fallback, q]);
  if (!entities && !fallback.length) return <p className="muted small">Pulsa «Buscar luces» para ver las de tu casa.</p>;
  return (
    <>
      {(entities?.length ?? 0) > 8 && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar…" style={{ marginTop: 8 }} />}
      <ul className="entity-list" data-testid="ha-entities">
        {list.map((e) => (
          <li key={e.entityId}>
            <label>
              <input type="checkbox" checked={allowed.includes(e.entityId)} onChange={(ev) => onToggle(e, ev.target.checked)} data-testid="ha-allow" />
              <span>{e.kind === 'plug' ? <Plug size={13} /> : <Lightbulb size={13} />} {e.name}</span>
              <code>{e.entityId}</code>
              {e.state && <em>{e.state === 'on' ? 'encendida' : e.state === 'off' ? 'apagada' : e.state}</em>}
            </label>
          </li>
        ))}
      </ul>
    </>
  );
}
