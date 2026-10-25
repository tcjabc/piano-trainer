/**
 * Practice statistics: running counters only, never a log of notes. Item ids
 * and empty records, and the one-off backfill from review history. Chords
 * count by name (root + quality, any inversion or hand) and scales by tonic
 * + type, so "Cmaj7" is one item however it was practised. UI-agnostic.
 */
import type { ChordQuality } from './chords';
import type { ScaleType } from './scales';
import type { CardRecord, ItemStatsRecord, ReviewRecord, StatsKind } from './storage';

export const chordStatsId = (root: string, quality: ChordQuality) => `chord:${root}:${quality}`;
export const scaleStatsId = (tonic: string, type: ScaleType) => `scale:${tonic}:${type}`;
export const songStatsId = (songId: string) => `song:${songId}`;
export const sectionStatsId = (songId: string, sectionId: string) => `section:${songId}:${sectionId}`;
export const confusionId = (targetId: string, playedSymbol: string) => `${targetId}>${playedSymbol}`;
export const measureMissId = (songId: string, measure: number) => `${songId}:${measure}`;

/** The same item id for another copy of its song (bundled songs have an id per device). */
export function itemStatsIdForSong(record: ItemStatsRecord, songId: string): string {
  if (record.kind === 'song') return songStatsId(songId);
  return sectionStatsId(songId, record.id.slice(`section:${record.songId}:`.length));
}

/** Lowest key with a counter (A0); one counter per key of an 88-key piano. */
export const KEY_HITS_LOW = 21;
export const KEY_HITS_COUNT = 88;

/** Local calendar date, YYYY-MM-DD (days start at local midnight). */
export function localDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function newItemStats(id: string, kind: StatsKind, songId: string | null, now: number): ItemStatsRecord {
  const record: ItemStatsRecord = {
    id,
    kind,
    songId,
    plays: 0,
    practiceMs: 0,
    voluntaryMs: 0,
    affinity: 0,
    affinityAt: now,
    hits: 0,
    misses: 0,
    lastPlayed: null,
    updatedAt: now,
  };
  if (kind === 'song' || kind === 'section') record.hands = { L: { hits: 0, misses: 0 }, R: { hits: 0, misses: 0 } };
  return record;
}

/** The stats item a chord or scale card belongs to (null for other cards). */
export function cardStatsId(card: CardRecord): string | null {
  if (card.module === 'chords') return chordStatsId(card.content.root, card.content.quality);
  if (card.module === 'scales') return scaleStatsId(card.content.tonic, card.content.type);
  return null;
}

/**
 * Hits and misses for chords and scales from their review history: a review
 * rated Again is a miss, any other rating a hit. Nothing else is backfilled.
 */
export function backfillItemStats(cards: readonly CardRecord[], reviews: readonly ReviewRecord[], now: number): ItemStatsRecord[] {
  const itemOf = new Map(cards.flatMap((c) => {
    const id = cardStatsId(c);
    return id ? [[c.id, { id, kind: c.module === 'chords' ? ('chord' as const) : ('scale' as const) }]] : [];
  }));
  const stats = new Map<string, ItemStatsRecord>();
  for (const review of reviews) {
    const item = itemOf.get(review.cardId);
    if (!item) continue;
    let record = stats.get(item.id);
    if (!record) stats.set(item.id, (record = newItemStats(item.id, item.kind, null, now)));
    if (review.rating === 1) record.misses++;
    else record.hits++;
  }
  return [...stats.values()];
}

// ── Affinity ───────────────────────────────────────────────────────────

/** Time chosen to practise something counts half as much after this long. */
export const AFFINITY_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;

/** A decayed value as it stands `to`, given its value at `from`. */
export function decayAffinity(value: number, from: number, to: number, halfLifeMs = AFFINITY_HALF_LIFE_MS): number {
  return value * 2 ** (-Math.max(0, to - from) / halfLifeMs);
}

// ── Pending changes ────────────────────────────────────────────────────

/** Something practised that has an itemStats record. */
export interface ItemRef {
  id: string;
  kind: StatsKind;
  songId: string | null;
}

