/** Ayuda para aprender en una tarde: guía de primeros pasos en Inicio y ayuda de cada pantalla (F1). */
import { useEffect, useState } from 'react';
import { CircleHelp, Check, Crosshair, Wand2, MonitorPlay, Lightbulb, FilePlus2, Video, X } from 'lucide-react';
import { useStore, type View } from '../store';
import { Button, Modal } from './ui';

interface HelpPage { title: string; what: string; steps: string[]; keys?: [string, string][] }

export const HELP: Record<View, HelpPage> = {
  home: {
    title: 'Inicio',
    what: 'Abre o crea proyectos. Un proyecto es una casa (o un lugar) con sus fotos, vídeos y espectáculos.',
    steps: [
      'Para probar en 5 minutos: «Empezar con un ejemplo» → Crear proyecto. Ya trae una casa, personajes y un espectáculo.',
      'Para tu casa: «Nuevo proyecto» y sigue la guía de primeros pasos de esta pantalla.',
      '«Duplicar proyecto» hace una copia completa para pasársela a otra persona (copia la carpeta entera, con un pendrive o por la nube).',
    ],
    keys: [['Ctrl+S', 'Guardar'], ['Ctrl+Z / Ctrl+Y', 'Deshacer / rehacer'], ['Ctrl+1…8', 'Cambiar de pantalla'], ['F1', 'Esta ayuda']],
  },
  calibrate: {
    title: 'Calibración',
    what: 'Aquí se le dice al programa dónde están las ventanas, puertas y paredes de la casa, tal como las ve el proyector.',
    steps: [
      'Enciende el proyector apuntando a la casa y pulsa «Abrir salida» (arriba a la derecha), con «Calibración» elegido.',
      'Herramienta «Rectángulo»: dibuja cada ventana o puerta y ponle su tipo y nombre en el panel de la derecha.',
      'Arrastra las 4 esquinas (aquí o con el ratón sobre la propia proyección) hasta que encajen con la ventana real. «Polígono» sirve para formas raras.',
      'Las flechas del teclado mueven la esquina elegida 1 píxel (con Mayús, 10).',
      'Si no tienes el proyector a mano, pon una foto de la fachada de fondo y dibuja encima.',
      'Cuando encaje todo, pulsa «Marcar calibrada».',
    ],
    keys: [['Flechas', 'Mover 1 px'], ['Mayús+flechas', 'Mover 10 px'], ['Supr', 'Borrar la superficie']],
  },
  library: {
    title: 'Biblioteca',
    what: 'Todos los vídeos, imágenes y sonidos del proyecto.',
    steps: [
      '«Importar» copia los archivos dentro del proyecto (el original no se toca).',
      'Vídeos con fondo verde o negro: elige el vídeo → «Quitar fondo».',
      'Los paquetes añaden personajes, sonidos y espectáculos ya hechos.',
    ],
  },
  characters: {
    title: 'Personajes',
    what: 'Un personaje agrupa sus animaciones (asomarse, saludar, irse…) para usarlo fácilmente en las escenas.',
    steps: ['Crea un personaje y añádele vídeos o imágenes como animaciones, cada una con su movimiento.', 'Después, en Espectáculos → «Personaje», eliges el personaje y la animación.'],
  },
  shows: {
    title: 'Espectáculos',
    what: 'Un espectáculo es una lista de escenas. Cada escena tiene una fila por ventana o puerta, más sonidos y luces.',
    steps: [
      'Lo más rápido: «Asistente de espectáculos» (varita) → elige estilo y protagonistas → te hace el espectáculo entero.',
      'Para añadir algo en una ventana: doble clic en el hueco de su fila, en el segundo que quieras.',
      'Arrastra los bloques para moverlos (también a otra fila) y su borde derecho para alargarlos.',
      'Clic derecho en un bloque: duplicar, pasar a otra ventana, silueta, borrar…',
      '«Plantilla» rellena toda la casa de golpe (tormenta, ojos, fiesta…). «Coreografía» hace que un personaje pase de una ventana a otra.',
      'Las escenas se reordenan arrastrándolas en la tira de escenas. Doble clic para cambiarles el nombre.',
    ],
    keys: [['Espacio', 'Reproducir la vista previa'], ['Supr', 'Borrar lo elegido'], ['Ctrl+D', 'Duplicar'], ['Ctrl+C / Ctrl+V', 'Copiar y pegar clips'], ['Alt+flechas', 'Mover 0,1 s']],
  },
  lights: {
    title: 'Luces',
    what: 'Luces de casa sincronizadas con el espectáculo, reales (Home Assistant) o simuladas en pantalla.',
    steps: [
      'Añade luces al proyecto («Tira del porche», «Enchufe calabaza»…). Sin Home Assistant se simulan en pantalla.',
      'Para usar las reales: pon la dirección de Home Assistant y una clave de acceso, «Probar conexión», «Buscar luces» y marca las que puede usar el programa.',
      '«Crear luces automáticas» hace la pista de luces de todo el espectáculo. Retócala en Espectáculos, en las filas «Luces».',
      'Al detener, poner en negro o cerrar, las luces vuelven solas a como estaban.',
    ],
  },
  play: {
    title: 'Reproducción',
    what: 'El espectáculo en el proyector, para la noche de verdad.',
    steps: [
      '«Preparar» abre el proyector en negro. Pulsa Espacio sobre la proyección (o «Empezar») cuando quieras.',
      'Modo directo: las teclas 1-9 dejan una escena en bucle (ideal mientras llega la gente); Intro sigue con el espectáculo.',
      '«Grabar vídeo de demostración» crea un vídeo del espectáculo (sobre la foto de la casa si la tienes) para enviarlo por WhatsApp.',
      'Reproducción programada: empieza sola cada día a la hora que digas.',
    ],
    keys: [['Espacio', 'Empezar / pausa'], ['B', 'Negro'], ['1-9', 'Escena en bucle'], ['→ / ←', 'Siguiente / anterior'], ['Intro', 'Seguir el espectáculo'], ['Esc', 'Salir de pantalla completa']],
  },
  settings: {
    title: 'Ajustes',
    what: 'Preferencias del programa, copias de seguridad, actualizaciones y control por agentes de IA.',
    steps: ['«Buscar actualizaciones» instala la última versión probada sin perder nada.', 'Las copias de seguridad se hacen solas; aquí puedes recuperar una.'],
  },
};

