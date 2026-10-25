/**
 * The only module that touches IndexedDB. Every record carries a UUID `id`
 * and an `updatedAt` timestamp (epoch ms) so a sync layer can be added later.
 */
import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from 'idb';
import type { ChordQuality } from './chords';
import type { LibraryFilter } from './filter';
import { signatureFromMusicXml, songKey } from './key-finder';
import type { Clef } from './pitch';
import type { ScaleType } from './scales';
import type { Section, SongData, SongHand } from './song';
import type { SectionProgress } from './song-learning';
import { backfillItemStats, itemStatsIdForSong, measureMissId } from './stats';
import { withDefaults, type HandChoice, type Settings } from './settings';

/** FSRS card state as stored: dates are epoch ms so records survive JSON round trips. */
export interface StoredFsrs {
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  /** ts-fsrs State: 0 New, 1 Learning, 2 Review, 3 Relearning. */
  state: number;
  last_review: number | null;
}

export interface NoteCardContent {
  clef: Clef;
  /** Written note, e.g. "C#4". */
  spelling: string;
  midi: number;
}

/** A chord to play anywhere on the keyboard; identity is root + quality + inversion + hand. */
export interface ChordCardContent {
  root: string;
  quality: ChordQuality;
  inversion: number;
  hand: HandChoice;
}

/** A scale to play; identity is tonic + type + hand + octaves. */
export interface ScaleCardContent {
  tonic: string;
  type: ScaleType;
  hand: HandChoice;
  octaves: 1 | 2;
}

/** A section of a song; it is practised at the step of the learning path it has reached. */
export interface SongCardContent {
  songId: string;
  sectionId: string;
}

interface CardBase {
  id: string;
  /** Unique, human-readable identity, e.g. "notes:treble:C#4", "chords:F#:m7:1:right". */
  key: string;
  fsrs: StoredFsrs;
  createdAt: number;
  updatedAt: number;
  /** Taken out of review (kept so its history and schedule return if it is added again). */
  suspended?: boolean;
}

export type NoteCard = CardBase & { module: 'notes'; content: NoteCardContent };
export type ChordCard = CardBase & { module: 'chords'; content: ChordCardContent };
export type ScaleCard = CardBase & { module: 'scales'; content: ScaleCardContent };
export type SongCard = CardBase & { module: 'songs'; content: SongCardContent };
export type CardRecord = NoteCard | ChordCard | ScaleCard | SongCard;
export type CardModule = CardRecord['module'];
export type CardContent = CardRecord['content'];

export interface ReviewRecord {
  id: string;
  cardId: string;
  module: CardRecord['module'];
  /** ts-fsrs Rating: 1 Again, 2 Hard, 3 Good, 4 Easy. */
  rating: number;
  /** FSRS state before this review. */
  stateBefore: number;
  responseMs: number;
  reviewedAt: number;
  /** FSRS state after the review, kept for later analysis or optimisation. */
  fsrsAfter: StoredFsrs;
  updatedAt: number;
}

export interface SettingsRecord {
  id: string;
  key: 'app';
  value: Settings;
  updatedAt: number;
}

/**
 * One answer in free practice. Logged for the record only: it never changes
 * a card or the review schedule (those live in `cards` and `reviews`).
 */
export interface AttemptRecord {
  id: string;
  module: CardRecord['module'];
  mode: 'free';
  /** Same form as a card key, e.g. "notes:treble:C#4" (the card may not exist). */
  key: string;
  content: CardContent;
  correct: boolean;
  responseMs: number;
  /** Wrong notes along the way (scales). */
  errors?: number;
  /** The note was heard (H) before answering. */
  hinted: boolean;
  at: number;
  updatedAt: number;
}

/** A deck: a saved Library filter, e.g. "minor 7ths in flat keys". */
export interface DeckRecord {
  id: string;
  name: string;
  filter: LibraryFilter;
  /** Scales in the deck are practised over this many octaves. */
  octaves: 1 | 2;
  /** One of the decks offered on first run. */
  starter: boolean;
  createdAt: number;
  updatedAt: number;
}

