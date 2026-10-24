# Estado del proyecto, limitaciones y hoja de ruta

## Registro de progreso

**2026-10-24, sesión 1: MVP 0.1.0**
- Fases 0-5 implementadas y verificadas con pruebas automáticas; fase 6 parcial (paquetes generados; pruebas en Windows pendientes).
- Núcleo: modelo y validación, geometría, línea de tiempo, motor WebGL2, audio y reproductor compartido entre la salida y la previsualización.
- Aplicación: Inicio, Calibración, Biblioteca, Personajes, Espectáculos (línea de tiempo), Reproducción y Ajustes.
- Contenido: paquete «Halloween infantil» generado por `scripts/pack-tools/` (SVG dibujados a mano, audio sintetizado con `synth_audio.py`, vídeo VP9 con alfa renderizado desde SVG). Para regenerar `pack.json`: `node scripts/run-ts.mjs scripts/pack-tools/build-halloween-pack.ts`.
- Empaquetado: instalador NSIS y ZIP portátil generados desde Linux con Wine; flujo de CI para Windows en `.github/workflows/windows.yml`.

## Limitaciones conocidas (reales)

1. **Sin detección automática** de puertas y ventanas: la calibración es manual (no requiere cámara).
2. **Superficies planas**: perspectiva de 4 esquinas + recorte poligonal. No hay deformación por malla para superficies curvas (columnas o cornisas curvas) ni varios proyectores con fusión de bordes.
3. **Formatos de vídeo**: los de Chromium. MP4 H.264 (sin alfa), WebM VP8/VP9 (con alfa) y Ogg Theora. MOV ProRes, HEVC con alfa y la mayoría de MKV/AVI no se reproducen: hay que convertirlos (ver guía). El audio de los vídeos se ignora; el sonido va en pistas de audio.
4. **GIF animado**: solo se ve el primer fotograma (usa WebM o una secuencia PNG).
5. **Secuencias PNG**: todas las imágenes se cargan en memoria (máx. 1024 px por fotograma). Para animaciones largas es mejor WebM.
6. **Sincronización**: imagen y sonido comparten el reloj de AudioContext. Los vídeos se corrigen si se desvían más de 0,3 s, así que no está pensado para sincronizar labios al fotograma.
7. **Un proyector por instalación**: una única salida activa a la vez.
8. **Rendimiento**: no medido aún en una GPU real; con renderizado por software (sin GPU) a 1080p ronda 20 fps.
9. **Salida de audio**: el dispositivo predeterminado de Windows; no se puede elegir otro desde el programa.
10. **Edición en la previsualización**: posición, escala y rotación de los clips se ajustan con números en el panel, no arrastrando sobre la vista previa.
11. **Instalador sin firma digital**: Windows SmartScreen avisa en la primera ejecución. No hay actualización automática.
12. **Generación de contenido con IA**: no integrada. Se importan archivos creados con cualquier herramienta externa.
13. **Paquete de ejemplo**: el «vídeo» del fantasma y la secuencia del murciélago son animaciones sencillas; los personajes cobran vida con los movimientos del programa, no con animación fotograma a fotograma.

## Mejoras futuras (por prioridad)

1. **Pruebas en Windows con el proyector** (lista de `docs/PRUEBAS.md`) y corregir lo que aparezca. Medir fps y memoria en 2 h de bucle.
2. **Arrastrar y escalar clips directamente sobre la previsualización** (asas como en calibración).
3. **Paquete de Navidad** (renos, muñeco de nieve, copos, luces), creado con las mismas herramientas.
4. **Modo «espectáculo programado»**: abrir la salida y empezar a una hora, y apagar a otra (para que funcione solo toda la noche).
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
