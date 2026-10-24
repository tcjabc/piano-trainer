/**
 * Where a drill gets its cards and what happens to an answer.
 *
 * - ReviewSource: today's spaced-repetition session (notes, chords and
 *   scales mixed). Answers are graded and change the FSRS schedule; failed
 *   cards come back in the same session.
 * - FreeSource: free practice. Cards from a chosen set, at random, with no
 *   end. Answers are logged as attempts and never touch the schedule.
 */
import { GRADING, gradeScale, gradeSongPass, gradeTimed, scalePassed, type SongPassResult } from '../../core/grading';
import type { StaffKind } from '../../core/notation';
import { recordReview, SessionQueue } from '../../core/scheduler';
import { storage, uuid, type AttemptRecord, type CardRecord } from '../../core/storage';
import { Rating, type Grade } from 'ts-fsrs';
import { cardItem, type DrillItem } from './items';

/** How a showing went, at the first answer (notes, chords) or when finished (scales). */
export interface Outcome {
  correct: boolean;
  /** Notes/chords: time to answer. Scales: time from the first note to the last. */
  ms: number;
  /** Scales: wrong notes along the way. */
  errors?: number;
  /** Scales: notes in the scale as played. */
  notes?: number;
  /** Song sections: how the pass went. */
  song?: SongPassResult;
}

export function gradeOutcome(module: DrillItem['module'], o: Outcome, hinted: boolean): Grade {
  if (module === 'scales') return gradeScale(o.errors ?? 0, o.ms, o.notes ?? 1, hinted);
  if (module === 'songs') {
    // Hearing the section first caps the grade at Hard, as for other cards.
    const grade = gradeSongPass(o.song ?? { mode: 'wait', accuracy: o.correct ? 1 : 0, onTime: null });
    return hinted ? (Math.min(grade, Rating.Hard) as Grade) : grade;
  }
  return gradeTimed(o.correct, o.ms, hinted, module === 'chords' ? GRADING.chords : GRADING.notes);
}

export interface DrillSource {
  /** Staff used for note cards. */
  readonly noteStaff: StaffKind;
  /** Next card, or null when the session is over. */
  next(now: number): DrillItem | null;
  /** The outcome of a showing (only the first per showing is recorded). */
  record(item: DrillItem, outcome: Outcome, hinted: boolean): Promise<void>;
  /** Skipped without an answer. */
  skip(item: DrillItem): void;
  /** Stepped back from with "previous": serve it next. */
  pushFront(item: DrillItem): void;
  /** Small progress text for the panel corner. */
  corner(): string;
}

export class ReviewSource implements DrillSource {
  private queue: SessionQueue;

  constructor(
    cards: CardRecord[],
    readonly noteStaff: StaffKind,
    { ahead = false }: { ahead?: boolean },
    private reviewed: () => void,
  ) {
    this.queue = new SessionQueue(cards, { ahead });
  }

  next(now: number): DrillItem | null {
    const card = this.queue.next(now);
    return card ? cardItem(card) : null;
  }

  async record(item: DrillItem, outcome: Outcome, hinted: boolean): Promise<void> {
    const now = Date.now();
    const card = item as unknown as CardRecord;
    const result = recordReview(card, gradeOutcome(item.module, outcome, hinted), outcome.ms, now);
    this.queue.requeue(result.card, now);
    await storage.recordReview(result.review, result.card);
    this.reviewed();
  }

  skip(item: DrillItem): void {
    this.queue.deferToEnd(item as unknown as CardRecord);
  }

  pushFront(item: DrillItem): void {
    this.queue.pushFront(item as unknown as CardRecord);
  }

  corner(): string {
    // The card on screen has already left the queue.
    return `${this.queue.size + 1} left`;
  }
}

export class FreeSource implements DrillSource {
  private waiting: DrillItem[] = [];
  private lastId: string | null = null;
  private played = 0;
  private correct = 0;

  constructor(
    private items: DrillItem[],
    readonly noteStaff: StaffKind,
    private log: (attempt: AttemptRecord) => Promise<void> = (a) => storage.addAttempt(a),
    private random: () => number = Math.random,
  ) {}

  get size(): number {
    return this.items.length;
  }

  /** A random card, never the same one twice in a row (when there is a choice). */
  next(): DrillItem | null {
    const item = this.waiting.shift() ?? this.pick();
    if (item) this.lastId = item.id;
    return item;
  }

  private pick(): DrillItem | null {
    if (this.items.length === 0) return null;
    const choices = this.items.length > 1 ? this.items.filter((i) => i.id !== this.lastId) : this.items;
    return choices[Math.floor(this.random() * choices.length)] ?? choices[0]!;
  }

  async record(item: DrillItem, outcome: Outcome, hinted: boolean): Promise<void> {
    const correct = item.module === 'scales' ? scalePassed(outcome.errors ?? 0) : outcome.correct;
    this.played++;
    if (correct) this.correct++;
    const now = Date.now();
    await this.log({
      id: uuid(),
      module: item.module,
      mode: 'free',
      key: item.id,
      content: item.content,
      correct,
      responseMs: Math.round(outcome.ms),
      errors: outcome.errors,
      hinted,
      at: now,
      updatedAt: now,
    });
  }

  skip(): void {
    // Random order: nothing to defer.
  }

  pushFront(item: DrillItem): void {
    this.waiting.unshift(item);
  }

  corner(): string {
    if (this.played === 0) return 'Free practice';
    return `Free · ${this.played} played · ${Math.round((this.correct / this.played) * 100)}%`;
  }
}
