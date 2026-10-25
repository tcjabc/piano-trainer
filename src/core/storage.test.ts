// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newChordCard, newScaleCard, newSongCard } from '../modules/drill/items';
import { newCard } from '../modules/notes/cards';
import { BUNDLED_SONGS, musicXmlRecord } from '../modules/songs/import';
import { recordReview, Rating } from './scheduler';
import { DEFAULT_SETTINGS } from './settings';
import { newProgress } from './song-learning';
import { AFFINITY_HALF_LIFE_MS, dailyDelta, emptyDelta, itemDelta, newItemStats, sectionStatsId, songStatsId } from './stats';
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
    expect(await other.importAll(file)).toEqual({ cards: 1, reviews: 1, settings: 1, attempts: 0, decks: 0, songs: 0, songProgress: 0, stats: 0 });
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

  it('upgrades a version 4 database to add stats: song keys, and chord and scale hits from reviews', async () => {
    const name = `test-${++n}`;
    const ode = BUNDLED_SONGS.find((b) => b.id === 'ode-to-joy')!;
    const minuet = BUNDLED_SONGS.find((b) => b.id === 'minuet-in-g')!;
    /** A song as version 4 stored it: no keySource, and a key only from a signature (major when no mode). */
    const asV4 = (song: SongRecord, key: string | null): SongRecord => {
      const { keySource: _, ...data } = song.data;
      return { ...song, data: { ...data, key } };
    };
    const noKey = asV4(musicXmlRecord(ode.xml.replace(/<key>.*?<\/key>/g, ''), 'ode.musicxml', null, NOW), null);
    const noMode = asV4(musicXmlRecord(minuet.xml.replace(/<mode>.*?<\/mode>/g, ''), 'minuet.musicxml', null, NOW), 'G major');
    const midiSong = { ...asV4(musicXmlRecord(ode.xml, 'ode.mid', null, NOW), null), format: 'midi' as const, musicXml: null };
    const progress = { ...newProgress(), id: `${noKey.id}:s0`, songId: noKey.id, sectionId: 's0', passes: 3, updatedAt: NOW };

    // Two cards for C maj7 (different inversions) count as one chord; note cards aren't backfilled.
    const cmaj7 = newChordCard({ root: 'C', quality: 'maj7', inversion: 0, hand: 'right' }, NOW);
    const cmaj7First = newChordCard({ root: 'C', quality: 'maj7', inversion: 1, hand: 'left' }, NOW);
    const dMajor = newScaleCard({ tonic: 'D', type: 'major', hand: 'right', octaves: 1 }, NOW);
    const note = newCard({ clef: 'treble', spelling: 'C4', midi: 60 }, NOW);
    const reviews = [
      recordReview(cmaj7, Rating.Again, 900, NOW + 1).review,
      recordReview(cmaj7, Rating.Good, 900, NOW + 2).review,
      recordReview(cmaj7First, Rating.Again, 900, NOW + 3).review,
      recordReview(dMajor, Rating.Hard, 900, NOW + 4).review,
      recordReview(note, Rating.Again, 900, NOW + 5).review,
    ];

    const v4 = await openDB(name, 4, {
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
        d.createObjectStore('songs', { keyPath: 'id' });
        d.createObjectStore('songProgress', { keyPath: 'id' }).createIndex('songId', 'songId');
      },
    });
    for (const card of [cmaj7, cmaj7First, dMajor, note]) await v4.put('cards', card);
    for (const review of reviews) await v4.put('reviews', review);
    for (const song of [noKey, noMode, midiSong]) await v4.put('songs', song);
    await v4.put('songProgress', progress);
    v4.close();

    const upgraded = new Storage(name);
    const keys = new Map((await upgraded.getSongs()).map((s) => [s.id, [s.data.key, s.data.keySource]]));
    expect(keys.get(noKey.id)).toEqual(['C major', 'detected']);
    expect(keys.get(noMode.id)).toEqual(['G major', 'signature']);
    expect(keys.get(midiSong.id)).toEqual(['C major', 'detected']);
    // Everything else is as it was.
    expect((await upgraded.getSong(noKey.id))?.data.notes).toEqual(noKey.data.notes);
    expect((await upgraded.getSong(noKey.id))?.updatedAt).toBe(NOW);
    expect(await upgraded.getSongProgress(noKey.id)).toEqual([progress]);
    expect(await upgraded.getCards('chords')).toHaveLength(2);
    expect(await upgraded.getRecentReviews(10)).toHaveLength(5);

    const exported = await upgraded.exportAll();
    const stats = new Map(exported.itemStats!.map((s) => [s.id, s]));
    expect([...stats.keys()].sort()).toEqual(['chord:C:maj7', 'scale:D:major']);
    expect(stats.get('chord:C:maj7')).toMatchObject({ kind: 'chord', songId: null, hits: 1, misses: 2, plays: 0, practiceMs: 0, voluntaryMs: 0, lastPlayed: null });
    expect(stats.get('scale:D:major')).toMatchObject({ kind: 'scale', hits: 1, misses: 0 });
    expect(stats.get('chord:C:maj7')?.hands).toBeUndefined();
    for (const store of ['dailyStats', 'chordPlayCounts', 'confusions', 'keyHits', 'songMeasureMisses', 'songTempoBests'] as const) {
      expect(exported[store]).toEqual([]);
    }
    await upgraded.close();
  });

  it('round-trips stats, moving a bundled song’s stats to this device’s copy, and deletes them with their song', async () => {
    const twinkle = BUNDLED_SONGS.find((b) => b.id === 'twinkle-twinkle')!;
    const theirs = musicXmlRecord(twinkle.xml, 'twinkle-twinkle.musicxml', 'twinkle-twinkle', NOW);
    const songStats = { ...newItemStats(songStatsId(theirs.id), 'song', theirs.id, NOW), plays: 4, practiceMs: 60_000 };
    const sectionStats = { ...newItemStats(sectionStatsId(theirs.id, 's0'), 'section', theirs.id, NOW), hits: 30, misses: 2 };
    const chordStats = { ...newItemStats('chord:C:maj7', 'chord', null, NOW), hits: 8, misses: 3 };
    const file = {
      ...(await db.exportAll()),
      bundledSongs: [{ id: theirs.id, bundled: 'twinkle-twinkle' }],
      itemStats: [songStats, sectionStats, chordStats],
      dailyStats: [{ id: '2026-10-24', practiceMs: 90_000, notesPlayed: 412, updatedAt: NOW }],
      chordPlayCounts: [{ id: 'Am7', count: 12, updatedAt: NOW }],
      confusions: [{ id: 'chord:C:maj7>C7', targetId: 'chord:C:maj7', playedSymbol: 'C7', count: 9, updatedAt: NOW }],
      keyHits: [{ id: 'lifetime' as const, low: 21, counts: Array.from({ length: 88 }, (_, i) => i), updatedAt: NOW }],
      songMeasureMisses: [{ id: `${theirs.id}:3`, songId: theirs.id, measure: 3, misses: 7, updatedAt: NOW }],
      songTempoBests: [{ id: 't1', songId: theirs.id, sectionId: 's0', bestCleanTempo: 0.8, at: NOW, updatedAt: NOW }],
    };

    const local = musicXmlRecord(twinkle.xml, 'twinkle-twinkle.musicxml', 'twinkle-twinkle', NOW);
    await db.putSong(local);
    expect((await db.importAll(JSON.parse(JSON.stringify(file)))).stats).toBe(9);
    // Importing the same file again changes nothing (the newer record wins; equal is not newer).
    expect((await db.importAll(JSON.parse(JSON.stringify(file)))).stats).toBe(0);

    const out = await db.exportAll();
    expect(out.itemStats!.map((s) => [s.id, s.songId]).sort()).toEqual(
      [['chord:C:maj7', null], [songStatsId(local.id), local.id], [sectionStatsId(local.id, 's0'), local.id]].sort(),
    );
    expect(out.songMeasureMisses).toEqual([{ ...file.songMeasureMisses[0], id: `${local.id}:3`, songId: local.id }]);
    expect(out.songTempoBests).toEqual([{ ...file.songTempoBests[0], songId: local.id }]);
    expect(out.dailyStats).toEqual(file.dailyStats);
    expect(out.chordPlayCounts).toEqual(file.chordPlayCounts);
    expect(out.confusions).toEqual(file.confusions);
    expect(out.keyHits).toEqual(file.keyHits);

    // A newer count replaces the older one.
    const newer = { ...file, dailyStats: [{ ...file.dailyStats[0]!, practiceMs: 120_000, updatedAt: NOW + 1 }] };
    expect((await db.importAll(newer)).stats).toBe(1);
    expect((await db.exportAll()).dailyStats![0]!.practiceMs).toBe(120_000);

    await db.deleteSong(local.id);
    const left = await db.exportAll();
    expect(left.itemStats!.map((s) => s.id)).toEqual(['chord:C:maj7']);
    expect(left.songMeasureMisses).toEqual([]);
    expect(left.songTempoBests).toEqual([]);

    // A device without the bundled song skips its stats.
    const without = new Storage(`test-${++n}`);
    expect((await without.importAll(file)).stats).toBe(5);
    await without.close();
  });

  it('adds batches of counts: decayed affinity, key presses, and only tempos that beat the best', async () => {
    const twinkle = BUNDLED_SONGS.find((b) => b.id === 'twinkle-twinkle')!;
    const song = musicXmlRecord(twinkle.xml, 'twinkle.musicxml', null, NOW);
    await db.putSong(song);
    const section = { id: sectionStatsId(song.id, 's0'), kind: 'section' as const, songId: song.id };
    const chord = { id: 'chord:C:maj7', kind: 'chord' as const, songId: null };
    const batch = (voluntaryMs: number) => {
      const d = emptyDelta();
      Object.assign(itemDelta(d, chord), { plays: 1, practiceMs: voluntaryMs, voluntaryMs, hits: 3, misses: 1, lastPlayed: NOW });
      const s = itemDelta(d, section);
      s.hits = 5;
      s.hands.L.hits = 2;
      s.hands.R.misses = 1;
      dailyDelta(d, '2026-10-24').practiceMs = voluntaryMs;
      d.keyHits.set(60, 2).set(20, 9); // A0 is the lowest counted key
      d.chordPlays.set('Am7', 1);
      d.measureMisses.set(`${song.id}:2`, { songId: song.id, measure: 2, misses: 4 });
      return d;
    };

    await db.applyStats(batch(60_000), NOW);
    const later = NOW + AFFINITY_HALF_LIFE_MS;
    const second = batch(10_000);
    second.cleanTempos.push(
      { songId: song.id, sectionId: 's0', tempo: 0.7, at: later - 3 },
      { songId: song.id, sectionId: 's0', tempo: 0.6, at: later - 2 },
      { songId: song.id, sectionId: 's0', tempo: 0.8, at: later - 1 },
      { songId: song.id, sectionId: null, tempo: 0.5, at: later },
    );
    await db.applyStats(second, later);
    const third = emptyDelta();
    third.cleanTempos.push({ songId: song.id, sectionId: 's0', tempo: 0.8, at: later + 1 });
    await db.applyStats(third, later + 1);

    const out = await db.exportAll();
    const stats = new Map(out.itemStats!.map((s) => [s.id, s]));
    expect(stats.get(chord.id)).toMatchObject({ plays: 2, practiceMs: 70_000, voluntaryMs: 70_000, hits: 6, misses: 2, lastPlayed: NOW, affinityAt: later, updatedAt: later });
    expect(stats.get(chord.id)!.affinity).toBeCloseTo(30_000 + 10_000);
    expect(stats.get(section.id)).toMatchObject({ hits: 10, hands: { L: { hits: 4, misses: 0 }, R: { hits: 0, misses: 2 } } });
    expect(out.dailyStats).toEqual([{ id: '2026-10-24', practiceMs: 70_000, notesPlayed: 0, updatedAt: later }]);
    expect(out.keyHits![0]!.counts[60 - 21]).toBe(4);
    expect(out.keyHits![0]!.counts.reduce((a, b) => a + b, 0)).toBe(4);
    expect(out.chordPlayCounts).toEqual([{ id: 'Am7', count: 2, updatedAt: later }]);
    expect(out.songMeasureMisses![0]!.misses).toBe(8);
    expect(out.songTempoBests!.map((t) => [t.sectionId, t.bestCleanTempo]).sort()).toEqual([[null, 0.5], ['s0', 0.7], ['s0', 0.8]].sort());

    // Counts for a song deleted before they were saved are dropped.
    await db.deleteSong(song.id);
    await db.applyStats(batch(1000), later + 2);
    const after = await db.exportAll();
    expect(after.itemStats!.map((s) => s.id)).toEqual([chord.id]);
    expect(after.songMeasureMisses).toEqual([]);
  });

  it('fills in the key of a song imported from an export made before keys were detected', async () => {
    const ode = BUNDLED_SONGS.find((b) => b.id === 'ode-to-joy')!;
    const song = musicXmlRecord(ode.xml, 'ode.musicxml', null, NOW);
    const { keySource: _, ...data } = song.data;
    const file = { ...(await db.exportAll()), songs: [{ ...song, data }] };
    await db.importAll(file);
    expect((await db.getSong(song.id))?.data).toMatchObject({ key: 'C major', keySource: 'signature' });
  });

  it('rejects an export with damaged stats', async () => {
    const file = { ...(await db.exportAll()), dailyStats: [{ practiceMs: 5 }] };
    await expect(db.importAll(file)).rejects.toThrow(/incomplete or damaged/);
  });

  it('rejects files that are not exports', async () => {
    await expect(db.importAll({ hello: 'world' })).rejects.toThrow(/not a Piano Trainer export/);
  });
});
