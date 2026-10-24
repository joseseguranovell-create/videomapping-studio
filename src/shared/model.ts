/**
 * Modelo de datos del proyecto.
 *
 * Coordenadas: todas las posiciones de geometría se guardan NORMALIZADAS (0..1)
 * respecto al fotograma de salida del proyector (x hacia la derecha, y hacia abajo).
 * Así, cambiar la resolución de salida con la misma proporción no altera la calibración.
 *
 * Espacio de superficie (uv): cada superficie tiene su propio cuadrado unidad (0..1)
 * que se deforma sobre su cuadrilátero de contenido (`quad`) mediante una homografía.
 * Los clips se posicionan en ese espacio, por lo que mover una ventana no obliga a
 * regenerar ninguna animación (separación geometría / contenido).
 */
import { z } from 'zod';

export const SCHEMA_VERSION = 3;

export const Vec2 = z.object({ x: z.number(), y: z.number() });
export type Vec2 = z.infer<typeof Vec2>;

export const Quad = z.tuple([Vec2, Vec2, Vec2, Vec2]); // TL, TR, BR, BL
export type Quad = z.infer<typeof Quad>;

export const SURFACE_KINDS = ['window', 'door', 'garage', 'wall', 'roof', 'shopwindow', 'stage', 'decor', 'other'] as const;
export const SurfaceKind = z.enum(SURFACE_KINDS);
export type SurfaceKind = z.infer<typeof SurfaceKind>;

export const Mask = z.object({
  id: z.string(),
  name: z.string().default('Máscara'),
  enabled: z.boolean().default(true),
  points: z.array(Vec2),
});
export type Mask = z.infer<typeof Mask>;

export const Surface = z.object({
  id: z.string(),
  name: z.string(),
  kind: SurfaceKind.default('window'),
  group: z.string().default(''),
  color: z.string().default('#ff8a3d'),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  /** 'quad': el recorte coincide con el cuadrilátero; 'polygon': recorte con `polygon`. */
  shape: z.enum(['quad', 'polygon']).default('quad'),
  /** Cuadrilátero de mapeo del contenido (perspectiva). */
  quad: Quad,
  /** Contorno de recorte para superficies irregulares. */
  polygon: z.array(Vec2).default([]),
  /** Zonas de exclusión propias de la superficie. */
  masks: z.array(Mask).default([]),
  /** Proporción real ancho/alto de la superficie, si se conoce. null = estimada. */
  aspect: z.number().positive().nullable().default(null),
  notes: z.string().default(''),
});
export type Surface = z.infer<typeof Surface>;

export const Installation = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(''),
  notes: z.string().default(''),
  output: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).default({ width: 1920, height: 1080 }),
  /** Pantalla preferida (etiqueta y geometría) para reconocer el proyector la próxima vez. */
  preferredDisplay: z
    .object({ label: z.string(), width: z.number(), height: z.number() })
    .nullable()
    .default(null),
  surfaces: z.array(Surface).default([]),
  /** Zonas de exclusión globales (vegetación, obstáculos...). */
  masks: z.array(Mask).default([]),
  /** Foto de referencia opcional de la fachada (solo se ve en el editor). */
  referenceImageAssetId: z.string().nullable().default(null),
  referenceImageOpacity: z.number().min(0).max(1).default(0.5),
  calibratedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Installation = z.infer<typeof Installation>;

export const ASSET_KINDS = ['image', 'video', 'audio', 'sequence'] as const;
export const AssetKind = z.enum(ASSET_KINDS);
export type AssetKind = z.infer<typeof AssetKind>;

