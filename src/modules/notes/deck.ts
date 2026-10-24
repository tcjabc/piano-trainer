/**
 * Today's study plan across notes, chords and scales: due reviews, and new
 * cards up to each kind's own daily limit. Note cards are kept in step with
 * the note-drill options; chord and scale cards exist once added from the
 * Library. Only cards for the practised hand are included.
 */
import {
  getDueCards,
  interleave,
  isNew,
  newIntroducedToday,
  planToday,
  startOfDay,
} from '../../core/scheduler';
import type { HandChoice, NoteDrillOptions } from '../../core/settings';
import { storage, type CardModule, type CardRecord, type NoteCard } from '../../core/storage';
import { cardKey, contentsFor, introductionOrder, newCard } from './cards';

/** Seconds per note card used for the time estimate before there is any history. */
const DEFAULT_SECONDS_PER_CARD = 4;
/** Rough seconds per chord and per scale card (no history needed). */
const SECONDS_PER_CHORD = 6;
const SECONDS_PER_SCALE = 10;
/** Time between cards (feedback flash, drawing). */
const OVERHEAD_SECONDS = 0.6;
/** New cards are seen several times on their first day (learning steps); reviews sometimes fail. */
const NEW_CARD_SHOWINGS = 2.5;
const REVIEW_SHOWINGS = 1.2;

/** New cards allowed per day, per kind. */
export type NewLimits = Record<CardModule, number>;

export interface TodaySummary {
  /** Due reviews of every kind, earliest first. */
  reviews: CardRecord[];
  /** Today's new cards (each kind within its own limit). */
  newCards: CardRecord[];
  /** Every card in play for this hand (for practising ahead). */
  pool: CardRecord[];
  /** Due and new counts per kind. */
  counts: Record<CardModule, { reviews: number; new: number }>;
  estimateMinutes: number;
  /** Earliest due time among seen cards, for "next review in …". */
  nextDue: number | null;
}

let syncing: Promise<unknown> = Promise.resolve();

/**
 * Create any note cards the options need and return the cards in range, in
 * introduction order. Calls run one at a time so overlapping refreshes
 * cannot create the same card twice.
 */
export function syncPool(options: NoteDrillOptions, now = Date.now()): Promise<NoteCard[]> {
  const run = syncing.then(() => createMissing(options, now));
  syncing = run.catch(() => undefined);
  return run;
}

async function createMissing(options: NoteDrillOptions, now: number): Promise<NoteCard[]> {
  const existing = new Map((await storage.getCards('notes')).map((c) => [c.key, c]));
  const contents = contentsFor(options).sort(introductionOrder);
  const missing: NoteCard[] = [];
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

/** Chord or scale cards for this hand that are in review, oldest added first. */
async function addedCards(module: 'chords' | 'scales', hand: HandChoice): Promise<CardRecord[]> {
  const cards = await storage.getCards(module);
  return cards.filter((c) => c.content.hand === hand && !c.suspended).sort((a, b) => a.createdAt - b.createdAt);
}

/** Merge lists in turn (a, b, c, a, b, c, …) so no kind of new card comes all at once. */
function roundRobin<T>(lists: T[][]): T[] {
  const out: T[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]!);
  return out;
}

export async function summariseToday(
  options: NoteDrillOptions,
  hand: HandChoice,
  limits: NewLimits,
  now = Date.now(),
): Promise<TodaySummary> {
  const notes = await syncPool(options, now);
  const chords = await addedCards('chords', hand);
  const scales = await addedCards('scales', hand);
  const reviewsToday = await storage.getReviewsSince(startOfDay(now));

  const plans = {
    notes: planToday(notes, notes, limits.notes, newIntroducedToday(reviewsToday, 'notes'), now),
    chords: planToday(chords, chords, limits.chords, newIntroducedToday(reviewsToday, 'chords'), now),
    scales: planToday(scales, scales, limits.scales, newIntroducedToday(reviewsToday, 'scales'), now),
  };
  const pool: CardRecord[] = [...notes, ...chords, ...scales];
  const reviews = getDueCards(pool, now);
  const newCards = roundRobin([plans.notes.newCards, plans.chords.newCards, plans.scales.newCards]);
  const counts = {
    notes: { reviews: plans.notes.reviews.length, new: plans.notes.newCards.length },
    chords: { reviews: plans.chords.reviews.length, new: plans.chords.newCards.length },
    scales: { reviews: plans.scales.reviews.length, new: plans.scales.newCards.length },
  };

  const recent = await storage.getRecentReviews(50);
  const notesRecent = recent.filter((r) => r.module === 'notes');
  const perNote =
    notesRecent.length > 0
      ? notesRecent.reduce((sum, r) => sum + Math.min(r.responseMs, 10_000), 0) / notesRecent.length / 1000
      : DEFAULT_SECONDS_PER_CARD;
  const per: Record<CardModule, number> = { notes: perNote, chords: SECONDS_PER_CHORD, scales: SECONDS_PER_SCALE };
  const seconds = (Object.keys(counts) as CardModule[]).reduce(
    (sum, m) => sum + (per[m] + OVERHEAD_SECONDS) * (counts[m].reviews * REVIEW_SHOWINGS + counts[m].new * NEW_CARD_SHOWINGS),
    0,
  );

  const seen = pool.filter((c) => !isNew(c) && !c.suspended);
  const nextDue = seen.length > 0 ? Math.min(...seen.map((c) => c.fsrs.due)) : null;
  return { reviews, newCards, pool, counts, estimateMinutes: Math.ceil(seconds / 60), nextDue };
}

/** The cards for a normal session: due reviews with today's new cards spread through them. */
export function sessionCards(summary: TodaySummary): CardRecord[] {
  return interleave(summary.reviews, summary.newCards);
}

/** "Practise ahead": a few unseen cards (beyond today's limit) plus the soonest-due seen cards. */
export function practiseAheadCards(summary: TodaySummary, size = 20, maxNew = 5): CardRecord[] {
  const live = summary.pool.filter((c) => !c.suspended);
  const fresh = live.filter(isNew).slice(0, maxNew);
  const soonest = live
    .filter((c) => !isNew(c))
    .sort((a, b) => a.fsrs.due - b.fsrs.due)
    .slice(0, size - fresh.length);
  return interleave(soonest, fresh);
}
