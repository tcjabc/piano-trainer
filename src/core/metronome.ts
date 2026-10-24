/**
 * Metronome: a shared core service, used alongside Play, drills and the
 * Library (and by Phase 3's timed sight reading). UI-agnostic.
 *
 * Timing: clicks are scheduled on the AudioContext clock by a lookahead
 * scheduler. A 25 ms timer schedules every click due in the next 100 ms, so
 * a busy main thread (UI, visualiser) only delays the scheduling, never the
 * clicks themselves; after a stall it looks further ahead for a while.
 * Nothing is timed with a timeout per beat; beat events for the UI are
 * dispatched near each beat, for display only.
 *
 * Sounds are synthesised (no samples): an accented first beat, normal
 * beats and quieter subdivisions, as a click or a woodblock. The metronome
 * has its own volume and never touches the piano or MIDI input.
 */
import { Emitter } from './emitter';

export const MIN_BPM = 30;
export const MAX_BPM = 240;

export const TIME_SIGNATURES = ['2/4', '3/4', '4/4', '5/4', '6/8', '7/8', '12/8'] as const;
export type TimeSignature = (typeof TIME_SIGNATURES)[number];

export const SUBDIVISIONS = ['none', '8ths', 'triplets', '16ths'] as const;
export type Subdivision = (typeof SUBDIVISIONS)[number];

export const CLICK_SOUNDS = ['click', 'woodblock'] as const;
export type ClickSound = (typeof CLICK_SOUNDS)[number];

export interface MetronomeSettings {
  /** Beats per minute; the beat is the meter's beat (see meterOf). */
  bpm: number;
  timeSignature: TimeSignature;
  subdivision: Subdivision;
  sound: ClickSound;
  /** 0–1, independent of the piano. */
  volume: number;
  /** Start with one bar of count-in. */
  countIn: boolean;
  /** Pulse the visualiser's horizon line on each beat (when the visualiser is on). */
  pulseVisualiser: boolean;
}

export const DEFAULT_METRONOME: MetronomeSettings = {
  bpm: 80,
  timeSignature: '4/4',
  subdivision: 'none',
  sound: 'click',
  volume: 0.7,
  countIn: false,
  pulseVisualiser: false,
};

// ── Tempo and meter maths ──────────────────────────────────────────────

/** Click strengths, loudest first: the first beat, the start of a group (7/8), a beat, a subdivision. */
export type ClickLevel = 'accent' | 'group' | 'beat' | 'sub';

export interface Meter {
  /** Beats per bar: what the BPM counts, and the dots shown. */
  beats: number;
  /** Length of a beat in eighth notes: 2 in x/4, 3 (a dotted quarter) in 6/8 and 12/8, 1 in 7/8. */
  beatEighths: number;
  /** Beats (after the first) that start a group and get a lighter accent: 7/8 is counted 2+2+3. */
  groupStarts: number[];
}

/**
 * x/4 counts quarter notes. 6/8 and 12/8 are compound: the beat is the
 * dotted quarter (2 and 4 beats), each holding three eighths. 7/8 has no
 * even beat, so it counts eighths, grouped 2+2+3.
 */
export function meterOf(ts: TimeSignature): Meter {
  const [top, bottom] = ts.split('/').map(Number) as [number, number];
  if (bottom === 4) return { beats: top, beatEighths: 2, groupStarts: [] };
  if (top % 3 === 0) return { beats: top / 3, beatEighths: 3, groupStarts: [] };
  return { beats: top, beatEighths: 1, groupStarts: [2, 4] };
}

/**
 * Clicks per beat for a subdivision. Subdivisions are note values: 8ths and
 * 16ths fill the beat with eighths or sixteenths (so a compound beat gets
 * 3 or 6); triplets always split the beat in three.
 */
export function clicksPerBeat(meter: Meter, subdivision: Subdivision): number {
  switch (subdivision) {
    case 'none':
      return 1;
    case '8ths':
      return meter.beatEighths;
    case '16ths':
      return meter.beatEighths * 2;
    case 'triplets':
      return 3;
  }
}

export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return DEFAULT_METRONOME.bpm;
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));
}

export function secondsPerBeat(bpm: number): number {
  return 60 / bpm;
}

