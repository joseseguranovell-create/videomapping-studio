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

/** Fija el valor de un <input> de forma compatible con React (Playwright no escribe en type=time en Windows). */
async function setInput(win, selector, value) {
  await win.evaluate(({ selector, value }) => {
    const el = document.querySelector(selector);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, { selector, value });
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

  await step('1b. Proyecto vacío + paquete: la casa del paquete llega a Calibrar', async () => {
    await win.click('[data-testid="new-project"]');
    await prompt(win, 'Desde paquete');
    await win.waitForSelector('[data-testid="create-installation"]');
    await win.click('[data-testid="nav-library"]');
    await win.click('[data-testid="open-packs"]');
    assert(await win.locator('.modal input[type="checkbox"]').first().isChecked(), 'sin casa en el proyecto, el paquete trae la suya por defecto');
    await win.click('[data-testid="add-pack-halloween-infantil"]');
    await win.waitForFunction(() => window.__vmStore.getState().project.installations.length === 1, null, { timeout: 15000 });
    await win.click('[data-testid="nav-calibrate"]');
    await win.waitForSelector('[data-testid="surface-list"]');
    const n = await win.locator('[data-testid^="surface-item-"]').count();
    assert(n === 8, `superficies visibles en Calibrar: ${n}`);
    const s = await S(win);
    assert(await win.evaluate(() => window.__vmStore.getState().showId) === s.project.shows[0].id, 'el espectáculo del paquete queda seleccionado');
    await win.keyboard.press('Control+s');
    await win.waitForFunction(() => !window.__vmStore.getState().dirty);
    await win.click('[data-testid="nav-home"]');
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

  await step('6b. Calibrar directamente sobre la proyección (ratón y teclado en la ventana de salida)', async () => {
    await win.evaluate(() => { const st = window.__vmStore.getState(); st.set({ surfaceId: st.project.installations[0].surfaces[0].id }); });
    await out.waitForTimeout(300);
    const q0 = (await S(win)).project.installations[0].surfaces[0].quad;
    const r = await out.evaluate(() => document.getElementById('wrap').getBoundingClientRect().toJSON());
    const P = (p) => [r.x + p.x * r.width, r.y + p.y * r.height];
    const [cx, cy] = P(q0[2]);
    await out.mouse.move(cx, cy);
    await out.mouse.down();
    await out.mouse.move(cx + r.width * 0.02, cy + r.height * 0.03, { steps: 5 });
    await out.mouse.up();
    await win.waitForTimeout(200);
    let q1 = (await S(win)).project.installations[0].surfaces[0].quad;
    assert(Math.abs(q1[2].x - q0[2].x - 0.02) < 0.004 && Math.abs(q1[2].y - q0[2].y - 0.03) < 0.004, `esquina 3 movida sobre la proyección ${JSON.stringify(q0[2])} → ${JSON.stringify(q1[2])}`);
    // teclado sobre la salida: esquina 1 y flecha = 1 px
    await out.keyboard.press('1');
    await out.keyboard.press('ArrowRight');
    await win.waitForTimeout(200);
    const q2 = (await S(win)).project.installations[0].surfaces[0].quad;
    assert(Math.abs((q2[0].x - q1[0].x) * 1920 - 1) < 1e-6, 'flecha en la salida = 1 px en la esquina elegida');
    // Tab cambia de superficie; R añade una ventana; Ctrl+Z la quita
    await out.keyboard.press('Tab');
    await win.waitForTimeout(150);
    const sel = await win.evaluate(() => window.__vmStore.getState().surfaceId);
    const ids = (await S(win)).project.installations[0].surfaces.map((x) => x.id);
    assert(sel === ids[1], 'Tab selecciona la siguiente superficie');
    await out.mouse.move(r.x + r.width * 0.5, r.y + r.height * 0.5);
    await out.keyboard.press('r');
    await win.waitForTimeout(200);
    assert((await S(win)).project.installations[0].surfaces.length === ids.length + 1, 'R añade una ventana');
    await out.keyboard.press('Control+z');
    await win.waitForTimeout(200);
    assert((await S(win)).project.installations[0].surfaces.length === ids.length, 'Ctrl+Z en la salida deshace');
    const hud = await out.evaluate(() => document.getElementById('hud').textContent);
    assert(/Calibración/.test(hud), `ayuda en pantalla visible (${hud.slice(0, 40)})`);
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
    // El vídeo importado dura 2 s: se alarga su clip (en bucle) para no depender de la velocidad del equipo.
    await win.evaluate((id) => window.__vmStore.getState().update('test', (d) => { const c = d.shows.find((x) => x.id === id).scenes[0].clips[1]; c.duration = 9; c.loop = true; const fx = d.shows.find((x) => x.id === id).scenes[0].clips[2]; fx.duration = 9; }), show.id);
    // La salida recibe el documento modificado de forma asíncrona: se espera a tenerlo antes de reproducir.
    await out.waitForFunction((id) => window.__vmPlayer.currentShow()?.id === id && window.__vmPlayer.currentShow().scenes[0].clips[1].duration === 9, show.id, { timeout: 10000 });
    await out.evaluate(() => { window.__vmPlayer.seek(0.2); void window.__vmPlayer.play(); });
    const videoDiag = async () => {
      const diag = await out.evaluate(() => {
        const p = window.__vmPlayer;
        const vids = [...p.media.videos.values()].map((v) => ({ status: v.status, rs: v.el.readyState, ns: v.el.networkState, t: v.el.currentTime, paused: v.el.paused, err: v.el.error ? `${v.el.error.code} ${v.el.error.message}` : null, src: v.el.currentSrc.slice(-50), w: v.el.videoWidth }));
        const sh = p.currentShow();
        return { vids, playing: p.playing, time: p.time, mode: p.mode.kind, scene: p.status().sceneName, errors: p.status().errors, audio: p.audio.ctx?.state, clips: sh?.scenes[0].clips.map((c) => [c.source.type, c.start, c.duration]) };
      });
      console.log('      diagnóstico vídeo: ' + JSON.stringify(diag));
    };
    try {
      await out.waitForFunction(() => window.__vmPlayer.media.activeVideos > 0 && window.__vmPlayer.time > 1, null, { timeout: 15000 });
    } catch (e) { await videoDiag(); throw e; }
    const st = await out.evaluate(() => window.__vmPlayer.status());
    assert(st.playing && st.time > 1, `la salida reproduce (t=${st.time})`);
    assert(st.activeVideos >= 1, `vídeo activo (${st.activeVideos})`);
    assert(st.errors.length === 0, `sin errores de reproducción: ${st.errors.join(' | ')}`);
    const inst = s.project.installations[0];
    const center = (sf) => [((sf.quad[0].x + sf.quad[2].x) / 2) * 1920, ((sf.quad[0].y + sf.quad[2].y) / 2) * 1080];
    const between = [((inst.surfaces[0].quad[1].x + inst.surfaces[1].quad[0].x) / 2) * 1920, 0.2 * 1080];
    // El primer fotograma del vídeo puede tardar en decodificarse en equipos lentos: se espera hasta 5 s.
    let vidPx, gapPx, doorPx;
    for (let k = 0; k < 20; k++) {
      [vidPx, gapPx, doorPx] = await outputPixel(out, [[center(inst.surfaces[1])[0], 0.13 * 1080], between, center(inst.surfaces[2])]);
      if (bright(vidPx) > 20) break;
      await out.waitForTimeout(250);
    }
    if (bright(vidPx) <= 20) await videoDiag();
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
        sh.scenes[0].clips.push({ id: 'alpha-test', name: '', surfaceId: door.id, source: { type: 'asset', assetId: 'hx-ast-fantasma-video' }, characterId: null, animationId: null, start: 0, duration: 8, loop: true, playbackRate: 1, fit: 'contain', x: 0.5, y: 0.5, scale: 1, rotation: 0, flipX: false, opacity: 1, fadeIn: 0, fadeOut: 0, motion: { preset: 'none', intensity: 1, speed: 1 }, z: 0, silhouette: false, silhouetteColor: '#000000' });
      });
    });
    await out.evaluate(() => { window.__vmPlayer.seek(2); void window.__vmPlayer.play(); });
    const door = (await S(win)).project.installations[0].surfaces[2];
    const x0 = door.quad[0].x * 1920, x1 = door.quad[1].x * 1920, y0 = door.quad[0].y * 1080, y1 = door.quad[2].y * 1080;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const w = x1 - x0;
    // Espera a que el vídeo esté decodificado (en equipos lentos puede tardar varios segundos).
    let body, corner;
    for (let i = 0; i < 30; i++) {
      [body, corner] = await outputPixel(out, [[cx, cy + w * 0.12], [x0 + 3, y0 + 3]]);
      if (bright(body) > 150) break;
      await out.waitForTimeout(500);
    }
    const diag = await out.evaluate(() => ({ st: window.__vmPlayer.status(), errs: window.__vmPlayer.errors }));
    console.log('      diagnóstico vídeo:', JSON.stringify({ t: diag.st.time, videos: diag.st.activeVideos, gpu: diag.st.gpu, errs: diag.errs }));
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
    await win.waitForFunction(() => window.__vmStore.getState().project?.description === 'cambio pendiente', null, { timeout: 10000 });
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
    assert(s.project.shows[0].scenes.length === 10 && s.project.installations[0].surfaces.length === 8, 'espectáculo de ejemplo con 10 escenas y 8 superficies');
    const [w] = await Promise.all([app.waitForEvent('window'), win.click('[data-testid="output-open"]')]);
    out = w;
    await out.waitForFunction(() => !!window.__vmPlayer);
    await win.evaluate((id) => window.__vmStore.getState().set({ outputMode: 'show', outputShowId: id }), s.project.shows[0].id);
    await win.waitForFunction(() => window.__vmStore.getState().outputStatus?.mode === 'show');
    // Barrido rápido de 5 ciclos completos: los vídeos y texturas deben liberarse (sin fugas).
    const r = await out.evaluate(async () => {
      const p = window.__vmPlayer;
      let maxVideos = 0, maxTex = 0;
      const period = p.duration() + p.currentShow().loopGap;
      for (let cycle = 0; cycle < 4; cycle++) {
        for (let t = 0; t < period; t += 0.5) {
          p.seek(cycle * period + t);
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

  await step('18a. Preparar en espera y empezar con Espacio sobre la proyección; B negro; Esc sale de pantalla completa', async () => {
    await win.click('[data-testid="nav-play"]');
    await win.click('[data-testid="play-prepare"]');
    await win.waitForFunction(() => { const s = window.__vmStore.getState(); return s.outputStatus?.mode === 'show' && !s.outputStatus.playing && s.outputStatus.time === 0; }, null, { timeout: 10000 });
    await out.waitForTimeout(400);
    await out.keyboard.press(' ');
    await win.waitForFunction(() => window.__vmStore.getState().outputStatus?.playing === true, null, { timeout: 10000 });
    await out.keyboard.press('b');
    await win.waitForFunction(() => window.__vmStore.getState().outputMode === 'black', null, { timeout: 5000 });
    await out.keyboard.press('b');
    await win.waitForFunction(() => window.__vmStore.getState().outputMode === 'show', null, { timeout: 5000 });
    const fs0 = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getTitle().startsWith('Salida'))?.isFullScreen());
    await out.keyboard.press('Escape');
    await out.waitForTimeout(800);
    const fs1 = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getTitle().startsWith('Salida'))?.isFullScreen());
    console.log(`      pantalla completa: antes=${fs0} después de Esc=${fs1}`);
    assert(fs1 === false, 'Esc sale de pantalla completa');
    await out.keyboard.press('f');
    await out.waitForTimeout(800);
    await out.evaluate(() => window.__vmPlayer.pause());
  });

  await step('18a2. Modo directo: escena en bucle con teclas, cambio con flechas y seguir el espectáculo', async () => {
    await win.click('[data-testid="nav-play"]');
    if (await win.locator('[data-testid="play-prepare"]').isEnabled()) await win.click('[data-testid="play-prepare"]');
    await win.waitForFunction(() => { const s = window.__vmStore.getState(); return s.outputStatus?.mode === 'show' && !s.outputStatus.playing; }, null, { timeout: 10000 });
    await out.waitForTimeout(400);
    const info = () => out.evaluate(() => ({ live: window.__vmPlayer.liveInfo(), playing: window.__vmPlayer.playing, scene: window.__vmPlayer.status().sceneName }));
    await out.keyboard.press('2');
    let i = await info();
    assert(i.live?.index === 1 && i.playing, `la tecla 2 pone la escena 2 en bucle y arranca (${JSON.stringify(i)})`);
    // Se adelanta el reloj del bucle casi una vuelta entera: sigue en la misma escena.
    const name = i.live.name;
    await out.evaluate(() => { const p = window.__vmPlayer; const D = p.currentShow().scenes.filter((s) => s.enabled)[1].duration; p.live.since -= D * 1.5; p.renderFrame(); });
    i = await info();
    assert(i.scene === name && i.live.index === 1, `al acabar la escena vuelve a empezar (${i.scene})`);
    await win.waitForFunction(() => window.__vmStore.getState().outputStatus?.live?.index === 1, null, { timeout: 5000 });
    await out.keyboard.press('ArrowRight');
    i = await info();
    assert(i.live?.index === 2, 'flecha derecha: siguiente escena');
    await out.keyboard.press('PageUp');
    await out.keyboard.press('PageUp');
    i = await info();
    assert(i.live?.index === 0, 'RePág dos veces: dos escenas atrás');
    await win.click('[data-testid="live-scene-3"]');
    await out.waitForFunction(() => window.__vmPlayer.liveInfo()?.index === 3, null, { timeout: 5000 });
    await out.keyboard.press('Enter');
    i = await info();
    const sh = await out.evaluate(() => window.__vmPlayer.currentShow().scenes.filter((s) => s.enabled).map((s) => s.name));
    assert(i.live === null && i.playing && i.scene === sh[3], `Intro: sigue el espectáculo desde esa escena (${i.scene})`);
    await out.keyboard.press('l');
    i = await info();
    assert(i.live?.index === 3, 'L deja en bucle la escena que suena');
    // Reloj de audio atascado (p. ej. altavoz desconectado): la imagen pasa al reloj del sistema y sigue a velocidad real.
    const clk = await out.evaluate(async () => {
      const p = window.__vmPlayer;
      if (p.clockSrc !== 'audio') return { skipped: true };
      p.clockWatch = { perf: performance.now() / 1000 - 3, ctx: p.audio.ctx.currentTime - 0.5 };
      await new Promise((r) => setTimeout(r, 200));
      const t0 = p.time, w0 = performance.now();
      await new Promise((r) => setTimeout(r, 1000));
      return { src: p.clockSrc, rate: (p.time - t0) / ((performance.now() - w0) / 1000) };
    });
    console.log(`      reloj: ${JSON.stringify(clk)}`);
    assert(clk.skipped || (clk.src === 'perf' && clk.rate > 0.9 && clk.rate < 1.1), 'con el audio atascado la imagen sigue a velocidad real');
    await out.evaluate(() => window.__vmPlayer.pause());
  });

  await step('18b. Mover y escalar un clip arrastrando sobre la previsualización', async () => {
    await out.evaluate(() => window.__vmPlayer.pause());
    await win.click('[data-testid="nav-shows"]');
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
    // La caja del clip se ha movido: se busca su posición real antes de usar la rueda.
    let c2 = c1;
    for (let k = 0; k < 4 && c2.scale <= c1.scale * 1.1; k++) {
      const b2 = await win.locator('[data-testid="clip-box"]').boundingBox();
      await win.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
      await win.mouse.wheel(0, -200);
      await win.waitForTimeout(500);
      c2 = await get();
    }
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
    await setInput(win, '[data-testid="schedule-start"]', hm(new Date(now.getTime() - 60000)));
    await setInput(win, '[data-testid="schedule-end"]', hm(new Date(now.getTime() + 3 * 60000)));
    const [w] = await Promise.all([app.waitForEvent('window', { timeout: 20000 }), win.click('label:has([data-testid="schedule-enabled"])')]);
    out = w;
    await out.waitForFunction(() => !!window.__vmPlayer);
    await win.waitForFunction(() => window.__vmStore.getState().outputStatus?.playing === true, null, { timeout: 15000 });
    await win.waitForSelector('[data-testid="schedule-status"]');
    // fin: horario que ya ha pasado
    await setInput(win, '[data-testid="schedule-start"]', hm(new Date(now.getTime() - 3 * 60000)));
    await setInput(win, '[data-testid="schedule-end"]', hm(new Date(now.getTime() - 2 * 60000)));
    await win.waitForFunction(() => { const s = window.__vmStore.getState(); return s.outputMode === 'black' && s.outputStatus && !s.outputStatus.playing; }, null, { timeout: 25000 });
    await win.click('label:has([data-testid="schedule-enabled"])');
    await out.evaluate(() => { window.__vmPlayer.seek(0); });
  });

  await step('18d. Control por agentes: API local + servidor MCP (escena, rótulo, quitar fondo, captura)', async () => {
    await win.click('[data-testid="nav-settings"]');
    // Actualizaciones: muestra la versión compilada sin conectarse a nada hasta que se pulse el botón.
    const upd = await win.locator('[data-testid="update-info"]').innerText();
    assert(/[0-9a-f]{7}|desarrollo/.test(upd), `versión compilada visible (${upd.replace(/\s+/g, ' ')})`);
    await win.click('label:has([data-testid="agent-enabled"])');
    const infoPath = path.join(userData, 'agent-api.json');
    for (let i = 0; i < 40 && !fs.existsSync(infoPath); i++) await win.waitForTimeout(100);
    assert(fs.existsSync(infoPath), 'se crea agent-api.json al activar');
    const { url, token } = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
    const api = async (accion, parametros = {}, tk = token) => {
      const r = await fetch(`${url}/api`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify({ accion, parametros }) });
      return { status: r.status, ...(await r.json()) };
    };
    const bad = await api('estado', {}, 'clave-mala');
    assert(bad.status === 401, 'sin la clave correcta se rechaza');
    const est = await api('estado');
    assert(est.ok && est.resultado.instalaciones[0].superficies.length === 8, 'estado devuelve las superficies');
    const sh = est.resultado.espectaculos[0];
    // escena de prueba al principio, sin fundidos
    const sc = await api('crear_escena', { espectaculoId: sh.id, nombre: 'Prueba agente', duracion: 6, transicion: 'cut', posicion: 0 });
    assert(sc.ok, `crear_escena: ${sc.error}`);
    const rot = await api('anadir_rotulo', { espectaculoId: sh.id, escenaId: sc.resultado.escenaId, superficieId: 'Ventana alta izquierda', texto: '¡Hola!', inicio: 0, duracion: 6, fundidoEntrada: 0, movimiento: 'none', escala: 1 });
    assert(rot.ok, `anadir_rotulo: ${rot.error}`);
    const imp = await api('importar_recurso', { ruta: path.join(process.cwd(), 'tests/fixtures/croma.png'), nombre: 'Croma de prueba' });
    assert(imp.ok, `importar_recurso: ${imp.error}`);
    assert((await api('quitar_fondo', { recursoId: imp.resultado.recursoId, modo: 'color', color: '#00ff00', tolerancia: 0.3 })).ok, 'quitar_fondo');
    const cl = await api('anadir_clip', { espectaculoId: sh.id, escenaId: sc.resultado.escenaId, superficieId: 'Ventana alta central', recursoId: imp.resultado.recursoId, inicio: 0, duracion: 6, fundidoEntrada: 0, ajuste: 'contain', escala: 1 });
    assert(cl.ok, `anadir_clip: ${cl.error}`);
    const err = await api('anadir_clip', { superficieId: 'No existe', recursoId: 'x' });
    assert(!err.ok && /superficie/.test(err.error), 'errores comprensibles');
    // salida
    assert((await api('abrir_salida')).ok, 'abrir_salida');
    out = (await app.windows()).find((w) => w.url().includes('output.html')) ?? out;
    await out.waitForFunction(() => !!window.__vmPlayer);
    assert((await api('modo_salida', { modo: 'espectaculo', espectaculoId: sh.id })).ok, 'modo_salida');
    await win.waitForFunction(() => window.__vmStore.getState().outputStatus?.mode === 'show');
    await out.evaluate(() => { window.__vmPlayer.pause(); window.__vmPlayer.seek(1); });
    const inst = (await S(win)).project.installations[0];
    const sf = (n) => inst.surfaces.find((x) => x.name === n);
    const box = (s) => ({ x0: s.quad[0].x * 1920, x1: s.quad[1].x * 1920, y0: s.quad[0].y * 1080, y1: s.quad[2].y * 1080 });
    // rótulo: alguna muestra de la ventana debe ser brillante
    const t = box(sf('Ventana alta izquierda'));
    const pts = [];
    for (let i = 1; i < 12; i++) for (let j = 2; j < 7; j++) pts.push([t.x0 + ((t.x1 - t.x0) * i) / 12, t.y0 + ((t.y1 - t.y0) * j) / 9]);
    let maxB = 0;
    for (let k = 0; k < 20 && maxB < 150; k++) { maxB = Math.max(...(await outputPixel(out, pts)).map(bright)); if (maxB < 150) await out.waitForTimeout(250); }
    assert(maxB > 150, `el rótulo se dibuja (brillo máx. ${maxB})`);
    // croma: el cuadrado blanco se ve y el fondo verde desaparece
    const c = box(sf('Ventana alta central'));
    const cx = (c.x0 + c.x1) / 2, cy = (c.y0 + c.y1) / 2, h = c.y1 - c.y0;
    let center, edge;
    for (let k = 0; k < 20; k++) { [center, edge] = await outputPixel(out, [[cx, cy], [cx - h / 2 + h * 0.1, cy]]); if (bright(center) > 200) break; await out.waitForTimeout(250); }
    assert(bright(center) > 200, `el cuadrado del recurso se ve (${center})`);
    assert(bright(edge) < 10 && edge[1] < 10, `el fondo verde se ha quitado (${edge})`);
    const cap = await api('captura');
    assert(cap.ok && cap.resultado.png.length > 1000, 'captura devuelve una imagen');
    assert((await api('escena_en_bucle', { espectaculoId: sh.id, escena: 2 })).ok, 'escena_en_bucle');
    await out.waitForFunction(() => window.__vmPlayer.liveInfo()?.index === 1, null, { timeout: 5000 });
    assert((await api('escena_en_bucle', { accion: 'salir' })).ok, 'salir del modo directo');
    await out.waitForFunction(() => window.__vmPlayer.liveInfo() === null, null, { timeout: 5000 });
    assert(!(await api('escena_en_bucle', { escena: 99 })).ok, 'escena inexistente rechazada');
    await out.evaluate(() => { window.__vmPlayer.pause(); window.__vmPlayer.seek(1); });
    if (SHOTS) fs.writeFileSync(`${SHOTS}/e2e-agente-captura.png`, Buffer.from(cap.resultado.png, 'base64'));
    // MCP por stdio
    const { spawn } = await import('node:child_process');
    const mcp = spawn(process.execPath, [path.join(process.cwd(), 'resources/mcp/vmstudio-mcp.cjs')], { env: { ...process.env, VMSTUDIO_API_FILE: infoPath } });
    const replies = [];
    let buf = '';
    mcp.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { replies.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
    const sendMcp = (m) => mcp.stdin.write(JSON.stringify(m) + '\n');
    sendMcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
    sendMcp({ jsonrpc: '2.0', method: 'notifications/initialized' });
    sendMcp({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    sendMcp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'estado', arguments: {} } });
    sendMcp({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'captura', arguments: {} } });
    for (let i = 0; i < 100 && replies.length < 4; i++) await new Promise((r) => setTimeout(r, 100));
    mcp.kill();
    const byId = Object.fromEntries(replies.map((r) => [r.id, r]));
    assert(byId[1]?.result?.serverInfo?.name === 'videomapping-studio', 'MCP initialize');
    assert(byId[2]?.result?.tools?.length >= 20, `MCP lista herramientas (${byId[2]?.result?.tools?.length})`);
    assert(/Prueba agente/.test(byId[3]?.result?.content?.[0]?.text ?? ''), 'MCP estado refleja los cambios del agente');
    assert(byId[4]?.result?.content?.[0]?.type === 'image', 'MCP captura devuelve imagen');
    // deshacer lo hecho por el agente
    const before = (await S(win)).project.shows[0].scenes.length;
    for (let i = 0; i < 6; i++) await api('deshacer');
    const after = (await S(win)).project.shows[0].scenes.length;
    assert(after === before - 1, `los cambios del agente se deshacen (${before} → ${after})`);
  });

  await step('18e. Contornos de neón (brillan fuera de la ventana), plantillas y siluetas', async () => {
    const { url, token } = JSON.parse(fs.readFileSync(path.join(userData, 'agent-api.json'), 'utf8'));
    const api = async (accion, parametros = {}) => (await fetch(`${url}/api`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ accion, parametros }) })).json();
    const sh = (await api('estado')).resultado.espectaculos[0];
    const sc = await api('crear_escena', { espectaculoId: sh.id, nombre: 'Prueba efectos', duracion: 8, transicion: 'cut', posicion: 0 });
    const esc = sc.resultado.escenaId;
    assert((await api('anadir_clip', { espectaculoId: sh.id, escenaId: esc, superficieId: 'Ventana alta izquierda', efecto: 'neon', inicio: 0, duracion: 8, fundidoEntrada: 0 })).ok, 'añadir neón');
    // silueta de Boo sobre luz de vela en la ventana central
    assert((await api('anadir_clip', { espectaculoId: sh.id, escenaId: esc, superficieId: 'Ventana alta central', efecto: 'solid', color: '#ffb347', inicio: 0, duracion: 8, fundidoEntrada: 0, capa: -5 })).ok, 'fondo');
    assert((await api('anadir_clip', { espectaculoId: sh.id, escenaId: esc, superficieId: 'Ventana alta central', personajeId: 'Boo, el fantasma', animacion: 'Flotar', inicio: 0, duracion: 8, fundidoEntrada: 0, movimiento: 'none', silueta: true, colorSilueta: '#000000', escala: 0.9 })).ok, 'silueta');
    const tp = await api('aplicar_plantilla', { espectaculoId: sh.id, escenaId: esc, plantilla: 'lucesFeria', inicio: 6 });
    assert(tp.ok && tp.resultado.clips === 8, `plantilla en las 8 superficies (${JSON.stringify(tp)})`);
    await out.evaluate(() => { window.__vmPlayer.pause(); window.__vmPlayer.seek(2); });
    await out.waitForTimeout(600);
    const inst = (await S(win)).project.installations[0];
    const sf = (n) => inst.surfaces.find((x) => x.name === n);
    const L = sf('Ventana alta izquierda');
    const x0 = L.quad[0].x * 1920, y0 = L.quad[0].y * 1080, y1 = L.quad[2].y * 1080, x1 = L.quad[1].x * 1920;
    const my = (y0 + y1) / 2;
    const [edge, outside, inside, far] = await outputPixel(out, [[x0, my], [x0 - 14, my], [(x0 + x1) / 2, my], [x0 - 200, my]]);
    assert(bright(edge) > 150, `línea de neón sobre el borde (${edge})`);
    assert(bright(outside) > 25, `el halo ilumina fuera de la ventana (${outside})`);
    assert(bright(inside) < 25, `el interior queda oscuro (${inside})`);
    assert(bright(far) < 8, `lejos del contorno no hay luz (${far})`);
    const C = sf('Ventana alta central');
    const cx = ((C.quad[0].x + C.quad[1].x) / 2) * 1920, cy = ((C.quad[0].y + C.quad[2].y) / 2) * 1080;
    let body, corner;
    for (let k = 0; k < 20; k++) { [body, corner] = await outputPixel(out, [[cx, cy + 10], [C.quad[0].x * 1920 + 5, C.quad[0].y * 1080 + 5]]); if (bright(body) < 30) break; await out.waitForTimeout(200); }
    assert(bright(corner) > 120, `fondo iluminado (${corner})`);
    assert(bright(body) < 30, `la silueta de Boo tapa la luz (${body})`);
    for (let i = 0; i < 5; i++) await api('deshacer');
  });

  await step('18f. Asistente de espectáculos: estilo, dos protagonistas y rótulo; también por la API', async () => {
    await win.click('[data-testid="nav-shows"]');
    const before = (await S(win)).project.shows.length;
    await win.click('[data-testid="open-wizard"] >> nth=0');
    await win.waitForSelector('[data-testid="wizard-run"]');
    await win.locator('[data-testid="wizard-pick"]').nth(0).click();
    await win.locator('[data-testid="wizard-pick"]').nth(1).click();
    await win.click('[data-testid="wizard-run"]');
    await win.waitForFunction((n) => window.__vmStore.getState().project.shows.length === n + 1, before, { timeout: 15000 });
    const sh = (await S(win)).project.shows.at(-1);
    assert(sh.scenes.length >= 6 && sh.scenes[0].name.startsWith('Espera'), `escenas del asistente: ${sh.scenes.map((x) => x.name).join(' | ')}`);
    const texts = sh.scenes.flatMap((x) => x.clips).filter((c) => c.source.type === 'text').map((c) => c.source.text);
    assert(texts.includes('¡Feliz Halloween!'), `rótulo del final (${texts.join(', ')})`);
    const s = await S(win);
    const info = JSON.parse(fs.readFileSync(path.join(userData, 'agent-api.json'), 'utf8'));
    const r = await (await fetch(`${info.url}/api`, { method: 'POST', headers: { Authorization: `Bearer ${info.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'generar_espectaculo', parametros: { estilo: 'terror', nombre: 'Miedo', protagonistas: ['Boo, el fantasma'], duracion: 90, rotulo: '¡Corre!' } }) })).json();
    assert(r.ok && r.resultado.escenas.length >= 6, `generar_espectaculo por la API: ${JSON.stringify(r).slice(0, 200)}`);
    const s2 = await S(win);
    assert(s2.project.assets.some((a) => a.id === 'tr-ast-golpe'), 'el estilo terror añade los sonidos de terror al proyecto');
    for (let i = 0; i < 3; i++) await win.evaluate(() => window.__vmStore.getState().undo());
  });

  if (LONG) {
    await step('19. Reproducción en tiempo real de un ciclo completo con bucle', async () => {
      await win.evaluate((id) => window.__vmStore.getState().set({ outputMode: 'show', outputShowId: id }), (await S(win)).project.shows[0].id);
      await win.waitForFunction(() => window.__vmStore.getState().outputStatus?.mode === 'show');
      await out.evaluate(() => { window.__vmPlayer.seek(0); void window.__vmPlayer.play(); });
      const period = await out.evaluate(() => window.__vmPlayer.duration() + window.__vmPlayer.currentShow().loopGap);
      const nSamples = Math.ceil((period + 6) / 5);
      const samples = [];
      const t0 = Date.now();
      for (let i = 0; i < nSamples; i++) {
        await out.waitForTimeout(5000);
        samples.push(await out.evaluate(() => { const s = window.__vmPlayer.status(); return { t: s.time, c: s.cycleTime, fps: s.fps, v: s.activeVideos, e: s.errors.length, a: window.__vmPlayer.audio.activeCount, w: Date.now() }; }));
      }
      console.log('      ' + samples.map((x) => `t=${x.t.toFixed(1)} c=${x.c.toFixed(1)} fps=${Math.round(x.fps)} v=${x.v} audio=${x.a}`).join('\n      '));
      const last = samples[samples.length - 1];
      assert(last.t > period, `el reloj avanza (${last.t})`);
      assert(last.c < 10, `el espectáculo vuelve a empezar en bucle (ciclo ${last.c})`);
      assert(samples.every((x) => x.e === 0), 'sin errores durante la reproducción');
      // deriva = tiempo del reproductor frente a tiempo real transcurrido (desde que se pidió reproducir)
      const drift = Math.abs(last.t - (last.w - t0) / 1000);
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
