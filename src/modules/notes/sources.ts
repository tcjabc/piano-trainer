/**
 * Where a note drill gets its cards and what happens to an answer.
 *
 * - ReviewSource: today's spaced-repetition session. Answers are graded and
 *   change the FSRS schedule; failed cards come back in the same session.
 * - FreeSource: free practice. Cards from a chosen set, at random, with no
 *   end. Answers are logged as attempts and never touch the schedule.
 */
import type { StaffKind } from '../../core/notation';
import { autoGrade, recordReview, SessionQueue } from '../../core/scheduler';
import { storage, uuid, type AttemptRecord, type CardRecord, type NoteCardContent } from '../../core/storage';
import { cardKey } from './cards';

export interface DrillItem {
  id: string;
  content: NoteCardContent;
}

export interface DrillSource {
  /** Staff the cards are shown on. */
  readonly staff: StaffKind;
  /** Next card, or null when the session is over. */
  next(now: number): DrillItem | null;
  /** The first answer to a showing of `item` (later attempts at the same showing aren't recorded). */
  record(item: DrillItem, correct: boolean, responseMs: number, hinted: boolean): Promise<void>;
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
    readonly staff: StaffKind,
    { ahead = false }: { ahead?: boolean },
    private reviewed: () => void,
  ) {
    this.queue = new SessionQueue(cards, { ahead });
  }

  next(now: number): DrillItem | null {
    return this.queue.next(now);
  }

  async record(item: DrillItem, correct: boolean, responseMs: number, hinted: boolean): Promise<void> {
    const now = Date.now();
    const result = recordReview(item as CardRecord, autoGrade(correct, responseMs, hinted), responseMs, now);
    this.queue.requeue(result.card, now);
    await storage.recordReview(result.review, result.card);
    this.reviewed();
  }

  skip(item: DrillItem): void {
    this.queue.deferToEnd(item as CardRecord);
  }

  pushFront(item: DrillItem): void {
    this.queue.pushFront(item as CardRecord);
  }

  corner(): string {
    // The card on screen has already left the queue.
    return `${this.queue.size + 1} left`;
  }
}

export class FreeSource implements DrillSource {
  private items: DrillItem[];
  private waiting: DrillItem[] = [];
  private lastId: string | null = null;
  private played = 0;
  private correct = 0;

  constructor(
    contents: NoteCardContent[],
    readonly staff: StaffKind,
    private log: (attempt: AttemptRecord) => Promise<void> = (a) => storage.addAttempt(a),
    private random: () => number = Math.random,
  ) {
    this.items = contents.map((content) => ({ id: cardKey(content.clef, content.spelling), content }));
  }

  get size(): number {
    return this.items.length;
  }

  /** A random card, never the same one twice in a row (when there is a choice). */
  next(): DrillItem | null {
    const queued = this.waiting.shift();
    const item = queued ?? this.pick();
    if (item) this.lastId = item.id;
    return item;
  }

  private pick(): DrillItem | null {
    if (this.items.length === 0) return null;
    const choices = this.items.length > 1 ? this.items.filter((i) => i.id !== this.lastId) : this.items;
    return choices[Math.floor(this.random() * choices.length)] ?? choices[0]!;
  }

  async record(item: DrillItem, correct: boolean, responseMs: number, hinted: boolean): Promise<void> {
    this.played++;
    if (correct) this.correct++;
    const now = Date.now();
    await this.log({
      id: uuid(),
      module: 'notes',
      mode: 'free',
      key: item.id,
      content: item.content,
      correct,
      responseMs: Math.round(responseMs),
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
