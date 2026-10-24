import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../../src/main/projectStore';
import { importPack, readPack, exportPack } from '../../src/main/packStore';
import { createProject, createInstallation, createSurface } from '../../src/shared/factory';

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vms-unit-')); });

describe('almacenamiento de proyectos', () => {
  it('crea, guarda y vuelve a abrir (escritura atómica, sin temporales)', async () => {
    const p = createProject('Casa: prueba/1');
    const lp = await store.createProjectFolder(tmp, p);
    expect(path.basename(lp.dir)).toBe('Casa_ prueba_1');
    p.installations.push(createInstallation('Fachada'));
    p.installations[0].surfaces.push(createSurface('V1', 'window', 0));
    await store.saveProject(lp.file, p);
    const back = await store.loadProject(lp.dir);
    expect(back.project).toEqual(p);
    expect(fs.readdirSync(lp.dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
  it('nombres únicos si la carpeta ya existe', async () => {
    const a = await store.createProjectFolder(tmp, createProject('X'));
    const b = await store.createProjectFolder(tmp, createProject('X'));
    expect(a.dir).not.toBe(b.dir);
  });
  it('detecta autoguardado recuperable y lo borra al guardar', async () => {
    const p = createProject('R');
    const lp = await store.createProjectFolder(tmp, p);
    await store.writeAutosave(lp.dir, { ...p, description: 'cambio' });
    expect((await store.loadProject(lp.file)).autosaveNewer).toBe(true);
    expect((await store.readAutosave(lp.dir))!.description).toBe('cambio');
    await store.saveProject(lp.file, p);
    expect((await store.loadProject(lp.file)).autosaveNewer).toBe(false);
  });
  it('un archivo dañado da un error claro', async () => {
    const lp = await store.createProjectFolder(tmp, createProject('D'));
    fs.writeFileSync(lp.file, '{ roto');
    await expect(store.loadProject(lp.file)).rejects.toThrow(/dañado/);
  });
  it('copias de seguridad al guardar y restauración', async () => {
    const p = createProject('B');
    const lp = await store.createProjectFolder(tmp, p);
    await store.saveProject(lp.file, { ...p, description: 'v2' });
    const list = await store.listBackups(lp.dir);
    expect(list.length).toBe(1);
    expect((await store.readBackup(lp.dir, list[0].name)).description).toBe('');
    await store.writeManualBackup(lp.dir, p, 'antes de Navidad');
    expect((await store.listBackups(lp.dir)).some((b) => b.name.includes('antes de Navidad'))).toBe(true);
  });
  it('migra un proyecto antiguo guardando copia del original', async () => {
    const p: any = createProject('Viejo');
    delete p.schemaVersion;
    const lp = await store.createProjectFolder(tmp, createProject('Viejo'));
    fs.writeFileSync(lp.file, JSON.stringify(p));
    const r = await store.loadProject(lp.file);
    expect(r.migratedFrom).toBe(0);
    expect(fs.readdirSync(path.join(lp.dir, 'backups')).some((f) => f.includes('pre-migracion'))).toBe(true);
  });
});

describe('recursos y rutas', () => {
  it('copia recursos dentro del proyecto con rutas relativas', async () => {
    const lp = await store.createProjectFolder(tmp, createProject('A'));
    const src = path.join(tmp, 'mi foto.png');
    fs.writeFileSync(src, 'x');
    const f = await store.copyIntoProject(lp.dir, src);
    expect(f.file).toBe('assets/mi foto.png');
    expect(f.kind).toBe('image');
    const f2 = await store.copyIntoProject(lp.dir, src);
    expect(f2.file).toBe('assets/mi foto (2).png');
  });
  it('rechaza formatos no admitidos', async () => {
    const lp = await store.createProjectFolder(tmp, createProject('A'));
    const src = path.join(tmp, 'virus.exe');
    fs.writeFileSync(src, 'MZ');
    await expect(store.copyIntoProject(lp.dir, src)).rejects.toThrow(/no admitido/);
  });
  it('impide rutas que salgan de la carpeta del proyecto', () => {
    expect(() => store.resolveInside(tmp, '../secreto.txt')).toThrow();
    expect(() => store.resolveInside(tmp, '/etc/passwd')).toThrow();
    expect(() => store.resolveInside(tmp, 'C:/Windows/win.ini')).toThrow();
    expect(store.resolveInside(tmp, 'assets/a.png')).toBe(path.join(tmp, 'assets', 'a.png'));
  });
  it('detecta recursos ausentes', async () => {
    const p = createProject('M');
    const lp = await store.createProjectFolder(tmp, p);
    p.assets.push({ id: 'a1', name: 'x', kind: 'image', file: 'assets/no-existe.png', frames: [], fps: 24, format: 'png', width: 1, height: 1, duration: null, hasAlpha: null, size: 0, tags: [], collections: [], license: '', source: '', thumbnail: '', addedAt: '' });
    p.assets.push({ ...p.assets[0], id: 'a2', file: '../../fuera.png' });
    expect(await store.findMissingAssets(lp.dir, p)).toEqual(['a1', 'a2']);
  });
  it('secuencias de imágenes en orden natural', async () => {
    const lp = await store.createProjectFolder(tmp, createProject('S'));
    const dir = path.join(tmp, 'seq');
    fs.mkdirSync(dir);
    for (const n of ['f10.png', 'f2.png', 'f1.png', 'notas.txt']) fs.writeFileSync(path.join(dir, n), 'x');
    const r = await store.importSequenceFolder(lp.dir, dir);
    expect(r.frames.map((f) => path.basename(f))).toEqual(['f1.png', 'f2.png', 'f10.png']);
  });
  it('«guardar como» crea una copia completa e independiente', async () => {
    const p = createProject('Orig');
    const lp = await store.createProjectFolder(tmp, p);
    fs.mkdirSync(path.join(lp.dir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(lp.dir, 'assets/v.mp4'), 'video');
    p.assets.push({ id: 'v', name: 'v', kind: 'video', file: 'assets/v.mp4', frames: [], fps: 24, format: 'mp4', width: 1, height: 1, duration: 1, hasAlpha: false, size: 5, tags: [], collections: [], license: '', source: '', thumbnail: '', addedAt: '' });
    const dest = path.join(tmp, 'copias');
    fs.mkdirSync(dest);
    const copy = await store.saveProjectAs(lp.dir, dest, { ...p, name: 'Copia' });
    expect(fs.readFileSync(path.join(copy.dir, 'assets/v.mp4'), 'utf8')).toBe('video');
    expect(await store.findMissingAssets(copy.dir, copy.project)).toEqual([]);
    // el original sigue intacto
    expect((await store.loadProject(lp.file)).project.name).toBe('Orig');
  });
});

describe('paquetes', () => {
  const packDir = path.resolve(__dirname, '../../resources/packs/halloween-infantil');
  it('el paquete Halloween es válido y todos sus archivos existen', async () => {
    const m = await readPack(packDir);
    expect(m.characters.length).toBeGreaterThanOrEqual(6);
    for (const a of m.assets) for (const f of store.assetFiles(a)) expect(fs.existsSync(path.join(packDir, f)), f).toBe(true);
    const ids = new Set(m.assets.map((a) => a.id));
    for (const c of m.characters) for (const an of c.animations) expect(ids.has(an.assetId)).toBe(true);
    for (const s of m.shows) for (const sc of s.scenes) {
      for (const c of sc.clips) {
        if (c.source.type === 'asset') expect(ids.has(c.source.assetId)).toBe(true);
        expect(m.installations[0].surfaces.some((x) => x.id === c.surfaceId)).toBe(true);
      }
    }
  });
  it('importar dos veces no duplica recursos', async () => {
    const p = createProject('P');
    const lp = await store.createProjectFolder(tmp, p);
    const r1 = await importPack(packDir, lp.dir, p);
    p.assets.push(...r1.assets);
    p.characters.push(...r1.characters);
    const r2 = await importPack(packDir, lp.dir, p);
    expect(r2.assets.length).toBe(0);
    expect(r2.skippedAssets).toBe(r1.assets.length);
    expect(await store.findMissingAssets(lp.dir, p)).toEqual([]);
  });
  it('exportar un paquete y volver a leerlo', async () => {
    const p = createProject('P');
    const lp = await store.createProjectFolder(tmp, p);
    const r = await importPack(packDir, lp.dir, p);
    p.assets.push(...r.assets);
    p.characters.push(...r.characters);
    const out = path.join(tmp, 'paquetes');
    fs.mkdirSync(out);
    const dir = await exportPack(lp.dir, p, { parentDir: out, name: 'Mis fantasmas', description: '', assetIds: [], characterIds: ['hx-chr-boo'], includeShows: [] });
    const m = await readPack(dir);
    expect(m.id).toBe('mis-fantasmas');
    expect(m.characters).toHaveLength(1);
    for (const a of m.assets) expect(fs.existsSync(path.join(dir, a.file))).toBe(true);
  });
});