export function clickLevel(meter: Meter, beat: number, sub: number): ClickLevel {
  if (sub > 0) return 'sub';
  if (beat === 0) return 'accent';
  return meter.groupStarts.includes(beat) ? 'group' : 'beat';
}

/** Tap tempo: the average of the last four taps; a pause of two seconds starts again. */
export class TapTempo {
  private taps: number[] = [];

  constructor(
    private readonly maxTaps = 4,
    private readonly resetMs = 2000,
  ) {}

  /** Record a tap at `ms` (any millisecond clock); the BPM once there are two taps, else null. */
  tap(ms: number): number | null {
    const last = this.taps[this.taps.length - 1];
    if (last !== undefined && (ms - last > this.resetMs || ms <= last)) this.taps = [];
    this.taps.push(ms);
    if (this.taps.length > this.maxTaps) this.taps.shift();
    if (this.taps.length < 2) return null;
    const interval = (this.taps[this.taps.length - 1]! - this.taps[0]!) / (this.taps.length - 1);
    return 60000 / interval;
  }

  reset(): void {
    this.taps = [];
  }
}

// ── Scheduler ──────────────────────────────────────────────────────────

/** One click, scheduled ahead of time. */
export interface Click {
  /** When it sounds, on the scheduler's clock (AudioContext seconds). */
  time: number;
  /** Bar number; the count-in bar is -1. */
  bar: number;
  beat: number;
  /** Subdivision within the beat (0 = the beat itself). */
  sub: number;
  level: ClickLevel;
  countIn: boolean;
}

export interface SchedulerTimers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

export interface SchedulerOptions {
  timers: SchedulerTimers;
  /** How often the scheduler wakes (ms). */
  intervalMs: number;
  /** How far ahead of the clock it schedules (s). */
  lookahead: number;
}

export const DEFAULT_SCHEDULER: SchedulerOptions = {
  timers: { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (id) => clearInterval(id as number) },
  intervalMs: 25,
  lookahead: 0.1,
};

/** A click this late (s) when its turn comes (the timer stalled) is skipped rather than played in a burst. */
const LATE_SKIP = 0.05;
/**
 * After the timer stalls (a long task on the main thread), schedule further
 * ahead: 1.5 × the longest recent gap between wake-ups, up to half a
 * second, easing back to the normal lookahead over a few seconds.
 */
const STALL_MARGIN = 1.5;
const STALL_DECAY = 0.99;
const MAX_LOOKAHEAD = 0.5;

export interface Pattern {
  bpm: number;
  meter: Meter;
  subdivision: Subdivision;
}

/**
 * Generates click times on an external clock. Each click's time is the
 * anchor plus a whole number of click lengths, so there is no drift from
 * adding up intervals; a tempo or subdivision change re-anchors at the next
 * beat, a time-signature change at the next bar.
 */
export class ClickScheduler {
  private timer: unknown = null;
  private pattern: Pattern;
  private pending: Partial<Pattern> = {};
  private anchor = 0;
  private sinceAnchor = 0;
  private bar = 0;
  private beat = 0;
  private sub = 0;
  private countIn = false;
  private next: Click | null = null;
  /** Times of beats already scheduled, for nextBeatTime. */
  private beatTimes: number[] = [];
  private options: SchedulerOptions;

  constructor(
    private readonly clock: () => number,
    private readonly play: (click: Click) => void,
    options: Partial<SchedulerOptions> = {},
    pattern: Pattern = { bpm: DEFAULT_METRONOME.bpm, meter: meterOf('4/4'), subdivision: 'none' },
  ) {
    this.options = { ...DEFAULT_SCHEDULER, ...options };
    this.pattern = pattern;
  }

