/**
 * Validación y migración de archivos de proyecto.
 * Nunca se descarta un proyecto antiguo en silencio: si no se puede migrar se informa del error.
 */
import { Project, SCHEMA_VERSION } from './model';

export class ProjectFormatError extends Error {
  constructor(message: string, readonly details: string[] = []) {
    super(message);
    this.name = 'ProjectFormatError';
  }
}

type RawProject = Record<string, unknown> & { schemaVersion?: unknown };

/**
 * Migraciones: cada entrada transforma un documento de la versión N a la N+1.
 * Se aplican en orden. Al cambiar SCHEMA_VERSION, añadir aquí la migración correspondiente.
 */
export const MIGRATIONS: Record<number, (doc: RawProject) => RawProject> = {
  // Versión 0: borradores previos sin schemaVersion ni colecciones.
  0: (doc) => ({ ...doc, schemaVersion: 1, collections: Array.isArray(doc.collections) ? doc.collections : [] }),
  // Versión 1 → 2: rótulos de texto y «quitar fondo» en los recursos. Campos nuevos con valores por defecto.
  1: (doc) => ({ ...doc, schemaVersion: 2 }),
  // Versión 2 → 3: efectos de contorno y de fachada, siluetas. Campos nuevos con valores por defecto.
  2: (doc) => ({ ...doc, schemaVersion: 3 }),
  // Versión 3 → 4: nuevas letras de rótulo y efectos «ojos» y «espíritus». Los valores antiguos siguen siendo válidos.
  3: (doc) => ({ ...doc, schemaVersion: 4 }),
  // Versión 4 → 5: efectos de ventanas falsas, impacto y Navidad. Nada que convertir.
  4: (doc) => ({ ...doc, schemaVersion: 5 }),
  // Versión 5 → 6: clips que viajan por la fachada (campo opcional «travel»).
  5: (doc) => ({ ...doc, schemaVersion: 6 }),
  // Versión 6 → 7: luces de casa (lista de luces del proyecto y pista de luces en cada escena).
  6: (doc) => ({ ...doc, schemaVersion: 7 }),
  // Versión 7 → 8: encuadre de la foto de referencia (`referenceCrop`, opcional en cada instalación).
  7: (doc) => ({ ...doc, schemaVersion: 8 }),
  // Versión 8 → 9: efecto «slitEye» (ojo de pupila vertical). Nada que convertir.
  8: (doc) => ({ ...doc, schemaVersion: 9 }),
  // Versión 9 → 10: clips de fachada entera (facade) y linterna que revela (reveal). Campos opcionales.
  9: (doc) => ({ ...doc, schemaVersion: 10 }),
  // Versión 10 → 11: «groupMove» en las superficies (mover y estirar un grupo como una pieza). Opcional; por defecto desactivado.
  10: (doc) => ({ ...doc, schemaVersion: 11 }),
  // Versión 11 → 12: movimientos «dropExitLeft» y «dropExitRight» (baja de arriba y se va hacia un lado). Nada que convertir.
  11: (doc) => ({ ...doc, schemaVersion: 12 }),
};

export function migrateProject(input: unknown): { doc: RawProject; migratedFrom: number | null } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ProjectFormatError('El archivo no contiene un proyecto válido.');
  }
  let doc = input as RawProject;
  const original = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : 0;
  if (original > SCHEMA_VERSION) {
    throw new ProjectFormatError(
      `El proyecto se creó con una versión más reciente del programa (esquema ${original}; este programa admite hasta ${SCHEMA_VERSION}). Actualiza la aplicación para abrirlo.`,
    );
  }
  let v = original;
  while (v < SCHEMA_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) throw new ProjectFormatError(`No existe migración desde la versión de esquema ${v}.`);
    doc = m(doc);
    v++;
  }
  return { doc, migratedFrom: original === SCHEMA_VERSION ? null : original };
}

export function parseProject(input: unknown): { project: Project; migratedFrom: number | null } {
  const { doc, migratedFrom } = migrateProject(input);
  const r = Project.safeParse(doc);
  if (!r.success) {
    const details = r.error.issues.slice(0, 20).map((i) => `${i.path.join('.') || '(raíz)'}: ${i.message}`);
    throw new ProjectFormatError('El proyecto tiene un formato incorrecto.', details);
  }
  return { project: r.data, migratedFrom };
}

export function serializeProject(p: Project): string {
  return JSON.stringify(p, null, 2);
}
