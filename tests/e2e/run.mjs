/**
 * Pruebas de extremo a extremo con la aplicación Electron real (Playwright).
 * Recorren los criterios de éxito del MVP: crear proyecto, calibrar, proyectar, importar,
 * reproducir, guardar, reabrir, duplicar, recursos ausentes, recuperación y reproducción prolongada.
 *
 * Uso:  npm run build && node tests/e2e/run.mjs            (en Linux sin pantalla: xvfb-run -a node ...)
 * Opciones: --long  (incluye una reproducción en tiempo real de un ciclo completo, ~70 s)
 *           SHOTS=<carpeta> para guardar capturas.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright');
const LONG = process.argv.includes('--long');
const SHOTS = process.env.SHOTS || null;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vms-e2e-'));
const userData = path.join(tmp, 'userdata');
const docs = path.join(tmp, 'docs');
const results = [];
let current = '';

function assert(cond, msg) {
  if (!cond) throw new Error(`Falla: ${msg}`);
}
async function step(name, fn) {
  current = name;
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`  ✔ ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, error: e.message });
    console.log(`  ✘ ${name}\n      ${e.message.split('\n').join('\n      ')}`);
    throw e;
  }
}

async function launch() {
  const env = { ...process.env, VMSTUDIO_USER_DATA: userData, VMSTUDIO_DOCUMENTS: docs };
  delete env.NODE_OPTIONS;
  const app = await electron.launch({ executablePath: require('electron'), args: ['.', '--no-sandbox'], env });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await win.waitForSelector('.app', { timeout: 20000 });
  return { app, win, errors };
}

const S = (win) => win.evaluate(() => {
  const s = window.__vmStore.getState();
  return { project: s.project, dirty: s.dirty, file: s.file, dir: s.dir, missing: s.missing, view: s.view, output: s.output, status: s.outputStatus, recover: s.recoverAvailable };
});

async function prompt(win, value) {
  await win.waitForSelector('[data-testid="dialog-input"]');
  await win.fill('[data-testid="dialog-input"]', value);
  await win.click('[data-testid="dialog-ok"]');
}

async function stubOpenDialog(app, paths) {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: p });
  }, paths);
}

async function outputPixel(out, points) {
  return out.evaluate((pts) => {
    const p = window.__vmPlayer;
    p.renderFrame();
    return pts.map(([x, y]) => p.r.readPixel(x, y));
  }, points);
}
const bright = (px) => (px[0] + px[1] + px[2]) / 3;

console.log(`Datos temporales: ${tmp}`);
let ctx = await launch();
let { app, win } = ctx;
let out = null;
let projectDir = null;

try {
  await step('1. La aplicación arranca y muestra Inicio', async () => {
    await win.waitForSelector('[data-testid="new-project"]');
    assert(ctx.errors.length === 0, `errores en consola: ${ctx.errors.join(' | ')}`);
  });

  await step('2. Crear proyecto nuevo vacío y una instalación', async () => {
    await win.click('[data-testid="new-project"]');
    await prompt(win, 'Casa de pruebas');
    await win.waitForSelector('[data-testid="create-installation"]');
    await win.click('[data-testid="create-installation"]');
    await prompt(win, 'Fachada principal');
    await win.waitForSelector('[data-testid="calib-svg"]');
    const s = await S(win);
    assert(s.project.name === 'Casa de pruebas', 'nombre del proyecto');
    assert(s.project.installations.length === 1, 'instalación creada');
    assert(fs.existsSync(path.join(s.dir, 'project.vmsp')), 'carpeta de proyecto en disco');
    projectDir = s.dir;
  });

  await step('3. Dibujar dos ventanas y una puerta con el ratón', async () => {
    const box = await win.locator('[data-testid="calib-svg"]').boundingBox();
    const drag = async (x0, y0, x1, y1) => {
      await win.click('[data-testid="tool-rect"]');
      await win.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
      await win.mouse.down();
      await win.mouse.move(box.x + box.width * ((x0 + x1) / 2), box.y + box.height * ((y0 + y1) / 2), { steps: 4 });
      await win.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 4 });
      await win.mouse.up();
    };
    await drag(0.1, 0.1, 0.3, 0.35);
    await drag(0.6, 0.1, 0.8, 0.35);
    await drag(0.42, 0.5, 0.56, 0.95);
    let s = await S(win);
    const inst = s.project.installations[0];
    assert(inst.surfaces.length === 3, `3 superficies (hay ${inst.surfaces.length})`);
    const q = inst.surfaces[0].quad;
    assert(Math.abs(q[0].x - 0.1) < 0.01 && Math.abs(q[2].y - 0.35) < 0.01, `coordenadas de la primera ventana ${JSON.stringify(q)}`);
    // la tercera es una puerta
    await win.click('[data-testid="surface-item-2"]');
    await win.selectOption('[data-testid="surface-props"] select >> nth=0', 'door');
    await win.fill('[data-testid="surface-name"]', 'Puerta principal');
    await win.press('[data-testid="surface-name"]', 'Enter');
    s = await S(win);
    assert(s.project.installations[0].surfaces[2].kind === 'door' && s.project.installations[0].surfaces[2].name === 'Puerta principal', 'puerta renombrada');
  });

  await step('4. Ajustar una esquina arrastrando, deshacer y rehacer, mover 1 px con el teclado', async () => {
    await win.click('[data-testid="surface-item-0"]');
    const before = (await S(win)).project.installations[0].surfaces[0].quad[0];
    const c = await win.locator('[data-testid="corner-0"] circle').boundingBox();
    const box = await win.locator('[data-testid="calib-svg"]').boundingBox();
    await win.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
    await win.mouse.down();
    await win.mouse.move(c.x + c.width / 2 + box.width * 0.03, c.y + c.height / 2 + box.height * 0.02, { steps: 5 });
    await win.mouse.up();
    let after = (await S(win)).project.installations[0].surfaces[0].quad[0];
    assert(Math.abs(after.x - before.x - 0.03) < 0.004 && Math.abs(after.y - before.y - 0.02) < 0.004, `esquina movida ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    // perspectiva: la superficie ya no es rectangular y sigue siendo válida
    await win.click('[data-testid="undo"]');
    after = (await S(win)).project.installations[0].surfaces[0].quad[0];
    assert(Math.abs(after.x - before.x) < 1e-9, 'deshacer restaura la esquina');
    await win.click('[data-testid="redo"]');
    after = (await S(win)).project.installations[0].surfaces[0].quad[0];
    assert(Math.abs(after.x - before.x - 0.03) < 0.004, 'rehacer vuelve a aplicar');
    // teclado: seleccionar esquina con Tab y mover 1 px a la derecha
    await win.locator('[data-testid="calib-svg"]').hover();
    await win.keyboard.press('Tab');
    const sumX = (q) => q.reduce((n, p) => n + p.x, 0);
    const k0 = (await S(win)).project.installations[0].surfaces[0].quad;
    await win.keyboard.press('ArrowRight');
    const k1 = (await S(win)).project.installations[0].surfaces[0].quad;
    assert(Math.abs((sumX(k1) - sumX(k0)) * 1920 - 1) < 1e-6, `flecha = 1 px en un único vértice (${(sumX(k1) - sumX(k0)) * 1920})`);
    await win.keyboard.press('Shift+ArrowDown');
    const k2 = (await S(win)).project.installations[0].surfaces[0].quad;
    const sumY = (q) => q.reduce((n, p) => n + p.y, 0);
    assert(Math.abs((sumY(k2) - sumY(k1)) * 1080 - 10) < 1e-6, 'Mayús+flecha = 10 px');
  });

  await step('5. Dibujar una zona de exclusión poligonal', async () => {
    await win.keyboard.press('Escape');
    await win.keyboard.press('Escape');
    await win.evaluate(() => window.__vmStore.getState().set({ surfaceId: null }));
    await win.click('[data-testid="tool-mask"]');
    const box = await win.locator('[data-testid="calib-svg"]').boundingBox();
    for (const [x, y] of [[0.62, 0.25], [0.78, 0.25], [0.78, 0.4], [0.62, 0.4]]) await win.mouse.click(box.x + box.width * x, box.y + box.height * y);
    await win.keyboard.press('Enter');
    const s = await S(win);
    assert(s.project.installations[0].masks.length === 1 && s.project.installations[0].masks[0].points.length === 4, 'máscara global creada');
  });

  await step('6. Abrir la salida de proyección y comprobar la calibración en directo (píxeles)', async () => {
    const [w] = await Promise.all([app.waitForEvent('window'), win.click('[data-testid="calib-open-output"]')]);
    out = w;
    await out.waitForFunction(() => !!window.__vmPlayer);
    await win.waitForFunction(() => window.__vmStore.getState().outputStatus?.mode === 'calibration', null, { timeout: 10000 });
    const inst = (await S(win)).project.installations[0];
    const s0 = inst.surfaces[0];
    // un punto dentro de la primera ventana, otro fuera de todas, otro dentro de la máscara (segunda ventana)
    const cx = ((s0.quad[0].x + s0.quad[2].x) / 2) * 1920 + 37, cy = ((s0.quad[0].y + s0.quad[2].y) / 2) * 1080 + 23;
    const [inside, outside, masked, inside2] = await outputPixel(out, [[cx, cy], [1900, 1060], [0.7 * 1920, 0.3 * 1080], [0.7 * 1920, 0.12 * 1080]]);
    assert(bright(inside) > 25, `dentro de la ventana hay patrón (${inside})`);
    assert(bright(outside) < 5, `fuera de las superficies es negro (${outside})`);
    assert(bright(masked) < 5, `la zona de exclusión no se proyecta (${masked})`);
    assert(bright(inside2) > 25, `la parte no excluida de la segunda ventana sí se proyecta (${inside2})`);
    // modificar una esquina en el editor se refleja en la salida
    await win.evaluate(() => window.__vmStore.getState().update('test', (d) => { d.installations[0].surfaces[0].quad[0] = { x: 0.0, y: 0.0 }; }));
    await out.waitForTimeout(400);
    const [corner] = await outputPixel(out, [[0.03 * 1920, 0.03 * 1080]]);
    assert(bright(corner) > 20, `el cambio de geometría llega en directo a la salida (${corner})`);
    await win.click('[data-testid="undo"]');
    if (SHOTS) await out.screenshot({ path: `${SHOTS}/e2e-output-calibration.png` });
  });

  await step('7. Importar un vídeo MP4 y una imagen PNG con transparencia', async () => {
    const media = path.join(tmp, 'media');
    fs.mkdirSync(media);
    const fixtures = path.join(process.cwd(), 'tests/fixtures');
    fs.copyFileSync(path.join(fixtures, 'prueba.mp4'), path.join(media, 'prueba.mp4'));
    fs.copyFileSync(path.join(fixtures, 'estrella.png'), path.join(media, 'estrella.png'));
    fs.writeFileSync(path.join(media, 'malicioso.exe'), 'MZ');
    await win.click('[data-testid="nav-library"]');
    await stubOpenDialog(app, [path.join(media, 'prueba.mp4'), path.join(media, 'estrella.png'), path.join(media, 'malicioso.exe')]);
    await win.click('[data-testid="import-assets"]');
    await win.waitForFunction(() => window.__vmStore.getState().project.assets.length >= 2, null, { timeout: 15000 });
    const s = await S(win);
    const mp4 = s.project.assets.find((a) => a.name === 'prueba');
    const png = s.project.assets.find((a) => a.name === 'estrella');
    assert(mp4 && mp4.kind === 'video' && Math.abs(mp4.duration - 2) < 0.2 && mp4.width === 320, `metadatos del vídeo ${JSON.stringify(mp4 && { d: mp4.duration, w: mp4.width })}`);
    assert(mp4.hasAlpha === false, 'MP4 sin transparencia');
    assert(png && png.hasAlpha === true, 'PNG con transparencia detectada');
    assert(!s.project.assets.some((a) => a.name === 'malicioso'), 'los formatos no admitidos se rechazan');
    assert(fs.existsSync(path.join(s.dir, mp4.file)), 'el archivo se copió dentro del proyecto');
    await win.waitForSelector('[data-testid="toast-error"]');
  });

  await step('8. Añadir el paquete Halloween al proyecto (recursos y personajes)', async () => {
    await win.click('[data-testid="open-packs"]');
    await win.click('[data-testid="add-pack-halloween-infantil"]');
    await win.waitForFunction(() => window.__vmStore.getState().project.characters.length >= 7, null, { timeout: 15000 });
    const s = await S(win);
    assert(s.project.assets.length >= 23, `recursos tras el paquete: ${s.project.assets.length}`);
    assert(fs.existsSync(path.join(s.dir, 'assets/packs/halloween-infantil/files/personajes/fantasma.svg')), 'archivos del paquete copiados');
  });

  await step('9. Crear un espectáculo con escenas, personaje, vídeo, efecto, sonido y música', async () => {
    await win.click('[data-testid="nav-shows"]');
    await win.click('[data-testid="new-show"]');
    await prompt(win, 'Halloween 2026');
    await win.waitForSelector('[data-testid="timeline"]');
    // personaje en la ventana 1 (fila seleccionada por defecto: primera superficie)
    await win.click('[data-testid="add-character"]');
    await win.click('[data-testid="pick-animation"] >> nth=1'); // Boo: Flotar
    // vídeo en la ventana 2
    await win.click('[data-testid="tl-clip"] >> nth=0');
    let s = await S(win);
    const surf = s.project.installations[0].surfaces;
    await win.locator('.tl-row[data-surface-row] .tl-label').nth(1).click();
    await win.click('[data-testid="add-clip"]');
    await win.locator('[data-testid="pick-asset"]', { hasText: 'prueba' }).click();
    // efecto en la puerta
    await win.locator('.tl-row[data-surface-row] .tl-label').nth(2).click();
    await win.click('[data-testid="add-effect"]');
    await win.click('[data-testid="effect-glow"]');
    // sonido y música
    await win.click('[data-testid="add-sound"]');
    await win.locator('[data-testid="pick-asset"]', { hasText: 'Buuu' }).click();
    await win.click('[data-testid="add-scene"]');
    await win.click('[data-testid="add-character"]');
    await win.click('[data-testid="pick-animation"] >> nth=0');
    await win.evaluate(() => window.__vmStore.getState().set({ clipId: null, soundId: null, musicId: null }));
    await win.click('[data-testid="add-music"]');
    await win.locator('[data-testid="pick-asset"]', { hasText: 'Marcha' }).click();
    s = await S(win);
    const show = s.project.shows.find((x) => x.name === 'Halloween 2026');
    assert(show.scenes.length === 2, `2 escenas (${show.scenes.length})`);
    const sc = show.scenes[0];
    assert(sc.clips.length === 3, `3 clips en la escena 1 (${sc.clips.length})`);
    assert(sc.clips[0].surfaceId === surf[0].id && sc.clips[0].characterId, 'personaje en la ventana 1');
    assert(sc.clips[1].surfaceId === surf[1].id && sc.clips[1].source.type === 'asset', 'vídeo en la ventana 2');
    assert(sc.clips[2].surfaceId === surf[2].id && sc.clips[2].source.type === 'effect', 'efecto en la puerta');
    assert(sc.sounds.length === 1 && show.music.length === 1, 'sonido y música');
  });

  await step('10. Mover un clip en la línea de tiempo arrastrándolo', async () => {
    await win.click('[data-testid="scene-block-0"]');
    const bar = win.locator('[data-testid="tl-clip"]').nth(0);
    const b = await bar.boundingBox();
    const before = (await S(win)).project.shows.find((x) => x.name === 'Halloween 2026').scenes[0].clips[0].start;
    await win.mouse.move(b.x + 20, b.y + b.height / 2);
    await win.mouse.down();
    await win.mouse.move(b.x + 80, b.y + b.height / 2, { steps: 6 });
    await win.mouse.up();
    const after = (await S(win)).project.shows.find((x) => x.name === 'Halloween 2026').scenes[0].clips[0].start;
    assert(after > before, `el clip se desplaza en el tiempo (${before} → ${after})`);
  });

  await step('11. Reproducir en el proyector: clips coordinados en dos ventanas sin invadir vecinas', async () => {
    const s = await S(win);
    const show = s.project.shows.find((x) => x.name === 'Halloween 2026');
    await win.evaluate((id) => window.__vmStore.getState().set({ outputMode: 'show', outputShowId: id }), show.id);
    await win.waitForFunction(() => window.__vmStore.getState().outputStatus?.mode === 'show');
    // El vídeo importado dura 2 s (clip de 0 a 2 s): se reproduce desde 0,2 s y se comprueba a ~1,4 s.
    await out.evaluate(() => { window.__vmPlayer.seek(0.2); void window.__vmPlayer.play(); });
    await out.waitForTimeout(1200);
    const st = await out.evaluate(() => window.__vmPlayer.status());
    assert(st.playing && st.time > 1, `la salida reproduce (t=${st.time})`);
    assert(st.activeVideos >= 1, `vídeo activo (${st.activeVideos})`);
    assert(st.errors.length === 0, `sin errores de reproducción: ${st.errors.join(' | ')}`);
    const inst = s.project.installations[0];
    const center = (sf) => [((sf.quad[0].x + sf.quad[2].x) / 2) * 1920, ((sf.quad[0].y + sf.quad[2].y) / 2) * 1080];
    const between = [((inst.surfaces[0].quad[1].x + inst.surfaces[1].quad[0].x) / 2) * 1920, 0.2 * 1080];
    const [vidPx, gapPx, doorPx] = await outputPixel(out, [[center(inst.surfaces[1])[0], 0.13 * 1080], between, center(inst.surfaces[2])]);
    assert(bright(vidPx) > 20, `el vídeo se ve dentro de la ventana 2 (${vidPx})`);
    assert(bright(gapPx) < 5, `nada se proyecta entre ventanas (${gapPx})`);
    assert(bright(doorPx) > 10, `el efecto se ve en la puerta (${doorPx})`);
    if (SHOTS) await out.screenshot({ path: `${SHOTS}/e2e-output-show.png` });
    await out.evaluate(() => window.__vmPlayer.pause());
  });

  await step('12. Transparencia real de vídeo WebM VP9 (paquete): fondo transparente, cuerpo visible', async () => {
    // Clip del fantasma en vídeo sobre la puerta; esquina sin efecto de fondo.
    await win.evaluate(() => {
      const st = window.__vmStore.getState();
      st.update('test vídeo alfa', (d) => {
        const sh = d.shows.find((x) => x.name === 'Halloween 2026');
        const door = d.installations[0].surfaces[2];
        sh.scenes[0].clips = sh.scenes[0].clips.filter((c) => c.surfaceId !== door.id);
        sh.scenes[0].clips.push({ id: 'alpha-test', name: '', surfaceId: door.id, source: { type: 'asset', assetId: 'hx-ast-fantasma-video' }, characterId: null, animationId: null, start: 0, duration: 8, loop: true, playbackRate: 1, fit: 'contain', x: 0.5, y: 0.5, scale: 1, rotation: 0, flipX: false, opacity: 1, fadeIn: 0, fadeOut: 0, motion: { preset: 'none', intensity: 1, speed: 1 }, z: 0 });
      });
    });
    await out.evaluate(() => { window.__vmPlayer.seek(2); void window.__vmPlayer.play(); });
    await out.waitForTimeout(2000);
    const door = (await S(win)).project.installations[0].surfaces[2];
    const x0 = door.quad[0].x * 1920, x1 = door.quad[1].x * 1920, y0 = door.quad[0].y * 1080, y1 = door.quad[2].y * 1080;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const w = x1 - x0;
    const [body, corner] = await outputPixel(out, [[cx, cy + w * 0.12], [x0 + 3, y0 + 3]]);
    assert(bright(body) > 150, `cuerpo del fantasma visible (${body})`);
    assert(bright(corner) < 5, `fondo del vídeo transparente (${corner})`);
    await out.evaluate(() => window.__vmPlayer.pause());
  });

  await step('13. Guardar, cerrar y reabrir sin perder calibración ni recursos', async () => {
    await win.keyboard.press('Control+s');
    await win.waitForFunction(() => !window.__vmStore.getState().dirty);
    const before = await S(win);
    const onDisk = JSON.parse(fs.readFileSync(path.join(before.dir, 'project.vmsp'), 'utf8'));
    assert(onDisk.shows.some((x) => x.name === 'Halloween 2026'), 'el espectáculo está en disco');
    await app.close();
    ctx = await launch();
    ({ app, win } = ctx);
    await win.waitForFunction(() => !!window.__vmStore.getState().project, null, { timeout: 15000 });
    const after = await S(win);
    assert(after.project.name === 'Casa de pruebas', 'se reabre el último proyecto');
    assert(JSON.stringify(after.project.installations) === JSON.stringify(before.project.installations), 'calibración idéntica');
    assert(JSON.stringify(after.project.shows) === JSON.stringify(before.project.shows), 'espectáculos idénticos');
    assert(after.missing.length === 0, `sin recursos ausentes (${after.missing.length})`);
  });

  await step('14. Duplicar el espectáculo para otra versión sin modificar el original', async () => {
    await win.click('[data-testid="nav-shows"]');
    await win.selectOption('[data-testid="show-select"]', { label: 'Halloween 2026' });
    const orig = (await S(win)).project.shows.find((x) => x.name === 'Halloween 2026');
    await win.click('[data-testid="dup-show"]');
    await prompt(win, 'Halloween 2027');
    await win.fill('[data-testid="scene-name"]', 'Escena modificada');
    await win.press('[data-testid="scene-name"]', 'Enter');
    const s = await S(win);
    const copy = s.project.shows.find((x) => x.name === 'Halloween 2027');
    const orig2 = s.project.shows.find((x) => x.name === 'Halloween 2026');
    assert(copy && copy.id !== orig.id && copy.scenes[0].name === 'Escena modificada', 'copia editada');
    assert(JSON.stringify(orig2) === JSON.stringify(orig), 'el original no cambia');
  });

  await step('15. Crear un perfil para otra casa y adaptar una copia del espectáculo', async () => {
    await win.click('[data-testid="nav-calibrate"]');
    const origInst = (await S(win)).project.installations[0];
    await win.click('[data-testid="new-installation"]');
    await prompt(win, 'Casa de los abuelos');
    await win.click('[data-testid="add-window"]');
    await win.click('[data-testid="add-door"]');
    const s = await S(win);
    assert(s.project.installations.length === 2, 'dos instalaciones');
    assert(JSON.stringify(s.project.installations[0]) === JSON.stringify(origInst), 'la instalación original no cambia');
    await win.click('[data-testid="nav-shows"]');
    await win.selectOption('[data-testid="show-select"]', { label: 'Halloween 2027' });
    await win.selectOption('[data-testid="show-installation"]', { label: 'Casa de los abuelos' });
    await win.click('[data-testid="remap-apply"]');
    const s2 = await S(win);
    const adapted = s2.project.shows.find((x) => x.installationId === s2.project.installations[1].id);
    assert(adapted, 'existe una copia asignada a la nueva casa');
    const newIds = s2.project.installations[1].surfaces.map((x) => x.id);
    assert(adapted.scenes.every((sc) => sc.clips.every((c) => newIds.includes(c.surfaceId))), 'clips reasignados a superficies de la nueva casa');
    assert(s2.project.shows.find((x) => x.name === 'Halloween 2027').installationId === s2.project.installations[0].id, 'el espectáculo de origen sigue en la casa original');
    await win.keyboard.press('Control+s');
    await win.waitForFunction(() => !window.__vmStore.getState().dirty);
  });

  await step('16. Recurso ausente: aviso al abrir y relocalización', async () => {
    const s = await S(win);
    const a = s.project.assets.find((x) => x.name === 'prueba');
    const file = path.join(s.dir, a.file);
    const backup = path.join(tmp, 'prueba-copia.mp4');
    fs.copyFileSync(file, backup);
    fs.rmSync(file);
    await app.close();
    ctx = await launch();
    ({ app, win } = ctx);
    await win.waitForFunction(() => !!window.__vmStore.getState().project, null, { timeout: 15000 });
    let s2 = await S(win);
    assert(s2.missing.includes(a.id) && s2.missing.length === 1, `se detecta el recurso ausente (${s2.missing})`);
    await win.click('[data-testid="nav-library"]');
    await win.locator('[data-testid="asset-card"]', { hasText: 'prueba' }).click();
    await stubOpenDialog(app, [backup]);
    await win.click('[data-testid="relink-asset"]');
    await win.waitForFunction(() => window.__vmStore.getState().missing.length === 0, null, { timeout: 10000 });
    s2 = await S(win);
    assert(fs.existsSync(path.join(s2.dir, s2.project.assets.find((x) => x.id === a.id).file)), 'archivo relocalizado dentro del proyecto');
    await win.keyboard.press('Control+s');
    await win.waitForFunction(() => !window.__vmStore.getState().dirty);
  });

  await step('17. Recuperación tras cierre inesperado (guardado automático)', async () => {
    await win.evaluate(async () => {
      const st = window.__vmStore.getState();
      st.update('cambio no guardado', (d) => { d.description = 'cambio pendiente'; });
      await window.vm.project.autosave(window.__vmStore.getState().project);
    });
    app.process().kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 800));
    ctx = await launch();
    ({ app, win } = ctx);
    await win.waitForSelector('[data-testid="recover-banner"]', { timeout: 15000 });
    await win.click('[data-testid="recover"]');
    const s = await S(win);
    assert(s.project.description === 'cambio pendiente' && s.dirty, 'cambios recuperados');
    await win.keyboard.press('Control+s');
    await win.waitForFunction(() => !window.__vmStore.getState().dirty);
    assert(!fs.existsSync(path.join(s.dir, 'autosave.vmsp')), 'el autosave se elimina tras guardar');
    assert(fs.readdirSync(path.join(s.dir, 'backups')).length >= 1, 'existen copias de seguridad');
  });

  await step('18. Proyecto de ejemplo completo desde el paquete y barrido de todo el espectáculo', async () => {
    await win.click('[data-testid="nav-home"]');
    await win.click('[data-testid="example-halloween-infantil"]');
    await prompt(win, 'Ejemplo Halloween');
    await win.waitForSelector('[data-testid="timeline"]', { timeout: 15000 });
    const s = await S(win);
    assert(s.project.shows[0].scenes.length === 7 && s.project.installations[0].surfaces.length === 8, 'espectáculo de ejemplo con 7 escenas y 8 superficies');
    const [w] = await Promise.all([app.waitForEvent('window'), win.click('[data-testid="output-open"]')]);
    out = w;
    await out.waitForFunction(() => !!window.__vmPlayer);
    await win.evaluate((id) => window.__vmStore.getState().set({ outputMode: 'show', outputShowId: id }), s.project.shows[0].id);
    await win.waitForFunction(() => window.__vmStore.getState().outputStatus?.mode === 'show');
    // Barrido rápido de 5 ciclos completos: los vídeos y texturas deben liberarse (sin fugas).
    const r = await out.evaluate(async () => {
      const p = window.__vmPlayer;
      let maxVideos = 0, maxTex = 0;
      for (let cycle = 0; cycle < 5; cycle++) {
        for (let t = 0; t < 64; t += 0.5) {
          p.seek(cycle * 64 + t);
          p.renderFrame();
          maxVideos = Math.max(maxVideos, p.media.activeVideos);
          maxTex = Math.max(maxTex, p.r.textureCount);
          if (t % 8 === 0) await new Promise((res) => setTimeout(res, 30));
        }
      }
      return { maxVideos, maxTex, errors: p.errors, after: p.media.activeVideos };
    });
    assert(r.maxVideos <= 2, `vídeos simultáneos acotados (${r.maxVideos})`);
    assert(r.maxTex < 40, `texturas acotadas (${r.maxTex})`);
    assert(r.errors.length === 0, `sin errores: ${r.errors.join(' | ')}`);
  });

  await step('18b. Mover y escalar un clip arrastrando sobre la previsualización', async () => {
    await out.evaluate(() => window.__vmPlayer.pause());
    await win.click('[data-testid="scene-block-1"]');
    await win.locator('[data-testid="tl-clip"]', { hasText: 'Boo saluda' }).click();
    await win.waitForSelector('[data-testid="clip-box"]');
    const get = () => win.evaluate(() => { const s = window.__vmStore.getState(); const sh = s.project.shows[0]; const c = sh.scenes[1].clips.find((x) => x.id === s.clipId); return { x: c.x, y: c.y, scale: c.scale }; });
    const c0 = await get();
    const box = await win.locator('[data-testid="clip-box"]').boundingBox();
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await win.mouse.down();
    await win.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 10, { steps: 5 });
    await win.mouse.up();
    const c1 = await get();
    assert(c1.x > c0.x + 0.05 && c1.y > c0.y, `el clip se mueve dentro de la superficie (${c0.x.toFixed(3)} → ${c1.x.toFixed(3)})`);
    await win.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 10);
    await win.mouse.wheel(0, -200);
    await win.waitForTimeout(500);
    const c2 = await get();
    assert(c2.scale > c1.scale * 1.1, `la rueda escala el clip (${c1.scale.toFixed(2)} → ${c2.scale.toFixed(2)})`);
    await win.click('[data-testid="undo"]');
    await win.click('[data-testid="undo"]');
    const c3 = await get();
    assert(Math.abs(c3.x - c0.x) < 1e-9 && Math.abs(c3.scale - c0.scale) < 1e-9, 'deshacer devuelve posición y escala');
  });

  await step('18c. Reproducción programada: empieza sola dentro del horario y se apaga al terminar', async () => {
    await win.click('[data-testid="output-close"]');
    await win.waitForFunction(() => !window.__vmStore.getState().output.open);
    await win.click('[data-testid="nav-play"]');
    const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const now = new Date();
    await win.fill('[data-testid="schedule-start"]', hm(new Date(now.getTime() - 60000)));
    await win.fill('[data-testid="schedule-end"]', hm(new Date(now.getTime() + 3 * 60000)));
    const [w] = await Promise.all([app.waitForEvent('window', { timeout: 20000 }), win.click('label:has([data-testid="schedule-enabled"])')]);
    out = w;
    await out.waitForFunction(() => !!window.__vmPlayer);
    await win.waitForFunction(() => window.__vmStore.getState().outputStatus?.playing === true, null, { timeout: 15000 });
    await win.waitForSelector('[data-testid="schedule-status"]');
    // fin: horario que ya ha pasado
    await win.fill('[data-testid="schedule-start"]', hm(new Date(now.getTime() - 3 * 60000)));
    await win.fill('[data-testid="schedule-end"]', hm(new Date(now.getTime() - 2 * 60000)));
    await win.waitForFunction(() => { const s = window.__vmStore.getState(); return s.outputMode === 'black' && s.outputStatus && !s.outputStatus.playing; }, null, { timeout: 25000 });
    await win.click('label:has([data-testid="schedule-enabled"])');
    await out.evaluate(() => { window.__vmPlayer.seek(0); });
  });

  if (LONG) {
    await step('19. Reproducción en tiempo real de un ciclo completo con bucle (~70 s)', async () => {
      await win.evaluate((id) => window.__vmStore.getState().set({ outputMode: 'show', outputShowId: id }), (await S(win)).project.shows[0].id);
      await win.waitForFunction(() => window.__vmStore.getState().outputStatus?.mode === 'show');
      await out.evaluate(() => { window.__vmPlayer.seek(0); void window.__vmPlayer.play(); });
      const samples = [];
      for (let i = 0; i < 14; i++) {
        await out.waitForTimeout(5000);
        samples.push(await out.evaluate(() => { const s = window.__vmPlayer.status(); return { t: s.time, c: s.cycleTime, fps: s.fps, v: s.activeVideos, e: s.errors.length, a: window.__vmPlayer.audio.activeCount }; }));
      }
      console.log('      ' + samples.map((x) => `t=${x.t.toFixed(1)} c=${x.c.toFixed(1)} fps=${Math.round(x.fps)} v=${x.v} audio=${x.a}`).join('\n      '));
      const last = samples[samples.length - 1];
      assert(last.t > 68, `el reloj avanza (${last.t})`);
      assert(last.c < 10, `el espectáculo vuelve a empezar en bucle (ciclo ${last.c})`);
      assert(samples.every((x) => x.e === 0), 'sin errores durante la reproducción');
      const drift = Math.abs(last.t - 70);
      assert(drift < 1.5, `deriva del reloj respecto al tiempo real < 1,5 s (${drift.toFixed(2)})`);
    });
  }

  await step('20. Sin errores de interfaz durante toda la sesión', async () => {
    const relevant = ctx.errors.filter((e) => !/GPU stall|Electron Security/.test(e));
    assert(relevant.length === 0, relevant.join(' | '));
  });
} catch {
  if (SHOTS) {
    try { await win.screenshot({ path: `${SHOTS}/e2e-failure.png` }); } catch { /* ignorar */ }
  }
} finally {
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy()));
    await app.close();
  } catch { /* ignorar */ }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} pasos superados${failed.length ? ` — falló: ${failed[0].name}` : ''}`);
fs.writeFileSync(path.join(process.cwd(), 'tests/e2e/last-results.json'), JSON.stringify({ date: new Date().toISOString(), results }, null, 2));
process.exit(failed.length ? 1 : 0);
