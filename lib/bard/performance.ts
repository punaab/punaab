/**
 * Plays authored recordings from `public/music/` through Web Audio.
 *
 * Browsers will not start audio without a user gesture, so nothing here makes
 * sound until `resume()` is called from a click.
 */

import { getSong, pickRandomSong, type Song } from "./songs";

export type PerformanceEvent =
  | { type: "song-start"; song: Song }
  | { type: "song-end"; song: Song }
  | { type: "note"; freq: number; singing: boolean; accent: number }
  | { type: "lyric"; text: string }
  /** A long enough rest that the sung line should clear and start over. */
  | { type: "phrase-break" }
  | { type: "idle" };

/** Live spectrum snapshot for in-world song aura / visualizer VFX. */
export type MusicLevels = {
  /** ~20–180 Hz body of the track, 0..1 */
  bass: number;
  /** ~180–2kHz melody / lute body, 0..1 */
  mid: number;
  /** brightness / air, 0..1 */
  treble: number;
  /** Overall loudness, 0..1 */
  energy: number;
};

export const EMPTY_MUSIC_LEVELS: MusicLevels = {
  bass: 0,
  mid: 0,
  treble: 0,
  energy: 0,
};

type Listener = (event: PerformanceEvent) => void;

/**
 * A convolution reverb tail, generated rather than loaded. Exponentially
 * decaying noise is the standard trick; the lowpass sweep over the tail is
 * what makes it sound like open air rather than a metal box.
 */
function buildValleyImpulse(ctx: AudioContext, seconds = 2.6): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const impulse = ctx.createBuffer(2, length, rate);

  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    let lowpass = 0;
    for (let i = 0; i < length; i++) {
      const progress = i / length;
      // Decay, plus a short pre-delay so the direct sound reads separately.
      const envelope = Math.pow(1 - progress, 2.6);
      const preDelay = i < rate * 0.02 ? 0 : 1;
      const noise = Math.random() * 2 - 1;
      // High frequencies die first in open air.
      lowpass += (0.55 - progress * 0.4) * (noise - lowpass);
      data[i] = lowpass * envelope * preDelay;
    }
  }
  return impulse;
}

export class BardPerformance {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private dry: GainNode | null = null;
  private wet: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private freqData: Uint8Array | null = null;
  private listeners = new Set<Listener>();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private sources: AudioBufferSourceNode[] = [];
  private currentSong: Song | null = null;
  private lastSongId: string | null = null;
  /** Latest spectrum — SongAura reads this every frame while a song plays. */
  readonly levels: MusicLevels = { ...EMPTY_MUSIC_LEVELS };

  get ready() {
    return this.ctx?.state === "running";
  }

  get playing() {
    return this.currentSong !== null;
  }

  get song() {
    return this.currentSong;
  }