export interface HandCounts {
  hits: number;
  misses: number;
}

/** Increments for one item since the last save. */
export interface ItemDelta {
  ref: ItemRef;
  plays: number;
  practiceMs: number;
  voluntaryMs: number;
  hits: number;
  misses: number;
  hands: { L: HandCounts; R: HandCounts };
  lastPlayed: number | null;
}

/** Everything counted since the last save, applied to storage in one transaction. */
export interface StatsDelta {
  items: Map<string, ItemDelta>;
  /** By local date. */
  daily: Map<string, { practiceMs: number; notesPlayed: number }>;
  /** By chord symbol. */
  chordPlays: Map<string, number>;
  /** By confusion id. */
  confusions: Map<string, { targetId: string; playedSymbol: string; count: number }>;
  /** By MIDI note. */
  keyHits: Map<number, number>;
  /** By measure-miss id. */
  measureMisses: Map<string, { songId: string; measure: number; misses: number }>;
  /** Clean passes and their tempo; storage keeps the ones that beat the best so far. */
  cleanTempos: { songId: string; sectionId: string | null; tempo: number; at: number }[];
}

export function emptyDelta(): StatsDelta {
  return { items: new Map(), daily: new Map(), chordPlays: new Map(), confusions: new Map(), keyHits: new Map(), measureMisses: new Map(), cleanTempos: [] };
}

export function isEmptyDelta(d: StatsDelta): boolean {
  return d.items.size + d.daily.size + d.chordPlays.size + d.confusions.size + d.keyHits.size + d.measureMisses.size + d.cleanTempos.length === 0;
}

export function itemDelta(d: StatsDelta, ref: ItemRef): ItemDelta {
  let item = d.items.get(ref.id);
  if (!item) {
    item = { ref, plays: 0, practiceMs: 0, voluntaryMs: 0, hits: 0, misses: 0, hands: { L: { hits: 0, misses: 0 }, R: { hits: 0, misses: 0 } }, lastPlayed: null };
    d.items.set(ref.id, item);
  }
  return item;
}

export function dailyDelta(d: StatsDelta, date: string): { practiceMs: number; notesPlayed: number } {
  let day = d.daily.get(date);
  if (!day) d.daily.set(date, (day = { practiceMs: 0, notesPlayed: 0 }));
  return day;
}

/** Add to a counter in a map. */
export const bumpCount = <K>(map: Map<K, number>, key: K, by = 1) => map.set(key, (map.get(key) ?? 0) + by);

/** Add `from` into `into` (to keep counts whose save failed). */
export function mergeDelta(into: StatsDelta, from: StatsDelta): void {
  for (const f of from.items.values()) {
    const t = itemDelta(into, f.ref);
    t.plays += f.plays;
    t.practiceMs += f.practiceMs;
    t.voluntaryMs += f.voluntaryMs;
    t.hits += f.hits;
    t.misses += f.misses;
    for (const hand of ['L', 'R'] as const) {
      t.hands[hand].hits += f.hands[hand].hits;
      t.hands[hand].misses += f.hands[hand].misses;
    }
    t.lastPlayed = Math.max(t.lastPlayed ?? 0, f.lastPlayed ?? 0) || null;
  }
  for (const [date, f] of from.daily) {
    const t = dailyDelta(into, date);
    t.practiceMs += f.practiceMs;
    t.notesPlayed += f.notesPlayed;
  }
  for (const [symbol, n] of from.chordPlays) bumpCount(into.chordPlays, symbol, n);
  for (const [id, f] of from.confusions) {
    const t = into.confusions.get(id);
    if (t) t.count += f.count;
    else into.confusions.set(id, { ...f });
  }
  for (const [midi, n] of from.keyHits) bumpCount(into.keyHits, midi, n);
  for (const [id, f] of from.measureMisses) {
    const t = into.measureMisses.get(id);
    if (t) t.misses += f.misses;
    else into.measureMisses.set(id, { ...f });
  }
  into.cleanTempos.push(...from.cleanTempos);
}
