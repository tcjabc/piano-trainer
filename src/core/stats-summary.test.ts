import { describe, expect, it } from 'vitest';
import { AFFINITY_HALF_LIFE_MS, newItemStats } from './stats';
import {
  accuracyQualifies,
  addDays,
  basics,
  calendar,
  favouriteChords,
  keyHeat,
  mostMistakenChords,
  preferredKeys,
  songDetail,
  streaks,
  topAffinity,
  topConfusions,
  type StatsData,
} from './stats-summary';
import type { ItemStatsRecord, SongRecord } from './storage';

const NOW = new Date(2026, 9, 26, 12).getTime();

const item = (id: string, kind: ItemStatsRecord['kind'], patch: Partial<ItemStatsRecord> = {}, songId: string | null = null): ItemStatsRecord => ({
  ...newItemStats(id, kind, songId, NOW),
  ...patch,
});

const song = (id: string, title: string, key: string | null): StatsData['songs'][number] => ({
  id,
  title,
  data: { notes: [], measures: [{ label: '0', beat: 0, length: 1 }, { label: '1', beat: 1, length: 4 }, { label: '2', beat: 5, length: 4 }, { label: '3', beat: 9, length: 4 }], tempos: [], timeSignature: [4, 4], key },
  sections: [{ id: 's0', name: 'Bars 0–1', start: 0, end: 2 }, { id: 's2', name: 'Bars 2–3', start: 2, end: 4 }] as SongRecord['sections'],
});

const data = (patch: Partial<StatsData>): StatsData => ({
  itemStats: [],
  dailyStats: [],
  chordPlayCounts: [],
  confusions: [],
  keyHits: null,
  songMeasureMisses: [],
  songTempoBests: [],
  songs: [],
  ...patch,
});

describe('rankings', () => {
  it('ranks by plays and by time, naming chords, scales and songs', () => {
    const d = data({
      songs: [song('a', 'Ode to Joy', 'C major')],
      itemStats: [
        item('chord:C:maj7', 'chord', { plays: 3, practiceMs: 9000 }),
        item('chord:F#:m7', 'chord', { plays: 7, practiceMs: 1000 }),
        item('chord:G:M', 'chord'),
        item('scale:D:major', 'scale', { plays: 2 }),
        item('song:a', 'song', { plays: 4, practiceMs: 60_000 }, 'a'),
        item('song:gone', 'song', { plays: 99 }, 'gone'), // deleted song
      ],
    });
    const chords = basics(d, 'chord');
    expect(chords.mostPlayed.map((r) => [r.name, r.value])).toEqual([['F#m7', 7], ['Cmaj7', 3]]);
    expect(chords.mostPractised.map((r) => r.name)).toEqual(['Cmaj7', 'F#m7']);
    expect(basics(d, 'scale').mostPlayed.map((r) => r.name)).toEqual(['D major']);
    expect(basics(d, 'song').mostPlayed.map((r) => r.name)).toEqual(['Ode to Joy']);
  });

  it('only ranks accuracy with 5 plays or 200 notes', () => {
    expect(accuracyQualifies(item('x', 'chord', { plays: 4, hits: 150, misses: 49 }))).toBe(false);
    expect(accuracyQualifies(item('x', 'chord', { plays: 5, hits: 1, misses: 0 }))).toBe(true);
    expect(accuracyQualifies(item('x', 'chord', { plays: 0, hits: 150, misses: 50 }))).toBe(true);
    const d = data({
      itemStats: [
        item('scale:C:major', 'scale', { plays: 6, hits: 90, misses: 10 }),
        item('scale:G:major', 'scale', { plays: 1, hits: 300, misses: 0 }),
        item('scale:F:major', 'scale', { plays: 2, hits: 10, misses: 0 }), // too little
      ],
    });
    expect(basics(d, 'scale').mostAccurate.map((r) => [r.name, r.value])).toEqual([['G major', 1], ['C major', 0.9]]);
  });

  it('ranks affinity by chosen time decayed to now', () => {
    const d = data({
      itemStats: [
        // An hour two months ago is a quarter of an hour now; 20 minutes this morning beats it.
        item('chord:C:M', 'chord', { affinity: 3_600_000, affinityAt: NOW - 2 * AFFINITY_HALF_LIFE_MS }),
        item('chord:D:m', 'chord', { affinity: 1_200_000, affinityAt: NOW }),
        item('chord:E:m', 'chord', { affinity: 500, affinityAt: NOW }),
      ],
    });
    const top = topAffinity(d, NOW);
    expect(top.map((r) => r.name)).toEqual(['Dm', 'C']);
    expect(top[1]!.value).toBeCloseTo(900_000);
  });
});

describe('preferred key', () => {
  it('weights song keys by time, adds major and minor scales, and spells keys one way', () => {
    const d = data({
      songs: [song('a', 'A', 'G major'), song('b', 'B', 'Eb minor'), song('c', 'C', null)],
      itemStats: [
        item('song:a', 'song', { practiceMs: 50_000 }, 'a'),
        item('song:b', 'song', { practiceMs: 30_000 }, 'b'),
        item('song:c', 'song', { practiceMs: 99_000 }, 'c'),
        item('scale:D#:harmonic minor', 'scale', { practiceMs: 40_000 }),
        item('scale:G:major', 'scale', { practiceMs: 5_000 }),
        item('scale:D:dorian', 'scale', { practiceMs: 90_000 }), // a mode, not a key
      ],
    });
    expect(preferredKeys(d)).toEqual([{ key: 'Eb minor', ms: 70_000 }, { key: 'G major', ms: 55_000 }]);
  });
});

