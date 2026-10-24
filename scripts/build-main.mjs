// Compila proceso principal y preloads con esbuild (CommonJS, Node).
import { build, context } from 'esbuild';
const watch = process.argv.includes('--watch');
const common = { bundle: true, platform: 'node', target: 'node22', format: 'cjs', sourcemap: true, external: ['electron'], logLevel: 'info' };
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
