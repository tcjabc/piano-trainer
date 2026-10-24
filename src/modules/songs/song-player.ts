/**
 * Playing a song (or a range of it): the clock, the three modes and what
 * the app plays itself.
 *
 * - Wait: the song moves at tempo but stops at each step until its notes
 *   have been played (a chord in any order); wrong notes are counted.
 * - Play-along: it runs at tempo with the metronome (after a bar of
 *   count-in); each press is judged on time / early / late, unplayed notes
 *   are missed.
 * - Listen: the app plays the chosen hands.
 *
 * The other hand can be silent, played by the app, or hidden (not played or
 * shown). A range can loop, with the tempo raised after each clean pass
 * when progressive tempo is on. The clock is performance.now(), the same as
 * MIDI event times; app notes are scheduled ahead on the audio clock.
 */
import { audio, metronome } from '../../core/audio';
import { Emitter } from '../../core/emitter';
import { songPassClean } from '../../core/grading';
import { clampBpm, TIME_SIGNATURES, type MetronomeSettings, type TimeSignature } from '../../core/metronome';
import type { HandChoice, OtherHand } from '../../core/settings';
import { beatToSeconds, handsOf, notesIn, secondsToBeat, stepsOf, tempoAt, type SongData, type SongHand, type SongNote } from '../../core/song';
import { TimingJudge, WaitMatcher, type Timing, type TimingSummary } from '../../core/song-judge';
import { progressiveTempo, type Pass, type SongMode } from '../../core/song-learning';
import { GRADING } from '../../core/grading';

export interface PlayerConfig {
  hands: HandChoice;
  otherHand: OtherHand;
  mode: SongMode;
  /** Tempo factor (1 = as written). */
  tempo: number;
  loop: boolean;
  countIn: boolean;
  progressiveTempo: boolean;
}

export type PlayerPhase = 'stopped' | 'counting-in' | 'playing' | 'paused' | 'finished';

export type MarkKind = Timing | 'hit' | 'missed' | 'wrong';

export interface Mark {
  kind: MarkKind;
  midi: number;
  noteId?: string;
  deltaMs?: number;
  /** performance.now() when it happened. */
  at: number;
}

export interface PassReport extends Pass {
  range: [number, number];
  /** Play-along detail. */
  timing: TimingSummary | null;
  wrong: number;
  clean: boolean;
}

type PlayerEvents = {
  phase: PlayerPhase;
  mark: Mark;
  pass: PassReport;
  /** The tempo changed by itself (progressive tempo). */
  tempo: number;
};

export const MIN_TEMPO = 0.25;
export const MAX_TEMPO = 1.5;
/** How far ahead app notes are handed to the audio clock (ms). */
const SCHEDULE_AHEAD_MS = 150;
/** Lead time before a pass without count-in starts (ms). */
const START_LEAD_MS = 400;
const RECENT_MARKS = 32;

export class SongPlayer extends Emitter<PlayerEvents> {
  private data: SongData;
  private range: [number, number] = [0, 0];
  config: PlayerConfig;
  private _phase: PlayerPhase = 'stopped';
  /** The clock: position `anchorBeat` at performance time `anchorTime` (ms). */
  private anchorBeat = 0;
  private anchorTime = 0;
  /** The tempo actually played (the metronome rounds to whole BPM). */
  private playTempo = 1;
  private pos = 0;
  private matcher: WaitMatcher | null = null;
  private judge: TimingJudge | null = null;
  private appNotes: SongNote[] = [];
  private appNext = 0;
  private metronomeBefore: MetronomeSettings | null = null;
  private metronomeWasRunning = false;
  /** Marks per note in the current pass (for drawing). */
  readonly marks = new Map<string, Mark>();
  /** The latest marks, wrong notes included (for labels). */
  readonly recentMarks: Mark[] = [];

  constructor(data: SongData, config: PlayerConfig) {
    super();
    this.data = data;
    this.config = { ...config };
    this.range = [0, data.measures.length ? data.measures[data.measures.length - 1]!.beat + data.measures[data.measures.length - 1]!.length : 0];
  }

  get phase(): PlayerPhase {
    return this._phase;
  }

  get position(): number {
    return this.pos;
  }

  get songData(): SongData {
    return this.data;
  }

  get currentRange(): [number, number] {
    return this.range;
  }

  get activeHands(): SongHand[] {
    return handsOf(this.config.hands);
  }

  /** Hands whose notes are shown (the other hand unless it's hidden). */
  get shownHands(): SongHand[] {
    return this.config.otherHand === 'hide' ? this.activeHands : ['L', 'R'];
  }

  get waitingKeys(): number[] {
    return this.matcher && this.config.mode === 'wait' ? this.matcher.remaining() : [];
  }

  setData(data: SongData): void {
    this.data = data;
  }

  setRange(start: number, end: number): void {
    this.stop();
    this.range = [start, end];
    this.pos = start;
  }