describe('chords', () => {
  it('finds the favourite, the most missed and the top confusions', () => {
    const d = data({
      chordPlayCounts: [{ id: 'Am7', count: 12, updatedAt: NOW }, { id: 'C', count: 30, updatedAt: NOW }],
      itemStats: [item('chord:C:maj7', 'chord', { misses: 9 }), item('chord:D:m7', 'chord', { misses: 2 }), item('chord:E:M', 'chord')],
      confusions: [
        { id: 'chord:C:maj7>C7', targetId: 'chord:C:maj7', playedSymbol: 'C7', count: 9, updatedAt: NOW },
        { id: 'chord:D:m7>Dm', targetId: 'chord:D:m7', playedSymbol: 'Dm', count: 2, updatedAt: NOW },
      ],
    });
    expect(favouriteChords(d)[0]).toEqual({ symbol: 'C', count: 30 });
    expect(mostMistakenChords(d).map((r) => [r.name, r.value])).toEqual([['Cmaj7', 9], ['Dm7', 2]]);
    expect(topConfusions(d)).toEqual([{ target: 'Cmaj7', played: 'C7', count: 9 }, { target: 'Dm7', played: 'Dm', count: 2 }]);
  });
});

describe('days', () => {
  const day = (id: string, practiceMs = 60_000) => ({ id, practiceMs, notesPlayed: 10, updatedAt: NOW });

  it('adds days across months and years', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('counts streaks, keeping yesterday’s alive until today is over', () => {
    const daily = [day('2026-10-20'), day('2026-10-21'), day('2026-10-22'), day('2026-10-24'), day('2026-10-25'), day('2026-10-23', 0)];
    expect(streaks(daily, '2026-10-26')).toEqual({ current: 2, longest: 3 });
    expect(streaks([...daily, day('2026-10-26')], '2026-10-26')).toEqual({ current: 3, longest: 3 });
    expect(streaks(daily, '2026-10-27')).toEqual({ current: 0, longest: 3 });
    expect(streaks([], '2026-10-26')).toEqual({ current: 0, longest: 0 });
  });

  it('lays out whole weeks from a Monday to today, with levels against the busiest day', () => {
    // 2026-10-26 is a Monday.
    const days = calendar([day('2026-10-26', 100), day('2026-10-20', 400), day('2026-10-21', 40)], '2026-10-26', 2);
    expect(days[0]!.date).toBe('2026-10-19');
    expect(days).toHaveLength(8);
    expect(days.map((d) => d.level)).toEqual([0, 4, 1, 0, 0, 0, 0, 1]);
  });
});

describe('keys and songs', () => {
  it('turns key presses into heat on a log scale', () => {
    const counts = new Array<number>(88).fill(0);
    counts[60 - 21] = 999;
    counts[62 - 21] = 9;
    const heat = keyHeat({ id: 'lifetime', low: 21, counts, updatedAt: NOW });
    expect(heat.get(60)?.heat).toBe(1);
    expect(heat.get(62)?.heat).toBeCloseTo(1 / 3);
    expect(heat.has(64)).toBe(false);
    expect(keyHeat(null).size).toBe(0);
  });

  it('gives a song’s trouble bars, tempo progress and accuracy by hand', () => {
    const hands = { L: { hits: 30, misses: 10 }, R: { hits: 0, misses: 0 } };
    const d = data({
      songs: [song('a', 'A', null)],
      itemStats: [item('song:a', 'song', { hands }, 'a')],
      songMeasureMisses: [
        { id: 'a:1', songId: 'a', measure: 1, misses: 3, updatedAt: NOW },
        { id: 'a:3', songId: 'a', measure: 3, misses: 8, updatedAt: NOW },
        { id: 'b:0', songId: 'b', measure: 0, misses: 50, updatedAt: NOW },
      ],
      songTempoBests: [
        { id: '1', songId: 'a', sectionId: 's2', bestCleanTempo: 0.8, at: 3, updatedAt: NOW },
        { id: '2', songId: 'a', sectionId: 's2', bestCleanTempo: 0.6, at: 1, updatedAt: NOW },
        { id: '3', songId: 'a', sectionId: null, bestCleanTempo: 0.5, at: 2, updatedAt: NOW },
        { id: '4', songId: 'a', sectionId: 'merged-away', bestCleanTempo: 0.9, at: 2, updatedAt: NOW },
      ],
    });
    const detail = songDetail(d, 'a')!;
    expect(detail.trouble).toEqual([
      { measure: 3, label: '3', misses: 8, sectionId: 's2' },
      { measure: 1, label: '1', misses: 3, sectionId: 's0' },
    ]);
    expect(detail.tempo).toEqual([
      { sectionId: null, points: [{ at: 2, tempo: 0.5 }] },
      { sectionId: 's2', points: [{ at: 1, tempo: 0.6 }, { at: 3, tempo: 0.8 }] },
    ]);
    expect(detail.hands).toEqual({ L: 0.75, R: null });
    expect(songDetail(d, 'gone')).toBeNull();
  });
});
