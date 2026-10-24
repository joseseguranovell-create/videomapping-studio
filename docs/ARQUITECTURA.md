# Arquitectura y decisiones técnicas

## Decisiones principales

| Decisión | Elección | Motivo |
|---|---|---|
| Plataforma | **Electron 44** + React 19 + TypeScript + Vite | Ventanas a pantalla completa en un monitor concreto, detección de pantallas, acceso a archivos, vídeo acelerado de Chromium y empaquetado para Windows con una sola base de código. |
| Render | **WebGL2 propio** (sin PixiJS ni Three.js) | Basta con un shader: homografía inversa por píxel, recorte con stencil y mezcla premultiplicada. Menos dependencias y control total del mapeo. |
| Geometría | Coordenadas **normalizadas 0..1** del fotograma de salida | Cambiar la resolución con la misma proporción no altera la calibración. |
| Estado del editor | zustand + immer (documento inmutable) | Deshacer y rehacer baratos (estructura compartida), incluso arrastrando vértices a 60 fps. |
| Persistencia | Carpeta de proyecto autocontenida con `project.vmsp` (JSON) + `assets/` | Se puede copiar o mover la carpeta entera sin romper rutas (todas son relativas). No hace falta base de datos. |
| Validación | zod + versión de esquema + migraciones | Nunca se descarta un proyecto antiguo en silencio; los errores indican el campo. |
| Audio | Web Audio API, programado con antelación | El reloj de AudioContext es el reloj maestro: imagen y sonido comparten referencia. |
| Contenido | Paquetes (`pack.json` + archivos) sin código ejecutable | Reutilizable entre proyectos y años. Navidad será un paquete nuevo, sin cambios de código. |
| Empaquetado | electron-builder: NSIS + ZIP portátil | Gratuito; el ZIP permite usar la aplicación sin instalarla. |

Descartado por ahora: base de datos (innecesaria), servidor local (innecesario), FFmpeg integrado (pesado y con licencias delicadas; el usuario convierte con herramientas externas), autodetección de ventanas por cámara (fase posterior, opcional).

## Componentes

```
 Proceso principal (Node)                      Ventanas (Chromium, sandbox, sin Node)
 ┌───────────────────────────┐   IPC tipado   ┌──────────────────────────────────────┐
 │ main.ts  ventanas/pantallas│◄──────────────►│ Editor (React)                       │
 │ projectStore  archivos     │  preload       │  store (documento + deshacer)        │
 │ packStore     paquetes     │  editor.cjs    │  pantallas: Inicio, Calibración,     │
 │ protocol  vmapp://local/*  │                │  Biblioteca, Personajes, Espectáculos│
 │ settings, logger           │                │  Reproducción, Ajustes               │
 └────────────┬──────────────┘                │  Player (previsualización)           │
              │ reenvía órdenes/estado          └──────────────────────────────────────┘
              ▼
 ┌──────────────────────────────────────┐
 │ Salida (output.html)  preload output │   Player autónomo: recibe documento y órdenes,
 │  Player → GLRenderer, MediaManager,  │   reproduce con su propio reloj y envía estado
 │  AudioEngine                         │   (tiempo, fps, errores) 4 veces por segundo.
 └──────────────────────────────────────┘
```

- **`src/shared`** (puro, sin DOM, probado con Vitest): `model.ts` (esquemas), `schema.ts` (validación y migración), `geometry.ts` (homografías, polígonos, triangulación con earcut, validaciones), `timeline.ts` (maquetación de escenas, pesos de transición, evaluación de clips, cues de audio, matriz de contenido), `motion.ts` (movimientos como funciones del tiempo), `factory.ts` (creación, duplicado y reasignación), `pack.ts`.
- **`src/renderer/engine`**: `glRenderer.ts` (shaders), `media.ts` (imágenes rasterizadas, vídeos por clip, secuencias, liberación), `audio.ts`, `player.ts` (une todo; se usa igual en el proyector y en la previsualización, de modo que la vista previa coincide con la salida).

## Modelo de datos (resumen)

