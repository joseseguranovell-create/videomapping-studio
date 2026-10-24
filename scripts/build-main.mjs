// Compila proceso principal y preloads con esbuild (CommonJS, Node).
import { build, context } from 'esbuild';
const watch = process.argv.includes('--watch');
import { execFileSync } from 'node:child_process';
// Commit y fecha de compilación: la aplicación los compara con la versión publicada para saber si hay actualización.
let sha = process.env.GITHUB_SHA || '';
if (!sha) { try { sha = execFileSync('git', ['rev-parse', 'HEAD']).toString().trim(); } catch { sha = 'dev'; } }
const define = { __BUILD_SHA__: JSON.stringify(sha), __BUILD_DATE__: JSON.stringify(new Date().toISOString()) };
const common = { bundle: true, platform: 'node', target: 'node22', format: 'cjs', sourcemap: true, external: ['electron'], logLevel: 'info', define };
const configs = [
  { ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main/main.cjs' },
  { ...common, entryPoints: ['src/preload/editor.ts'], outfile: 'dist/preload/editor.cjs', sourcemap: false },
  { ...common, entryPoints: ['src/preload/output.ts'], outfile: 'dist/preload/output.cjs', sourcemap: false },
];
if (watch) {
  for (const c of configs) (await context(c)).watch();
} else {
  await Promise.all(configs.map((c) => build(c)));
}
