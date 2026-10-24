/**
 * The only module that touches IndexedDB. Every record carries a UUID `id`
 * and an `updatedAt` timestamp (epoch ms) so a sync layer can be added later.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Clef } from './pitch';
import { withDefaults, type Settings } from './settings';

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

export interface CardRecord {
  id: string;
  /** Unique, human-readable identity, e.g. "notes:treble:C#4". */
  key: string;
  module: 'notes';
  content: NoteCardContent;
  fsrs: StoredFsrs;
  createdAt: number;
  updatedAt: number;
}

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

export interface ExportFile {
  app: 'piano-trainer';
  schemaVersion: 1;
  exportedAt: string;
  cards: CardRecord[];
  reviews: ReviewRecord[];
  settings: SettingsRecord[];
}

export interface ImportSummary {
  cards: number;
  reviews: number;
  settings: number;
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
}

export function uuid(): string {
  return crypto.randomUUID();
}

export class Storage {
  private dbPromise: Promise<IDBPDatabase<TrainerDB>> | null = null;

  constructor(private readonly name = 'piano-trainer') {}

  private db(): Promise<IDBPDatabase<TrainerDB>> {
    this.dbPromise ??= openDB<TrainerDB>(this.name, 1, {
      upgrade(db) {
        const cards = db.createObjectStore('cards', { keyPath: 'id' });
        cards.createIndex('key', 'key', { unique: true });
        cards.createIndex('module', 'module');
        const reviews = db.createObjectStore('reviews', { keyPath: 'id' });
        reviews.createIndex('cardId', 'cardId');
        reviews.createIndex('reviewedAt', 'reviewedAt');
        const settings = db.createObjectStore('settings', { keyPath: 'id' });
        settings.createIndex('key', 'key', { unique: true });
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

  async getCards(module: CardRecord['module']): Promise<CardRecord[]> {
    return (await this.db()).getAllFromIndex('cards', 'module', module);
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
    return {
      app: 'piano-trainer',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      cards: await db.getAll('cards'),
      reviews: await db.getAll('reviews'),
      settings: await db.getAll('settings'),
    };
  }

  /**
   * Merge an export into the database. Records are matched by `id` (and
   * cards/settings also by their unique `key`); the newer `updatedAt` wins.
   */
  async importAll(data: unknown): Promise<ImportSummary> {
    const file = validateExport(data);
    const db = await this.db();
    const tx = db.transaction(['cards', 'reviews', 'settings'], 'readwrite');
    const summary: ImportSummary = { cards: 0, reviews: 0, settings: 0 };

    const cards = tx.objectStore('cards');
    for (const incoming of file.cards) {
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
  if (!hasIds(f.cards) || !hasIds(f.reviews) || !hasIds(f.settings)) {
    throw new Error('The export file is incomplete or damaged.');
  }
  return f as ExportFile;
}

export const storage = new Storage();