/** Quitar el fondo de un recurso al reproducirlo (vídeos o imágenes generados con IA, croma…). */
export const BackgroundKey = z.object({
  /** 'color': elimina un color (verde, blanco…); 'dark': elimina lo oscuro (fondos negros). */
  mode: z.enum(['none', 'color', 'dark']).default('none'),
  color: z.string().default('#00ff00'),
  /** Tolerancia 0..1: cuánto se parece un píxel al color para eliminarlo. */
  threshold: z.number().min(0).max(1).default(0.3),
  /** Suavidad del borde 0..1. */
  softness: z.number().min(0).max(1).default(0.1),
  /** Reducir el reflejo del color de fondo en los bordes (útil con croma verde). */
  despill: z.boolean().default(true),
});
export type BackgroundKey = z.infer<typeof BackgroundKey>;

export const Asset = z.object({
  id: z.string(),
  name: z.string(),
  kind: AssetKind,
  /** Ruta relativa a la carpeta del proyecto (siempre con '/'). */
  file: z.string(),
  /** Fotogramas para secuencias de imágenes (rutas relativas). */
  frames: z.array(z.string()).default([]),
  fps: z.number().positive().default(24),
  format: z.string().default(''),
  width: z.number().nullable().default(null),
  height: z.number().nullable().default(null),
  duration: z.number().nullable().default(null),
  /** true/false si se conoce, null si no se ha podido determinar. */
  hasAlpha: z.boolean().nullable().default(null),
  size: z.number().default(0),
  tags: z.array(z.string()).default([]),
  collections: z.array(z.string()).default([]),
  license: z.string().default(''),
  source: z.string().default(''),
  /** Miniatura como data URL pequeña (JPEG/PNG). */
  thumbnail: z.string().default(''),
  key: BackgroundKey.default({ mode: 'none', color: '#00ff00', threshold: 0.3, softness: 0.1, despill: true }),
  addedAt: z.string(),
});
export type Asset = z.infer<typeof Asset>;

export const MOTION_PRESETS = [
  'none',
  'float',
  'bounce',
  'wave',
  'lookAround',
  'pulse',
  'shake',
  'spin',
  'popIn',
  'popOut',
  'peekLeft',
  'peekRight',
  'peekBottom',
  'peekTop',
  'enterLeft',
  'enterRight',
  'exitLeft',
  'exitRight',
  'crossLeftToRight',
  'crossRightToLeft',
  'rise',
  'grow',
  'shrink',
] as const;
export const MotionPreset = z.enum(MOTION_PRESETS);
export type MotionPreset = z.infer<typeof MotionPreset>;

export const Motion = z.object({
  preset: MotionPreset.default('none'),
  /** Intensidad 0..2 (1 = normal). */
  intensity: z.number().min(0).max(3).default(1),
  /** Velocidad de los movimientos periódicos (1 = normal). */
  speed: z.number().min(0.05).max(10).default(1),
});
export type Motion = z.infer<typeof Motion>;

export const EFFECT_KINDS = [
  'solid', 'glow', 'stars', 'flicker', 'rainbow', 'testPattern',
  // contornos: se dibujan sobre el borde de la superficie y brillan hacia fuera
  'neon', 'drawOn', 'chase',
  // ambiente
  'sweep', 'lightning', 'fire', 'fog', 'rain', 'snow', 'fireflies',
] as const;
/** Efectos que se dibujan sobre el contorno (no recortados por la superficie). */
export const CONTOUR_EFFECTS = ['neon', 'drawOn', 'chase'] as const;
/** Efectos que pueden calcularse en el espacio de toda la fachada (continuos entre ventanas). */
export const FACADE_EFFECTS = ['sweep', 'lightning', 'fire', 'fog', 'rain', 'snow', 'fireflies', 'rainbow', 'stars'] as const;
export const EffectKind = z.enum(EFFECT_KINDS);
export type EffectKind = z.infer<typeof EffectKind>;

export const TEXT_FONTS = ['divertida', 'gruesa', 'elegante', 'manuscrita', 'simple'] as const;
export const TextFont = z.enum(TEXT_FONTS);
export type TextFont = z.infer<typeof TextFont>;

