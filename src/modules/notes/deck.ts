/** The note-drill deck: keeps stored cards in step with the drill options and plans the day. */
import {
  interleave,
  isNew,
  newIntroducedToday,
  planToday,
  startOfDay,
  type DuePlan,
} from '../../core/scheduler';
import type { NoteDrillOptions } from '../../core/settings';
import { storage, type CardRecord } from '../../core/storage';
import { cardKey, contentsFor, introductionOrder, newCard } from './cards';

/** Seconds per card used for the time estimate before there is any history. */
const DEFAULT_SECONDS_PER_CARD = 4;
/** Time between cards (feedback flash, drawing). */
const OVERHEAD_SECONDS = 0.6;
/** New cards are seen several times on their first day (learning steps); reviews sometimes fail. */
const NEW_CARD_SHOWINGS = 2.5;
const REVIEW_SHOWINGS = 1.2;

export interface TodaySummary extends DuePlan {
  /** Every card in the current drill range. */
  pool: CardRecord[];
  estimateMinutes: number;
  /** Earliest due time among seen cards, for "next review in …". */
  nextDue: number | null;
}

let syncing: Promise<unknown> = Promise.resolve();

/**
 * Create any cards the options need and return the cards in range, in
 * introduction order. Calls run one at a time so overlapping refreshes
 * cannot create the same card twice.
 */
export function syncPool(options: NoteDrillOptions, now = Date.now()): Promise<CardRecord[]> {
  const run = syncing.then(() => createMissing(options, now));
  syncing = run.catch(() => undefined);
  return run;
}

async function createMissing(options: NoteDrillOptions, now: number): Promise<CardRecord[]> {
  const existing = new Map((await storage.getCards('notes')).map((c) => [c.key, c]));
  const contents = contentsFor(options).sort(introductionOrder);
  const missing: CardRecord[] = [];
  const pool = contents.map((content) => {
    const found = existing.get(cardKey(content.clef, content.spelling));
    if (found) return found;
    const card = newCard(content, now);
    missing.push(card);
    return card;
  });
  if (missing.length > 0) await storage.putCards(missing);
  return pool;
}

export async function summariseToday(options: NoteDrillOptions, now = Date.now()): Promise<TodaySummary> {
  const pool = await syncPool(options, now);
  const reviewsToday = await storage.getReviewsSince(startOfDay(now));
  const plan = planToday(pool, pool, options.newPerDay, newIntroducedToday(reviewsToday), now);

  const recent = await storage.getRecentReviews(50);
  const perCard =
    recent.length > 0
      ? recent.reduce((sum, r) => sum + Math.min(r.responseMs, 10_000), 0) / recent.length / 1000
      : DEFAULT_SECONDS_PER_CARD;
  const seconds =
    (perCard + OVERHEAD_SECONDS) *
    (plan.reviews.length * REVIEW_SHOWINGS + plan.newCards.length * NEW_CARD_SHOWINGS);

  const seen = pool.filter((c) => !isNew(c));
  const nextDue = seen.length > 0 ? Math.min(...seen.map((c) => c.fsrs.due)) : null;
  return { ...plan, pool, estimateMinutes: Math.ceil(seconds / 60), nextDue };
}

/** The cards for a normal session: due reviews with today's new cards spread through them. */
export function sessionCards(summary: TodaySummary): CardRecord[] {
  return interleave(summary.reviews, summary.newCards);
}

/** "Practise ahead": a few unseen cards (beyond today's limit) plus the soonest-due seen cards. */
export function practiseAheadCards(summary: TodaySummary, size = 20, maxNew = 5): CardRecord[] {
  const fresh = summary.pool.filter(isNew).slice(0, maxNew);
  const soonest = summary.pool
    .filter((c) => !isNew(c))
    .sort((a, b) => a.fsrs.due - b.fsrs.due)
    .slice(0, size - fresh.length);
  return interleave(soonest, fresh);
}
