# Control por agentes de IA

Videomapping Studio se puede manejar desde un asistente de IA (Claude Desktop, Claude Code o cualquier cliente MCP) o desde tus propios scripts. El agente puede, por ejemplo:

- consultar las superficies;
- crear escenas, rótulos y clips con personajes;
- importar archivos y quitarles el fondo;
- abrir la salida, reproducir o poner en negro;
- hacer una **captura** para ver el resultado.

Por ejemplo, puedes pedirle: *«Crea una escena de 8 segundos en la que Boo aparezca en la ventana central y luego salga el rótulo "¡Feliz Halloween, Leo!" en la puerta. Después enséñame una captura.»*

## Seguridad

- Está **desactivado por defecto**. Se activa en **Ajustes → Control por agentes de IA**.
- Solo acepta conexiones **desde el propio PC** (127.0.0.1) que lleven la **clave**. Rechaza peticiones que vengan de páginas web.
- Todo lo que hace el agente pasa por el historial («Agente: …»): se puede **deshacer con Ctrl+Z** y no se guarda en disco hasta que el agente o tú lo guardéis.
- La URL y la clave se guardan en `%APPDATA%\Videomapping Studio\agent-api.json` mientras está activo.

## Opción 1: Claude Desktop (recomendado)

1. En Videomapping Studio: **Ajustes → Control por agentes de IA → activar**.
2. Pulsa **Copiar configuración**.
3. En Claude Desktop: **Ajustes → Desarrollador → Editar configuración**. Pega el contenido en `claude_desktop_config.json` (si ya tenías otros servidores, añade solo la entrada `videomapping-studio` dentro de `mcpServers`) y **reinicia Claude Desktop**.

Tendrá esta forma (las rutas las rellena el botón):

```json
{
  "mcpServers": {
    "videomapping-studio": {
      "command": "C:\\Users\\TU_USUARIO\\AppData\\Local\\Programs\\videomapping-studio\\Videomapping Studio.exe",
      "args": ["C:\\Users\\TU_USUARIO\\AppData\\Local\\Programs\\videomapping-studio\\resources\\mcp\\vmstudio-mcp.cjs"],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}
```

`ELECTRON_RUN_AS_NODE=1` hace que el propio ejecutable de la aplicación ejecute el servidor MCP, así que **no hace falta instalar Node**. Videomapping Studio debe estar abierto y con el control activado mientras lo uses.

## Opción 2: Claude Code

```bash
claude mcp add videomapping-studio -e ELECTRON_RUN_AS_NODE=1 -- "C:\...\Videomapping Studio.exe" "C:\...\resources\mcp\vmstudio-mcp.cjs"
```

El botón **Copiar orden** de Ajustes la da con las rutas correctas. Con Node instalado también vale `node ruta\vmstudio-mcp.cjs`.

## Opción 3: tus propios scripts (HTTP)

`POST http://127.0.0.1:8765/api` con la cabecera `Authorization: Bearer <clave>` y un cuerpo `{ "accion": "...", "parametros": { ... } }`. La respuesta tiene la forma `{ "ok": true, "resultado": ... }` o `{ "ok": false, "error": "..." }`.

PowerShell:

