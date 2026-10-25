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
