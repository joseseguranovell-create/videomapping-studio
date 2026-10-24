/**
 * Comprueba que el ejecutable empaquetado arranca y muestra la ventana del editor.
 * Uso: node tests/e2e/packaged.mjs "<ruta al ejecutable>"
 * Si falla, imprime el registro de la aplicación para diagnosticar.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright');
const exe = process.argv[2];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vms-pkg-'));
const ud = path.join(tmp, 'ud');
const env = { ...process.env, VMSTUDIO_USER_DATA: ud, VMSTUDIO_DOCUMENTS: path.join(tmp, 'docs') };
delete env.NODE_OPTIONS;
const dumpLog = () => { const f = path.join(ud, 'logs', 'app.log'); console.log('--- app.log ---\n' + (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '(no existe)')); };
let app;
try {
  app = await electron.launch({ executablePath: exe, args: [], env, timeout: 60000 });
  const win = await app.firstWindow({ timeout: 60000 });
  await win.waitForSelector('.app', { timeout: 30000 });
  // La ventana se muestra al terminar de pintarse: esperar hasta 15 s.
  let visible = [];
  for (let i = 0; i < 60; i++) {
    visible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.isVisible()));
    if (visible.some(Boolean)) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log('ventanas visibles:', visible);
  if (!visible.some(Boolean)) throw new Error('la ventana no es visible');
  await win.click('[data-testid="example-halloween-infantil"]');
  await win.fill('[data-testid="dialog-input"]', 'Prueba empaquetada');
  await win.click('[data-testid="dialog-ok"]');
  await win.waitForSelector('[data-testid="timeline"]', { timeout: 20000 });
  const r = await win.evaluate(() => ({ missing: window.__vmStore.getState().missing.length, assets: window.__vmStore.getState().project.assets.length }));
  if (r.missing || !r.assets) throw new Error(`recursos: ${JSON.stringify(r)}`);
  console.log('OK: el ejecutable empaquetado arranca, muestra la ventana y crea el proyecto de ejemplo', r);
  dumpLog();
  await app.close();
} catch (e) {
  console.log('FALLO:', e.message);
  dumpLog();
  try { await app?.close(); } catch {}
  process.exit(1);
}
