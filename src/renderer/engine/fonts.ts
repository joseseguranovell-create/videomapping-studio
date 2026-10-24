/**
 * Tipos de letra de los rótulos. Son fuentes libres (SIL Open Font License 1.1, licencias junto a cada
 * archivo en ./fonts) que viajan dentro de la aplicación: no se descarga nada de internet.
 */
import type { TextFont } from '../../shared/model';
import creepster from './fonts/creepster.woff2?url';
import eater from './fonts/eater.woff2?url';
import hennyPenny from './fonts/henny-penny.woff2?url';
import griffy from './fonts/griffy.woff2?url';
import mysteryQuest from './fonts/mystery-quest.woff2?url';
import jollyLodger from './fonts/jolly-lodger.woff2?url';
import pirataOne from './fonts/pirata-one.woff2?url';
import cinzelDecorative from './fonts/cinzel-decorative.woff2?url';
import bangers from './fonts/bangers.woff2?url';
import fredoka from './fonts/fredoka.woff2?url';

interface Face {
  family: string;
  url: string;
  weight: string;
  /** Relleno extra alrededor del texto (adornos que sobresalen: goteos, rizos). */
  overhang: number;
}

const FACES: Record<Exclude<TextFont, 'simple'>, Face> = {
  terror: { family: 'VMS Creepster', url: creepster, weight: '400', overhang: 0.25 },
  monstruo: { family: 'VMS Eater', url: eater, weight: '400', overhang: 0.3 },
  bruja: { family: 'VMS Henny Penny', url: hennyPenny, weight: '400', overhang: 0.3 },
  cuento: { family: 'VMS Griffy', url: griffy, weight: '400', overhang: 0.25 },
  misterio: { family: 'VMS Mystery Quest', url: mysteryQuest, weight: '400', overhang: 0.2 },
  manuscrita: { family: 'VMS Mystery Quest', url: mysteryQuest, weight: '400', overhang: 0.2 },
  calabaza: { family: 'VMS Jolly Lodger', url: jollyLodger, weight: '400', overhang: 0.15 },
  gotica: { family: 'VMS Pirata One', url: pirataOne, weight: '400', overhang: 0.15 },
  elegante: { family: 'VMS Cinzel Decorative', url: cinzelDecorative, weight: '700', overhang: 0.2 },
  gruesa: { family: 'VMS Bangers', url: bangers, weight: '400', overhang: 0.1 },
  divertida: { family: 'VMS Fredoka', url: fredoka, weight: '600', overhang: 0.1 },
};

/** Fuente CSS para el lienzo del rótulo (con respaldo del sistema si aún no se ha cargado). */
export function fontFor(font: TextFont, size: number): { css: string; overhang: number } {
  const f = font === 'simple' ? null : FACES[font];
  if (!f) return { css: `700 ${size}px 'Segoe UI', system-ui, Arial, sans-serif`, overhang: 0.1 };
  return { css: `${f.weight} ${size}px '${f.family}', 'Segoe UI', sans-serif`, overhang: f.overhang };
}

let loading: Promise<void> | null = null;

/** Carga todas las fuentes una vez (en paralelo). Se resuelve aunque alguna falle. */
export function loadFonts(): Promise<void> {
  if (loading) return loading;
  const seen = new Set<string>();
  const jobs: Promise<unknown>[] = [];
  for (const f of Object.values(FACES)) {
    if (seen.has(f.family)) continue;
    seen.add(f.family);
    const face = new FontFace(f.family, `url(${f.url})`, { weight: f.weight });
    jobs.push(face.load().then((l) => document.fonts.add(l)).catch(() => undefined));
  }
  loading = Promise.all(jobs).then(() => undefined);
  return loading;
}
