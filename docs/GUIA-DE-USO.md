# Guía de uso

## 1. Preparación física (antes de abrir el programa)

1. **Coloca el proyector** donde no le dé la lluvia y no lo tapen personas ni coches, centrado frente a la fachada si es posible. Cuanto más perpendicular, menos deformación y más nitidez.
2. **Conéctalo** por HDMI al PC y pulsa **Win+P → «Extender»** (no «Duplicar»). En *Configuración → Pantalla*:
   - selecciona la pantalla del proyector y pon su **resolución nativa** (normalmente 1920×1080 o 1280×800);
   - pon la **escala al 100 %** para esa pantalla.
3. En el menú del proyector:
   - **desactiva la corrección trapezoidal (keystone)** automática; la deformación la hace el programa, que es más preciso;
   - ajusta **zoom y enfoque** hasta que la imagen cubra toda la zona que te interesa, y no los toques más (cualquier cambio obliga a recalibrar);
   - desactiva el modo ecológico o el apagado automático si interrumpe la proyección.
4. Ajusta el PC para que **no entre en reposo** (el programa ya impide que la pantalla se apague mientras la salida está abierta).

> El programa **no detecta automáticamente** puertas ni ventanas: sin cámara ni sistema de visión no hay forma fiable de hacerlo. La calibración manual funciona con cualquier fachada y no necesita hardware adicional.

## 1b. Una pantalla o dos

- **Dos pantallas (recomendado)**: el proyector es una segunda pantalla de Windows (**Win+P → «Extender»**). El editor se queda en el portátil y la imagen a pantalla completa va solo al proyector.
- **Una sola pantalla** (el PC solo ve el proyector, o está en modo «Duplicar»): la salida ocupa toda la pantalla y **se maneja con el teclado y el ratón sobre la propia proyección** (tabla de abajo). **Esc** sale de pantalla completa para volver al editor y **F** la recupera.

| Tecla sobre la proyección | Acción |
|---|---|
| **Espacio** | Empezar / pausar el espectáculo |
| **Inicio** | Volver al principio |
| **B** | Negro (otra vez: vuelve el espectáculo) |
| En espectáculo: **1–9** | Modo directo: esa escena se repite en bucle hasta que elijas otra (si estaba preparado, empieza) |
| En espectáculo: **→** / **←** (o **AvPág** / **RePág**) | Escena siguiente / anterior en bucle (sirve un mando de presentaciones) |
| En espectáculo: **L** / **Intro** | Dejar en bucle la escena que suena / salir del bucle y seguir el espectáculo desde ahí |
| **C** / **P** | Pasar a calibración / a espectáculo |
| **F**, **F11** o doble clic | Pantalla completa sí/no |
| **Esc** | Salir de pantalla completa |
| **H** | Mostrar u ocultar la ayuda en pantalla |
| En calibración: arrastrar | Mover esquinas (círculos de color), vértices (cuadrados blancos) o la superficie entera |
| En calibración: **Tab** / **Mayús+Tab** | Superficie siguiente / anterior |
| En calibración: **1–4** y **flechas** | Elegir esquina y moverla 1 px (**Mayús**: 10 px; sin esquina elegida se mueve toda la superficie) |
| En calibración: **R** / **D** | Añadir una ventana / una puerta donde está el ratón |
| **Ctrl+Z**, **Ctrl+Y**, **Ctrl+S** | Deshacer, rehacer, guardar |

## 2. Crear el proyecto y la instalación

1. **Inicio → Nuevo proyecto** (por ejemplo «Mi casa»), o **Crear proyecto** desde el ejemplo «Halloween infantil» para partir de una casa y un espectáculo ya hechos.
2. **Calibración → Nueva instalación** («Fachada principal»). En el panel derecho elige la **resolución de salida** del proyector.
3. Pulsa **Proyectar calibración**. Se abre la salida a pantalla completa en el proyector (o en la única pantalla). Puedes calibrar desde el editor o **directamente sobre la proyección** con el ratón y el teclado (ver §1b). Para probar sin pantalla completa elige «Ventana de prueba» en el selector de la barra superior.

## 3. Dibujar y ajustar las superficies (mirando la fachada)

