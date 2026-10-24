// Ejecuta un script TypeScript de herramientas (compilado al vuelo con esbuild).
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const entry = process.argv[2];
if (!entry) { console.error('Uso: node scripts/run-ts.mjs <archivo.ts>'); process.exit(1); }
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vms-run-')), 'script.cjs');
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error', define: { __dirname: JSON.stringify(path.resolve(path.dirname(entry))) } });
createRequire(import.meta.url)(out);
