# Videomapping Studio — notas para sesiones de desarrollo

Aplicación Electron (Windows) para videomapping. Interfaz y documentación en español. Estado, limitaciones y siguiente tarea: `docs/ESTADO.md`.

## Comandos
- `npm run build` compila `dist/` (esbuild para main/preload, Vite para renderer). La app carga siempre `dist/`.
- `npm test` ejecuta las unitarias; `npm run typecheck` comprueba los tipos.
- `xvfb-run -a node tests/e2e/run.mjs [--long]` ejecuta la E2E con la app real (en Linux hace falta Xvfb; usa `--no-sandbox`).
- `npx electron-builder --win --x64` genera el instalador y el ZIP en `release/`. Desde Linux necesita `wine` (32+64) y `WINEDEBUG=-all`.
- `node scripts/run-ts.mjs scripts/pack-tools/build-halloween-pack.ts` regenera `pack.json`. El audio se regenera con `python3 scripts/pack-tools/synth_audio.py`.

## Convenciones
- Lógica pura y probada en `src/shared`; nada de DOM ni Electron allí.
- Coordenadas normalizadas 0..1 del fotograma de salida; los clips usan el espacio uv de la superficie.
- Toda modificación del documento pasa por `useStore().update(label, fn)` (immer, con historial). Para arrastres: `beginDrag` → `dragUpdate` → `endDrag(label)`.
- E/S solo en el proceso principal (`src/main`); las rutas de recursos son relativas al proyecto y se resuelven con `resolveInside`.
- Pruebas: `window.__vmStore` (editor), `window.__vmPlayer` (salida), `window.__vmPreviewPlayer` y `window.__vmCalibPlayer`. `Player.renderFrame()` + `r.readPixel()` comprueban píxeles. Las capturas de pantalla de WebGL bajo Xvfb pueden salir negras tras redimensionar la ventana: usa la lectura de píxeles.
- Cambiar el esquema → subir `SCHEMA_VERSION` y añadir la migración en `src/shared/schema.ts` con su prueba.
