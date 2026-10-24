/** Spaced-repetition scheduling: a thin wrapper around ts-fsrs plus session queueing. */
import { createEmptyCard, fsrs, Rating, State, type Card, type Grade } from 'ts-fsrs';
import { uuid, type CardRecord, type ReviewRecord, type StoredFsrs } from './storage';

export { Rating, State };
export type { Grade };

const engine = fsrs({ enable_fuzz: true, enable_short_term: true });

/** Cards due within this window are served early once nothing else is due (as in Anki). */
export const LEARN_AHEAD_MS = 20 * 60 * 1000;

/** Response-time thresholds for auto-grading a correct answer. */
export const GRADE_THRESHOLDS = { easyUnderMs: 1000, hardOverMs: 3000 };

export function toFsrs(s: StoredFsrs): Card {
  return {
    ...s,
    due: new Date(s.due),
    last_review: s.last_review === null ? undefined : new Date(s.last_review),
  };
}

export function fromFsrs(c: Card): StoredFsrs {
  return {
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: c.last_review ? c.last_review.getTime() : null,
  };
}

export function newFsrsState(now: number): StoredFsrs {
  return fromFsrs(createEmptyCard(new Date(now)));
}

/**
 * Wrong = Again. Correct: under 1 s = Easy, 1–3 s = Good, over 3 s = Hard.
 * Hearing the note first (hint) caps the grade at Hard.
 */
export function autoGrade(correct: boolean, responseMs: number, hinted = false): Grade {
  if (!correct) return Rating.Again;
  if (hinted || responseMs > GRADE_THRESHOLDS.hardOverMs) return Rating.Hard;
  if (responseMs < GRADE_THRESHOLDS.easyUnderMs) return Rating.Easy;
  return Rating.Good;
}

/** Apply a grade to a card; returns the updated card and the review to store. */
export function recordReview(
  card: CardRecord,
  grade: Grade,
  responseMs: number,
  now: number,
): { card: CardRecord; review: ReviewRecord } {
  const result = engine.next(toFsrs(card.fsrs), new Date(now), grade);
  const fsrsAfter = fromFsrs(result.card);
  return {
    card: { ...card, fsrs: fsrsAfter, updatedAt: now },
    review: {
      id: uuid(),
      cardId: card.id,
      module: card.module,
      rating: grade,
      stateBefore: card.fsrs.state,
      responseMs: Math.round(responseMs),
      reviewedAt: now,
      fsrsAfter,
      updatedAt: now,
    },
  };
}

export function isNew(card: CardRecord): boolean {
  return card.fsrs.state === State.New;
}

/** Already-seen cards due at `now`, earliest first. */
export function getDueCards(cards: CardRecord[], now: number): CardRecord[] {
  return cards.filter((c) => !isNew(c) && c.fsrs.due <= now).sort((a, b) => a.fsrs.due - b.fsrs.due);
}

export function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** How many new cards were introduced today, from today's reviews. */
export function newIntroducedToday(reviewsToday: ReviewRecord[]): number {
  return new Set(reviewsToday.filter((r) => r.stateBefore === State.New).map((r) => r.cardId)).size;
}

export interface DuePlan {
  reviews: CardRecord[];
  /** New cards allowed today, in introduction order. */
  newCards: CardRecord[];
}

/**
 * What is due today: seen cards that are due plus new cards up to the daily
 * limit. `newOrder` must already be sorted in introduction order.
 */
export function planToday(
  cards: CardRecord[],
  newOrder: CardRecord[],
  newPerDay: number,
  introducedToday: number,
  now: number,
): DuePlan {
  const allowed = Math.max(0, newPerDay - introducedToday);
  const ids = new Set(cards.map((c) => c.id));
  return {
    reviews: getDueCards(cards, now),
    newCards: newOrder.filter((c) => isNew(c) && ids.has(c.id)).slice(0, allowed),
  };
}

/** Spread new cards evenly through the reviews. */
export function interleave(reviews: CardRecord[], newCards: CardRecord[]): CardRecord[] {
  if (newCards.length === 0) return [...reviews];
  if (reviews.length === 0) return [...newCards];
  const out: CardRecord[] = [];
  const every = (reviews.length + newCards.length) / newCards.length;
  let r = 0;
  let n = 0;
  for (let i = 0; r < reviews.length || n < newCards.length; i++) {
    const wantNew = n < newCards.length && (r >= reviews.length || i + 1 >= (n + 1) * every);
    out.push(wantNew ? newCards[n++]! : reviews[r++]!);
  }
  return out;
}

/**
 * A practice session's queue. Cards answered wrongly (or still in a learning
 * step) come back once due, so the session ends only when nothing is left
 * due within the learn-ahead window.
 */
export class SessionQueue {
  private pending: CardRecord[];
  private lastId: string | null = null;
  /** Cards served regardless of due date (practising ahead). */
  private early: Set<string>;

  constructor(initial: CardRecord[], { ahead = false } = {}) {
    this.pending = [...initial];
    this.early = new Set(ahead ? initial.map((c) => c.id) : []);
  }

  get size(): number {
    return this.pending.length;
  }

  /** Next card to show, or null when the session is finished. */
  next(now: number): CardRecord | null {
    if (this.pending.length === 0) return null;
    const ready = (c: CardRecord) => isNew(c) || c.fsrs.due <= now || this.early.has(c.id);
    const pick = (pred: (c: CardRecord) => boolean) => {
      const others = this.pending.findIndex((c) => pred(c) && c.id !== this.lastId);
      return others >= 0 ? others : this.pending.findIndex(pred);
    };

    let index = pick(ready);
    if (index < 0) {
      // Nothing due right now: serve the soonest card inside the learn-ahead window.
      const soonest = [...this.pending].sort((a, b) => a.fsrs.due - b.fsrs.due)[0]!;
      if (soonest.fsrs.due - now > LEARN_AHEAD_MS) return null;
      index = pick((c) => c.fsrs.due - now <= LEARN_AHEAD_MS);
    }
    const [card] = this.pending.splice(index, 1);
    this.lastId = card!.id;
    return card!;
  }

  /** Put a reviewed card back if it is due again soon (failed or in a learning step). */
  requeue(card: CardRecord, now: number): void {
    this.early.delete(card.id);
    if (card.fsrs.due - now > LEARN_AHEAD_MS) return;
    const at = this.pending.findIndex((c) => !isNew(c) && c.fsrs.due > card.fsrs.due);
    this.pending.splice(at < 0 ? this.pending.length : at, 0, card);
  }

  /** Put a card back at the front (it was stepped away from with "previous"). */
  pushFront(card: CardRecord): void {
    this.pending.unshift(card);
  }

  /** Move a card to the end without reviewing it (skip). */
  deferToEnd(card: CardRecord): void {
    this.pending.push(card);
  }
}
