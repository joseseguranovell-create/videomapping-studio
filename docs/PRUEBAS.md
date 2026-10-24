# Pruebas

## Automáticas

| Conjunto | Comando | Qué cubre |
|---|---|---|
| Unitarias (Vitest) | `npm test` | Homografías (esquinas, inversa, perspectiva real frente a afín, degenerados), polígonos (cruzados, vértices fuera de orden, cóncavos, triangulación), límites 0/1, cambios de resolución, validación de instalaciones; maquetación de escenas, fundidos y fundidos cruzados (pesos que suman 1), bucle con pausa, reloj tras horas, tiempo de medio con bucle, fundidos de clip, todos los movimientos, matriz de contenido (ajustes, rotación sin deformar, volteo), cues de audio; formato de proyecto (ida y vuelta, valores por defecto, migración, versiones futuras, datos corruptos), duplicar y reasignar; almacenamiento (escritura atómica, nombres únicos, autoguardado, archivo dañado, copias, migración con copia previa, rutas relativas, rechazo de formatos, rutas fuera del proyecto, recursos ausentes, secuencias en orden natural, «guardar como»); paquetes (validez del paquete incluido, importación sin duplicados, exportación). |
| De extremo a extremo (Playwright + Electron real) | `npm run build && node tests/e2e/run.mjs [--long]` | 19 pasos (20 con `--long`) que recorren los criterios de éxito con la aplicación real: ver abajo. |
| Dos pantallas | `node tests/e2e/multidisplay.mjs` (con proyector o segundo monitor conectado) | Detección de pantallas, preselección de la pantalla sin editor, salida a pantalla completa en el proyector, editor sin moverse y cierre seguro al desconectar el proyector. |

### Pasos de la prueba E2E

1. Arranque sin errores.
2. Proyecto nuevo + instalación (carpeta en disco).
3. Dibujar 2 ventanas y 1 puerta **con el ratón**; coordenadas correctas; cambiar tipo y nombre.
4. Arrastrar una esquina (perspectiva), deshacer, rehacer, Tab + flecha = 1 px, Mayús+flecha = 10 px.
5. Dibujar una zona de exclusión poligonal.
6. Abrir la salida: **lectura de píxeles en la ventana de salida**. Hay patrón dentro de la ventana, negro fuera, negro dentro de la exclusión y patrón en la parte no excluida. Un cambio de geometría en el editor llega en directo a la salida.
7. Importar MP4 + PNG con alfa (metadatos, transparencia detectada, archivo copiado); se rechaza un `.exe`.
8. Añadir el paquete Halloween (sin duplicados, archivos copiados).
9. Crear un espectáculo desde la interfaz: personaje, vídeo, efecto, sonido, segunda escena y música.
10. Arrastrar un clip en la línea de tiempo.
11. Reproducir en la salida: vídeo en la ventana 2, efecto en la puerta y **negro entre ventanas** (no invade); sin errores.
12. **Transparencia real** de WebM VP9: cuerpo del fantasma visible y esquinas del vídeo transparentes.
13. Guardar, cerrar y reabrir: calibración y espectáculos idénticos; sin recursos ausentes.
14. Duplicar el espectáculo y modificar la copia: el original no cambia.
15. Nueva instalación (otra casa) sin tocar la original; copia adaptada del espectáculo con superficies reasignadas.
16. Borrar un archivo: aviso al abrir y relocalización desde la Biblioteca.
17. Matar el proceso con cambios autoguardados: aviso de recuperación, recuperar y guardar (se elimina el autoguardado y existen copias de seguridad).
18. Proyecto de ejemplo completo y barrido de 5 ciclos: vídeos simultáneos ≤ 2, texturas acotadas, sin errores (liberación de memoria).
19. (`--long`) 70 s en tiempo real con bucle: el reloj avanza sin deriva (< 1,5 s), el espectáculo vuelve a empezar y no hay errores.
20. Sin errores de interfaz en toda la sesión.

### Resultados de la última ejecución (Linux, Xvfb, WebGL por software SwiftShader)

- Unitarias: **61/61** superadas.
- E2E: **24/24** superadas (más el paso de 70 s con `--long`, también superado). Deriva del reloj tras 70 s: ~0,2 s. FPS en la salida con renderizado por software a 1920×1080: 16-23 (en una GPU real se espera 60; **pendiente de medir en Windows**).
- Paquete Linux empaquetado (asar + `resources/packs`): arranca y crea el proyecto de ejemplo sin recursos ausentes.
- No ejecutado aquí: Windows real, proyector físico, dos pantallas reales (Xvfb no permite emular dos monitores RandR) y sonido audible (no hay tarjeta de sonido).

## Pruebas manuales pendientes en Windows (lista de comprobación)

Hazlas con el proyector conectado y marca cada punto:

**Instalación**
- [ ] El instalador se ejecuta (aviso de SmartScreen → «Ejecutar de todas formas») y crea los accesos directos.
- [ ] La versión ZIP portátil arranca descomprimida en cualquier carpeta.
- [ ] Ajustes → Información muestra la carpeta de proyectos en `Documentos\Videomapping Studio`.

**Pantallas y salida**
- [ ] Con Win+P → Extender aparecen 2 pantallas y se preselecciona la del proyector.
- [ ] «Abrir salida» la muestra a pantalla completa en el proyector, sin bordes ni cursor, y el editor sigue en el monitor.
- [ ] Desconectar el HDMI con la salida abierta la cierra (no aparece sobre el monitor) y reconectar permite abrirla otra vez.
- [ ] `node tests/e2e/multidisplay.mjs` (desde una copia del código) termina con todos los puntos ✔.

**Calibración en la fachada**
- [ ] Las esquinas se pueden ajustar mirando la fachada; el patrón de cuadrícula sigue los marcos.
- [ ] Ajuste con flechas de 1 px visible en la proyección.
- [ ] Una zona de exclusión deja realmente a oscuras la zona física (árbol, cristal).
- [ ] Guardar, cerrar el programa, volver a abrir: las superficies coinciden con la fachada sin retocar.

**Reproducción**
- [ ] El espectáculo de ejemplo se reproduce fluido (Reproducción → Diagnóstico ≈ 60 fps; «Gráficos» muestra la GPU real, no SwiftShader).
- [ ] El fantasma en vídeo (escena «Estrellas mágicas») se ve **sin rectángulo negro** alrededor.
- [ ] La música y los efectos suenan sincronizados con las apariciones (Boo con «¡Buuu!», calabazas con «boing»).
- [ ] Ajustes → desactivar audio: silencio total.
- [ ] Reproducción de 2 horas en bucle sin cortes, sin aumento continuo de memoria (Administrador de tareas) y sin que se apague la pantalla.
- [ ] Un MP4 de un móvil y un vídeo generado con IA se importan y se reproducen (o el diagnóstico explica por qué no).

**Fiabilidad**
- [ ] Cerrar con cambios sin guardar muestra el aviso «Guardar y salir / Salir sin guardar / Cancelar».
- [ ] Forzar el cierre desde el Administrador de tareas tras un cambio: al volver a abrir se ofrece recuperar.
- [ ] Copiar la carpeta del proyecto a otro PC o USB y abrirla allí: todo funciona.
