import { describe, expect, it } from 'vitest';
import type { ItemRef } from '../../core/stats';
import type { SongData, SongHand } from '../../core/song';
import type { Mark, PassReport } from './song-player';
import { recordMark, recordPass, songStatsRefs, type SongStatsSink } from './song-stats';

/** Two 4/4 bars: right hand C D in bar 1, left hand C in bar 2. */
const data: SongData = {
  notes: [
    { id: 'n0', midi: 60, beat: 0, duration: 1, hand: 'R', finger: null, velocity: 0.7 },
    { id: 'n1', midi: 62, beat: 1, duration: 1, hand: 'R', finger: null, velocity: 0.7 },
    { id: 'n2', midi: 48, beat: 4, duration: 4, hand: 'L', finger: null, velocity: 0.7 },
  ],
  measures: [
    { label: '1', beat: 0, length: 4 },
    { label: '2', beat: 4, length: 4 },
  ],
  tempos: [],
  timeSignature: [4, 4],
  key: 'C major',
};

function sink() {
  const results: [string, boolean, SongHand | undefined][] = [];
  const misses: [string, number][] = [];
  const tempos: [string, string | null, number][] = [];
  let completed = 0;
  const s: SongStatsSink = {
    result: (ref: ItemRef, correct: boolean, hand?: SongHand) => void results.push([ref.id, correct, hand]),
    measureMiss: (songId, measure) => void misses.push([songId, measure]),
    completed: () => void completed++,
    cleanPass: (songId, sectionId, tempo) => void tempos.push([songId, sectionId, tempo]),
  };
  return { s, results, misses, tempos, completed: () => completed };
}

const mark = (kind: Mark['kind'], noteId?: string): Mark => ({ kind, midi: 60, noteId, at: 0 });
const refs = songStatsRefs('s1', 's0');

describe('song stats', () => {
  it('counts judged notes for the song and section, by hand, and misses by measure', () => {
    const { s, results, misses } = sink();
    recordMark(s, data, 's1', refs, mark('on-time', 'n0'), 0);
    recordMark(s, data, 's1', refs, mark('late', 'n1'), 1);
    recordMark(s, data, 's1', refs, mark('missed', 'n2'), 5);
    expect(results).toEqual([
      ['song:s1', true, 'R'], ['section:s1:s0', true, 'R'],
      ['song:s1', true, 'R'], ['section:s1:s0', true, 'R'],
      ['song:s1', false, 'L'], ['section:s1:s0', false, 'L'],
    ]);
    expect(misses).toEqual([['s1', 1]]);
  });

  it('counts a wrong key against the measure being played, but not a hand', () => {
    const { s, results, misses } = sink();
    recordMark(s, data, 's1', songStatsRefs('s1', null), mark('wrong'), 2.5);
    recordMark(s, data, 's1', songStatsRefs('s1', null), mark('wrong'), 6);
    expect(results).toEqual([['song:s1', false, undefined], ['song:s1', false, undefined]]);
    expect(misses).toEqual([['s1', 0], ['s1', 1]]);
  });

  it('keeps only clean, hands-together, play-along passes over a whole section or song as tempos', () => {
    const pass = (p: Partial<PassReport>): PassReport => ({
      mode: 'play-along', accuracy: 1, onTime: 1, hands: 'both', tempo: 0.8, at: 0, range: [0, 8], timing: null, wrong: 0, clean: true, ...p,
    });
    const { s, tempos, completed } = sink();
    recordPass(s, 's1', 's0', false, pass({}));
    recordPass(s, 's1', null, false, pass({ tempo: 1 }));
    recordPass(s, 's1', 's0', false, pass({ clean: false }));
    recordPass(s, 's1', 's0', false, pass({ hands: 'right' }));
    recordPass(s, 's1', 's0', false, pass({ mode: 'wait' }));
    recordPass(s, 's1', 's0', true, pass({}));
    expect(tempos).toEqual([['s1', 's0', 0.8], ['s1', null, 1]]);
    expect(completed()).toBe(6);
  });
});