  /** Schedule further ahead (e.g. while the page is hidden and timers are throttled). */
  setLookahead(seconds: number): void {
    this.options.lookahead = seconds;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  /** Start with the first beat at `at` (after `countInBars` bars of count-in); returns the first downbeat's time. */
  start(at: number, countInBars = 0): number {
    this.stop();
    this.applyPending();
    this.anchor = at;
    this.sinceAnchor = 0;
    this.countIn = countInBars > 0;
    this.bar = this.countIn ? -countInBars : 0;
    this.beat = 0;
    this.sub = 0;
    this.beatTimes = [];
    this.lastTick = Number.NaN;
    this.next = this.makeClick();
    this.timer = this.options.timers.setInterval(() => this.tick(), this.options.intervalMs);
    this.tick();
    return at + countInBars * this.pattern.meter.beats * secondsPerBeat(this.pattern.bpm);
  }

  stop(): void {
    if (this.timer !== null) this.options.timers.clearInterval(this.timer);
    this.timer = null;
    this.next = null;
    this.beatTimes = [];
  }

  /** Change tempo/subdivision (from the next beat) or meter (from the next bar). */
  update(pattern: Partial<Pattern>): void {
    if (!this.running) {
      this.pattern = { ...this.pattern, ...pattern };
      return;
    }
    this.pending = { ...this.pending, ...pattern };
  }

  get bpm(): number {
    return this.pending.bpm ?? this.pattern.bpm;
  }

  /** Time of the next beat (not subdivision) not yet sounded, or null when stopped. */
  nextBeatTime(): number | null {
    if (!this.next) return null;
    // A beat may already be scheduled ahead of the clock.
    const now = this.clock();
    const scheduled = this.beatTimes.find((t) => t > now);
    if (scheduled !== undefined) return scheduled;
    if (this.next.sub === 0) return this.next.time;
    const perBeat = this.perBeatNow();
    return this.next.time + ((perBeat - this.next.sub) * secondsPerBeat(this.pattern.bpm)) / perBeat;
  }

  /** The longest recent gap between wake-ups (s), decaying. */
  private stall = 0;
  private lastTick = Number.NaN;

  /** How far ahead the scheduler currently looks (s). */
  get lookahead(): number {
    return Math.max(this.options.lookahead, Math.min(MAX_LOOKAHEAD, this.stall * STALL_MARGIN));
  }

  private tick(): void {
    const now = this.clock();
    if (!Number.isNaN(this.lastTick)) this.stall = Math.max(now - this.lastTick, this.stall * STALL_DECAY);
    this.lastTick = now;
    const until = now + this.lookahead;
    this.beatTimes = this.beatTimes.filter((t) => t > now);
    while (this.next && this.next.time < until) {
      if (this.next.time >= now - LATE_SKIP) {
        this.play(this.next);
        if (this.next.sub === 0) this.beatTimes.push(this.next.time);
      }
      this.advance(this.next);
      this.next = this.makeClick();
    }
  }

  /** Step past the click just played. */
  private advance(played: Click): void {
    // A tempo or subdivision change takes effect from the beat just played.
    if (played.sub === 0 && (this.pending.bpm !== undefined || this.pending.subdivision !== undefined)) {
      this.applyPending(false);
      this.anchor = played.time;
      this.sinceAnchor = 0;
    }
    const perBeat = this.perBeatNow();
    this.sinceAnchor++;
    this.sub++;
    if (this.sub < perBeat) return;
    this.sub = 0;
    this.beat++;
    const newBar = this.beat >= this.pattern.meter.beats;
    if (newBar) {
      this.beat = 0;
      this.bar++;
      if (this.bar === 0) this.countIn = false;
    }
    // A new time signature starts with the next bar; the end of the count-in adds subdivisions.
    if ((newBar && this.pending.meter) || perBeat !== this.perBeatNow()) {
      const nextTime = this.timeOf(this.sinceAnchor, perBeat);
      this.applyPending(newBar);
      this.anchor = nextTime;
      this.sinceAnchor = 0;
    }
  }

  private perBeatNow(): number {
    return this.countIn ? 1 : clicksPerBeat(this.pattern.meter, this.pattern.subdivision);
  }

  private applyPending(includeMeter = true): void {
    const { meter, ...rest } = this.pending;
    this.pattern = { ...this.pattern, ...rest, ...(includeMeter && meter ? { meter } : {}) };
    this.pending = includeMeter || !meter ? {} : { meter };
  }

  private timeOf(clicks: number, perBeat: number): number {
    return this.anchor + (clicks * secondsPerBeat(this.pattern.bpm)) / perBeat;
  }

  private makeClick(): Click {
    return {
      time: this.timeOf(this.sinceAnchor, this.perBeatNow()),
      bar: this.bar,
      beat: this.beat,
      sub: this.sub,
      level: clickLevel(this.pattern.meter, this.beat, this.sub),
      countIn: this.countIn,
    };
  }
}

// ── Sound ──────────────────────────────────────────────────────────────

/** Pitch (Hz) and loudness (0–1) per click level. */
const VOICE: Record<ClickSound, Record<ClickLevel, { freq: number; gain: number }>> = {
  click: {
    accent: { freq: 2000, gain: 1 },
    group: { freq: 1600, gain: 0.8 },
    beat: { freq: 1500, gain: 0.65 },
    sub: { freq: 1200, gain: 0.3 },
  },
  woodblock: {
    accent: { freq: 1250, gain: 1 },
    group: { freq: 1050, gain: 0.8 },
    beat: { freq: 950, gain: 0.7 },
    sub: { freq: 820, gain: 0.32 },
  },
};

/** Synthesise one click at `time` into `out`. */
function synthClick(ctx: BaseAudioContext, out: AudioNode, time: number, level: ClickLevel, sound: ClickSound): void {
  const { freq, gain } = VOICE[sound][level];
  const env = ctx.createGain();
  env.connect(out);
  env.gain.setValueAtTime(0, time);
  env.gain.linearRampToValueAtTime(gain, time + 0.001);
  if (sound === 'click') {
    // A short, bright blip.
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, time);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.035);
    osc.connect(env);
    osc.start(time);
    osc.stop(time + 0.04);
    return;
  }
  // Woodblock: a hollow tone with a quick pitch drop, plus an inharmonic partial for the knock.
  const decay = 0.09;
  env.gain.exponentialRampToValueAtTime(0.0001, time + decay);
  for (const [ratio, level] of [[1, 1], [2.76, 0.35]] as const) {
    const osc = ctx.createOscillator();
    const partial = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * ratio * 1.04, time);
    osc.frequency.exponentialRampToValueAtTime(freq * ratio, time + 0.02);
    partial.gain.value = level;
    osc.connect(partial).connect(env);
    osc.start(time);
    osc.stop(time + decay + 0.01);
  }
}