```powershell
$c = Get-Content "$env:APPDATA\Videomapping Studio\agent-api.json" | ConvertFrom-Json
function VM($accion, $parametros = @{}) {
  Invoke-RestMethod -Method Post -Uri "$($c.url)/api" -Headers @{ Authorization = "Bearer $($c.token)" } `
    -ContentType 'application/json' -Body (@{ accion = $accion; parametros = $parametros } | ConvertTo-Json -Depth 10)
}
VM estado
VM anadir_rotulo @{ superficieId = 'Puerta principal'; texto = '¡Truco o trato!'; inicio = 1; duracion = 5 }
VM reproducir
```

## Acciones disponibles

Los ids y nombres se pueden usar indistintamente (superficie «Puerta principal», espectáculo «Halloween 2026»…). Si no se indica espectáculo o escena, se usa el seleccionado o la última escena.

| Acción | Parámetros | Qué hace |
|---|---|---|
| `estado` | — | Resumen con instalaciones, superficies (ids y esquinas), espectáculos, escenas, recursos, personajes, salida y opciones válidas. |
| `obtener_proyecto` | — | Documento completo (JSON, sin miniaturas). |
| `reemplazar_proyecto` | `proyecto` | Sustituye el documento entero (validado; se puede deshacer). |
| `obtener_escena` | `espectaculoId`, `escenaId` | Detalle de una escena. |
| `abrir_proyecto` | `ruta` | Abre un `project.vmsp` o su carpeta. |
| `crear_instalacion` | `nombre`, `ancho`, `alto` | Nueva instalación (otra casa). |
| `crear_superficie` | `nombre`, `tipo`, `x`, `y`, `ancho`, `alto`, `px?` | Superficie rectangular (0..1, o en píxeles con `px: true`). |
| `mover_esquinas` | `superficieId`, `esquinas` [[x,y]×4], `px?` | Fija la perspectiva (sup. izq., sup. der., inf. der., inf. izq.). |
| `crear_espectaculo` | `nombre`, `instalacionId?` | Espectáculo nuevo. |
| `crear_escena` | `nombre`, `duracion`, `transicion?` (cut, fade, crossfade), `posicion?` | Escena nueva. |
| `editar_escena` / `eliminar_escena` | `escenaId`, … | |
| `anadir_rotulo` | `superficieId`, `texto`, `letra?` (terror, monstruo, bruja, cuento, misterio, calabaza, gotica, elegante, gruesa, divertida, manuscrita, simple), `color?`, `contorno?`, `halo?` + campos de clip | Rótulo animado. |
| `anadir_clip` | `superficieId` + `recursoId` **o** `personajeId`+`animacion` **o** `efecto` + campos de clip | Imagen, vídeo, personaje o efecto. |
| `editar_clip` / `eliminar_clip` | `clipId`, … | |
| `generar_espectaculo` | `estilo` (infantil, terror, navidad), `nombre?`, `protagonistas?` [nombres de vídeos o personajes], `duracion?`, `rotulo?`, `despedida?`, `instalacionId?` | Asistente: compone un espectáculo entero listo para retocar. |
| `aplicar_plantilla` | `plantilla` (neonDibujo, cascadaLuz, tormenta, ojos, sombras, telon, cristalRoto, navidad, fuegosArtificiales, lucesFeria, barrido, incendio, nieveMagica, luciernagas), `escenaId?`, `inicio?` | Coreografía en todas las superficies. |
| `anadir_sonido` | `recursoId`, `inicio`, `volumen?`, `bucle?`, `continuar?` | Efecto de sonido en la escena. |
| `anadir_musica` | `recursoId`, `volumen?` | Música continua del espectáculo. |
| `importar_recurso` | `ruta`, `nombre?` | Copia un archivo al proyecto. |
| `quitar_fondo` | `recursoId`, `modo` (color, dark, none), `color?`, `tolerancia?`, `suavidad?` | Croma o fondo negro. |
| `pantallas` / `abrir_salida` / `cerrar_salida` | `pantallaId?` | Proyector. |
| `modo_salida` | `modo` (negro, calibracion, espectaculo) | |
| `reproducir` / `pausar` / `detener` / `ir_a` | `espectaculoId?`, `desde?` / `segundos` | Transporte. |
| `escena_en_bucle` | `escena?` (número desde 1 o nombre), `accion?` (escena, siguiente, anterior, mantener, salir), `espectaculoId?` | Modo directo: la escena se repite hasta que se pida otra. |
| `captura` | `de?` (salida, editor) | PNG en base64 de lo que se proyecta. |
| `guardar` / `deshacer` / `rehacer` | — | |

**Campos de clip:**

- `inicio`, `duracion`, `x`, `y` (0..1 dentro de la superficie), `escala`, `rotacion`, `opacidad`, `fundidoEntrada`, `fundidoSalida`, `bucle`, `voltear`, `capa`, `ajuste` (contain, cover, stretch).
- `movimiento`: none, float, bounce, wave, lookAround, pulse, shake, spin, popIn, popOut, peekLeft, peekRight, peekBottom, peekTop, enterLeft, enterRight, exitLeft, exitRight, crossLeftToRight, crossRightToLeft, rise, grow o shrink.
- `intensidad` y `velocidad` del movimiento.
- `silueta` (true/false) y `colorSilueta`, para dibujar un personaje como sombra.
- Efectos (`efecto`): solid, glow, stars, flicker, rainbow, **neon, drawOn, chase** (contornos; `grosor` en px), **sweep, lightning, fire, fog, rain, snow, fireflies**, de Halloween **eyes** (ojos en la oscuridad) y **spirits** (espíritus), ventanas falsas **shadowPass, curtains, shutters, stainedGlass**, de impacto **cracks, glitch, pulse, searchlight, fireworks** y de invierno **frost, aurora, shootingStars**. `espacio: "fachada"` hace que vayan sincronizados en toda la casa.

## Opción 4: editar el archivo del proyecto

`project.vmsp` es JSON legible y validado al abrir (modelo en `src/shared/model.ts`, resumido en `docs/ARQUITECTURA.md`). Un agente que trabaje con archivos puede modificarlo **con la aplicación cerrada** (o volviendo a abrir el proyecto después). Si el formato es incorrecto, al abrir se indica el campo exacto y no se pierde nada. Hay copias de seguridad en `backups/`.

Para trabajos grandes es preferible `obtener_proyecto` → modificar → `reemplazar_proyecto` con la aplicación abierta: se valida, se ve al momento y se puede deshacer.
