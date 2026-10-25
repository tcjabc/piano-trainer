/**
 * What the Stats tab shows, worked out from the stored counters when it is
 * opened (nothing here runs during play). Pure functions over the records.
 *
 * - Rankings per kind: most played (plays), most practised (active time),
 *   most accurate (hits ÷ (hits + misses), only for items with at least
 *   ACCURACY_MIN_PLAYS plays or ACCURACY_MIN_NOTES notes).
 * - Affinity: time chosen to practise something, decayed with a 30-day
 *   half-life to now.
 * - Preferred key: song keys weighted by time practised, plus major and
 *   minor scales by their time.
 * - Chords: most held in Play, most missed, and what was played instead.
 * - Days: the current and longest streak of days practised, and a calendar.
 * - Per song: the most missed measures, clean-tempo progress and accuracy
 *   by hand.
 */
import { chordSymbol, pitchClass, type ChordQuality } from './chords';
import { keyNameOf, type KeyMode } from './key-finder';
import { scaleName, type ScaleType } from './scales';
import type { SongHand } from './song';
import { decayAffinity, localDate } from './stats';
import type {
  ChordPlayCountRecord,
  ConfusionRecord,
  DailyStatsRecord,
  ItemStatsRecord,
  KeyHitsRecord,
  SongMeasureMissRecord,
  SongRecord,
  SongTempoBestRecord,
  StatsKind,
} from './storage';

export const ACCURACY_MIN_PLAYS = 5;
export const ACCURACY_MIN_NOTES = 200;

export interface StatsData {
  itemStats: readonly ItemStatsRecord[];
  dailyStats: readonly DailyStatsRecord[];
  chordPlayCounts: readonly ChordPlayCountRecord[];
  confusions: readonly ConfusionRecord[];
  keyHits: KeyHitsRecord | null;
  songMeasureMisses: readonly SongMeasureMissRecord[];
  songTempoBests: readonly SongTempoBestRecord[];
  songs: readonly Pick<SongRecord, 'id' | 'title' | 'data' | 'sections'>[];
}

export interface RankedItem {
  record: ItemStatsRecord;
  name: string;
  /** What it is ranked by: plays, ms or an accuracy 0–1. */
  value: number;
}

// ── Items ──────────────────────────────────────────────────────────────

/** "Cmaj7", "D major", a song's title (null for a song that no longer exists). */
export function itemName(record: ItemStatsRecord, songs: StatsData['songs']): string | null {
  const [, a, b] = record.id.split(':');
  if (record.kind === 'chord') return chordSymbol({ root: a!, quality: b as ChordQuality, inversion: 0 });
  if (record.kind === 'scale') return scaleName({ tonic: a!, type: b as ScaleType, octaves: 1 });
  const song = songs.find((s) => s.id === record.songId);
  if (!song) return null;
  if (record.kind === 'song') return song.title;
  const section = song.sections.find((s) => s.id === b);
  return section ? `${song.title} · ${section.name}` : null;
}

export function accuracy(hits: number, misses: number): number | null {
  return hits + misses === 0 ? null : hits / (hits + misses);
}

/** Enough to say how accurate it is. */
export function accuracyQualifies(r: ItemStatsRecord): boolean {
  return r.plays >= ACCURACY_MIN_PLAYS || r.hits + r.misses >= ACCURACY_MIN_NOTES;
}

function ranked(data: StatsData, records: readonly ItemStatsRecord[], value: (r: ItemStatsRecord) => number | null, limit: number): RankedItem[] {
  const out: RankedItem[] = [];
  for (const record of records) {
    const v = value(record);
    if (v === null || v <= 0) continue;
    const name = itemName(record, data.songs);
    if (name !== null) out.push({ record, name, value: v });
  }
  return out.sort((a, b) => b.value - a.value || b.record.practiceMs - a.record.practiceMs || a.name.localeCompare(b.name)).slice(0, limit);
}

export interface Basics {
  mostPlayed: RankedItem[];
  mostPractised: RankedItem[];
  mostAccurate: RankedItem[];
}

/** The rankings for songs, chords or scales. */
export function basics(data: StatsData, kind: Exclude<StatsKind, 'section'>, limit = 5): Basics {
  const records = data.itemStats.filter((r) => r.kind === kind);
  return {
    mostPlayed: ranked(data, records, (r) => r.plays, limit),
    mostPractised: ranked(data, records, (r) => r.practiceMs, limit),
    mostAccurate: ranked(data, records, (r) => (accuracyQualifies(r) ? accuracy(r.hits, r.misses) : null), limit),
  };
}

