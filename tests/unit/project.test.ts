import { describe, it, expect } from 'vitest';
import { parseProject, serializeProject, ProjectFormatError } from '../../src/shared/schema';
import {
  createProject, createInstallation, createSurface, createShow, createScene, createClip,
  duplicateShow, duplicateInstallation, suggestSurfaceMap, remapShowSurfaces, referencedAssetIds, createPolygonSurface,
} from '../../src/shared/factory';
import { SCHEMA_VERSION } from '../../src/shared/model';

function sample() {
  const p = createProject('Casa');
  const inst = createInstallation('Fachada');
  const names = ['Ventana salón', 'Ventana izquierda', 'Ventana derecha', 'Puerta principal'];
  names.forEach((n, i) => inst.surfaces.push(createSurface(n, i === 3 ? 'door' : 'window', i)));
  inst.surfaces.push(createPolygonSurface('Arco', 'decor', 4, [{ x: 0.1, y: 0.9 }, { x: 0.2, y: 0.7 }, { x: 0.3, y: 0.9 }]));
  p.installations.push(inst);
  const sh = createShow('Halloween', inst.id);
  for (let i = 0; i < 3; i++) {
    const sc = createScene(`Escena ${i + 1}`, 8);
    sc.clips.push(createClip(inst.surfaces[i].id, { type: 'asset', assetId: 'ghost' }));
    sh.scenes.push(sc);
  }
  p.shows.push(sh);
  return p;
}

describe('formato de proyecto', () => {
  it('guarda y abre sin pérdidas (ida y vuelta)', () => {
    const p = sample();
    const { project, migratedFrom } = parseProject(JSON.parse(serializeProject(p)));
    expect(migratedFrom).toBeNull();
    expect(project).toEqual(p);
    expect(project.installations[0].surfaces).toHaveLength(5);
    expect(project.shows[0].scenes).toHaveLength(3);
  });
  it('rellena valores por defecto de campos ausentes', () => {
    const p = sample() as any;
    delete p.installations[0].surfaces[0].locked;
    delete p.shows[0].scenes[0].clips[0].fit;
    const { project } = parseProject(p);
    expect(project.installations[0].surfaces[0].locked).toBe(false);
    expect(project.shows[0].scenes[0].clips[0].fit).toBe('contain');
  });
  it('migra proyectos sin versión de esquema', () => {
    const p = sample() as any;
    delete p.schemaVersion; delete p.collections;
    const r = parseProject(p);
    expect(r.migratedFrom).toBe(0);
    expect(r.project.schemaVersion).toBe(SCHEMA_VERSION);
  });
  it('migra proyectos v1 (sin rótulos ni «quitar fondo») a la versión actual', () => {
    const p = sample() as any;
    p.schemaVersion = 1;
    p.assets.push({ id: 'a', name: 'x', kind: 'image', file: 'assets/x.png', addedAt: '' });
    const r = parseProject(p);
    expect(r.migratedFrom).toBe(1);
    expect(r.project.assets[0].key.mode).toBe('none');
  });
  it('migra proyectos v3 conservando sus rótulos y efectos', () => {
    const p = sample() as any;
    p.schemaVersion = 3;
    p.shows[0].scenes[0].clips.push(createClip(p.installations[0].surfaces[0].id, { type: 'text', text: 'Hola', font: 'divertida', color: '#fff', outline: '#000', glow: true, bold: true }));
    const r = parseProject(p);
    expect(r.migratedFrom).toBe(3);
    expect(r.project.schemaVersion).toBe(SCHEMA_VERSION);
    expect(r.project.shows[0].scenes[0].clips[1].source).toMatchObject({ type: 'text', font: 'divertida' });
  });
  it('migra v7 → v8: la foto de referencia queda sin encuadre', () => {
    const p = sample() as any;
    p.schemaVersion = 7;
    for (const i of p.installations) delete i.referenceCrop;
    const r = parseProject(p);
    expect(r.migratedFrom).toBe(7);
    expect(r.project.installations[0].referenceCrop).toBeNull();
  });
  it('acepta clips de texto', () => {
    const p = sample();
    p.shows[0].scenes[0].clips.push(createClip(p.installations[0].surfaces[0].id, { type: 'text', text: '¡Hola!', font: 'divertida', color: '#fff', outline: '#000', glow: true, bold: true }));
    const { project } = parseProject(JSON.parse(serializeProject(p)));
    expect(project.shows[0].scenes[0].clips[1].source).toMatchObject({ type: 'text', text: '¡Hola!' });
  });
  it('rechaza proyectos de versiones futuras con un mensaje claro', () => {
    const p = { ...sample(), schemaVersion: 99 };
    expect(() => parseProject(p)).toThrow(/más reciente/);
  });
  it('rechaza datos corruptos indicando el campo', () => {
    const p = sample() as any;
    p.installations[0].surfaces[0].quad = 'roto';
    try { parseProject(p); throw new Error('no lanzó'); } catch (e) {
      expect(e).toBeInstanceOf(ProjectFormatError);
      expect((e as ProjectFormatError).details.join(' ')).toMatch(/quad/);
    }
  });
  it('no acepta entradas que no sean objetos', () => {
    expect(() => parseProject(null)).toThrow(ProjectFormatError);
    expect(() => parseProject([1, 2])).toThrow(ProjectFormatError);
  });
});

describe('duplicación y reasignación', () => {
  it('duplicar un espectáculo no modifica el original y genera ids nuevos', () => {
    const p = sample();
    const orig = p.shows[0];
    const before = JSON.stringify(orig);
    const d = duplicateShow(orig, { name: 'Halloween 2027' });
    expect(JSON.stringify(orig)).toBe(before);
    expect(d.id).not.toBe(orig.id);
    expect(d.scenes[0].id).not.toBe(orig.scenes[0].id);
    expect(d.scenes[0].clips[0].id).not.toBe(orig.scenes[0].clips[0].id);
    expect(d.name).toBe('Halloween 2027');
  });
  it('trasladar a otra casa: duplicar instalación y reasignar superficies', () => {
    const p = sample();
    const { installation: casa2, surfaceMap } = duplicateInstallation(p.installations[0], 'Casa abuela');
    expect(casa2.surfaces.map((s) => s.id)).not.toContain(p.installations[0].surfaces[0].id);
    const moved = duplicateShow(p.shows[0], { installationId: casa2.id, surfaceMap });
    expect(moved.scenes[0].clips[0].surfaceId).toBe(casa2.surfaces[0].id);
    expect(p.shows[0].scenes[0].clips[0].surfaceId).toBe(p.installations[0].surfaces[0].id);
  });
  it('sugiere reasignaciones por nombre, tipo y orden', () => {
    const p = sample();
    const from = p.installations[0].surfaces;
    const other = createInstallation('Otra');
    other.surfaces.push(createSurface('Puerta principal', 'door', 0));
    other.surfaces.push(createSurface('Ventana A', 'window', 1));
    const map = suggestSurfaceMap(from, other.surfaces);
    expect(map[from[3].id]).toBe(other.surfaces[0].id);
    expect(map[from[0].id]).toBe(other.surfaces[1].id);
    expect(map[from[1].id]).toBeNull();
    const r = remapShowSurfaces(p.shows[0], map, other.id);
    expect(r.scenes[1].clips).toHaveLength(0); // superficie sin destino: clip eliminado en la copia
    expect(p.shows[0].scenes[1].clips).toHaveLength(1);
  });
  it('lista recursos referenciados', () => {
    expect([...referencedAssetIds(sample())]).toEqual(['ghost']);
  });
});