- **Proyecto**: `installations[]`, `assets[]`, `characters[]`, `shows[]`, `collections[]` y `schemaVersion`.
- **Instalación** (lugar físico): resolución de salida, `surfaces[]`, `masks[]` globales, foto de referencia y fecha de calibración.
- **Superficie**: `quad` (4 esquinas que definen la perspectiva del contenido), `shape` (`quad` o `polygon`), `polygon` (contorno de recorte para arcos y formas irregulares), `masks[]` propias, `aspect` real opcional, tipo, grupo, color, visibilidad y bloqueo.
- **Recurso**: archivo relativo, tipo (imagen, vídeo, audio o secuencia), metadatos, transparencia, etiquetas, colecciones, licencia y miniatura.
- **Personaje**: animaciones (recurso + movimiento + duración + escala).
- **Espectáculo**: referencia a una instalación, `scenes[]` (clips por superficie y sonidos), `music[]`, bucle y volumen. **No duplica coordenadas**: los clips referencian superficies por id y se posicionan en el espacio uv de la superficie, así que mover una ventana no obliga a rehacer las animaciones.

## Tiempos

Hay un único reloj por reproductor (AudioContext.currentTime, o performance.now si no hay audio) y todo se deriva de él en cada fotograma:

- tiempo del espectáculo → ciclo (bucle + pausa) → **tiempo de escena** (según la maqueta de escenas, con solapes en los fundidos cruzados) → **tiempo de clip** → **tiempo de medio** (× velocidad, módulo de la duración real si hay bucle).
- Los vídeos se resincronizan si se desvían más de 0,3 s; en pausa se colocan en el fotograma exacto.
- Los sonidos se programan en AudioContext con su desfase si se entra a mitad, y se detienen con un fundido breve al pausar o saltar.
- Los movimientos son funciones puras del tiempo del clip: saltar a cualquier instante da siempre el mismo resultado.

## Canal de renderizado

Por cada superficie visible, en orden:

1. Contorno triangulado → stencil = 1.
2. Máscaras de exclusión (de la superficie y globales) → stencil = 0.
3. Cada capa activa se dibuja sobre el contorno con test stencil == 1. El fragment shader calcula `uv = H⁻¹·p` (homografía exacta, no afín), luego `c = M⁻¹·uv` (ajuste, posición, escala, rotación y movimiento del clip) y descarta fuera de `[0,1]`.

El resultado es que el contenido **nunca invade** superficies vecinas ni zonas excluidas, aunque el personaje se mueva fuera. Los SVG se rasterizan hasta 2048 px y las secuencias hasta 1024 px por fotograma. Los vídeos usan `requestVideoFrameCallback` para subir solo los fotogramas nuevos.

En calibración, en negro o en pausa solo se redibuja cuando algo cambia, para ahorrar GPU.

## Seguridad

- Ventanas con `contextIsolation`, `sandbox` y sin `nodeIntegration`. El preload expone solo operaciones concretas y el proceso principal comprueba que las peticiones de archivos vienen de la ventana del editor.
- El protocolo `vmapp://` sirve solo la interfaz compilada y archivos **dentro** de la carpeta del proyecto abierto (`resolveInside` impide `../` y rutas absolutas).
- Se bloquean la navegación externa, las ventanas emergentes, las descargas y los `<webview>`. Los permisos se deniegan salvo pantalla completa.
- Los proyectos y paquetes son JSON validado: nunca se ejecuta su contenido. Al importar solo se aceptan extensiones multimedia y el contenido no se interpreta.
- No se guardan claves de API ni datos personales. El registro técnico guarda solo mensajes técnicos.
- `enable-unsafe-swiftshader`: permite WebGL por software si la GPU no está disponible. Es aceptable porque la aplicación solo carga contenido local propio.

## Extensión futura

- **Generación con IA**: interfaz de «proveedor» (adaptador) que produzca archivos en la biblioteca. Será opcional, con credenciales en el almacén seguro del sistema y nunca en el proyecto. La reproducción nunca dependerá de él.
- **Calibración asistida por cámara**: módulo opcional que proponga cuadriláteros; la calibración manual seguirá siendo la base.
- **Deformación por malla (bezier/grid)** para superficies curvas: se añadiría como otra `shape` con su propio camino de dibujo, sin cambiar el modelo de clips.