export const ClipSource = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    text: z.string(),
    font: TextFont.default('divertida'),
    color: z.string().default('#ffb347'),
    outline: z.string().default('#2b1240'),
    /** Halo luminoso alrededor de las letras. */
    glow: z.boolean().default(true),
    bold: z.boolean().default(true),
  }),
  z.object({ type: z.literal('asset'), assetId: z.string() }),
  z.object({
    type: z.literal('effect'),
    effect: EffectKind,
    color: z.string().default('#ffb347'),
    color2: z.string().default('#7b2ff7'),
    /** Grosor de los contornos en píxeles (para una salida de 1080 líneas). */
    width: z.number().min(0.5).max(80).default(6),
    /** 'surface': el efecto se adapta a cada superficie; 'facade': continuo en toda la fachada. */
    space: z.enum(['surface', 'facade']).default('surface'),
  }),
]);
export type ClipSource = z.infer<typeof ClipSource>;

export const Clip = z.object({
  id: z.string(),
  name: z.string().default(''),
  surfaceId: z.string(),
  source: ClipSource,
  /** Referencia opcional al personaje/animación de origen (solo informativa). */
  characterId: z.string().nullable().default(null),
  animationId: z.string().nullable().default(null),
  start: z.number().min(0).default(0),
  duration: z.number().positive().default(5),
  loop: z.boolean().default(true),
  playbackRate: z.number().positive().default(1),
  fit: z.enum(['contain', 'cover', 'stretch']).default('contain'),
  /** Centro en el espacio de la superficie (0..1). */
  x: z.number().default(0.5),
  y: z.number().default(0.5),
  scale: z.number().positive().default(1),
  rotation: z.number().default(0),
  flipX: z.boolean().default(false),
  opacity: z.number().min(0).max(1).default(1),
  fadeIn: z.number().min(0).default(0.5),
  fadeOut: z.number().min(0).default(0.5),
  motion: Motion.default({ preset: 'none', intensity: 1, speed: 1 }),
  /** Orden de capa dentro de la superficie (mayor = encima). */
  z: z.number().default(0),
  /** Dibujar el recurso como silueta de un solo color (sombras chinescas). */
  silhouette: z.boolean().default(false),
  silhouetteColor: z.string().default('#000000'),
});
export type Clip = z.infer<typeof Clip>;

export const SoundCue = z.object({
  id: z.string(),
  assetId: z.string(),
  start: z.number().min(0).default(0),
  /** null = hasta el final del sonido (o de la escena si no continúa). */
  duration: z.number().positive().nullable().default(null),
  volume: z.number().min(0).max(2).default(1),
  fadeIn: z.number().min(0).default(0),
  fadeOut: z.number().min(0).default(0),
  loop: z.boolean().default(false),
  /** Si es true, el sonido puede seguir sonando tras el final de la escena. */
  continueAfterScene: z.boolean().default(false),
});
export type SoundCue = z.infer<typeof SoundCue>;

export const Transition = z.object({
  type: z.enum(['cut', 'fade', 'crossfade']).default('fade'),
  duration: z.number().min(0).default(1),
});
export type Transition = z.infer<typeof Transition>;

export const Scene = z.object({
  id: z.string(),
  name: z.string(),
  duration: z.number().positive().default(10),
  transition: Transition.default({ type: 'fade', duration: 1 }),
  clips: z.array(Clip).default([]),
  sounds: z.array(SoundCue).default([]),
  notes: z.string().default(''),
  enabled: z.boolean().default(true),
});
export type Scene = z.infer<typeof Scene>;

export const MusicTrack = z.object({
  id: z.string(),
  assetId: z.string(),
  /** Inicio en tiempo del espectáculo (segundos). */
  start: z.number().min(0).default(0),
  volume: z.number().min(0).max(2).default(0.8),
  fadeIn: z.number().min(0).default(1),
  fadeOut: z.number().min(0).default(2),
  loop: z.boolean().default(true),
});
export type MusicTrack = z.infer<typeof MusicTrack>;