/** A record's affinity as it stands now. */
export function affinityNow(r: ItemStatsRecord, now: number): number {
  return decayAffinity(r.affinity, r.affinityAt, now);
}

/** What the player keeps choosing to practise lately (songs, chords and scales; ms of decayed time). */
export function topAffinity(data: StatsData, now: number, limit = 5): RankedItem[] {
  const records = data.itemStats.filter((r) => r.kind !== 'section');
  // Under a second is too little to mean anything.
  return ranked(data, records, (r) => {
    const a = affinityNow(r, now);
    return a >= 1000 ? a : null;
  }, limit);
}

// ── Keys ───────────────────────────────────────────────────────────────

const SCALE_KEY_MODES: Partial<Record<ScaleType, KeyMode>> = {
  major: 'major',
  ionian: 'major',
  'natural minor': 'minor',
  'harmonic minor': 'minor',
  'melodic minor': 'minor',
  aeolian: 'minor',
};

/** "G major" etc. spelled the usual way, or null for anything else. */
function normalKey(name: string): string | null {
  const m = /^([A-G][#b]?)\s+(major|minor)$/.exec(name);
  return m ? keyNameOf(pitchClass(m[1]!), m[2] as KeyMode) : null;
}

export interface KeyWeight {
  key: string;
  ms: number;
}

/** Keys by time: songs in the key and its major or minor scales. Most practised first. */
export function preferredKeys(data: StatsData): KeyWeight[] {
  const weights = new Map<string, number>();
  const add = (key: string | null, ms: number) => {
    if (key && ms > 0) weights.set(key, (weights.get(key) ?? 0) + ms);
  };
  for (const r of data.itemStats) {
    if (r.kind === 'song') {
      const key = data.songs.find((s) => s.id === r.songId)?.data.key;
      add(key ? normalKey(key) : null, r.practiceMs);
    } else if (r.kind === 'scale') {
      const [, tonic, type] = r.id.split(':') as [string, string, ScaleType];
      const mode = SCALE_KEY_MODES[type];
      add(mode ? keyNameOf(pitchClass(tonic), mode) : null, r.practiceMs);
    }
  }
  return [...weights].map(([key, ms]) => ({ key, ms })).sort((a, b) => b.ms - a.ms || a.key.localeCompare(b.key));
}

// ── Chords ─────────────────────────────────────────────────────────────

export function favouriteChords(data: StatsData, limit = 5): { symbol: string; count: number }[] {
  return data.chordPlayCounts
    .filter((c) => c.count > 0)
    .map((c) => ({ symbol: c.id, count: c.count }))
    .sort((a, b) => b.count - a.count || a.symbol.localeCompare(b.symbol))
    .slice(0, limit);
}

/** Chords with the most misses in drills and Study. */
export function mostMistakenChords(data: StatsData, limit = 5): RankedItem[] {
  return ranked(data, data.itemStats.filter((r) => r.kind === 'chord'), (r) => r.misses, limit);
}

export interface Confusion {
  /** The chord aimed at, e.g. "Cmaj7". */
  target: string;
  played: string;
  count: number;
}

/** "Cmaj7 → C7 ×9": what was most often played instead. */
export function topConfusions(data: StatsData, limit = 5): Confusion[] {
  return data.confusions
    .filter((c) => c.count > 0)
    .map((c) => {
      const [, root, quality] = c.targetId.split(':');
      return { target: chordSymbol({ root: root!, quality: quality as ChordQuality, inversion: 0 }), played: c.playedSymbol, count: c.count };
    })
    .sort((a, b) => b.count - a.count || a.target.localeCompare(b.target))
    .slice(0, limit);
}

// ── Days ───────────────────────────────────────────────────────────────

/** A local date `days` later (or earlier), YYYY-MM-DD. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return localDate(new Date(y, m - 1, d + days).getTime());
}

const practised = (daily: readonly DailyStatsRecord[]) => new Set(daily.filter((d) => d.practiceMs > 0).map((d) => d.id));

/**
 * Days in a row with some practice. The current streak still stands today
 * when today hasn't been practised yet but yesterday was.
 */
export function streaks(daily: readonly DailyStatsRecord[], today: string): { current: number; longest: number } {
  const days = practised(daily);
  let current = 0;
  for (let d = days.has(today) ? today : addDays(today, -1); days.has(d); d = addDays(d, -1)) current++;
  let longest = 0;
  for (const day of days) {
    if (days.has(addDays(day, -1))) continue; // not the start of a run
    let length = 0;
    for (let d = day; days.has(d); d = addDays(d, 1)) length++;
    longest = Math.max(longest, length);
  }
  return { current, longest };
}

export interface CalendarDay {
  date: string;
  practiceMs: number;
  /** 0 (none) to 4 (as much as the busiest day shown). */
  level: 0 | 1 | 2 | 3 | 4;
}

/** The last `weeks` weeks to today, from a Monday, for a calendar heatmap (columns of 7). */
export function calendar(daily: readonly DailyStatsRecord[], today: string, weeks = 26): CalendarDay[] {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const weekday = (new Date(y, m - 1, d).getDay() + 6) % 7; // Monday 0
  const start = addDays(today, -weekday - 7 * (weeks - 1));
  const byDate = new Map(daily.map((r) => [r.id, r.practiceMs]));
  const days: Omit<CalendarDay, 'level'>[] = [];
  for (let date = start; date <= today; date = addDays(date, 1)) days.push({ date, practiceMs: byDate.get(date) ?? 0 });
  const max = Math.max(0, ...days.map((x) => x.practiceMs));
  return days.map((x) => ({ ...x, level: x.practiceMs <= 0 ? 0 : (Math.min(4, Math.max(1, Math.ceil((4 * x.practiceMs) / max))) as CalendarDay['level']) }));
}

// ── Keys pressed ───────────────────────────────────────────────────────

/** Each key's presses and a heat 0–1 (log scale, so a few busy keys don't wash out the rest). */
export function keyHeat(record: KeyHitsRecord | null): Map<number, { count: number; heat: number }> {
  const out = new Map<number, { count: number; heat: number }>();
  if (!record) return out;
  const max = Math.max(0, ...record.counts);
  record.counts.forEach((count, i) => {
    if (count > 0) out.set(record.low + i, { count, heat: Math.log1p(count) / Math.log1p(max) });
  });
  return out;
}

// ── Per song ───────────────────────────────────────────────────────────

export interface TroubleBar {
  /** Measure index. */
  measure: number;
  /** As printed. */
  label: string;
  misses: number;
  /** The section the measure is in, if any. */
  sectionId: string | null;
}

export interface SongDetail {
  trouble: TroubleBar[];
  /** Clean-tempo progress, oldest first: for the whole song (sectionId null) and each section that has any. */
  tempo: { sectionId: string | null; points: { at: number; tempo: number }[] }[];
  /** Accuracy 0–1 by hand (null without notes for that hand). */
  hands: Record<SongHand, number | null>;
}

export function songDetail(data: StatsData, songId: string, limit = 5): SongDetail | null {
  const song = data.songs.find((s) => s.id === songId);
  if (!song) return null;
  const trouble = data.songMeasureMisses
    .filter((m) => m.songId === songId && m.misses > 0)
    .sort((a, b) => b.misses - a.misses || a.measure - b.measure)
    .slice(0, limit)
    .map((m) => ({
      measure: m.measure,
      label: song.data.measures[m.measure]?.label ?? String(m.measure + 1),
      misses: m.misses,
      sectionId: song.sections.find((s) => m.measure >= s.start && m.measure < s.end)?.id ?? null,
    }));
  const series = new Map<string | null, { at: number; tempo: number }[]>();
  for (const t of data.songTempoBests) {
    if (t.songId !== songId) continue;
    const points = series.get(t.sectionId) ?? [];
    points.push({ at: t.at, tempo: t.bestCleanTempo });
    series.set(t.sectionId, points);
  }
  // The whole song first, then sections in order; sections merged away since are left out.
  const order = (id: string | null) => (id === null ? -1 : song.sections.findIndex((s) => s.id === id));
  const tempo = [...series]
    .filter(([id]) => id === null || order(id) >= 0)
    .sort(([a], [b]) => order(a) - order(b))
    .map(([sectionId, points]) => ({ sectionId, points: points.sort((a, b) => a.at - b.at) }));
  const record = data.itemStats.find((r) => r.kind === 'song' && r.songId === songId);
  const hand = (h: SongHand) => (record?.hands ? accuracy(record.hands[h].hits, record.hands[h].misses) : null);
  return { trouble, tempo, hands: { L: hand('L'), R: hand('R') } };
}