/** An imported (or bundled) song. */
export interface SongRecord {
  id: string;
  title: string;
  artist: string;
  format: 'midi' | 'musicxml';
  fileName: string;
  /** The score, for the notation view (MusicXML only; .mxl is stored unzipped). */
  musicXml: string | null;
  data: SongData;
  sections: Section[];
  /** Which bundled song this is ("ode-to-joy"), or null for an import. */
  bundled: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Learning-path progress and stats for one section; id is "songId:sectionId". */
export interface SongProgressRecord extends SectionProgress {
  id: string;
  songId: string;
  sectionId: string;
  updatedAt: number;
}

// ── Practice statistics (running counters; see stats.ts) ─────────────────

export type StatsKind = 'song' | 'chord' | 'scale' | 'section';

/** Counters for one song, section, chord (by name) or scale; id e.g. "chord:C:maj7", "section:<song>:<section>". */
export interface ItemStatsRecord {
  id: string;
  kind: StatsKind;
  /** The song, for songs and sections (so their stats go with it); null for chords and scales. */
  songId: string | null;
  /** Sessions it was played in (one per session). */
  plays: number;
  /** Active time in it (idle and hidden time left out). */
  practiceMs: number;
  /** The part of practiceMs the player chose (not scheduled reviews). */
  voluntaryMs: number;
  /** voluntaryMs decayed with a 30-day half-life, as it stood at affinityAt. */
  affinity: number;
  affinityAt: number;
  hits: number;
  misses: number;
  /** Songs and sections: hits and misses by hand. */
  hands?: Record<SongHand, { hits: number; misses: number }>;
  lastPlayed: number | null;
  updatedAt: number;
}

/** One local day; id is the date, "YYYY-MM-DD". */
export interface DailyStatsRecord {
  id: string;
  practiceMs: number;
  notesPlayed: number;
  updatedAt: number;
}

/** How often a chord was held in Play; id is its symbol, e.g. "Am7". */
export interface ChordPlayCountRecord {
  id: string;
  count: number;
  updatedAt: number;
}

/** A chord check that failed: aimed at one chord, played another; id "<targetId>><playedSymbol>". */
export interface ConfusionRecord {
  id: string;
  /** Stats id of the chord aimed at, e.g. "chord:C:maj7". */
  targetId: string;
  /** What was held instead, e.g. "C7". */
  playedSymbol: string;
  count: number;
  updatedAt: number;
}

/** Lifetime key presses, one counter per key from `low` (a single record, id "lifetime"). */
export interface KeyHitsRecord {
  id: 'lifetime';
  low: number;
  counts: number[];
  updatedAt: number;
}

/** Misses in one measure of a song (missed notes and wrong presses); id "<songId>:<measure>". */
export interface SongMeasureMissRecord {
  id: string;
  songId: string;
  /** Measure index. */
  measure: number;
  misses: number;
  updatedAt: number;
}

/** A new best clean-pass tempo (one record per improvement, for the progress line). */
export interface SongTempoBestRecord {
  id: string;
  songId: string;
  /** Null for a pass through the whole song. */
  sectionId: string | null;
  /** Tempo factor, 1 = as written. */
  bestCleanTempo: number;
  at: number;
  updatedAt: number;
}

export const STATS_STORES = ['itemStats', 'dailyStats', 'chordPlayCounts', 'confusions', 'keyHits', 'songMeasureMisses', 'songTempoBests'] as const;

export interface ExportFile {
  app: 'piano-trainer';
  schemaVersion: 1;
  exportedAt: string;
  cards: CardRecord[];
  reviews: ReviewRecord[];
  settings: SettingsRecord[];
  /** Free-practice attempts (missing in exports made before free practice existed). */
  attempts?: AttemptRecord[];
  /** Decks (missing in exports made before decks existed). */
  decks?: DeckRecord[];
  /**
   * Imported songs (with their fingering and section edits) and the progress
   * of every song (missing in exports made before songs existed). Bundled
   * songs are re-seeded on each device rather than exported.
   */
  songs?: SongRecord[];
  songProgress?: SongProgressRecord[];
  /**
   * The exporting device's ids for its bundled songs, so their progress and
   * review cards can be matched to this device's copies.
   */
  bundledSongs?: { id: string; bundled: string }[];
  /** Practice statistics (each missing in exports made before stats existed). */
  itemStats?: ItemStatsRecord[];
  dailyStats?: DailyStatsRecord[];
  chordPlayCounts?: ChordPlayCountRecord[];
  confusions?: ConfusionRecord[];
  keyHits?: KeyHitsRecord[];
  songMeasureMisses?: SongMeasureMissRecord[];
  songTempoBests?: SongTempoBestRecord[];
}

export interface ImportSummary {
  cards: number;
  reviews: number;
  settings: number;
  attempts: number;
  decks: number;
  songs: number;
  songProgress: number;
  /** Records of all the stats stores together. */
  stats: number;
}

interface TrainerDB extends DBSchema {
  cards: {
    key: string;
    value: CardRecord;
    indexes: { key: string; module: string };
  };
  reviews: {
    key: string;
    value: ReviewRecord;
    indexes: { cardId: string; reviewedAt: number };
  };
  settings: {
    key: string;
    value: SettingsRecord;
    indexes: { key: string };
  };
  attempts: {
    key: string;
    value: AttemptRecord;
    indexes: { at: number };
  };
  decks: {
    key: string;
    value: DeckRecord;
  };
  songs: {
    key: string;
    value: SongRecord;
  };
  songProgress: {
    key: string;
    value: SongProgressRecord;
    indexes: { songId: string };
  };
  itemStats: {
    key: string;
    value: ItemStatsRecord;
    indexes: { songId: string };
  };
  dailyStats: {
    key: string;
    value: DailyStatsRecord;
  };
  chordPlayCounts: {
    key: string;
    value: ChordPlayCountRecord;
  };
  confusions: {
    key: string;
    value: ConfusionRecord;
  };
  keyHits: {
    key: string;
    value: KeyHitsRecord;
  };
  songMeasureMisses: {
    key: string;
    value: SongMeasureMissRecord;
    indexes: { songId: string };
  };
  songTempoBests: {
    key: string;
    value: SongTempoBestRecord;
    indexes: { songId: string };
  };
}

/** v1: cards, reviews, settings. v2: free-practice attempts. v3: decks. v4: songs. v5: practice statistics. */
const DB_VERSION = 5;

/**
 * The key of a song stored before keys were detected (no data.keySource):
 * MusicXML is read again for its signature (an unstated mode used to mean
 * major); a MIDI file's key came from its signature when it had one.
 */
export function withSongKey(song: SongRecord): SongRecord {
  if (song.data.keySource) return song;
  const signature = song.musicXml ? signatureFromMusicXml(song.musicXml) : null;
  if (!signature && song.data.key) return { ...song, data: { ...song.data, keySource: 'signature' } };
  const key = songKey(song.data.notes, signature);
  if (key.key === song.data.key && !key.keySource) return song;
  return { ...song, data: { ...song.data, ...key } };
}

/** v4 → v5: keys for stored songs, and chord and scale hits and misses from their reviews. */
async function migrateToV5(tx: IDBPTransaction<TrainerDB, StoreNames<TrainerDB>[], 'versionchange'>, now: number): Promise<void> {
  const songs = tx.objectStore('songs');
  for (const song of await songs.getAll()) {
    const keyed = withSongKey(song);
    if (keyed !== song) await songs.put(keyed);
  }
  const cards = await tx.objectStore('cards').getAll();
  const reviews = await tx.objectStore('reviews').getAll();
  const itemStats = tx.objectStore('itemStats');
  for (const record of backfillItemStats(cards, reviews, now)) await itemStats.put(record);
}

export function uuid(): string {
  return crypto.randomUUID();
}

export class Storage {
  private dbPromise: Promise<IDBPDatabase<TrainerDB>> | null = null;

