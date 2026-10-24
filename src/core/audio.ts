/**
 * Piano sound: smplr's SplendidGrandPiano (Steinway, 4 velocity layers).
 * Notes sustain until note-off, or until the sustain pedal (CC64) is released.
 */
import { SplendidGrandPiano, type Smplr, type StopFn } from 'smplr';
import { Emitter } from './emitter';
import { Metronome } from './metronome';

export interface AudioLoad {
  loaded: number;
  total: number;
  ready: boolean;
  error: boolean;
}

type AudioEvents = { load: AudioLoad };

const SUSTAIN_CC = 64;

export class PianoAudio extends Emitter<AudioEvents> {
  private context: AudioContext | null = null;
  private piano: Smplr | null = null;
  private voices = new Map<number, StopFn>();
  private held = new Set<number>();
  private sustain = false;
  private _load: AudioLoad = { loaded: 0, total: 0, ready: false, error: false };

  get load(): AudioLoad {
    return this._load;
  }

  /** Create the context and start fetching samples (playback starts after a user gesture). */
  init(): void {
    if (this.context) return;
    this.context = new AudioContext({ latencyHint: 'interactive' });
    this.piano = SplendidGrandPiano(this.context, {
      decayTime: 0.6,
      onLoadProgress: ({ loaded, total }) => this.setLoad({ ...this._load, loaded, total }),
    });
    this.piano.ready.then(
      () => this.setLoad({ ...this._load, ready: true }),
      () => this.setLoad({ ...this._load, error: true }),
    );

    // Browsers keep audio suspended until the page gets a gesture.
    const resume = () => {
      void this.context?.resume().then(() => {
        window.removeEventListener('pointerdown', resume, true);
        window.removeEventListener('keydown', resume, true);
      });
    };
    window.addEventListener('pointerdown', resume, true);
    window.addEventListener('keydown', resume, true);
  }

  /** The shared AudioContext (null until init), e.g. for the metronome. */
  get audioContext(): AudioContext | null {
    return this.context;
  }

  get running(): boolean {
    return this.context?.state === 'running';
  }

  noteOn(note: number, velocity: number): void {
    if (!this.piano) return;
    void this.context?.resume();
    this.voices.get(note)?.();
    this.voices.set(note, this.piano.start({ note, velocity }));
    this.held.add(note);
  }

  noteOff(note: number): void {
    this.held.delete(note);
    if (!this.sustain) this.release(note);
  }

  setSustain(down: boolean): void {
    this.sustain = down;
    if (down) return;
    for (const note of [...this.voices.keys()]) {
      if (!this.held.has(note)) this.release(note);
    }
  }

  handleCC(controller: number, value: number): void {
    if (controller === SUSTAIN_CC) this.setSustain(value >= 64);
  }

  /** Play a note for a fixed time (used for "hear the note" hints). */
  preview(note: number, velocity = 90, seconds = 1.2): void {
    if (!this.piano) return;
    void this.context?.resume();
    this.piano.start({ note, velocity, duration: seconds });
  }

  /**
   * Play notes for listening: together (stepMs 0, a block chord) or one after
   * another (arpeggio, scale), optionally starting `delayMs` from now.
   */
  playNotes(notes: number[], { stepMs = 0, seconds = 1.4, velocity = 80, delayMs = 0 } = {}): void {
    if (!this.piano || !this.context) return;
    void this.context.resume();
    const start = this.context.currentTime + 0.02 + delayMs / 1000;
    notes.forEach((note, i) => {
      this.piano!.start({ note, velocity, time: start + (i * stepMs) / 1000, duration: seconds });
    });
  }

  private release(note: number): void {
    this.voices.get(note)?.();
    this.voices.delete(note);
  }

  private setLoad(load: AudioLoad): void {
    this._load = load;
    this.emit('load', load);
  }
}

export const audio = new PianoAudio();

/** The app's metronome, sharing the piano's AudioContext (with its own volume). */
export const metronome = new Metronome(() => audio.audioContext);