// ── Service ────────────────────────────────────────────────────────────

/** Lead time before the first click (s), so it is never scheduled in the past. */
const START_DELAY = 0.05;
/** Lookahead while the page is hidden (s). */
const HIDDEN_LOOKAHEAD = 1.5;
/** The least time ahead (s) a click is handed to the audio thread. */
const MIN_LEAD = 0.015;

/** A beat (or subdivision) as it sounds, for the UI. */
export interface BeatEvent extends Click {
  /** Beats in the bar (for drawing dots). */
  beats: number;
}

type MetronomeEvents = {
  /** Running state changed. */
  state: { running: boolean };
  settings: MetronomeSettings;
  /** Dispatched near the moment each click is heard (display only, not for timing). */
  beat: BeatEvent;
  /** Every click as it is scheduled, ahead of time, with its exact AudioContext time. */
  scheduled: Click;
};

export class Metronome extends Emitter<MetronomeEvents> {
  private _settings: MetronomeSettings = { ...DEFAULT_METRONOME };
  private scheduler: ClickScheduler | null = null;
  private output: GainNode | null = null;
  private taps = new TapTempo();
  private uiTimers = new Set<number>();

  /** The AudioContext to play on (the piano's); null until audio is set up. */
  constructor(private readonly context: () => AudioContext | null) {
    super();
  }

  get settings(): MetronomeSettings {
    return { ...this._settings };
  }

  get running(): boolean {
    return this.scheduler?.running ?? false;
  }

  get meter(): Meter {
    return meterOf(this._settings.timeSignature);
  }

  setSettings(patch: Partial<MetronomeSettings>): void {
    const next = { ...this._settings, ...patch, bpm: clampBpm(patch.bpm ?? this._settings.bpm) };
    next.volume = Math.min(1, Math.max(0, next.volume));
    const changed = JSON.stringify(next) !== JSON.stringify(this._settings);
    this._settings = next;
    if (this.output) this.output.gain.value = next.volume;
    this.scheduler?.update({ bpm: next.bpm, meter: meterOf(next.timeSignature), subdivision: next.subdivision });
    if (changed) this.emit('settings', this.settings);
  }