- **Rectángulo**: arrastra en el lienzo sobre la zona aproximada de la ventana.
- **Polígono**: haz clic en cada esquina del contorno y pulsa Intro o haz doble clic para cerrar. Sirve para arcos, desvanes y frontones.
- **Ajusta las 4 esquinas de color** (1 rojo sup. izq., 2 verde sup. der., 3 azul inf. der., 4 amarillo inf. izq.) arrastrándolas **mientras miras la fachada real**. El patrón de cuadrícula se deforma en perspectiva; cuando sus líneas sigan los marcos de la ventana, la superficie está bien.
- **Precisión**:
  - **Mayús** mientras arrastras mueve 10 veces más despacio;
  - **Tab** selecciona la esquina siguiente y **flechas** la mueven 1 px (**Mayús+flechas**, 10 px);
  - la **rueda** del ratón hace zoom y el botón central o **Espacio+arrastrar** desplaza la vista.
- En polígonos, los cuadrados blancos son el **contorno de recorte**: clic en «+» para añadir un vértice y Alt+clic o clic derecho para quitarlo. Las 4 esquinas de color siguen definiendo la perspectiva del contenido.
- **Zonas de exclusión**: con la herramienta «Exclusión» dibuja polígonos donde no se debe proyectar (un árbol, un cristal, el hueco de un toldo). Si hay una superficie seleccionada, la máscara es suya; si no, es global.
- Usa **«Solo la seleccionada»** y el patrón **«Color de superficie»** para identificar cada ventana. **Bloquea** las superficies terminadas para no moverlas sin querer.
- **Ponles nombre** («Ventana salón», «Puerta») y tipo: después facilitan reasignar espectáculos a otra casa.
- Pulsa **Marcar calibrada** y **Guardar (Ctrl+S)**.

Atajos: Ctrl+Z / Ctrl+Y para deshacer o rehacer, Supr para borrar el vértice o la superficie (con confirmación) y Esc para cancelar.

**Foto de referencia (opcional)**: una foto de la fachada tomada desde el proyector permite preparar las superficies en casa, sin estar delante. En la calle hay que hacer el ajuste fino igualmente.

## 4. Biblioteca de recursos

**Biblioteca → Importar archivos…**: los archivos se **copian dentro del proyecto** (`assets/`), así que puedes mover o copiar la carpeta del proyecto sin romper nada.

| Uso | Formato recomendado | Notas |
|---|---|---|
| Personajes recortados | **PNG** o **SVG** con transparencia | Nítidos al proyectar; el movimiento lo aporta el programa. |
| Personajes animados recortados | **WebM VP9 con canal alfa** o **secuencia PNG** | Es el único vídeo con transparencia fiable en este motor. |
| Fondos o escenas completas | **MP4 H.264** | Sin transparencia: se proyecta todo el rectángulo del vídeo. |
| Música y efectos | MP3, OGG, WAV, M4A | |
| No admitidos | MOV ProRes 4444, HEVC con alfa, GIF animado (solo se ve el primer fotograma) | Conviértelos como se indica abajo. |

Si mueves o borras un archivo, al abrir el proyecto verás un aviso y los recursos marcados en rojo. Usa **Localizar / reemplazar archivo…**.

### Preparar contenido generado con IA (o con cualquier otra herramienta)

El programa no depende de ningún proveedor: usa cualquier herramienta que exporte imágenes o vídeo.