  configure(patch: Partial<PlayerConfig>): void {
    const wasRunning = this._phase === 'playing' || this._phase === 'counting-in';
    const before = this.config;
    this.config = { ...this.config, ...patch };
    const restart = patch.mode !== undefined && patch.mode !== before.mode || patch.hands !== undefined && patch.hands !== before.hands || patch.otherHand !== undefined;
    if (wasRunning && restart) this.start();
    else if (wasRunning && patch.tempo !== undefined && patch.tempo !== before.tempo) {
      // Keep the place and go on at the new tempo (play-along restarts, so timing stays fair).
      if (this.config.mode === 'play-along') this.start();
      else {
        this.anchor(this.pos, performance.now());
        this.playTempo = this.config.tempo;
      }
    }
  }

  private setPhase(phase: PlayerPhase): void {
    if (phase === this._phase) return;
    this._phase = phase;
    this.emit('phase', phase);
  }

  // ── Clock ────────────────────────────────────────────────────────────

  private anchor(beat: number, time: number): void {
    this.anchorBeat = beat;
    this.anchorTime = time;
  }

  private beatAt(time: number): number {
    const seconds = beatToSeconds(this.data, this.anchorBeat) + ((time - this.anchorTime) / 1000) * this.playTempo;
    return seconds < 0 ? 0 : secondsToBeat(this.data, seconds);
  }

  /** performance.now() time at which a beat is reached on the current clock. */
  timeAt(beat: number): number {
    return this.anchorTime + ((beatToSeconds(this.data, beat) - beatToSeconds(this.data, this.anchorBeat)) / this.playTempo) * 1000;
  }

  // ── Transport ────────────────────────────────────────────────────────

  /** Play from the start of the range (or carry on after a pause). */
  play(): void {
    if (this._phase === 'paused') {
      this.anchor(this.pos, performance.now());
      if (this.config.mode === 'play-along') this.startMetronome(false, this.pos);
      this.setPhase('playing');
      return;
    }
    this.start();
  }

  toggle(): void {
    if (this._phase === 'playing' || this._phase === 'counting-in') this.pause();
    else this.play();
  }

  pause(): void {
    if (this._phase !== 'playing' && this._phase !== 'counting-in') return;
    this.stopMetronome();
    this.setPhase('paused');
  }

  stop(): void {
    this.stopMetronome(true);
    this.matcher = null;
    this.judge = null;
    this.pos = this.range[0];
    this.setPhase('stopped');
  }

  /** Start a pass through the range from its beginning. */
  start(): void {
    const [start, end] = this.range;
    const { mode } = this.config;
    this.stopMetronome();
    this.marks.clear();
    this.pos = start;
    const userNotes = notesIn(this.data, start, end, this.activeHands);
    const others = (['L', 'R'] as SongHand[]).filter((h) => !this.activeHands.includes(h));
    const appHands = mode === 'listen' ? [...this.activeHands, ...(this.config.otherHand === 'play' ? others : [])] : this.config.otherHand === 'play' ? others : [];
    this.appNotes = notesIn(this.data, start, end, appHands).sort((a, b) => a.beat - b.beat);
    this.appNext = 0;
    this.matcher = mode === 'wait' ? new WaitMatcher(stepsOf(userNotes)) : null;
    this.playTempo = this.config.tempo;

    const now = performance.now();
    if (mode === 'play-along') {
      const downbeat = this.startMetronome(this.config.countIn, start);
      this.anchor(start, downbeat);
      this.judge = new TimingJudge(userNotes.map((n) => ({ id: n.id, midi: n.midi, time: this.timeAt(n.beat) / 1000 })));
      this.setPhase(downbeat > now + 50 ? 'counting-in' : 'playing');
    } else {
      this.judge = null;
      this.anchor(start, now + START_LEAD_MS);
      this.setPhase('playing');
    }
  }

  /** Start the metronome in time with the song; returns the performance time of the first beat. */
  private startMetronome(countIn: boolean, fromBeat: number): number {
    if (!this.metronomeBefore) {
      this.metronomeBefore = metronome.settings;
      this.metronomeWasRunning = metronome.running;
    }
    const [n, d] = this.data.timeSignature;
    const quarterBpm = tempoAt(this.data, fromBeat) * this.config.tempo;
    const compound = d === 8 && n % 3 === 0;
    const beatBpm = compound ? quarterBpm / 1.5 : d === 8 ? quarterBpm * 2 : quarterBpm;
    const bpm = clampBpm(beatBpm);
    this.playTempo = this.config.tempo * (bpm / beatBpm);
    const ts = `${n}/${d}`;
    metronome.setSettings({ bpm, timeSignature: (TIME_SIGNATURES as readonly string[]).includes(ts) ? (ts as TimeSignature) : '4/4' });
    const downbeat = metronome.start({ countIn });
    const perf = downbeat === null ? null : metronome.toPerformanceTime(downbeat);
    return perf ?? performance.now() + START_LEAD_MS;
  }

  /** Stop the metronome; on a full stop, put its settings back as they were. */
  private stopMetronome(restore = false): void {
    if (!this.metronomeBefore) return;
    metronome.stop();
    if (!restore) return;
    const before = this.metronomeBefore;
    this.metronomeBefore = null;
    metronome.setSettings({ bpm: before.bpm, timeSignature: before.timeSignature });
    if (this.metronomeWasRunning) metronome.start({ countIn: false });
  }

