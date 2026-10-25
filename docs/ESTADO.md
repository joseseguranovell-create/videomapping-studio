# Estado del proyecto, limitaciones y hoja de ruta

## Registro de progreso

**2026-10-24, sesión 1: MVP 0.1.0**
- Fases 0-5 implementadas y verificadas con pruebas automáticas; fase 6 parcial (paquetes generados; pruebas en Windows pendientes).
- Núcleo: modelo y validación, geometría, línea de tiempo, motor WebGL2, audio y reproductor compartido entre la salida y la previsualización.
- Aplicación: Inicio, Calibración, Biblioteca, Personajes, Espectáculos (línea de tiempo), Reproducción y Ajustes.
- Contenido: paquete «Halloween infantil» generado por `scripts/pack-tools/` (SVG dibujados a mano, audio sintetizado con `synth_audio.py`, vídeo VP9 con alfa renderizado desde SVG). Para regenerar `pack.json`: `node scripts/run-ts.mjs scripts/pack-tools/build-halloween-pack.ts`.
- Empaquetado: instalador NSIS y ZIP portátil generados desde Linux con Wine; flujo de CI para Windows en `.github/workflows/windows.yml`.

**2026-10-24, sesión 1 (continuación)**
- Primera instalación en Windows: la versión compilada desde Linux con Wine no abría. La compilada en Windows (GitHub Actions) sí funciona y se publica automáticamente en Releases tras comprobar que arranca.
- Salida a pantalla completa también con una sola pantalla; modo **Preparar** + **Espacio**; teclado sobre la proyección; **calibración directa sobre la imagen proyectada**.
- **Rótulos de texto** animados y **quitar fondo** (croma o fondo negro) en el motor.
- **Control por agentes de IA**: API local (`src/main/agentApi.ts`, `src/renderer/editor/agent.ts`) y servidor MCP sin dependencias (`resources/mcp/vmstudio-mcp.cjs`). Guía en `docs/AGENTES.md`.
- Esquema de proyecto v2 (migración automática desde v1).

**2026-10-24, sesión 1 (efectos profesionales)**
- Contornos con halo fuera de la superficie (neón, trazado progresivo, luces de feria), efectos de ambiente (relámpago, fuego, niebla, lluvia, nieve, luciérnagas, barrido) con modo «fachada», siluetas y plantillas de escena (`src/shared/templates.ts`).
- Espectáculo de ejemplo ampliado a 10 escenas (~1 min 40 s): neón inicial, tormenta con truenos, sombras chinescas y gran final con luces de feria y rótulo.
- Esquema v3. Rendimiento: los contornos y el fuego o la niebla son los efectos más costosos. Con renderizado por software bajan a ~10 fps; en una GPU integrada deberían ir fluidos (pendiente de confirmar en el portátil).

**2026-10-25: luces de casa, ayuda y vídeo de demostración**
- **Luces de casa** (esquema v7): luces del proyecto (`project.lights`) y pista de luces por escena (`scene.lights`) con encender en un color, apagar, relámpagos, parpadeo, vela y «como estaba». Lógica pura y probada en `src/shared/lights.ts`: órdenes con hora, `LightDriver` (resincroniza al saltar o cambiar de escena, también en modo directo), luces automáticas por escena y traducción a Home Assistant.
- **Home Assistant** (`src/main/homeAssistant.ts`, opcional y desactivado por defecto): solo `light.turn_on/turn_off` y `switch.turn_on/turn_off` de las entidades que el usuario permite; foto del estado antes de tocar cada luz y restauración al detener, negro, cerrar la salida o salir; ritmo limitado por luz; la clave va cifrada con safeStorage. Sin Home Assistant, las luces se simulan en pantalla. Prueba E2E con un Home Assistant falso (paso 18i).
- **Facilidad de uso**: guía «Primeros pasos» en Inicio, botón **Ayuda** y **F1** con la ayuda de cada pantalla, como mucho 3 avisos a la vez.
- **Vídeo de demostración** (Reproducción): graba el espectáculo con sonido en MP4 o WebM, sobre la foto de la fachada oscurecida, con un reproductor oculto aparte (paso 18j).

