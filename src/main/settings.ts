/** Preferencias de la aplicación (no del proyecto) guardadas en la carpeta de usuario. */
import fs from 'node:fs';
import path from 'node:path';
import type { AppSettings } from '../shared/api';
import { writeFileAtomic } from './projectStore';

const DEFAULTS: AppSettings = {
  recent: [],
  lastProject: null,
  reopenLastProject: true,
  audioEnabled: true,
  previewAudio: true,
  autosaveSeconds: 30,
  lastOutputDisplayLabel: null,
  showFps: false,
  schedule: { enabled: false, projectFile: null, showId: null, start: '18:30', end: '22:00' },
};

export class SettingsStore {
  private data: AppSettings;
  constructor(private file: string) {
    this.data = { ...DEFAULTS };
    try {
      if (fs.existsSync(file)) {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        this.data = { ...DEFAULTS, ...saved, schedule: { ...DEFAULTS.schedule, ...(saved.schedule ?? {}) } };
      }
    } catch {
      // Preferencias dañadas: se guarda una copia y se empieza con valores por defecto.
      try { fs.copyFileSync(file, `${file}.corrupt`); } catch { /* ignorar */ }
    }
  }
  get(): AppSettings {
    return structuredClone(this.data);
  }
  async set(p: Partial<AppSettings>): Promise<AppSettings> {
    this.data = { ...this.data, ...p };
    await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
    await writeFileAtomic(this.file, JSON.stringify(this.data, null, 2));
    return this.get();
  }
  async touchRecent(file: string, name: string) {
    const recent = [{ file, name, openedAt: new Date().toISOString() }, ...this.data.recent.filter((r) => r.file !== file)].slice(0, 12);
    await this.set({ recent, lastProject: file });
  }
}
