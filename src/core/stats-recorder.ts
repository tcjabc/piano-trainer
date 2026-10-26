/**
 * Counting practice while it happens: plain counter increments in memory,
 * saved in one batch every so often (and when the tab is hidden or the page
 * closes). Nothing is logged note by note. UI-agnostic; the app tells it
 * what is being practised and when keys are pressed.
 *
 * Sessions: a session is one stretch of practice in one place (a drill run,
 * a song opened, a visit to Play). Within it, time goes to the items in
 * focus (a song and its section, the card on screen). An item is played in
 * a session once it gets a key press; its play is counted once, at the first
 * completed pass (full or loop) or else when the session ends.
 *
 * Time: active time only. A gap between key presses (or from the start of
 * the session, from the tab being shown again or from the end of listening)
 * counts in full when it is at most IDLE_MS, and not at all when it is
 * longer. Hidden time never counts, nor does time spent listening to the app
 * play (a song in listen mode, even if keys are pressed along), and a
 * session without a key press has no time at all. Voluntary time is active
 * time in sessions the player chose.
 */
import { bumpCount, dailyDelta, emptyDelta, isEmptyDelta, itemDelta, localDate, mergeDelta, type ItemRef, type StatsDelta } from './stats';
import type { SongHand } from './song';
import { storage } from './storage';

/** A gap without key presses longer than this is idle and isn't counted. */
export const IDLE_MS = 30_000;
/** How often pending counts are saved. */
export const FLUSH_MS = 15_000;

export interface StatsSink {
  applyStats(delta: StatsDelta, now: number): Promise<void>;
}

export interface SessionOptions {
  /** Chosen by the player (Play, free practice, a song opened from the list), not a scheduled review. */
  voluntary: boolean;
}

interface Session {
  voluntary: boolean;
  focus: ItemRef[];
  /** A key has been pressed in this session. */
  pressed: boolean;
  /** Items played this session, and whether their play is counted yet. */
  played: Map<string, { ref: ItemRef; counted: boolean }>;
}

export class StatsRecorder {
  private pending = emptyDelta();
  private session: Session | null = null;
  /** Start of the gap being timed (last key press, session start or tab shown). */
  private since = 0;
  private hidden = false;
  /** The app is playing to you (listen mode), so you aren't practising. */
  private listening = false;
  private saving: Promise<void> = Promise.resolve();

  constructor(
    private readonly sink: StatsSink,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get inSession(): boolean {
    return this.session !== null;
  }

  /** Start a session (ending any running one). */
  start(options: SessionOptions, focus: ItemRef[] = []): void {
    this.end();
    this.session = { voluntary: options.voluntary, focus, pressed: false, played: new Map() };
    this.since = this.now();
  }

  /** Change what is being practised (time so far goes to what was in focus). */
  focus(items: ItemRef[]): void {
    if (!this.session) return;
    this.accrue();
    this.session.focus = items;
  }

  /** End the session: count the plays not yet counted. */
  end(): void {
    const s = this.session;
    if (!s) return;
    this.accrue();
    const at = this.now();
    for (const p of s.played.values()) if (!p.counted) this.countPlay(p.ref, at);
    this.session = null;
  }

  /** A completed full or loop pass of the items in focus: their play counts now (once a session). */
  completed(): void {
    const s = this.session;
    if (!s) return;
    const at = this.now();
    for (const ref of s.focus) {
      const p = s.played.get(ref.id);
      if (p?.counted) continue;
      s.played.set(ref.id, { ref, counted: true });
      this.countPlay(ref, at);
    }
  }

  /** A key was pressed: counted on its key and the day, and it keeps the session active. */
  notePlayed(midi: number): void {
    bumpCount(this.pending.keyHits, midi);
    dailyDelta(this.pending, localDate(this.now())).notesPlayed++;
    this.activity();
  }

  /** The tab was hidden or shown again. */
  setHidden(hidden: boolean): void {
    if (hidden === this.hidden) return;
    if (hidden) this.accrue();
    this.hidden = hidden;
    this.since = this.now();
  }

  /** The app started or stopped playing to you (a song in listen mode). */
  setListening(listening: boolean): void {
    if (listening === this.listening) return;
    if (listening) this.accrue();
    this.listening = listening;
    this.since = this.now();
  }

  /** A right or wrong answer (or note) for an item; songs and sections can say which hand. */
  result(ref: ItemRef, correct: boolean, hand?: SongHand): void {
    const item = itemDelta(this.pending, ref);
    if (correct) item.hits++;
    else item.misses++;
    if (hand) item.hands[hand][correct ? 'hits' : 'misses']++;
  }

  /** Aimed at one chord, played another. */
  confusion(targetId: string, playedSymbol: string): void {
    const id = `${targetId}>${playedSymbol}`;
    const c = this.pending.confusions.get(id);
    if (c) c.count++;
    else this.pending.confusions.set(id, { targetId, playedSymbol, count: 1 });
  }

  /** A chord held in Play. */
  chordPlayed(symbol: string): void {
    bumpCount(this.pending.chordPlays, symbol);
  }

  /** A miss in a measure of a song. */
  measureMiss(songId: string, measure: number): void {
    const id = `${songId}:${measure}`;
    const m = this.pending.measureMisses.get(id);
    if (m) m.misses++;
    else this.pending.measureMisses.set(id, { songId, measure, misses: 1 });
  }

  /** A clean pass (section, or the whole song when sectionId is null) at a tempo factor. */
  cleanPass(songId: string, sectionId: string | null, tempo: number): void {
    this.pending.cleanTempos.push({ songId, sectionId, tempo, at: this.now() });
  }

  /**
   * Save what has been counted. The gap still running isn't counted yet (it
   * may turn out idle). Saves run one at a time; counts from a failed save
   * are kept for the next.
   */
  flush(): Promise<void> {
    this.saving = this.saving.then(async () => {
      if (isEmptyDelta(this.pending)) return;
      const delta = this.pending;
      this.pending = emptyDelta();
      try {
        await this.sink.applyStats(delta, this.now());
      } catch (err) {
        console.error('Saving practice stats failed', err);
        mergeDelta(delta, this.pending);
        this.pending = delta;
      }
    });
    return this.saving;
  }

  /** Counts not saved yet (for tests). */
  get unsaved(): StatsDelta {
    return this.pending;
  }

  private activity(): void {
    const s = this.session;
    // Playing along while listening isn't practising the item.
    if (!s || this.listening) return;
    s.pressed = true;
    this.accrue();
    for (const ref of s.focus) if (!s.played.has(ref.id)) s.played.set(ref.id, { ref, counted: false });
    const at = this.now();
    for (const ref of s.focus) itemDelta(this.pending, ref).lastPlayed = at;
  }

  /**
   * Count the gap since `since` when it is short enough to be active, and
   * start timing a new one. A longer gap is idle: none of it counts.
   */
  private accrue(): void {
    const now = this.now();
    const gap = now - this.since;
    const s = this.session;
    if (s?.pressed && !this.hidden && !this.listening && gap > 0 && gap <= IDLE_MS) {
      dailyDelta(this.pending, localDate(now)).practiceMs += gap;
      for (const ref of s.focus) {
        const item = itemDelta(this.pending, ref);
        item.practiceMs += gap;
        if (s.voluntary) item.voluntaryMs += gap;
      }
    }
    this.since = now;
  }

  private countPlay(ref: ItemRef, at: number): void {
    const item = itemDelta(this.pending, ref);
    item.plays++;
    item.lastPlayed = Math.max(item.lastPlayed ?? 0, at);
  }
}

export const stats = new StatsRecorder(storage);