export function HelpButton() {
  const view = useStore((s) => s.view);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'F1') { e.preventDefault(); setOpen((o) => !o); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  const h = HELP[view];
  return (
    <>
      <Button icon={<CircleHelp size={16} />} onClick={() => setOpen(true)} title="Cómo se usa esta pantalla (F1)" data-testid="help">Ayuda</Button>
      {open && (
        <Modal title={`Cómo se usa: ${h.title}`} onClose={() => setOpen(false)}>
          <p>{h.what}</p>
          <ol className="help-steps">{h.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          {h.keys && (
            <>
              <h4 className="sub">Teclas</h4>
              <dl className="help-keys">{h.keys.map(([k, v]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>)}</dl>
            </>
          )}
          <div className="btn-row"><Button variant="primary" onClick={() => setOpen(false)}>Entendido</Button></div>
        </Modal>
      )}
    </>
  );
}

const HIDE_KEY = 'vm-first-steps-hidden';

/** Guía de primeros pasos con lo que ya está hecho marcado. */
export function FirstSteps({ onNew }: { onNew: () => void }) {
  const project = useStore((s) => s.project);
  const played = useStore((s) => s.playedOnce);
  const set = useStore((s) => s.set);
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(HIDE_KEY) === '1'; } catch { return false; } });
  const hide = (v: boolean) => { setHidden(v); try { localStorage.setItem(HIDE_KEY, v ? '1' : '0'); } catch { /* sin almacenamiento */ } };

  const surfaces = project ? Math.max(0, ...project.installations.map((i) => i.surfaces.length)) : 0;
  const hasShow = !!project?.shows.some((s) => s.scenes.some((sc) => sc.clips.length));
  const steps = [
    { done: !!project, icon: <FilePlus2 size={18} />, title: 'Crea un proyecto', text: 'Uno por casa. Si solo quieres verlo funcionar, empieza con el ejemplo de abajo.', action: !project ? <Button small variant="primary" onClick={onNew}>Nuevo proyecto</Button> : null },
    { done: surfaces >= 2, icon: <Crosshair size={18} />, title: 'Dibuja las ventanas y puertas', text: 'Con el proyector apuntando a la casa (o sobre una foto), dibuja cada ventana y ajusta sus 4 esquinas.', action: project ? <Button small onClick={() => set({ view: 'calibrate' })}>Ir a Calibración</Button> : null },
    { done: hasShow, icon: <Wand2 size={18} />, title: 'Crea el espectáculo', text: 'El asistente lo compone entero: eliges estilo (infantil, terror, Navidad) y protagonistas.', action: project ? <Button small onClick={() => set({ view: 'shows', pendingWizard: true })} data-testid="steps-wizard">Abrir el asistente</Button> : null },
    { done: played, icon: <MonitorPlay size={18} />, title: 'Pruébalo en la casa', text: 'Reproducción → «Preparar» y pulsa Espacio sobre la proyección. Las teclas 1-9 dejan una escena en bucle.', action: project ? <Button small onClick={() => set({ view: 'play' })}>Ir a Reproducción</Button> : null },
  ];
  const extras = [
    { icon: <Lightbulb size={16} />, text: 'Luces de casa sincronizadas (Home Assistant)', view: 'lights' as View },
    { icon: <Video size={16} />, text: 'Grabar un vídeo de demostración para enviarlo', view: 'play' as View },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (hidden) {
    return <div className="first-steps-mini"><Button small variant="ghost" onClick={() => hide(false)} data-testid="steps-show">Ver la guía de primeros pasos ({doneCount}/4)</Button></div>;
  }
  return (
    <section className="first-steps" data-testid="first-steps">
      <header>
        <h2>Primeros pasos <span className="muted">{doneCount}/4</span></h2>
        <Button small variant="ghost" icon={<X size={14} />} onClick={() => hide(true)} title="Ocultar la guía">Ocultar</Button>
      </header>
      <ol>
        {steps.map((s, i) => (
          <li key={i} className={s.done ? 'done' : steps.findIndex((x) => !x.done) === i ? 'next' : ''}>
            <span className="fs-num">{s.done ? <Check size={16} /> : i + 1}</span>
            <span className="fs-icon">{s.icon}</span>
            <div><b>{s.title}</b><p>{s.text}</p></div>
            {!s.done && s.action}
          </li>
        ))}
      </ol>
      {project && (
        <div className="fs-extras">
          <span className="muted small">Y cuando quieras:</span>
          {extras.map((x) => <Button key={x.text} small variant="ghost" icon={x.icon} onClick={() => set({ view: x.view })}>{x.text}</Button>)}
          <span className="muted small">· En cualquier pantalla, <kbd>F1</kbd> explica cómo se usa.</span>
        </div>
      )}
    </section>
  );
}