1. **Ilustraciones** (Midjourney, DALL·E, Stable Diffusion, Firefly…): pide «personaje simpático, estilo libro infantil, fondo liso». Quita el fondo con un editor gratuito (GIMP, Photopea, rembg) y exporta **PNG con transparencia**. Una imagen fija con un movimiento del programa (flotar, saltar, asomarse) suele quedar muy bien.
2. **Vídeos generados** (Runway, Pika, Kling, Luma…): casi siempre vienen en MP4 **sin transparencia**.
   - Si el fondo es negro y el personaje claro, en un proyector el negro no se ve: puedes usarlo tal cual.
   - Para recortarlo de verdad, pide un fondo de croma (verde liso) y conviértelo:

     ```bash
     ffmpeg -i fantasma.mp4 -vf "chromakey=0x00ff00:0.15:0.05,format=yuva420p" -c:v libvpx-vp9 -b:v 0 -crf 30 -auto-alt-ref 0 fantasma.webm
     ```
   - Desde una secuencia de PNG con transparencia:

     ```bash
     ffmpeg -framerate 24 -i frame_%04d.png -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 30 -auto-alt-ref 0 animacion.webm
     ```
   - Desde un MOV ProRes 4444 con alfa:

     ```bash
     ffmpeg -i entrada.mov -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 30 -auto-alt-ref 0 salida.webm
     ```
   - Vídeo sin transparencia reducido a MP4 compatible:

     ```bash
     ffmpeg -i entrada.mov -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart salida.mp4
     ```
3. **Bucles**: para que un vídeo en bucle no «salte», el primer y el último fotograma deben coincidir. Muchas herramientas de IA no lo garantizan; recórtalo o usa un fundido.
4. **Tamaño**: no hace falta más resolución que la de la superficie proyectada (un personaje en una ventana rara vez necesita más de 1024 px).

No se puede prometer que cualquier vídeo generado sirva para todo. Un personaje necesita **transparencia y continuidad** para entrar y salir de una ventana de forma convincente.

### Quitar el fondo dentro del programa

En **Biblioteca → (recurso) → Quitar fondo** puedes eliminar al reproducir:
- **un color**: fondo verde, azul o blanco. «Detectar» toma el color de la esquina;
- **lo oscuro**: fondos negros.

Así puedes usar directamente el MP4 o la imagen que te dé la IA. Si se come partes del personaje, baja la tolerancia; si queda un borde de color, súbela. El archivo original no se modifica.

**Consejos para generar con IA** (Suno para la música; Midjourney, Ideogram, Kling, Runway… para la imagen):
- Pide **«fondo verde liso, sin sombras, personaje completo y centrado»**.
- Para vídeo, pide **un gesto corto de 3 a 6 s con el personaje en el sitio** (saludar, parpadear, reír). El programa se encarga de desplazarlo, hacerlo entrar o asomarse.
- Para que una imagen fija tenga más vida, genera 2 o 3 variantes del mismo personaje (normal, saludando, sorprendido) y encadénalas en clips seguidos.

## 5. Personajes

**Personajes → nuevo personaje → Añadir animación**: cada animación es un recurso con un movimiento (Flotar, Saltar, Saludar, Asomarse por abajo o por arriba, Entrar o salir por un lado, Cruzar, Aparecer o desaparecer de golpe, Latir, Temblar, Girar…), una intensidad, una velocidad, una duración y una escala. Un mismo dibujo puede tener varias animaciones, y un personaje puede usar varios dibujos (variantes o expresiones).

## 6. Espectáculos

1. **Espectáculos → Nuevo espectáculo** y elige la **instalación**.
2. **Escenas** (franja inferior): añadir, duplicar, reordenar y borrar. Cada escena tiene su duración y una transición de entrada (corte, fundido a negro o fundido cruzado).
3. **Línea de tiempo**: una fila por superficie. Elige la fila (clic en su nombre), coloca el cursor en el segundo deseado (clic en la regla) y añade **Recurso**, **Personaje**, **Efecto** o **Sonido**.
   - Arrastra un clip para cambiar su inicio, **también a otra fila** (otra ventana).
   - Arrastra su borde derecho para cambiar la duración.
   - En el panel derecho ajustas posición, escala, rotación, opacidad, fundidos, movimiento, bucle, velocidad y capa.
4. **Música del espectáculo** (panel derecho sin nada seleccionado): suena de forma continua por encima de las escenas. Los **sonidos** de escena pueden cortarse al acabar la escena o seguir sonando.
5. **Previsualización**: Espacio reproduce o pausa y la barra permite saltar. Con «contornos» ves las superficies. Lo que ves aquí es exactamente lo que irá al proyector.
6. Ejemplo de secuencia: a los 0 s se ilumina la ventana izquierda (efecto «Luz de vela»), a los 2 s aparece un fantasma (personaje Boo, «Aparecer»), a los 4 s se esconde («Desaparecer») y a los 5 s se ilumina la ventana superior.

