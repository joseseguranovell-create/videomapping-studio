/**
 * Salida por red: la misma imagen del proyector en el navegador de un Fire TV, otra tele u otro equipo.
 * La tele muestra lo que se prepara/reproduce/calibra aquí, así que se calibra desde el editor como siempre.
 */
import { useEffect, useState } from 'react';
import { Tv, Copy } from 'lucide-react';
import { useStore } from '../store';
import { vm, errMsg } from '../services';
import type { WebOutputStatus } from '../../../shared/api';
import { Button, Field, Panel, TextInput, Toggle } from './ui';

export function WebOutputPanel() {
  const toast = useStore((s) => s.toast);
  const [st, setSt] = useState<WebOutputStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => vm.web.status().then(setSt).catch(() => {});
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, []);

  const configure = async (p: { enabled?: boolean; fireTvIp?: string }) => {
    try { setSt(await vm.web.configure(p)); } catch (e) { toast('error', errMsg(e), 8000); }
  };
  const openFireTv = async () => {
    setBusy(true);
    try { toast('success', await vm.web.openOnFireTv(), 8000); } catch (e) { toast('error', errMsg(e), 12000); }
    setBusy(false);
  };
  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); toast('success', 'Enlace copiado', 3000); } catch { toast('warning', 'No se pudo copiar el enlace'); }
  };

  if (!st) return null;
  return (
    <Panel title={<span><Tv size={15} /> Salida por red (Fire TV u otra tele)</span>}>
      <p className="muted small">La tele muestra lo mismo que el proyector: abre la salida con «Preparar», dale a «Empezar» o calibra aquí como siempre y se ve también en ella.</p>
      <Toggle checked={st.running} onChange={(v) => void configure({ enabled: v })} label="Enviar la salida por la red de casa" data-testid="web-toggle" />
      {st.error && <div className="banner error small">{st.error}</div>}
      {st.running && (
        <>
          <Field label="IP del Fire TV" hint="Ajustes > Mi Fire TV > Acerca de > Red. Con la depuración ADB activada.">
            <TextInput value={st.fireTvIp} onCommit={(v) => void configure({ fireTvIp: v })} placeholder="192.168.1.50" data-testid="web-firetv-ip" />
          </Field>
          <div className="btn-row">
            <Button variant="primary" icon={<Tv size={15} />} onClick={() => void openFireTv()} disabled={busy || !st.fireTvIp} data-testid="web-open-firetv">{busy ? 'Abriendo…' : 'Abrir en el Fire TV'}</Button>
          </div>
          <p className="muted small">
            {st.clients ? `${st.clients} pantalla${st.clients > 1 ? 's' : ''} conectada${st.clients > 1 ? 's' : ''}.` : 'Ninguna pantalla conectada todavía.'} En la tele, pulsa OK en el mando cuando salga el aviso (activa sonido y pantalla completa).
          </p>
          <details>
            <summary className="muted small">Otras formas de abrirlo (otro navegador, otro equipo)</summary>
            {st.urls.map((u) => (
              <div key={u} className="btn-row">
                <code className="small" style={{ wordBreak: 'break-all' }}>{u}</code>
                <Button small icon={<Copy size={13} />} onClick={() => void copy(u)} title="Copiar enlace" />
              </div>
            ))}
            <p className="muted small">El enlace lleva una clave: solo funciona con él. Windows puede preguntar la primera vez si permites el acceso a la red privada: di que sí.</p>
          </details>
        </>
      )}
    </Panel>
  );
}
