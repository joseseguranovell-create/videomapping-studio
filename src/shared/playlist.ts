/**
 * Listas de reproducción: varios espectáculos encadenados con la misma calibración.
 *
 * Una lista se reproduce como un espectáculo «virtual» (id `lista:<id>`) que se construye juntando las escenas
 * de cada espectáculo, con una pausa en negro opcional entre ellos, y con la música de cada uno desplazada a su sitio.
 * No se guarda en el proyecto: se calcula cuando hace falta (salida, grabación de vídeo, selector de reproducción).
 */
import type { Playlist, Project, Scene, Show } from './model';
import { layoutShow } from './timeline';

export const PLAYLIST_ID_PREFIX = 'lista:';
export const isPlaylistShowId = (id: string | null | undefined): id is string => !!id && id.startsWith(PLAYLIST_ID_PREFIX);
export const playlistIdOf = (showId: string) => showId.slice(PLAYLIST_ID_PREFIX.length);

/** ¿El espectáculo empieza con una escena de espera (su nombre dice «espera»)? Esa es la que se salta al encadenarlo después de otro. */
export const hasWaitScene = (show: Show): boolean => /espera/i.test(show.scenes.find((s) => s.enabled)?.name ?? '');

/** Elemento de lista con los ajustes por defecto: salta la espera solo si la tiene, y deja 2 s en negro entre espectáculos. */
export const newPlaylistItem = (show: Show, first: boolean): { showId: string; skipFirstScene: boolean; gap: number } =>
  ({ showId: show.id, skipFirstScene: !first && hasWaitScene(show), gap: first ? 0 : 2 });

/** Escenas activas de un espectáculo; si `skipFirst`, sin la primera (la de espera). */
function keptScenes(show: Show, skipFirst: boolean): Scene[] {
  const on = show.scenes.filter((s) => s.enabled);
  return skipFirst && on.length > 1 ? on.slice(1) : on;
}

/**
 * Construye el espectáculo virtual de una lista. Los espectáculos que ya no existen o no tienen escenas activas se ignoran.
 * Devuelve null si no queda ninguno.
 */
export function playlistToShow(project: Project, pl: Playlist): Show | null {
  const scenes: Scene[] = [];
  const music: Show['music'] = [];
  let first: Show | null = null;
  let made = 0;
  pl.items.forEach((item, i) => {
    const show = project.shows.find((s) => s.id === item.showId);
    if (!show) return;
    const skip = item.skipFirstScene && made > 0;
    const kept = keptScenes(show, skip);
    if (!kept.length) return;
    // Pausa en negro antes de este espectáculo (no antes del primero).
    if (made > 0 && item.gap > 0) {
      scenes.push({ id: `${i}:pausa`, name: 'Pausa', duration: item.gap, transition: { type: 'cut', duration: 0 }, clips: [], sounds: [], lights: [], notes: '', enabled: true });
    }
    // Dónde empieza (en la lista) el primer fotograma de este espectáculo y cuánto hay que adelantar su música si se salta una escena.
    const offset = made === 0 ? 0 : layoutShow({ ...(first ?? show), scenes }).duration;
    const original = layoutShow(show);
    const shift = skip ? original.slots.find((sl) => sl.scene.id === kept[0].id)?.start ?? 0 : 0;
    kept.forEach((sc, k) => {
      const tr = made > 0 && k === 0 && sc.transition.type === 'crossfade' ? { type: 'fade' as const, duration: sc.transition.duration } : sc.transition;
      scenes.push({
        ...sc,
        id: `${i}:${sc.id}`,
        transition: tr,
        clips: sc.clips.map((c) => ({ ...c, id: `${i}:${c.id}` })),
        sounds: sc.sounds.map((c) => ({ ...c, id: `${i}:${c.id}` })),
        lights: sc.lights.map((c) => ({ ...c, id: `${i}:${c.id}` })),
      });
    });
    show.music.forEach((m) => music.push({ ...m, id: `${i}:${m.id}`, start: offset + Math.max(0, m.start - shift), loop: false }));
    if (!first) first = show;
    made++;
  });
  if (!first || !scenes.length) return null;
  const f: Show = first;
  return {
    id: PLAYLIST_ID_PREFIX + pl.id,
    name: pl.name,
    description: `Lista de reproducción (${made} espectáculo${made === 1 ? '' : 's'})`,
    tags: ['lista'],
    installationId: f.installationId,
    scenes,
    music,
    masterVolume: f.masterVolume,
    loop: pl.loop,
    loopGap: pl.loopGap,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  };
}

/** Los espectáculos del proyecto más las listas, convertidas en espectáculos. */
export function allShows(project: Project): Show[] {
  const lists = (project.playlists ?? []).map((pl) => playlistToShow(project, pl)).filter((s): s is Show => !!s);
  return [...project.shows, ...lists];
}

/** El proyecto con las listas añadidas como espectáculos (para la salida y la grabación de vídeo; no se guarda). */
export function withPlaylists(project: Project): Project {
  if (!project.playlists?.length) return project;
  return { ...project, shows: allShows(project) };
}