## Limitaciones conocidas (reales)

1. **Sin detección automática** de puertas y ventanas: la calibración es manual (no requiere cámara).
2. **Superficies planas**: perspectiva de 4 esquinas + recorte poligonal. No hay deformación por malla para superficies curvas (columnas o cornisas curvas) ni varios proyectores con fusión de bordes.
3. **Formatos de vídeo**: los de Chromium. MP4 H.264 (sin alfa), WebM VP8/VP9 (con alfa) y Ogg Theora. MOV ProRes, HEVC con alfa y la mayoría de MKV/AVI no se reproducen: hay que convertirlos (ver guía). El audio de los vídeos se ignora; el sonido va en pistas de audio.
4. **GIF animado**: solo se ve el primer fotograma (usa WebM o una secuencia PNG).
5. **Secuencias PNG**: todas las imágenes se cargan en memoria (máx. 1024 px por fotograma). Para animaciones largas es mejor WebM.
6. **Sincronización**: imagen y sonido comparten el reloj de AudioContext. Los vídeos se corrigen si se desvían más de 0,3 s, así que no está pensado para sincronizar labios al fotograma.
7. **Un proyector por instalación**: una única salida activa a la vez.
8. **Rendimiento**: no medido aún en una GPU real; con renderizado por software (sin GPU) a 1080p ronda 20 fps.
9. **Luces de casa**: solo Home Assistant (API REST local). Las luces reales responden con 0,1-0,5 s de retardo y se limitan a ~4 órdenes por segundo por luz (enchufes, 1 por segundo). Sin probar aún con luces reales.
10. **Vídeo de demostración**: se graba en tiempo real; la ventana debe estar a la vista mientras graba.
11. **Salida de audio**: el dispositivo predeterminado de Windows; no se puede elegir otro desde el programa.
12. **Edición en la previsualización**: se puede mover y escalar el clip seleccionado; la rotación es con Mayús+rueda o en el panel.
13. **Instalador sin firma digital**: Windows SmartScreen avisa en la primera ejecución. No hay actualización automática.
14. **Generación de contenido con IA**: no integrada. Se importan archivos creados con cualquier herramienta externa.
15. **Paquete de ejemplo**: el «vídeo» del fantasma y la secuencia del murciélago son animaciones sencillas; los personajes cobran vida con los movimientos del programa, no con animación fotograma a fotograma.

## Mejoras futuras (por prioridad)

1. **Pruebas en Windows con el proyector** (lista de `docs/PRUEBAS.md`) y corregir lo que aparezca. Medir fps y memoria en 2 h de bucle.
2. ~~Arrastrar y escalar clips sobre la previsualización~~ (hecho).
3. **Paquete de Navidad** (renos, muñeco de nieve, copos, luces), creado con las mismas herramientas.
4. ~~Modo programado~~ (hecho).
5. **Elegir el dispositivo de audio** (setSinkId) y salida por altavoces del proyector.
6. **Deformación por malla** (rejilla bezier) para superficies curvas o no planas.
7. **Plantillas de escena** (por ejemplo «aparece en todas las ventanas en cascada»).
8. **Reacción al sonido** (escala o brillo según el nivel de la música).
9. **Proveedores de IA opcionales** (adaptadores) para generar imágenes de personajes dentro de la Biblioteca, con autorización explícita y credenciales fuera del proyecto.
10. **Calibración asistida por cámara** (opcional): proyectar patrones y detectar esquinas.
11. **Control remoto** desde el móvil (play, pausa, negro) en la red local.
12. Exportar o importar el proyecto como un único archivo `.zip`.
13. Firma de código y actualizaciones automáticas.

## Próxima tarea concreta

Instalar en el PC con Windows, completar la lista «Pruebas manuales pendientes en Windows» de `docs/PRUEBAS.md` con la fachada real y anotar problemas. Después, en este orden: (2) edición directa sobre la previsualización y (4) modo programado para la noche de Halloween.
