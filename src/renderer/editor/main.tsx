import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import type { VmApi } from '../../shared/api';
import './styles.css';

declare global {
  interface Window { vm: VmApi }
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { window.vm?.app.log('error', `Error de interfaz: ${error.stack ?? error.message}`); }
  render() {
    if (this.state.error) {
      return (
        <div className="crash">
          <h1>Se ha producido un error en la interfaz</h1>
          <p>Tus cambios están protegidos por el guardado automático. Pulsa «Recargar»; al abrir el proyecto podrás recuperarlos.</p>
          <pre>{this.state.error.message}</pre>
          <button className="btn btn-primary" onClick={() => location.reload()}>Recargar</button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