  // ── Each frame ───────────────────────────────────────────────────────

  /** Move the song on; call once per animation frame. Returns the position (beats). */
  frame(now: number): number {
    if (this._phase === 'counting-in' && now >= this.anchorTime) this.setPhase('playing');
    if (this._phase !== 'playing' && this._phase !== 'counting-in') return this.pos;
    const [start, end] = this.range;
    let target = Math.max(start, this.beatAt(now));

    if (this.config.mode === 'wait' && this.matcher) {
      const limit = this.matcher.current?.beat ?? end;
      if (target >= limit) {
        // Hold at the step; keep the clock there so it carries on from now once played.
        target = limit;
        this.anchor(limit, now);
      }
    }
    this.pos = Math.min(target, end);
    this.playAppNotes(now);

    if (this.judge) {
      for (const n of this.judge.sweep(now / 1000)) this.mark({ kind: 'missed', midi: n.midi, noteId: n.id, at: now });
    }

    const finished =
      this.config.mode === 'play-along'
        ? now >= this.timeAt(end) + GRADING.songs.hitWindowMs
        : this.pos >= end - 1e-6 && (!this.matcher || this.matcher.done);
    if (finished) this.finishPass();
    return this.pos;
  }

  private playAppNotes(now: number): void {
    const waiting = this.config.mode === 'wait';
    while (this.appNext < this.appNotes.length) {
      const n = this.appNotes[this.appNext]!;
      // In wait mode notes sound as the song passes them (it may be holding at a step).
      if (waiting ? n.beat >= this.pos - 1e-6 && this.pos < this.range[1] : this.timeAt(n.beat) > now + SCHEDULE_AHEAD_MS) break;
      const delayMs = waiting ? 0 : Math.max(0, this.timeAt(n.beat) - now);
      const seconds = Math.max(0.1, beatToSeconds(this.data, n.beat + n.duration) - beatToSeconds(this.data, n.beat)) / this.playTempo;
      audio.playNotes([n.midi], { delayMs, seconds, velocity: Math.round(n.velocity * 127) });
      this.appNext++;
    }
  }

  /** Notes the app has played that are still sounding at the position (for lighting keys). */
  appSounding(): SongNote[] {
    return this.appNotes.slice(0, this.appNext).filter((n) => n.beat <= this.pos + 1e-6 && this.pos < n.beat + n.duration);
  }

  // ── Input ────────────────────────────────────────────────────────────

  noteOn(midi: number, time: number): void {
    if (this._phase !== 'playing' && this._phase !== 'counting-in') return;
    if (this.config.mode === 'wait' && this.matcher) {
      const step = this.matcher.current;
      const result = this.matcher.press(midi);
      const note = step?.notes.find((n) => n.midi === midi);
      if (result === 'wrong') this.mark({ kind: 'wrong', midi, at: time });
      else if (result !== 'again') this.mark({ kind: 'hit', midi, noteId: note?.id, at: time });
      // Played ahead of the song: let it catch up at tempo from where it is.
      if (result === 'step' || result === 'done') this.anchor(this.pos, Math.max(time, performance.now()));
    } else if (this.config.mode === 'play-along' && this.judge) {
      const judged = this.judge.press(midi, time / 1000);
      if (judged) this.mark({ kind: judged.timing, midi, noteId: judged.note.id, deltaMs: judged.deltaMs, at: time });
      else this.mark({ kind: 'wrong', midi, at: time });
    }
  }

  private mark(m: Mark): void {
    if (m.noteId) this.marks.set(m.noteId, m);
    this.recentMarks.push(m);
    if (this.recentMarks.length > RECENT_MARKS) this.recentMarks.shift();
    this.emit('mark', m);
  }

  private finishPass(): void {
    const { mode } = this.config;
    if (mode !== 'listen') {
      const timing = this.judge?.summary() ?? null;
      const accuracy = timing ? timing.accuracy : (this.matcher?.accuracy ?? 1);
      const onTime = timing ? timing.onTimeShare : null;
      const result = { mode: mode as 'wait' | 'play-along', accuracy, onTime };
      const clean = songPassClean(result);
      this.emit('pass', {
        ...result,
        hands: this.config.hands,
        tempo: Math.round(this.config.tempo * 100) / 100,
        at: Date.now(),
        range: [...this.range],
        timing,
        wrong: timing ? timing.wrong : (this.matcher?.wrong ?? 0),
        clean,
      });
      if (this.config.progressiveTempo && clean) {
        const next = progressiveTempo(this.config.tempo, true);
        if (next !== this.config.tempo) {
          this.config = { ...this.config, tempo: next };
          this.emit('tempo', next);
        }
      }
    }
    if (this.config.loop) {
      this.start();
      return;
    }
    this.stopMetronome(true);
    this.pos = this.range[1];
    this.setPhase('finished');
  }
}