  setBpm(bpm: number): void {
    this.setSettings({ bpm });
  }

  /** Change the tempo by `delta` BPM. */
  nudge(delta: number): void {
    this.setBpm((this.scheduler?.bpm ?? this._settings.bpm) + delta);
  }

  /** Tap tempo; returns the new BPM once there are two taps in a row. */
  tap(ms = performance.now()): number | null {
    const bpm = this.taps.tap(ms);
    if (bpm !== null) this.setBpm(bpm);
    return bpm === null ? null : this._settings.bpm;
  }

  /**
   * Start (with the count-in setting, unless `countIn` says otherwise).
   * Returns the AudioContext time of the first downbeat, or null when audio
   * isn't available.
   */
  start({ countIn = this._settings.countIn }: { countIn?: boolean } = {}): number | null {
    const ctx = this.context();
    if (!ctx) return null;
    void ctx.resume();
    if (!this.output) {
      this.output = ctx.createGain();
      this.output.gain.value = this._settings.volume;
      this.output.connect(ctx.destination);
    }
    if (!this.scheduler) {
      this.scheduler = new ClickScheduler(
        () => ctx.currentTime,
        (click) => this.sound(ctx, click),
      );
      // Background tabs throttle timers to about once a second: schedule further ahead there.
      const lookahead = () => this.scheduler?.setLookahead(document.hidden ? HIDDEN_LOOKAHEAD : DEFAULT_SCHEDULER.lookahead);
      document.addEventListener('visibilitychange', lookahead);
      lookahead();
    }
    const s = this._settings;
    this.clearUiTimers();
    this.scheduler.update({ bpm: s.bpm, meter: meterOf(s.timeSignature), subdivision: s.subdivision });
    const downbeat = this.scheduler.start(ctx.currentTime + START_DELAY, countIn ? 1 : 0);
    this.emit('state', { running: true });
    return downbeat;
  }

  /** Start with one bar of count-in; returns the time of the first downbeat after it. */
  countIn(): number | null {
    return this.start({ countIn: true });
  }

  stop(): void {
    if (!this.running) return;
    this.scheduler?.stop();
    this.clearUiTimers();
    // Clicks already scheduled ahead are cut off with their output.
    this.output?.disconnect();
    this.output = null;
    this.emit('state', { running: false });
  }

  private clearUiTimers(): void {
    for (const id of this.uiTimers) clearTimeout(id);
    this.uiTimers.clear();
  }

  toggle(): void {
    if (this.running) this.stop();
    else this.start();
  }

  /** Time of the next beat on the AudioContext clock, or null when stopped. */
  nextBeatTime(): number | null {
    return this.running ? (this.scheduler?.nextBeatTime() ?? null) : null;
  }

  /** Listen to beats as they are heard (for display). Returns an unsubscribe function. */
  onBeat(fn: (beat: BeatEvent) => void): () => void {
    return this.on('beat', fn);
  }

  /** An AudioContext time as a performance.now() time (to compare with MIDI event times). */
  toPerformanceTime(contextTime: number): number | null {
    const ctx = this.context();
    if (!ctx) return null;
    const stamp = ctx.getOutputTimestamp();
    if (stamp.contextTime === undefined || stamp.performanceTime === undefined) return null;
    return stamp.performanceTime + (contextTime - stamp.contextTime) * 1000;
  }

  private sound(ctx: AudioContext, click: Click): void {
    // A click that reaches the audio thread after its time would be silent (its short envelope
    // already over), so one scheduled too late (only after a stall) sounds a moment late instead.
    synthClick(ctx, this.output!, Math.max(click.time, ctx.currentTime + MIN_LEAD), click.level, this._settings.sound);
    this.emit('scheduled', click);
    // Tell the UI when it is heard: the click's time plus the output latency.
    const latency = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
    const delay = Math.max(0, (click.time + latency - ctx.currentTime) * 1000);
    const id = window.setTimeout(() => {
      this.uiTimers.delete(id);
      this.emit('beat', { ...click, beats: this.meter.beats });
    }, delay);
    this.uiTimers.add(id);
  }
}
