import { describe, it, expect } from 'vitest';
import { createProject, createScene } from '../../src/shared/factory';
import { layoutShow } from '../../src/shared/timeline';
import { playlistToShow, allShows, withPlaylists, isPlaylistShowId, PLAYLIST_ID_PREFIX } from '../../src/shared/playlist';
import type { Project, Show, Playlist } from '../../src/shared/model';

const NOW = '2026-01-01T00:00:00.000Z';
function show(id: string, durations: number[], musicStart = 0): Show {
  return {
    id, name: id, description: '', tags: [], installationId: null,
    scenes: durations.map((d, i) => ({ ...createScene(`${id} escena ${i}`, d), id: `${id}-s${i}`, transition: { type: 'cut' as const, duration: 0 } })),
    music: [{ id: `${id}-m`, assetId: 'musica', start: musicStart, volume: 0.9, fadeIn: 1, fadeOut: 2, loop: true }],
    masterVolume: 1, loop: true, loopGap: 3, createdAt: NOW, updatedAt: NOW,
  };
}
function proyecto(): Project {
  const p = createProject('Prueba');
  p.shows = [show('A', [24, 10, 10], 24), show('B', [5, 20], 5)];
  return p;
}
const lista = (items: Playlist['items'], extra: Partial<Playlist> = {}): Playlist => ({ id: 'L1', name: 'Mi lista', items, loop: false, loopGap: 3, ...extra });

describe('listas de reproducción', () => {
  it('encadena las escenas de los espectáculos en orden', () => {
    const p = proyecto();
    const s = playlistToShow(p, lista([{ showId: 'A', skipFirstScene: false, gap: 0 }, { showId: 'B', skipFirstScene: false, gap: 0 }]))!;
    expect(s.id).toBe(PLAYLIST_ID_PREFIX + 'L1');
    expect(layoutShow(s).duration).toBe(24 + 10 + 10 + 5 + 20);
  });
  it('la música del segundo espectáculo empieza donde empieza él', () => {
    const p = proyecto();
    const s = playlistToShow(p, lista([{ showId: 'A', skipFirstScene: false, gap: 0 }, { showId: 'B', skipFirstScene: false, gap: 0 }]))!;
    expect(s.music.find((m) => m.id === '0:A-m')!.start).toBe(24);
    expect(s.music.find((m) => m.id === '1:B-m')!.start).toBe(44 + 5);
    expect(s.music.every((m) => m.loop === false)).toBe(true);
  });
  it('salta la escena de espera (menos en el primero) y adelanta su música; la pausa suma tiempo', () => {
    const p = proyecto();
    const s = playlistToShow(p, lista([{ showId: 'A', skipFirstScene: true, gap: 5 }, { showId: 'B', skipFirstScene: true, gap: 2 }]))!;
    // El primero conserva su espera (24+10+10); el segundo la pierde (5 s) y suma 2 s de pausa.
    expect(layoutShow(s).duration).toBe(44 + 2 + 20);
    expect(s.music.find((m) => m.id === '1:B-m')!.start).toBe(44 + 2 + 0);
  });
  it('un mismo espectáculo dos veces no repite ids y los inexistentes se ignoran', () => {
    const p = proyecto();
    const s = playlistToShow(p, lista([{ showId: 'B', skipFirstScene: false, gap: 0 }, { showId: 'NO', skipFirstScene: false, gap: 0 }, { showId: 'B', skipFirstScene: false, gap: 0 }]))!;
    const ids = s.scenes.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(layoutShow(s).duration).toBe(50);
  });
  it('una lista vacía no genera espectáculo y withPlaylists lo añade al proyecto', () => {
    const p = proyecto();
    expect(playlistToShow(p, lista([]))).toBeNull();
    p.playlists = [lista([{ showId: 'A', skipFirstScene: false, gap: 0 }])];
    expect(allShows(p).map((x) => x.id)).toEqual(['A', 'B', 'lista:L1']);
    expect(withPlaylists(p).shows.length).toBe(3);
    expect(isPlaylistShowId('lista:L1')).toBe(true);
    expect(isPlaylistShowId('A')).toBe(false);
  });
});
