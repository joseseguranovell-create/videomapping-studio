# Videomapping Studio

Aplicación de escritorio para Windows para crear espectáculos de **videomapping** sobre fachadas, ventanas, puertas, escaparates y escenarios. Se coloca el proyector, se dibujan las superficies **sobre la imagen proyectada en directo**, se asignan animaciones a cada una y se programa el espectáculo con escenas, música y efectos.

Funciona sin conexión, sin suscripciones y sin depender de servicios de IA. Cada casa o edificio es un perfil de instalación reutilizable, y cada celebración es un espectáculo (Halloween, Navidad, cumpleaños…).

## Qué puede hacer ya (versión 0.1, MVP)

- **Calibración en directo**: salida a pantalla completa en el proyector y el editor en el monitor. Se dibujan rectángulos y polígonos, se ajustan esquinas con el ratón o con las flechas (1 px, o 10 px con Mayús), y hay **deformación de perspectiva real** (homografía), zonas de exclusión, patrones de prueba, bloqueo, deshacer y rehacer.
- **Varias instalaciones por proyecto**: otra casa u otra fachada sin tocar la original, duplicado y reasignación de superficies.
- **Reproducción**: imágenes (PNG, SVG, JPG), vídeo (MP4 H.264, WebM VP8/VP9 **con transparencia**), secuencias de PNG, efectos generados (luz de vela, resplandor, estrellas, arcoíris) y varias superficies a la vez con un **reloj compartido**.
- **Espectáculos**: escenas con duración, transiciones (corte, fundido, fundido cruzado) y una línea de tiempo por superficie con clips que se arrastran. También sonidos puntuales, música continua, bucle para toda la noche y previsualización.
- **Personajes**: cada uno agrupa varias animaciones (recurso + movimiento: flotar, saltar, saludar, asomarse, cruzar…).
- **Biblioteca**: importación con miniaturas y metadatos, búsqueda, etiquetas, colecciones, detección de transparencia, recursos ausentes y relocalización, y paquetes reutilizables (importar y exportar).
- **Efectos profesionales**: contornos de neón que se dibujan, luces de feria, relámpagos sincronizados con truenos, fuego, niebla, lluvia, nieve, barridos de luz, siluetas (sombras chinescas) y **plantillas de escena** de un clic.
- **Rótulos de texto animados** y **quitar fondo** (croma verde, blanco o negro) para usar directamente vídeos e imágenes generados con IA.
- **Una o dos pantallas**: pantalla completa siempre, «Preparar» y empezar con Espacio, y **calibración directa sobre la imagen proyectada** con ratón y teclado.
- **Control por agentes de IA** (Claude Desktop/Code vía MCP o HTTP local): ver [docs/AGENTES.md](docs/AGENTES.md).
- **Fiabilidad**: guardado atómico, copias de seguridad automáticas, guardado automático con recuperación tras un cierre inesperado, migración de versiones de formato y registro técnico.
- **Paquete «Halloween infantil»** con 7 personajes ilustrados originales, decorados, música y efectos sintetizados, una casa de ejemplo con 6 ventanas, puerta, desván y frontón, y un **espectáculo de 1 minuto** listo para adaptar.

## Instalar en Windows

1. Descarga `Videomapping-Studio-Setup-<versión>.exe` (instalador) o `Videomapping-Studio-<versión>-win-x64-portable.zip` (sin instalación: descomprimir y ejecutar `Videomapping Studio.exe`).
2. El ejecutable no está firmado digitalmente: Windows SmartScreen mostrará un aviso. Pulsa «Más información» y luego «Ejecutar de todas formas».
3. **Actualizar**: instala la versión nueva encima de la anterior. Los proyectos están en `Documentos\Videomapping Studio\Proyectos` y no se tocan.

Primeros pasos: [docs/GUIA-DE-USO.md](docs/GUIA-DE-USO.md).

## Desarrollo

Requisitos: Node.js 22 y npm.

```bash
npm ci                 # dependencias
npm run build          # compila proceso principal, preloads e interfaz
npm start              # compila y abre la aplicación
npm test               # pruebas unitarias (Vitest)
npm run typecheck      # comprobación de tipos
node tests/e2e/run.mjs # pruebas de extremo a extremo con la aplicación real (Playwright + Electron)
npm run dist:win       # instalador NSIS + ZIP portátil en release/
```

En Linux sin pantalla, ejecuta las pruebas E2E con `xvfb-run -a node tests/e2e/run.mjs` (añade `--long` para incluir 70 s de reproducción en tiempo real). Generar el instalador de Windows desde Linux requiere `wine` (32 y 64 bits). El flujo `.github/workflows/windows.yml` lo compila y prueba en Windows.

### Estructura

```
src/shared/     modelo de datos (zod), geometría, línea de tiempo, movimientos, paquetes (puro, probado)
src/main/       proceso principal Electron: ventanas, pantallas, protocolo de medios, archivos, copias
src/preload/    puentes seguros (contextBridge) del editor y de la salida
src/renderer/
  engine/       motor de reproducción: WebGL2, medios, audio, reproductor
  editor/       interfaz React (pantallas, componentes, estado con deshacer)
  output/       ventana de salida al proyector
resources/packs/ paquetes de contenido incluidos (Halloween infantil)
scripts/        compilación y herramientas para generar paquetes
tests/unit      pruebas unitarias · tests/e2e  pruebas con la app real
docs/           arquitectura, guía de uso, pruebas, estado y hoja de ruta
```

Documentación: [arquitectura y decisiones](docs/ARQUITECTURA.md) · [guía de uso](docs/GUIA-DE-USO.md) · [pruebas](docs/PRUEBAS.md) · [estado, limitaciones y hoja de ruta](docs/ESTADO.md).

## Licencia

Código: MIT. Contenido del paquete «Halloween infantil» (ilustraciones, música y sonidos): CC0, creado para este proyecto.

Tipos de letra de los rótulos (`src/renderer/engine/fonts/`): Creepster, Eater, Henny Penny, Griffy, Mystery Quest, Jolly Lodger, Pirata One, Cinzel Decorative, Bangers y Fredoka, todas con licencia SIL Open Font License 1.1 (el texto de cada licencia está junto a su archivo). Se incluyen en la aplicación; no se descarga nada.
