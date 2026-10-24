/**
 * Prueba con dos pantallas (en Linux: xvfb-run -s "+xinerama -screen 0 1920x1080x24 -screen 1 1280x720x24").
 * Comprueba que se detectan, que la salida se abre a pantalla completa en la segunda pantalla
 * (no en la del editor) y que se cierra sola si esa pantalla desaparece.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vms-md-'));
const env = { ...process.env, VMSTUDIO_USER_DATA: path.join(tmp, 'ud'), VMSTUDIO_DOCUMENTS: path.join(tmp, 'docs') };
delete env.NODE_OPTIONS;
const fail = (m) => { console.log('  ✘ ' + m); process.exitCode = 1; };
const ok = (m) => console.log('  ✔ ' + m);
const app = await electron.launch({ executablePath: require('electron'), args: ['.', '--no-sandbox'], env });
const win = await app.firstWindow();
await win.waitForSelector('.app');
const displays = await win.evaluate(() => window.vm.displays.list());
console.log('  pantallas:', displays.map((d) => `${d.id} ${d.bounds.x},${d.bounds.y} ${d.bounds.width}x${d.bounds.height}${d.hasEditor ? ' (editor)' : ''}`).join(' | '));
if (displays.length < 2) { fail('se necesitan 2 pantallas'); await app.close(); process.exit(1); }
ok('se detectan 2 pantallas');
const proj = displays.find((d) => !d.hasEditor);
await win.click('[data-testid="example-halloween-infantil"]');
await win.fill('[data-testid="dialog-input"]', 'Dos pantallas');
await win.click('[data-testid="dialog-ok"]');
await win.waitForSelector('[data-testid="timeline"]', { timeout: 15000 });
const sel = await win.inputValue('[data-testid="display-select"]');
sel === String(proj.id) ? ok('la pantalla preseleccionada es la que no tiene el editor') : fail(`preselección incorrecta (${sel})`);
const [out] = await Promise.all([app.waitForEvent('window'), win.click('[data-testid="output-open"]')]);
await out.waitForFunction(() => !!window.__vmPlayer);
await out.waitForTimeout(1500);
const b = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ title: w.getTitle(), bounds: w.getBounds(), fs: w.isFullScreen(), focused: w.isFocused() })));
console.log('  ventanas:', JSON.stringify(b));
const o = b.find((w) => w.title.startsWith('Salida'));
const e = b.find((w) => !w.title.startsWith('Salida'));
const inside = (w, d) => w.bounds.x >= d.bounds.x && w.bounds.y >= d.bounds.y && w.bounds.x + w.bounds.width <= d.bounds.x + d.bounds.width && w.bounds.y + w.bounds.height <= d.bounds.y + d.bounds.height;
o && inside(o, proj) && o.bounds.width === proj.bounds.width ? ok('la salida cubre la pantalla del proyector') : fail('la salida no está en la pantalla del proyector');
const edDisp = displays.find((d) => d.hasEditor);
e && inside(e, edDisp) ? ok('el editor sigue en su pantalla') : fail('el editor se ha movido');
const st = await win.evaluate(() => window.__vmStore.getState().output);
st.open && st.displayId === proj.id ? ok('estado de salida correcto en el editor') : fail(JSON.stringify(st));
// Simular desconexión del proyector: el proceso principal emite display-removed.
await app.evaluate(({ screen }, id) => { const d = screen.getAllDisplays().find((x) => x.id === id); screen.emit('display-removed', {}, d); }, proj.id);
await win.waitForTimeout(800);
const after = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
const st2 = await win.evaluate(() => window.__vmStore.getState().output);
after === 1 && !st2.open ? ok('al desconectar el proyector la salida se cierra (no invade el monitor del editor)') : fail(`ventanas tras desconexión: ${after}`);
await app.close();
