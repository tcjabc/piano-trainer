/**
 * Judging a pass through a song section.
 *
 * Wait mode: the song stops at each step (the notes that start together)
 * until every note of it has been played; a chord's notes may come in any
 * order. A key that isn't in the step is a wrong note: it is counted but
 * costs nothing else.
 *
 * Play-along: each key press is matched to the nearest unplayed note of
 * that key within the hit window and marked on time, early or late; a note
 * whose window passes unplayed is missed; a press that matches nothing is a
 * wrong note. Windows are in GRADING.songs.
 */
import { GRADING } from './grading';
import type { Step } from './song';

export type WaitPress = 'hit' | 'step' | 'done' | 'again' | 'wrong';

export class WaitMatcher {
  private index = 0;
  private played = new Set<number>();
  /** Right notes played (each note of a step once). */
  correct = 0;
  wrong = 0;

  constructor(private readonly steps: readonly Step[]) {}

  get stepIndex(): number {
    return this.index;
  }

  get current(): Step | null {
    return this.steps[this.index] ?? null;
  }

  get done(): boolean {
    return this.index >= this.steps.length;
  }

  /** Keys of the current step still to play. */
  remaining(): number[] {
    const step = this.current;
    if (!step) return [];
    return [...new Set(step.notes.map((n) => n.midi))].filter((m) => !this.played.has(m));
  }

  /**
   * A key was pressed: 'hit' (part of the step), 'step' (it completed the
   * step), 'done' (the last step), 'again' (already played in this step)
   * or 'wrong'.
   */
  press(midi: number): WaitPress {
    const step = this.current;
    if (!step) return 'wrong';
    const keys = new Set(step.notes.map((n) => n.midi));
    if (!keys.has(midi)) {
      this.wrong++;
      return 'wrong';
    }
    if (this.played.has(midi)) return 'again';
    this.played.add(midi);
    this.correct++;
    if (this.played.size < keys.size) return 'hit';
    this.index++;
    this.played.clear();
    return this.done ? 'done' : 'step';
  }

  /** Right notes ÷ (right notes + wrong presses). */
  get accuracy(): number {
    const total = this.correct + this.wrong;
    return total === 0 ? 1 : this.correct / total;
  }
}

export type Timing = 'on-time' | 'early' | 'late';

export interface Expected {
  id: string;
  midi: number;
  /** When it should be played (seconds on the player's clock). */
  time: number;
}

export interface Judged {
  note: Expected;
  timing: Timing;
  /** Played minus expected, in ms (negative = early). */
  deltaMs: number;
}

export interface TimingSummary {
  notes: number;
  hits: number;
  onTime: number;
  early: number;
  late: number;
  missed: number;
  wrong: number;
  /** Hits ÷ (notes + wrong presses). */
  accuracy: number;
  /** On-time hits ÷ notes. */
  onTimeShare: number;
}

export class TimingJudge {
  private judged = new Map<string, Judged>();
  private missedIds = new Set<string>();
  wrong = 0;

  constructor(
    private readonly notes: readonly Expected[],
    private readonly windows: { onTimeMs: number; hitWindowMs: number } = GRADING.songs,
  ) {}

  /** Match a press to the nearest unplayed note of that key in the window; null is a wrong note. */
  press(midi: number, time: number): Judged | null {
    const window = this.windows.hitWindowMs / 1000;
    let best: Expected | null = null;
    for (const n of this.notes) {
      if (n.midi !== midi || this.judged.has(n.id) || this.missedIds.has(n.id)) continue;
      if (Math.abs(time - n.time) > window) continue;
      if (!best || Math.abs(time - n.time) < Math.abs(time - best.time)) best = n;
    }
    if (!best) {
      this.wrong++;
      return null;
    }
    const deltaMs = (time - best.time) * 1000;
    const timing: Timing = Math.abs(deltaMs) <= this.windows.onTimeMs ? 'on-time' : deltaMs < 0 ? 'early' : 'late';
    const result = { note: best, timing, deltaMs };
    this.judged.set(best.id, result);
    return result;
  }

  /** Notes whose window has now closed without being played (each reported once). */
  sweep(time: number): Expected[] {
    const window = this.windows.hitWindowMs / 1000;
    const missed: Expected[] = [];
    for (const n of this.notes) {
      if (this.judged.has(n.id) || this.missedIds.has(n.id) || time <= n.time + window) continue;
      this.missedIds.add(n.id);
      missed.push(n);
    }
    return missed;
  }

  summary(): TimingSummary {
    const all = [...this.judged.values()];
    const count = (t: Timing) => all.filter((j) => j.timing === t).length;
    const notes = this.notes.length;
    const hits = all.length;
    return {
      notes,
      hits,
      onTime: count('on-time'),
      early: count('early'),
      late: count('late'),
      missed: notes - hits,
      wrong: this.wrong,
      accuracy: notes + this.wrong === 0 ? 1 : hits / (notes + this.wrong),
      onTimeShare: notes === 0 ? 1 : count('on-time') / notes,
    };
  }
}