export const Show = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(''),
  tags: z.array(z.string()).default([]),
  installationId: z.string().nullable(),
  scenes: z.array(Scene).default([]),
  music: z.array(MusicTrack).default([]),
  masterVolume: z.number().min(0).max(2).default(1),
  /** Repetir el espectáculo indefinidamente. */
  loop: z.boolean().default(true),
  /** Pausa en negro entre repeticiones (segundos). */
  loopGap: z.number().min(0).default(3),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Show = z.infer<typeof Show>;

export const CharacterAnimation = z.object({
  id: z.string(),
  name: z.string(),
  assetId: z.string(),
  motion: Motion.default({ preset: 'none', intensity: 1, speed: 1 }),
  duration: z.number().positive().default(4),
  loop: z.boolean().default(true),
  fit: z.enum(['contain', 'cover', 'stretch']).default('contain'),
  scale: z.number().positive().default(0.8),
});
export type CharacterAnimation = z.infer<typeof CharacterAnimation>;

export const Character = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(''),
  tags: z.array(z.string()).default([]),
  referenceAssetId: z.string().nullable().default(null),
  animations: z.array(CharacterAnimation).default([]),
});
export type Character = z.infer<typeof Character>;

export const Project = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  description: z.string().default(''),
  createdAt: z.string(),
  updatedAt: z.string(),
  installations: z.array(Installation).default([]),
  assets: z.array(Asset).default([]),
  characters: z.array(Character).default([]),
  shows: z.array(Show).default([]),
  collections: z.array(z.string()).default([]),
});
export type Project = z.infer<typeof Project>;

export const SURFACE_KIND_LABELS: Record<SurfaceKind, string> = {
  window: 'Ventana',
  door: 'Puerta',
  garage: 'Garaje',
  wall: 'Pared',
  roof: 'Tejado',
  shopwindow: 'Escaparate',
  stage: 'Escenario',
  decor: 'Decorativa',
  other: 'Otra',
};

export const MOTION_LABELS: Record<MotionPreset, string> = {
  none: 'Sin movimiento',
  float: 'Flotar',
  bounce: 'Saltar',
  wave: 'Saludar (balanceo)',
  lookAround: 'Mirar a los lados',
  pulse: 'Latir',
  shake: 'Temblar',
  spin: 'Girar',
  popIn: 'Aparecer de golpe',
  popOut: 'Desaparecer de golpe',
  peekLeft: 'Asomarse por la izquierda',
  peekRight: 'Asomarse por la derecha',
  peekBottom: 'Asomarse por abajo',
  peekTop: 'Asomarse por arriba',
  enterLeft: 'Entrar por la izquierda',
  enterRight: 'Entrar por la derecha',
  exitLeft: 'Salir por la izquierda',
  exitRight: 'Salir por la derecha',
  crossLeftToRight: 'Cruzar de izquierda a derecha',
  crossRightToLeft: 'Cruzar de derecha a izquierda',
  rise: 'Subir desde abajo',
  grow: 'Crecer',
  shrink: 'Encoger',
};

export const TEXT_FONT_LABELS: Record<TextFont, string> = {
  divertida: 'Divertida',
  gruesa: 'Gruesa',
  elegante: 'Elegante',
  manuscrita: 'Manuscrita',
  simple: 'Simple',
};

export const EFFECT_LABELS: Record<EffectKind, string> = {
  solid: 'Color sólido',
  glow: 'Resplandor pulsante',
  stars: 'Estrellas mágicas',
  flicker: 'Parpadeo de vela',
  rainbow: 'Arcoíris',
  testPattern: 'Patrón de prueba',
  neon: 'Contorno de neón',
  drawOn: 'Contorno que se dibuja',
  chase: 'Luces de feria en el contorno',
  sweep: 'Barrido de luz',
  lightning: 'Relámpago',
  fire: 'Fuego',
  fog: 'Niebla',
  rain: 'Lluvia',
  snow: 'Nieve',
  fireflies: 'Luciérnagas',
};
