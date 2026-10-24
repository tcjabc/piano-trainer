import { describe, expect, it } from 'vitest';
import { newCard } from '../modules/notes/cards';
import { autoGrade, interleave, LEARN_AHEAD_MS, Rating, recordReview, SessionQueue, State } from './scheduler';
import type { CardRecord } from './storage';

const NOW = new Date('2026-10-24T10:00:00Z').getTime();
const card = (spelling: string) => newCard({ clef: 'treble', spelling, midi: 60 }, NOW);

describe('autoGrade', () => {
  it('grades by correctness and response time', () => {
    expect(autoGrade(false, 500)).toBe(Rating.Again);
    expect(autoGrade(true, 999)).toBe(Rating.Easy);
    expect(autoGrade(true, 1000)).toBe(Rating.Good);
    expect(autoGrade(true, 3000)).toBe(Rating.Good);
    expect(autoGrade(true, 3001)).toBe(Rating.Hard);
  });

  it('caps hinted answers at Hard', () => {
    expect(autoGrade(true, 400, true)).toBe(Rating.Hard);
  });
});

describe('recordReview', () => {
  it('moves a new card into learning and logs the review', () => {
    const { card: next, review } = recordReview(card('C4'), Rating.Good, 1500, NOW);
    expect(next.fsrs.state).toBe(State.Learning);
    expect(next.fsrs.due).toBeGreaterThan(NOW);
    expect(next.updatedAt).toBe(NOW);
    expect(review).toMatchObject({ cardId: next.id, rating: Rating.Good, stateBefore: State.New, responseMs: 1500 });
  });

  it('schedules a failed card again within minutes', () => {
    const { card: next } = recordReview(card('C4'), Rating.Again, 800, NOW);
    expect(next.fsrs.due - NOW).toBeLessThanOrEqual(LEARN_AHEAD_MS);
  });
});

describe('interleave', () => {
  it('spreads new cards through reviews', () => {
    const reviews = ['r1', 'r2', 'r3', 'r4'].map(card);
    const fresh = ['n1', 'n2'].map(card);
    const order = interleave(reviews, fresh).map((c) => c.content.spelling);
    expect(order).toHaveLength(6);
    expect(order[0]).toBe('r1');
    expect(order.filter((s) => s.startsWith('n'))).toEqual(['n1', 'n2']);
    expect(order.indexOf('n1')).toBeLessThan(order.indexOf('r4'));
  });
});

describe('SessionQueue', () => {
  const review = (c: CardRecord, due: number): CardRecord => ({
    ...c,
    fsrs: { ...c.fsrs, state: State.Review, due },
  });

  it('serves due cards and finishes when nothing is left', () => {
    const q = new SessionQueue([card('C4'), card('D4')]);
    expect(q.next(NOW)?.content.spelling).toBe('C4');
    expect(q.next(NOW)?.content.spelling).toBe('D4');
    expect(q.next(NOW)).toBeNull();
  });

  it('brings a failed card back later in the same session, not straight away', () => {
    const a = card('C4');
    const q = new SessionQueue([a, card('D4')]);
    const first = q.next(NOW)!;
    const failed = recordReview(first, Rating.Again, 900, NOW).card;
    q.requeue(failed, NOW);
    expect(q.next(NOW)?.content.spelling).toBe('D4');
    // Only the failed card remains; it is served inside the learn-ahead window.
    expect(q.next(NOW)?.id).toBe(a.id);
  });

  it('does not requeue cards scheduled beyond the learn-ahead window', () => {
    const q = new SessionQueue([]);
    q.requeue(review(card('C4'), NOW + 2 * 24 * 3600 * 1000), NOW);
    expect(q.size).toBe(0);
  });

  it('serves not-yet-due cards when practising ahead', () => {
    const later = review(card('C4'), NOW + 3 * 24 * 3600 * 1000);
    expect(new SessionQueue([later]).next(NOW)).toBeNull();
    expect(new SessionQueue([later], { ahead: true }).next(NOW)?.id).toBe(later.id);
  });
});
