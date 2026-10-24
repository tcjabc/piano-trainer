// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newSongCard } from '../modules/drill/items';
import { newCard } from '../modules/notes/cards';
import { BUNDLED_SONGS, musicXmlRecord } from '../modules/songs/import';
import { recordReview, Rating } from './scheduler';
import { DEFAULT_SETTINGS } from './settings';
import { newProgress } from './song-learning';
import { Storage, type SongRecord } from './storage';

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
    expect(await other.importAll(file)).toEqual({ cards: 1, reviews: 1, settings: 1, attempts: 0, decks: 0, songs: 0, songProgress: 0 });
    expect(await other.getCards('notes')).toEqual([result.card]);
    expect((await other.getSettings()).theme).toBe('light');
    await other.close();
  });

  it('exports imported songs with their progress and fingering; bundled songs are matched, not copied', async () => {
    const twinkle = BUNDLED_SONGS.find((b) => b.id === 'twinkle-twinkle')!;
    const ode = BUNDLED_SONGS.find((b) => b.id === 'ode-to-joy')!;
    const bundled = musicXmlRecord(twinkle.xml, 'twinkle-twinkle.musicxml', 'twinkle-twinkle', NOW);
    const imported = musicXmlRecord(ode.xml, 'my-ode.musicxml', null, NOW);
    // A fingering edit on the imported song.
    const [first, ...rest] = imported.data.notes;
    const edited = { ...imported, data: { ...imported.data, notes: [{ ...first!, finger: 3 as const, suggested: false }, ...rest] }, updatedAt: NOW + 1 };
    await db.putSong(bundled);
    await db.putSong(edited);
    const progress = (songId: string, sectionId: string) => ({ ...newProgress(), step: 2, passes: 4, id: `${songId}:${sectionId}`, songId, sectionId, updatedAt: NOW + 2 });
    await db.putSongProgress(progress(bundled.id, bundled.sections[0]!.id));
    await db.putSongProgress(progress(edited.id, edited.sections[1]!.id));
    await db.putCards([newSongCard({ songId: bundled.id, sectionId: bundled.sections[0]!.id }, NOW), newSongCard({ songId: edited.id, sectionId: edited.sections[1]!.id }, NOW)]);

    const file = JSON.parse(JSON.stringify(await db.exportAll()));
    expect(file.songs.map((s: SongRecord) => s.id)).toEqual([edited.id]);
    expect(file.bundledSongs).toEqual([{ id: bundled.id, bundled: 'twinkle-twinkle' }]);

    // Another device, with its own copy of the bundled song.
    const other = new Storage(`test-${++n}`);
    const local = musicXmlRecord(twinkle.xml, 'twinkle-twinkle.musicxml', 'twinkle-twinkle', NOW);
    await other.putSong(local);
    expect(await other.importAll(file)).toMatchObject({ cards: 2, songs: 1, songProgress: 2 });
    expect((await other.getSongs()).map((s) => s.id).sort()).toEqual([local.id, edited.id].sort());
    expect((await other.getSong(edited.id))?.data.notes[0]).toMatchObject({ finger: 3, suggested: false });
    expect((await other.getSongProgress(edited.id)).map((p) => [p.sectionId, p.step, p.passes])).toEqual([[edited.sections[1]!.id, 2, 4]]);
    expect((await other.getSongProgress(local.id)).map((p) => [p.id, p.step])).toEqual([[`${local.id}:${local.sections[0]!.id}`, 2]]);
    expect((await other.getCards('songs')).map((c) => c.key).sort()).toEqual(
      [`songs:${local.id}:${local.sections[0]!.id}`, `songs:${edited.id}:${edited.sections[1]!.id}`].sort(),
    );
    await other.close();

    // A device that deleted the bundled song: its progress and card are left out.
    const without = new Storage(`test-${++n}`);
    expect(await without.importAll(file)).toMatchObject({ cards: 1, songs: 1, songProgress: 1 });
    await without.close();
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

  it('upgrades a version 2 database to add decks, keeping cards and attempts', async () => {
    const name = `test-${++n}`;
    const card = newCard({ clef: 'bass', spelling: 'A2', midi: 45 }, NOW);
    const attempt = {
      id: 'a1', module: 'notes', mode: 'free', key: card.key, content: card.content,
      correct: true, responseMs: 900, hinted: false, at: NOW, updatedAt: NOW,
    };
    const v2 = await openDB(name, 2, {
      upgrade(d) {
        const cards = d.createObjectStore('cards', { keyPath: 'id' });
        cards.createIndex('key', 'key', { unique: true });
        cards.createIndex('module', 'module');
        const reviews = d.createObjectStore('reviews', { keyPath: 'id' });
        reviews.createIndex('cardId', 'cardId');
        reviews.createIndex('reviewedAt', 'reviewedAt');
        d.createObjectStore('settings', { keyPath: 'id' }).createIndex('key', 'key', { unique: true });
        d.createObjectStore('attempts', { keyPath: 'id' }).createIndex('at', 'at');
      },
    });
    await v2.put('cards', card);
    await v2.put('attempts', attempt);
    v2.close();

    const upgraded = new Storage(name);
    expect(await upgraded.getCards('notes')).toEqual([card]);
    expect(await upgraded.getAttemptsSince(0)).toEqual([attempt]);
    expect(await upgraded.getDecks()).toEqual([]);
    const deck = {
      id: 'd1', name: 'Triads', filter: { kinds: ['chord'], qualities: ['M'], scaleTypes: [], roots: ['C'], inversions: [] },
      octaves: 1 as const, starter: false, createdAt: NOW, updatedAt: NOW,
    } as Parameters<Storage['putDeck']>[0];
    await upgraded.putDeck(deck);
    expect((await upgraded.exportAll()).decks).toEqual([deck]);
    await upgraded.close();
  });

  it('upgrades a version 3 database to add songs, keeping cards, attempts and decks', async () => {
    const name = `test-${++n}`;
    const card = newCard({ clef: 'treble', spelling: 'G4', midi: 67 }, NOW);
    const deck = {
      id: 'd1', name: 'Triads', filter: { kinds: ['chord'], qualities: ['M'], scaleTypes: [], roots: ['C'], inversions: [] },
      octaves: 1, starter: true, createdAt: NOW, updatedAt: NOW,
    };
    const v3 = await openDB(name, 3, {
      upgrade(d) {
        const cards = d.createObjectStore('cards', { keyPath: 'id' });
        cards.createIndex('key', 'key', { unique: true });
        cards.createIndex('module', 'module');
        const reviews = d.createObjectStore('reviews', { keyPath: 'id' });
        reviews.createIndex('cardId', 'cardId');
        reviews.createIndex('reviewedAt', 'reviewedAt');
        d.createObjectStore('settings', { keyPath: 'id' }).createIndex('key', 'key', { unique: true });
        d.createObjectStore('attempts', { keyPath: 'id' }).createIndex('at', 'at');
        d.createObjectStore('decks', { keyPath: 'id' });
      },
    });
    await v3.put('cards', card);
    await v3.put('decks', deck);
    v3.close();

    const upgraded = new Storage(name);
    expect(await upgraded.getCards('notes')).toEqual([card]);
    expect(await upgraded.getDecks()).toEqual([deck]);
    expect(await upgraded.getSongs()).toEqual([]);
    const song = {
      id: 's1', title: 'Ode to Joy', artist: 'Beethoven', format: 'musicxml' as const, fileName: 'ode.musicxml', musicXml: '<score-partwise/>',
      data: { notes: [], measures: [], tempos: [], timeSignature: [4, 4] as [number, number], key: null },
      sections: [{ id: 's0', name: 'Bars 1–4', start: 0, end: 4 }], bundled: null, createdAt: NOW, updatedAt: NOW,
    };
    await upgraded.putSong(song);
    await upgraded.putSongProgress({
      id: 's1:s0', songId: 's1', sectionId: 's0', step: 1, streak: 0, speedTempo: 0.6, bestTempo: 0.6,
      lastAccuracy: 1, bestAccuracy: 1, lastPractised: NOW, passes: 2, updatedAt: NOW,
    });
    const songCard = { ...newCard({ clef: 'treble', spelling: 'C4', midi: 60 }, NOW), id: 'sc', key: 'songs:s1:s0', module: 'songs', content: { songId: 's1', sectionId: 's0' } } as unknown as Parameters<Storage['putCard']>[0];
    await upgraded.putCard(songCard);
    const exported = await upgraded.exportAll();
    expect(exported.songs).toEqual([song]);
    expect(exported.songProgress).toHaveLength(1);

    // Deleting the song takes its progress and section cards with it, and nothing else.
    await upgraded.deleteSong('s1');
    expect(await upgraded.getSongs()).toEqual([]);
    expect(await upgraded.getSongProgress('s1')).toEqual([]);
    expect(await upgraded.getCards('songs')).toEqual([]);
    expect(await upgraded.getCards('notes')).toEqual([card]);
    await upgraded.close();
  });

  it('rejects files that are not exports', async () => {
    await expect(db.importAll({ hello: 'world' })).rejects.toThrow(/not a Piano Trainer export/);
  });
});
