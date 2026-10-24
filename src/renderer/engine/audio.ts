/**
 * Audio del espectáculo con Web Audio API.
 * El reloj de AudioContext es también el reloj maestro de la reproducción (ver PlaybackClock),
 * de modo que imagen y sonido comparten la misma referencia temporal.
 */
import type { Asset } from '../../shared/model';
import type { AudioCue } from '../../shared/timeline';
import { mediaUrl } from './media';

interface Playing {
  src: AudioBufferSourceNode;
  gain: GainNode;
  cycle: number;
}

export class AudioEngine {
  readonly ctx: AudioContext | null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer | null>();
  private loading = new Map<string, Promise<AudioBuffer | null>>();
  private playing = new Map<string, Playing>();
  private enabled = true;
  private volume = 1;
  errors = new Map<string, string>();

  constructor(private onError: (msg: string) => void = () => {}) {
    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioContext({ latencyHint: 'playback' });
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
    } catch {
      ctx = null;
    }
    this.ctx = ctx;
  }

  get running() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  async resume() {
    if (this.ctx && this.ctx.state !== 'running') {
      try {
        await this.ctx.resume();
      } catch {
        /* sin audio */
      }
    }
  }

  setEnabled(enabled: boolean, volume = this.volume) {
    this.enabled = enabled;
    this.volume = volume;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(enabled ? volume : 0, this.ctx.currentTime, 0.03);
  }

  isEnabled() {
    return this.enabled;
  }

  buffer(asset: Asset, base: string, key: string): AudioBuffer | null | undefined {
    if (this.buffers.has(asset.id)) return this.buffers.get(asset.id);
    if (!this.ctx) return null;
    if (!this.loading.has(asset.id)) {
      const ctx = this.ctx;
      const p = fetch(mediaUrl(base, asset.file, key))
        .then((r) => {
          if (!r.ok) throw new Error('ausente');
          return r.arrayBuffer();
        })
        .then((ab) => ctx.decodeAudioData(ab))
        .catch((e) => {
          const msg = `Audio «${asset.name}»: ${String(e.message) === 'ausente' ? 'archivo ausente' : 'formato no compatible'}`;
          if (!this.errors.has(asset.id)) this.onError(msg);
          this.errors.set(asset.id, msg);
          return null;
        })
        .then((b) => {
          this.buffers.set(asset.id, b);
          this.loading.delete(asset.id);
          return b;
        });
      this.loading.set(asset.id, p);
    }
    return undefined; // cargando
  }

  /**
   * Programa (si no lo está ya) cada cue que deba sonar.
   * @param cycleStartCtx tiempo de AudioContext en el que empieza el ciclo actual del espectáculo
   * @param cycleNow tiempo actual dentro del ciclo
   */
  sync(cues: AudioCue[], assets: Map<string, Asset>, base: string, key: string, cycle: number, cycleStartCtx: number, cycleNow: number, masterVolume: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    for (const cue of cues) {
      const pid = `${cycle}:${cue.id}`;
      if (this.playing.has(pid)) continue;
      // Solo se programan los cues que empiezan pronto (o ya han empezado y siguen activos).
      if (cue.start > cycleNow + 1.0) continue;
      if (cue.end != null && cue.end <= cycleNow) continue;
      const asset = assets.get(cue.assetId);
      if (!asset) continue;
      const buf = this.buffer(asset, base, key);
      if (!buf) continue; // cargando o con error
      const naturalEnd = cue.loop ? Infinity : cue.start + buf.duration;
      const end = Math.min(cue.end ?? Infinity, naturalEnd);
      if (end <= cycleNow) {
        this.playing.set(pid, { src: null as any, gain: null as any, cycle }); // marcado como terminado
        continue;
      }
      const when = cycleStartCtx + cue.start;
      const startAt = Math.max(when, now + 0.01);
      let offset = Math.max(0, startAt - when);
      if (cue.loop) offset = offset % buf.duration;
      if (!cue.loop && offset >= buf.duration) continue;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = cue.loop;
      const gain = ctx.createGain();
      src.connect(gain);
      gain.connect(this.master);
      const vol = cue.volume * masterVolume;
      const g = gain.gain;
      const elapsed = startAt - when;
      if (cue.fadeIn > 0 && elapsed < cue.fadeIn) {
        g.setValueAtTime(vol * (elapsed / cue.fadeIn), startAt);
        g.linearRampToValueAtTime(vol, when + cue.fadeIn);
      } else {
        g.setValueAtTime(vol, startAt);
      }
      if (isFinite(end)) {
        const endCtx = cycleStartCtx + end;
        const fo = Math.min(Math.max(cue.fadeOut, 0.03), Math.max(0.03, end - cue.start));
        const foStart = Math.max(startAt, endCtx - fo);
        g.setValueAtTime(vol, Math.max(foStart, Math.min(endCtx, when + cue.fadeIn)));
        g.linearRampToValueAtTime(0, endCtx);
        src.stop(endCtx + 0.02);
      }
      src.start(startAt, offset);
      const entry: Playing = { src, gain, cycle };
      src.onended = () => {
        try { gain.disconnect(); } catch { /* ignorar */ }
      };
      this.playing.set(pid, entry);
    }
    // Limpieza de entradas de ciclos antiguos.
    for (const [pid, p] of this.playing) if (p.cycle < cycle - 1) this.playing.delete(pid);
  }

  /** Detiene todos los sonidos con un fundido muy breve para evitar chasquidos. */
  stopAll(fade = 0.05) {
    const ctx = this.ctx;
    for (const p of this.playing.values()) {
      if (!p.src) continue;
      try {
        if (ctx) {
          p.gain.gain.cancelScheduledValues(ctx.currentTime);
          p.gain.gain.setValueAtTime(p.gain.gain.value, ctx.currentTime);
          p.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + fade);
          p.src.stop(ctx.currentTime + fade + 0.01);
        } else p.src.stop();
      } catch {
        /* ya detenido */
      }
    }
    this.playing.clear();
  }

  get activeCount() {
    let n = 0;
    for (const p of this.playing.values()) if (p.src) n++;
    return n;
  }

  clearBuffers() {
    this.stopAll(0.02);
    this.buffers.clear();
    this.loading.clear();
    this.errors.clear();
  }

  invalidate(assetId: string) {
    this.buffers.delete(assetId);
    this.errors.delete(assetId);
  }

  dispose() {
    this.stopAll(0.01);
    void this.ctx?.close();
  }
}