  /** Subscribes to performance events. Returns an unsubscribe function. */
  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: PerformanceEvent) {
    for (const listener of this.listeners) listener(event);
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  async resume() {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new Ctor();
      this.ctx = ctx;

      this.master = ctx.createGain();
      this.master.gain.value = 0.8;

      this.dry = ctx.createGain();
      this.dry.gain.value = 0.78;

      const convolver = ctx.createConvolver();
      convolver.buffer = buildValleyImpulse(ctx);
      this.wet = ctx.createGain();
      this.wet.gain.value = 0.34;

      this.dry.connect(this.master);
      this.wet.connect(convolver);
      convolver.connect(this.master);
      this.master.connect(ctx.destination);

      // Tap the master for a soft visualizer — analyser is not in the audible path.
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.86;
      this.master.connect(this.analyser);
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    }
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  /**
   * Samples the current track into `levels`. Call once per frame from the
   * aura — cheap, and the smoothing lives on the AnalyserNode.
   */
  sampleLevels(): MusicLevels {
    const analyser = this.analyser;
    const data = this.freqData;
    const out = this.levels;
    if (!analyser || !data || !this.playing) {
      out.bass *= 0.88;
      out.mid *= 0.88;
      out.treble *= 0.88;
      out.energy *= 0.88;
      return out;
    }

    analyser.getByteFrequencyData(data as Uint8Array<ArrayBuffer>);
    const n = data.length;
    const bassEnd = Math.max(2, Math.floor(n * 0.08));
    const midEnd = Math.max(bassEnd + 1, Math.floor(n * 0.45));

    let bass = 0;
    let mid = 0;
    let treble = 0;
    for (let i = 0; i < n; i++) {
      const v = data[i] / 255;
      if (i < bassEnd) bass += v;
      else if (i < midEnd) mid += v;
      else treble += v;
    }
    bass /= bassEnd;
    mid /= Math.max(1, midEnd - bassEnd);
    treble /= Math.max(1, n - midEnd);

    // Mild compression so quiet passages still breathe and peaks don't blow out.
    const shape = (v: number) => Math.pow(Math.min(1, v * 1.35), 0.85);
    out.bass = shape(bass);
    out.mid = shape(mid);
    out.treble = shape(treble);
    out.energy = shape(bass * 0.45 + mid * 0.4 + treble * 0.15);
    return out;
  }

  setVolume(value: number) {
    if (!this.master || !this.ctx) return;
    this.master.gain.setTargetAtTime(
      Math.max(0, Math.min(1, value)),
      this.ctx.currentTime,
      0.05
    );
  }

  /**
   * Plays a song from `public/music/`. No synthesized fallback.
   * Omit `songId` to pick randomly from the repertoire (no immediate repeats).
   */
  async play(songId?: string) {
    await this.resume();
    if (!this.ctx) return;
    // Hard cut any prior track — no song-end event (that is for user silence).
    this.stop(0);
    if (this.master && this.ctx) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setValueAtTime(0.8, t);
    }

    const song = songId
      ? getSong(songId)
      : pickRandomSong(this.lastSongId ?? undefined);
    this.lastSongId = song.id;
    this.currentSong = song;
    this.emit({ type: "song-start", song });
    await this.playRecording(song);
  }

  /**
   * Plays an authored `.mp3` through the dry/wet bus, and pulses light `note`
   * events so his hands still keep time with the track.
   */
  private async playRecording(song: Song) {
    const ctx = this.ctx;
    const dry = this.dry;
    const wet = this.wet;
    if (!ctx || !dry || !wet || !song.audioFile) {
      this.currentSong = null;
      this.emit({ type: "song-end", song });
      this.emit({ type: "idle" });
      return;
    }

    let buffer: AudioBuffer;
    try {
      const res = await fetch(`/music/${encodeURIComponent(song.audioFile)}`);
      if (!res.ok) throw new Error(`Missing ${song.audioFile}`);
      const data = await res.arrayBuffer();
      buffer = await ctx.decodeAudioData(data.slice(0));
    } catch {
      this.currentSong = null;
      this.emit({ type: "song-end", song });
      this.emit({ type: "idle" });
      return;
    }

    // Another play() may have won the race while we were decoding.
    if (this.currentSong?.id !== song.id) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(dry);
    source.connect(wet);
    const startAt = ctx.currentTime + 0.06;
    source.start(startAt);
    this.sources.push(source);

    const durationMs = buffer.duration * 1000;
    const pulseMs = 680;
    let pulses = 0;
    const maxPulses = Math.floor(durationMs / pulseMs);
    const pulse = () => {
      if (this.currentSong?.id !== song.id) return;
      this.emit({
        type: "note",
        freq: 196 + (pulses % 5) * 18,
        singing: pulses % 4 === 0,
        accent: pulses % 3 === 0 ? 0.7 : 0.4,
      });
      pulses += 1;
      if (pulses < maxPulses) {
        this.timers.push(setTimeout(pulse, pulseMs));
      }
    };
    this.timers.push(setTimeout(pulse, 180));

    this.timers.push(
      setTimeout(() => {
        if (this.currentSong?.id !== song.id) return;
        this.currentSong = null;
        this.emit({ type: "song-end", song });
        this.emit({ type: "idle" });
      }, durationMs + 80)
    );
  }

  /**
   * Cuts the performance. Pass `fade` (seconds) to ramp the master down first
   * so a click-to-silence doesn't chop the last note dead. A faded stop also
   * emits `song-end`; a hard cut (used when starting the next track) does not.
   */
  stop(fade = 0) {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];

    const ended = this.currentSong;
    this.currentSong = null;
    this.levels.bass = 0;
    this.levels.mid = 0;
    this.levels.treble = 0;
    this.levels.energy = 0;

    const sources = this.sources;
    this.sources = [];

    const finish = () => {
      for (const source of sources) {
        try {
          source.stop();
        } catch {
          // already finished
        }
      }
      if (this.master && this.ctx) {
        const t = this.ctx.currentTime;
        this.master.gain.cancelScheduledValues(t);
        this.master.gain.setValueAtTime(0.8, t);
      }
    };

    if (fade > 0 && this.master && this.ctx && sources.length > 0) {
      const now = this.ctx.currentTime;
      const gain = this.master.gain;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(0.0001, now + fade);
      this.timers.push(setTimeout(finish, Math.ceil(fade * 1000) + 30));
    } else {
      finish();
    }

    if (ended && fade > 0) {
      this.emit({ type: "song-end", song: ended });
      this.emit({ type: "idle" });
    }
  }

  dispose() {
    this.stop();
    this.listeners.clear();
    void this.ctx?.close();
    this.ctx = null;
    this.analyser = null;
    this.freqData = null;
  }
}