Para que un personaje **pase de una ventana a otra**, pon un clip «Salir por la derecha» o «Cruzar» en la primera ventana y, justo después, otro «Entrar por la izquierda» en la siguiente. El espectáculo de ejemplo lo hace con el murciélago.

### Efectos profesionales y plantillas

**Efecto** (en la línea de tiempo) incluye tres grupos:

- **Bordes y contornos**: contorno de neón, contorno que se dibuja y luces de feria. Siguen el borde exacto de cada ventana o puerta (también arcos y polígonos) y **su halo ilumina la pared de alrededor**. Ajusta el grosor en el panel derecho.
- **Luz y color**: luz de vela, resplandor, **barrido de luz**, arcoíris y color.
- **Ambiente**: **relámpago**, fuego, niebla, lluvia, nieve, estrellas y luciérnagas. Con «Continuo en toda la fachada», el efecto va sincronizado entre ventanas: el relámpago ilumina toda la casa a la vez y la lluvia cae «a través» de las ventanas.

**Plantilla** genera en un clic una coreografía en todas las superficies, escalonada de izquierda a derecha:
- neón que se dibuja;
- cascada de luz;
- **tormenta** (con truenos sincronizados);
- luces de feria;
- barrido;
- ventanas en llamas;
- nieve mágica;
- luciérnagas.

Después puedes retocar cada clip o deshacer con Ctrl+Z.

**Siluetas (sombras chinescas):** en cualquier clip de personaje, activa «Silueta». Pon debajo una luz en la ventana (luz de vela o color), y el personaje se verá como una sombra pasando por detrás de la cortina.

### Rótulos

**Espectáculos → línea de tiempo → Rótulo** añade un texto animado (por defecto «¡Feliz Halloween!») en la superficie elegida. En el panel derecho puedes cambiar:
- el texto (Intro para varias líneas);
- el tipo de letra: Terror (Creepster), Monstruo (Eater), Bruja (Henny Penny), Cuento (Griffy), Misterio (Mystery Quest), Calabaza (Jolly Lodger), Gótica (Pirata One), Elegante (Cinzel Decorative), Cómic (Bangers), Redondeada (Fredoka) o Simple. Son fuentes libres (licencia SIL OFL) incluidas en el programa: se ven igual en cualquier PC;
- el color, el contorno y el halo;
- el movimiento, igual que en cualquier clip: aparecer, latir, flotar…

## 7. La noche del espectáculo

1. **Reproducción**: elige el espectáculo y revisa las **comprobaciones previas** (calibración, recursos ausentes, audio, pantallas).
2. **Preparar** abre la salida a pantalla completa en negro y en espera; el espectáculo empieza con **Empezar** en el editor o con **Espacio** sobre la proyección. **Empezar** directamente hace las dos cosas. Con «Repetir en bucle» se repite toda la noche (con la pausa en negro configurada).
3. **Modo directo** (para recibir a las visitas o dejar algo tranquilo mientras llega «la parte buena»): con las teclas **1–9** sobre la proyección, o los botones del panel «Modo directo» en Reproducción, una escena se repite en bucle; al elegir otra, cambia con un fundido de 1 s sin cortar la música. **Intro** devuelve al espectáculo normal desde esa escena. Un mando inalámbrico de presentaciones (de los que pasan diapositivas) funciona como cambiador de escenas con sus botones de avanzar y retroceder.
4. **Negro** apaga la imagen al instante sin cerrar nada. La salida es independiente: puedes minimizar el editor.
5. El panel **Diagnóstico** muestra fps, vídeos activos y errores. Si indica «por software», actualiza los controladores de la GPU.

## 8. Otra casa, otro año, otra celebración

