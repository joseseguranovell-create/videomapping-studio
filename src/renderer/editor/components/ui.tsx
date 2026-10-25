/** Componentes de interfaz básicos y diálogos (confirmar, pedir texto, elegir). */
import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { X } from 'lucide-react';

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  icon?: ReactNode;
  small?: boolean;
  active?: boolean;
};

export function Button({ variant = 'default', icon, small, active, className = '', children, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      className={`btn btn-${variant}${small ? ' btn-sm' : ''}${active ? ' active' : ''}${!children ? ' btn-icon' : ''} ${className}`}
      {...rest}
    >
      {icon}
      {children && <span>{children}</span>}
    </button>
  );
}

export function Field({ label, children, hint, inline }: { label: string; children: ReactNode; hint?: string; inline?: boolean }) {
  return (
    <label className={`field${inline ? ' inline' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/** Texto que solo confirma el cambio al salir del campo o pulsar Intro (un único paso de deshacer). */
export function TextInput({ value, onCommit, placeholder, multiline, autoFocus, ...rest }: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  autoFocus?: boolean;
  'data-testid'?: string;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => v !== value && onCommit(v);
  if (multiline)
    return <textarea value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={commit} rows={3} {...rest} />;
  return (
    <input
      type="text"
      value={v}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') { setV(value); (e.target as HTMLInputElement).blur(); }
        e.stopPropagation();
      }}
      {...rest}
    />
  );
}

export function NumberInput({ value, onCommit, min, max, step = 0.1, suffix, precision = 2, ...rest }: {
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  precision?: number;
  'data-testid'?: string;
}) {
  const fmt = (n: number) => (Number.isFinite(n) ? String(Math.round(n * 10 ** precision) / 10 ** precision) : '');
  const [v, setV] = useState(fmt(value));
  useEffect(() => setV(fmt(value)), [value]);
  const commit = () => {
    let n = parseFloat(v.replace(',', '.'));
    if (!Number.isFinite(n)) { setV(fmt(value)); return; }
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    setV(fmt(n));
    if (n !== value) onCommit(n);
  };
  return (
    <span className="num">
      <input
        type="text"
        inputMode="decimal"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const k = (e.shiftKey ? 10 : 1) * step * (e.key === 'ArrowUp' ? 1 : -1);
            let n = (parseFloat(v.replace(',', '.')) || 0) + k;
            if (min !== undefined) n = Math.max(min, n);
            if (max !== undefined) n = Math.min(max, n);
            setV(fmt(n));
            onCommit(n);
          }
        }}
        {...rest}
      />
      {suffix && <span className="num-suffix">{suffix}</span>}
    </span>
  );
}

export function Select<T extends string>({ value, options, onChange, ...rest }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  'data-testid'?: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)} {...rest}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function Toggle({ checked, onChange, label, ...rest }: { checked: boolean; onChange: (v: boolean) => void; label: string; 'data-testid'?: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} {...rest} />
      <span className="toggle-track"><span className="toggle-thumb" /></span>
      <span>{label}</span>
    </label>
  );
}

export function Slider({ value, min, max, step, onChange, onCommit, ...rest }: {
  value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; onCommit?: () => void; 'data-testid'?: string;
}) {
  return (
    <input
      type="range"
      className="slider"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      onPointerUp={onCommit}
      onKeyUp={onCommit}
      {...rest}
    />
  );
}

export function Panel({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <header className="panel-head">
          <h3>{title}</h3>
          <div className="panel-actions">{actions}</div>
        </header>
      )}
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <div className="empty-title">{title}</div>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <Button variant="ghost" icon={<X size={16} />} onClick={onClose} aria-label="Cerrar" />
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

// ───────── menú contextual (clic derecho) ─────────

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Atajo de teclado mostrado a la derecha. */
  hint?: string;
  separator?: boolean;
}

const useMenu = create<{ menu: { x: number; y: number; items: MenuItem[] } | null }>(() => ({ menu: null }));

/** Abre un menú en la posición del ratón. */
export function openMenu(e: { clientX: number; clientY: number; preventDefault?: () => void; stopPropagation?: () => void }, items: MenuItem[]) {
  e.preventDefault?.();
  e.stopPropagation?.();
  useMenu.setState({ menu: { x: e.clientX, y: e.clientY, items } });
}

export function ContextMenuHost() {
  const menu = useMenu((s) => s.menu);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => useMenu.setState({ menu: null });
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    window.addEventListener('keydown', k, true);
    window.addEventListener('mousedown', down, true);
    window.addEventListener('blur', close);
    return () => { window.removeEventListener('keydown', k, true); window.removeEventListener('mousedown', down, true); window.removeEventListener('blur', close); };
  }, [menu]);
  // Se recoloca para no salirse de la ventana.
  useEffect(() => {
    if (!menu || !ref.current) { setPos(null); return; }
    const r = ref.current.getBoundingClientRect();
    setPos({ x: Math.min(menu.x, window.innerWidth - r.width - 8), y: Math.min(menu.y, window.innerHeight - r.height - 8) });
  }, [menu]);
  if (!menu) return null;
  return (
    <div ref={ref} className="ctx-menu" style={{ left: pos?.x ?? menu.x, top: pos?.y ?? menu.y, visibility: pos ? 'visible' : 'hidden' }} role="menu" data-testid="ctx-menu">
      {menu.items.map((it, i) => it.separator ? <div key={i} className="ctx-sep" /> : (
        <button key={i} role="menuitem" className={`ctx-item${it.danger ? ' danger' : ''}`} disabled={it.disabled} onClick={() => { useMenu.setState({ menu: null }); it.onClick?.(); }}>
          <span className="ctx-ico">{it.icon}</span><span className="ctx-label">{it.label}</span>{it.hint && <kbd>{it.hint}</kbd>}
        </button>
      ))}
    </div>
  );
}

// ───────── diálogos con promesa ─────────

type DialogReq =
  | { kind: 'confirm'; title: string; message: string; ok: string; danger?: boolean; resolve: (v: boolean) => void }
  | { kind: 'prompt'; title: string; message?: string; value: string; ok: string; resolve: (v: string | null) => void };

const useDialogs = create<{ queue: DialogReq[] }>(() => ({ queue: [] }));

export function confirmDialog(title: string, message: string, ok = 'Aceptar', danger = false): Promise<boolean> {
  return new Promise((resolve) => useDialogs.setState((s) => ({ queue: [...s.queue, { kind: 'confirm', title, message, ok, danger, resolve }] })));
}

export function promptDialog(title: string, value = '', message?: string, ok = 'Aceptar'): Promise<string | null> {
  return new Promise((resolve) => useDialogs.setState((s) => ({ queue: [...s.queue, { kind: 'prompt', title, message, value, ok, resolve }] })));
}

export function DialogHost() {
  const req = useDialogs((s) => s.queue[0]);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (req?.kind === 'prompt') {
      setText(req.value);
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [req]);
  if (!req) return null;
  const close = (v: any) => {
    useDialogs.setState((s) => ({ queue: s.queue.slice(1) }));
    (req.resolve as (x: any) => void)(v);
  };
  if (req.kind === 'confirm') {
    return (
      <Modal
        title={req.title}
        onClose={() => close(false)}
        footer={
          <>
            <Button onClick={() => close(false)}>Cancelar</Button>
            <Button variant={req.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus data-testid="dialog-ok">{req.ok}</Button>
          </>
        }
      >
        <p className="dialog-msg">{req.message}</p>
      </Modal>
    );
  }
  return (
    <Modal
      title={req.title}
      onClose={() => close(null)}
      footer={
        <>
          <Button onClick={() => close(null)}>Cancelar</Button>
          <Button variant="primary" disabled={!text.trim()} onClick={() => close(text.trim())} data-testid="dialog-ok">{req.ok}</Button>
        </>
      }
    >
      {req.message && <p className="dialog-msg">{req.message}</p>}
      <input
        ref={inputRef}
        className="full"
        type="text"
        value={text}
        data-testid="dialog-input"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && text.trim()) close(text.trim());
        }}
      />
    </Modal>
  );
}

export function Badge({ children, tone = 'default', title }: { children: ReactNode; tone?: 'default' | 'warn' | 'error' | 'ok' | 'accent'; title?: string }) {
  return <span className={`badge badge-${tone}`} title={title}>{children}</span>;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
}