  constructor(private readonly name = 'piano-trainer') {}

  private db(): Promise<IDBPDatabase<TrainerDB>> {
    this.dbPromise ??= openDB<TrainerDB>(this.name, DB_VERSION, {
      // Only adds what an older database is missing; existing data is left alone.
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          const cards = db.createObjectStore('cards', { keyPath: 'id' });
          cards.createIndex('key', 'key', { unique: true });
          cards.createIndex('module', 'module');
          const reviews = db.createObjectStore('reviews', { keyPath: 'id' });
          reviews.createIndex('cardId', 'cardId');
          reviews.createIndex('reviewedAt', 'reviewedAt');
          const settings = db.createObjectStore('settings', { keyPath: 'id' });
          settings.createIndex('key', 'key', { unique: true });
        }
        if (oldVersion < 2) {
          const attempts = db.createObjectStore('attempts', { keyPath: 'id' });
          attempts.createIndex('at', 'at');
        }
        if (oldVersion < 3) {
          db.createObjectStore('decks', { keyPath: 'id' });
        }
        if (oldVersion < 4) {
          db.createObjectStore('songs', { keyPath: 'id' });
          db.createObjectStore('songProgress', { keyPath: 'id' }).createIndex('songId', 'songId');
        }
        if (oldVersion < 5) {
          db.createObjectStore('itemStats', { keyPath: 'id' }).createIndex('songId', 'songId');
          db.createObjectStore('dailyStats', { keyPath: 'id' });
          db.createObjectStore('chordPlayCounts', { keyPath: 'id' });
          db.createObjectStore('confusions', { keyPath: 'id' });
          db.createObjectStore('keyHits', { keyPath: 'id' });
          db.createObjectStore('songMeasureMisses', { keyPath: 'id' }).createIndex('songId', 'songId');
          db.createObjectStore('songTempoBests', { keyPath: 'id' }).createIndex('songId', 'songId');
          // Only IndexedDB requests are awaited, so the upgrade transaction stays open until this is done.
          if (oldVersion > 0) {
            migrateToV5(transaction, Date.now()).catch((err: unknown) => {
              console.error('Upgrading the database failed', err);
              transaction.abort();
            });
          }
        }
      },
    });
    return this.dbPromise;
  }

  async close(): Promise<void> {
    if (!this.dbPromise) return;
    (await this.dbPromise).close();
    this.dbPromise = null;
  }

  /**
   * Ask the browser not to evict our data. Only asks once; returns whether
   * storage is persisted.
   */
  async requestPersistence(): Promise<boolean> {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return navigator.storage.persist();
  }

  // ── Cards ──────────────────────────────────────────────────────────────

  async getCards<M extends CardModule>(module: M): Promise<Extract<CardRecord, { module: M }>[]> {
    return (await this.db()).getAllFromIndex('cards', 'module', module) as Promise<Extract<CardRecord, { module: M }>[]>;
  }

  async getCardByKey(key: string): Promise<CardRecord | undefined> {
    return (await this.db()).getFromIndex('cards', 'key', key);
  }

  async getCard(id: string): Promise<CardRecord | undefined> {
    return (await this.db()).get('cards', id);
  }

  async putCard(card: CardRecord): Promise<void> {
    await (await this.db()).put('cards', card);
  }

  async putCards(cards: CardRecord[]): Promise<void> {
    const tx = (await this.db()).transaction('cards', 'readwrite');
    await Promise.all([...cards.map((c) => tx.store.put(c)), tx.done]);
  }

  // ── Reviews ────────────────────────────────────────────────────────────

  /** Save a review and the card it updated in one transaction. */
  async recordReview(review: ReviewRecord, card: CardRecord): Promise<void> {
    const tx = (await this.db()).transaction(['reviews', 'cards'], 'readwrite');
    await Promise.all([
      tx.objectStore('reviews').put(review),
      tx.objectStore('cards').put(card),
      tx.done,
    ]);
  }

  async getReviewsSince(since: number): Promise<ReviewRecord[]> {
    return (await this.db()).getAllFromIndex('reviews', 'reviewedAt', IDBKeyRange.lowerBound(since));
  }

  /** The most recent reviews, newest first. */
  async getRecentReviews(limit: number): Promise<ReviewRecord[]> {
    const out: ReviewRecord[] = [];
    const tx = (await this.db()).transaction('reviews');
    let cursor = await tx.store.index('reviewedAt').openCursor(null, 'prev');
    while (cursor && out.length < limit) {
      out.push(cursor.value);
      cursor = await cursor.continue();
    }
    return out;
  }

  // ── Free-practice attempts ─────────────────────────────────────────────

  async addAttempt(attempt: AttemptRecord): Promise<void> {
    await (await this.db()).put('attempts', attempt);
  }

  async getAttemptsSince(since: number): Promise<AttemptRecord[]> {
    return (await this.db()).getAllFromIndex('attempts', 'at', IDBKeyRange.lowerBound(since));
  }

  // ── Decks ──────────────────────────────────────────────────────────────

  async getDecks(): Promise<DeckRecord[]> {
    const decks = await (await this.db()).getAll('decks');
    return decks.sort((a, b) => a.createdAt - b.createdAt);
  }

  async putDeck(deck: DeckRecord): Promise<void> {
    await (await this.db()).put('decks', deck);
  }

  async deleteDeck(id: string): Promise<void> {
    await (await this.db()).delete('decks', id);
  }

  // ── Songs ──────────────────────────────────────────────────────────────

  async getSongs(): Promise<SongRecord[]> {
    const songs = await (await this.db()).getAll('songs');
    return songs.sort((a, b) => a.createdAt - b.createdAt);
  }

  async getSong(id: string): Promise<SongRecord | undefined> {
    return (await this.db()).get('songs', id);
  }

  async putSong(song: SongRecord): Promise<void> {
    await (await this.db()).put('songs', song);
  }

  /** Delete a song with its progress, its stats and its section cards (their review history stays). */
  async deleteSong(id: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(['songs', 'songProgress', 'cards', 'itemStats', 'songMeasureMisses', 'songTempoBests'], 'readwrite');
    await tx.objectStore('songs').delete(id);
    for (const name of ['songProgress', 'itemStats', 'songMeasureMisses', 'songTempoBests'] as const) {
      const store = tx.objectStore(name);
      for (const key of await store.index('songId').getAllKeys(id)) await store.delete(key);
    }
    const cards = (await tx.objectStore('cards').index('module').getAll('songs')) as SongCard[];
    for (const card of cards) if (card.content.songId === id) await tx.objectStore('cards').delete(card.id);
    await tx.done;
  }

  async getSongProgress(songId: string): Promise<SongProgressRecord[]> {
    return (await this.db()).getAllFromIndex('songProgress', 'songId', songId);
  }

  async putSongProgress(record: SongProgressRecord): Promise<void> {
    await (await this.db()).put('songProgress', record);
  }

  // ── Settings ───────────────────────────────────────────────────────────

  async getSettings(): Promise<Settings> {
    const rec = await (await this.db()).getFromIndex('settings', 'key', 'app');
    return withDefaults(rec?.value);
  }

  async saveSettings(value: Settings): Promise<void> {
    const db = await this.db();
    const existing = await db.getFromIndex('settings', 'key', 'app');
    await db.put('settings', { id: existing?.id ?? uuid(), key: 'app', value, updatedAt: Date.now() });
  }

  // ── Export / import ────────────────────────────────────────────────────

  async exportAll(): Promise<ExportFile> {
    const db = await this.db();
    const songs = await db.getAll('songs');
    return {
      app: 'piano-trainer',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      cards: await db.getAll('cards'),
      reviews: await db.getAll('reviews'),
      settings: await db.getAll('settings'),
      attempts: await db.getAll('attempts'),
      decks: await db.getAll('decks'),
      songs: songs.filter((s) => s.bundled === null),
      songProgress: await db.getAll('songProgress'),
      bundledSongs: songs.flatMap((s) => (s.bundled === null ? [] : [{ id: s.id, bundled: s.bundled }])),
      itemStats: await db.getAll('itemStats'),
      dailyStats: await db.getAll('dailyStats'),
      chordPlayCounts: await db.getAll('chordPlayCounts'),
      confusions: await db.getAll('confusions'),
      keyHits: await db.getAll('keyHits'),
      songMeasureMisses: await db.getAll('songMeasureMisses'),
      songTempoBests: await db.getAll('songTempoBests'),
    };
  }

  /**
   * Merge an export into the database. Records are matched by `id` (and
   * cards/settings also by their unique `key`); the newer `updatedAt` wins.
   * Bundled songs aren't imported: their progress, stats and review cards
   * move to this device's copy of the same song, and are skipped if it was
   * deleted. Stats counters merge like any other record (the newer wins), so
   * importing the same file twice never counts anything twice.
   */
  async importAll(data: unknown): Promise<ImportSummary> {
    const file = validateExport(data);
    const db = await this.db();
    const tx = db.transaction(['cards', 'reviews', 'settings', 'attempts', 'decks', 'songs', 'songProgress', ...STATS_STORES], 'readwrite');
    const summary: ImportSummary = { cards: 0, reviews: 0, settings: 0, attempts: 0, decks: 0, songs: 0, songProgress: 0, stats: 0 };

    // The file's bundled-song ids → this device's (older exports carried the bundled songs themselves).
    const songs = tx.objectStore('songs');
    const localBundled = new Map((await songs.getAll()).flatMap((s) => (s.bundled === null ? [] : [[s.bundled, s.id] as const])));
    const bundledIds = new Map<string, string | null>();
    for (const { id, bundled } of [...(file.bundledSongs ?? []), ...(file.songs ?? []).flatMap((s) => (s.bundled === null ? [] : [{ id: s.id, bundled: s.bundled }]))]) {
      bundledIds.set(id, localBundled.get(bundled) ?? null);
    }
    /** A song id from the file as it is here; null when it is a bundled song deleted here. */
    const songIdHere = (id: string) => (bundledIds.has(id) ? bundledIds.get(id)! : id);

    const cards = tx.objectStore('cards');
    for (const raw of file.cards) {
      let incoming = raw;
      if (incoming.module === 'songs') {
        const songId = songIdHere(incoming.content.songId);
        if (songId === null) continue;
        if (songId !== incoming.content.songId) {
          incoming = { ...incoming, key: incoming.key.replace(`:${incoming.content.songId}:`, `:${songId}:`), content: { ...incoming.content, songId } };
        }
      }
      const sameKey = await cards.index('key').get(incoming.key);
      const sameId = await cards.get(incoming.id);
      const existing = sameKey ?? sameId;
      if (existing && existing.updatedAt >= incoming.updatedAt) continue;
      if (sameKey && sameKey.id !== incoming.id) await cards.delete(sameKey.id);
      if (sameId && sameId.key !== incoming.key) await cards.delete(sameId.id);
      await cards.put(incoming);
      summary.cards++;
    }

    const reviews = tx.objectStore('reviews');
    for (const incoming of file.reviews) {
      const existing = await reviews.get(incoming.id);
      if (existing && existing.updatedAt >= incoming.updatedAt) continue;
      await reviews.put(incoming);
      summary.reviews++;
    }

    const settings = tx.objectStore('settings');
    for (const incoming of file.settings) {
      const existing = await settings.index('key').get(incoming.key);
      if (existing && existing.updatedAt >= incoming.updatedAt) continue;
      if (existing) await settings.delete(existing.id);
      await settings.put({ ...incoming, value: withDefaults(incoming.value) });
      summary.settings++;
    }

    const attempts = tx.objectStore('attempts');
    for (const incoming of file.attempts ?? []) {
      const existing = await attempts.get(incoming.id);
      if (existing && existing.updatedAt >= incoming.updatedAt) continue;
      await attempts.put(incoming);
      summary.attempts++;
    }

    const decks = tx.objectStore('decks');
    for (const incoming of file.decks ?? []) {
      const existing = await decks.get(incoming.id);
      if (existing && existing.updatedAt >= incoming.updatedAt) continue;
      await decks.put(incoming);
      summary.decks++;
    }

    for (const incoming of file.songs ?? []) {
      if (incoming.bundled !== null) continue;
      const existing = await songs.get(incoming.id);
      if (existing && existing.updatedAt >= incoming.updatedAt) continue;
      await songs.put(withSongKey(incoming));
      summary.songs++;
    }

    const songProgress = tx.objectStore('songProgress');
    for (const raw of file.songProgress ?? []) {
      const songId = songIdHere(raw.songId);
      if (songId === null) continue;
      const incoming = songId === raw.songId ? raw : { ...raw, id: `${songId}:${raw.sectionId}`, songId };
      const existing = await songProgress.get(incoming.id);
      if (existing && existing.updatedAt >= incoming.updatedAt) continue;
      await songProgress.put(incoming);
      summary.songProgress++;
    }

    const merge = async <S extends (typeof STATS_STORES)[number]>(name: S, incoming: TrainerDB[S]['value']) => {
      const store = tx.objectStore(name);
      const existing = await store.get(incoming.id);
      if (existing && existing.updatedAt >= incoming.updatedAt) return;
      await store.put(incoming);
      summary.stats++;
    };
    for (const raw of file.itemStats ?? []) {
      if (raw.songId === null) {
        await merge('itemStats', raw);
        continue;
      }
      const songId = songIdHere(raw.songId);
      if (songId === null) continue;
      await merge('itemStats', songId === raw.songId ? raw : { ...raw, id: itemStatsIdForSong(raw, songId), songId });
    }
    for (const raw of file.songMeasureMisses ?? []) {
      const songId = songIdHere(raw.songId);
      if (songId === null) continue;
      await merge('songMeasureMisses', songId === raw.songId ? raw : { ...raw, id: measureMissId(songId, raw.measure), songId });
    }
    for (const raw of file.songTempoBests ?? []) {
      const songId = songIdHere(raw.songId);
      if (songId === null) continue;
      await merge('songTempoBests', songId === raw.songId ? raw : { ...raw, songId });
    }
    for (const incoming of file.dailyStats ?? []) await merge('dailyStats', incoming);
    for (const incoming of file.chordPlayCounts ?? []) await merge('chordPlayCounts', incoming);
    for (const incoming of file.confusions ?? []) await merge('confusions', incoming);
    for (const incoming of file.keyHits ?? []) await merge('keyHits', incoming);

    await tx.done;
    return summary;
  }
}

function validateExport(data: unknown): ExportFile {
  const f = data as Partial<ExportFile> | null;
  if (!f || f.app !== 'piano-trainer' || f.schemaVersion !== 1) {
    throw new Error('This file is not a Piano Trainer export.');
  }
  const hasIds = (rows: unknown) =>
    Array.isArray(rows) &&
    rows.every((r) => typeof r?.id === 'string' && typeof r?.updatedAt === 'number');
  const optional = ['attempts', 'decks', 'songs', 'songProgress', ...STATS_STORES] as const;
  if (!hasIds(f.cards) || !hasIds(f.reviews) || !hasIds(f.settings) || optional.some((name) => f[name] !== undefined && !hasIds(f[name]))) {
    throw new Error('The export file is incomplete or damaged.');
  }
  if (f.bundledSongs !== undefined && !(Array.isArray(f.bundledSongs) && f.bundledSongs.every((b) => typeof b?.id === 'string' && typeof b?.bundled === 'string'))) {
    throw new Error('The export file is incomplete or damaged.');
  }
  return f as ExportFile;
}

export const storage = new Storage();
