import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newCard } from '../modules/notes/cards';
import { recordReview, Rating } from './scheduler';
import { DEFAULT_SETTINGS } from './settings';
import { Storage } from './storage';

let db: Storage;
let n = 0;

beforeEach(() => {
  db = new Storage(`test-${++n}`);
});
afterEach(() => db.close());

const NOW = 1_760_000_000_000;

describe('storage', () => {
  it('returns default settings and saves changes with an id and timestamp', async () => {
    expect(await db.getSettings()).toEqual(DEFAULT_SETTINGS);
    await db.saveSettings({ ...DEFAULT_SETTINGS, theme: 'dark' });
    expect((await db.getSettings()).theme).toBe('dark');
    const [rec] = (await db.exportAll()).settings;
    expect(rec?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(rec?.updatedAt).toBeGreaterThan(0);
  });

  it('records a review together with the updated card', async () => {
    const card = newCard({ clef: 'treble', spelling: 'C4', midi: 60 }, NOW);
    await db.putCard(card);
    const result = recordReview(card, Rating.Good, 1200, NOW + 1000);
    await db.recordReview(result.review, result.card);
    expect((await db.getCard(card.id))?.fsrs.reps).toBe(1);
    expect(await db.getReviewsSince(NOW)).toHaveLength(1);
    expect(await db.getRecentReviews(5)).toHaveLength(1);
  });

  it('round-trips an export into an empty database', async () => {
    const card = newCard({ clef: 'bass', spelling: 'G3', midi: 55 }, NOW);
    await db.putCard(card);
    const result = recordReview(card, Rating.Easy, 700, NOW + 1000);
    await db.recordReview(result.review, result.card);
    await db.saveSettings({ ...DEFAULT_SETTINGS, theme: 'light' });
    const file = JSON.parse(JSON.stringify(await db.exportAll()));

    const other = new Storage(`test-${++n}`);
    expect(await other.importAll(file)).toEqual({ cards: 1, reviews: 1, settings: 1, attempts: 0 });
    expect(await other.getCards('notes')).toEqual([result.card]);
    expect((await other.getSettings()).theme).toBe('light');
    await other.close();
  });

  it('keeps the newer record when the same card key exists with another id', async () => {
    const local = newCard({ clef: 'treble', spelling: 'E4', midi: 64 }, NOW);
    await db.putCard({ ...local, updatedAt: NOW + 5000 });
    const older = { ...newCard({ clef: 'treble', spelling: 'E4', midi: 64 }, NOW), updatedAt: NOW + 1000 };
    const newer = { ...newCard({ clef: 'treble', spelling: 'E4', midi: 64 }, NOW), updatedAt: NOW + 9000 };
    const file = { ...(await db.exportAll()), cards: [older] };
    expect((await db.importAll(file)).cards).toBe(0);
    expect((await db.importAll({ ...file, cards: [newer] })).cards).toBe(1);
    const cards = await db.getCards('notes');
    expect(cards.map((c) => c.id)).toEqual([newer.id]);
  });

  it('upgrades a version 1 database without touching its data', async () => {
    const name = `test-${++n}`;
    const card = newCard({ clef: 'treble', spelling: 'D4', midi: 62 }, NOW);
    const v1 = await openDB(name, 1, {
      upgrade(d) {
        const cards = d.createObjectStore('cards', { keyPath: 'id' });
        cards.createIndex('key', 'key', { unique: true });
        cards.createIndex('module', 'module');
        const reviews = d.createObjectStore('reviews', { keyPath: 'id' });
        reviews.createIndex('cardId', 'cardId');
        reviews.createIndex('reviewedAt', 'reviewedAt');
        d.createObjectStore('settings', { keyPath: 'id' }).createIndex('key', 'key', { unique: true });
      },
    });
    await v1.put('cards', card);
    v1.close();

    const upgraded = new Storage(name);
    expect(await upgraded.getCards('notes')).toEqual([card]);
    expect(await upgraded.getAttemptsSince(0)).toEqual([]);
    await upgraded.close();
  });

  it('rejects files that are not exports', async () => {
    await expect(db.importAll({ hello: 'world' })).rejects.toThrow(/not a Piano Trainer export/);
  });
});