- **Otra casa**: Calibración → **Nueva instalación** (o duplicar una parecida y reajustarla). La original no cambia.
- **Llevar un espectáculo a otra casa**: Espectáculos → elige el espectáculo y cambia **Instalación** a la nueva. Se abre la herramienta de **reasignación** (propone superficies por nombre y tipo) y puedes **crear una copia adaptada** sin modificar el original. Revisa después posiciones y escalas, porque las ventanas de la otra casa tendrán otras proporciones.
- **Otro año**: Espectáculos → **Duplicar** («Halloween 2027») y modifica la copia.
- **Navidad u otra celebración**: crea un espectáculo nuevo e importa tus recursos, o un paquete de Navidad si lo tienes. No hace falta tocar el programa.
- **Duplicar el proyecto completo**: Inicio → **Duplicar proyecto…** crea una carpeta nueva con todos los recursos.

## 9. Copias de seguridad

- **Automáticas**: al guardar se conserva una copia del estado anterior como máximo cada 10 minutos (las 30 últimas) en `backups/` dentro del proyecto.
- **Guardado automático**: cada 30 s (configurable) se guarda `autosave.vmsp`. Tras un cierre inesperado, al abrir el proyecto aparece el aviso **Recuperar**.
- **Manuales**: **Ajustes → Copias de seguridad → Crear copia ahora** (con nombre, por ejemplo «antes de Navidad»). Desde ahí también puedes **restaurar** cualquier copia; se puede deshacer y no se guarda hasta que pulses Guardar.
- **Copia externa**: **Ajustes → Exportar proyecto completo…** a un USB o a la nube. También vale copiar la carpeta del proyecto desde el Explorador (`Documentos\Videomapping Studio\Proyectos\<nombre>`).
- **Paquetes**: **Biblioteca → Exportar paquete…** guarda personajes y recursos para reutilizarlos en otros proyectos o compartirlos.

## 9a. Actualizaciones

**Ajustes → Actualizaciones → Buscar actualizaciones** consulta en GitHub la última versión compilada y probada en Windows (solo cuando pulsas el botón). Si hay una nueva, **Descargar e instalar** la baja, comprueba su suma SHA-256, guarda el proyecto, abre el instalador y cierra el programa. Los proyectos y paquetes (en Documentos) no se tocan.

- Funciona en el programa **instalado** («Setup»). Con la versión portátil también puedes pulsarlo: se instalará la versión normal, y a partir de ahí usa esa.
- Si el repositorio de GitHub es **privado**, hace falta una clave de solo lectura (GitHub → Settings → Developer settings → Fine-grained tokens, acceso solo a ese repositorio y permiso de lectura de «Contents»). Se pega en el mismo panel y se guarda cifrada en el PC.

## 9b. Proyectores baratos (HY300 y similares)

- Su resolución real es **1280×720**, aunque digan aceptar 4K. Pon esa resolución en Windows para esa pantalla y elige «1280 × 720» en la instalación.
- **Desactiva el keystone automático y el enfoque automático**: si el proyector se reajusta solo, descuadra la calibración.
- Dan poca luz: proyecta de noche cerrada. Rinden mejor las fachadas claras y los colores saturados (naranja, amarillo, blanco) que los oscuros (morado, azul).
- Si el ventilador es ruidoso o se calienta, déjale espacio alrededor. El programa impide que la pantalla entre en reposo.

## 10. Problemas frecuentes

| Problema | Solución |
|---|---|
| El proyector no aparece en la lista | Win+P → Extender; revisa el cable; pulsa el botón de recargar en Ajustes → Pantallas. |
| La salida se abre en el monitor equivocado | Ciérrala, elige la pantalla correcta en la barra superior y vuelve a abrirla. |
| La imagen se ve borrosa | Usa la resolución nativa del proyector y la escala de Windows al 100 % en esa pantalla, y ajusta el enfoque. |
| Un vídeo no se ve | Formato no compatible: conviértelo a MP4 H.264 o WebM VP9 (ver §4). El diagnóstico lo indica. |
| Se ve el fondo negro de un vídeo | Es un MP4 sin transparencia: conviértelo a WebM con alfa o usa PNG. |
| No suena | Ajustes → Audio activado; dispositivo de salida predeterminado de Windows; volumen del espectáculo. |
| Va a saltos | Cierra otras aplicaciones; actualiza la GPU; reduce la resolución de los vídeos; mira «Gráficos» en el diagnóstico. |
| Moví el proyector | Recalibra: selecciona cada superficie y ajusta sus esquinas. Las animaciones no hay que rehacerlas. |
