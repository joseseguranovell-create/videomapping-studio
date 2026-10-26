/**
 * Paquetes de contenido reutilizable (personajes, recursos, espectáculos de ejemplo).
 * Un paquete es una carpeta con `pack.json` y sus archivos. No contiene código ejecutable.
 */
import { z } from 'zod';
import { Asset, Character, Installation, Show } from './model';

export const PACK_FORMAT = 'vmstudio-pack';

export const PackManifest = z.object({
  format: z.literal(PACK_FORMAT),
  formatVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/, 'id de paquete no válido'),
  name: z.string(),
  description: z.string().default(''),
  author: z.string().default(''),
  license: z.string().default(''),
  version: z.string().default('1.0.0'),
  tags: z.array(z.string()).default([]),
  assets: z.array(Asset.extend({ addedAt: z.string().default('') })).default([]),
  characters: z.array(Character).default([]),
  /** Plantillas opcionales para crear un proyecto de ejemplo. */
  installations: z.array(Installation).default([]),
  shows: z.array(Show).default([]),
});
export type PackManifest = z.infer<typeof PackManifest>;

export interface PackInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  license: string;
  author: string;
  builtIn: boolean;
  dir: string;
  assetCount: number;
  characterCount: number;
  showCount: number;
  tags: string[];
  /** Qué trae el paquete, para mostrarlo en la Biblioteca y compararlo con lo que ya hay en el proyecto. */
  contents: PackContents;
}

export interface PackContents {
  assets: { id: string; name: string; kind: string }[];
  characters: { id: string; name: string }[];
  shows: { id: string; name: string; scenes: number; duration: number }[];
  installations: { id: string; name: string; surfaces: number }[];
}
