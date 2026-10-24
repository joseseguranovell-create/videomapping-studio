import { X } from 'lucide-react';
import { useStore } from '../store';

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} data-testid={`toast-${t.kind}`}>
          <span>{t.text}</span>
          <button onClick={() => dismiss(t.id)} aria-label="Cerrar"><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}
