import { describe, expect, it } from 'vitest';
import { Rating } from 'ts-fsrs';
import { gradeSongPass, songPassClean } from './grading';
import { stepsOf, type SongNote } from './song';
import { TimingJudge, WaitMatcher } from './song-judge';
import { applyPass, describeStep, LEARNED, meets, newProgress, progressiveTempo, requirement, type Pass } from './song-learning';

const note = (midi: number, beat: number, hand: 'L' | 'R' = 'R'): SongNote => ({ id: `${midi}@${beat}`, midi, beat, duration: 1, hand, finger: null, velocity: 0.7 });

describe('wait mode', () => {
  // C, then a C major chord (both hands), then G.
  const steps = stepsOf([note(60, 0), note(48, 1, 'L'), note(64, 1), note(67, 1), note(67, 2)]);

  it('groups notes that start together into one step', () => {
    expect(steps.map((s) => s.notes.map((n) => n.midi))).toEqual([[60], [48, 64, 67], [67]]);
  });

  it('advances only on the right notes; a chord in any order', () => {
    const m = new WaitMatcher(steps);
    expect(m.press(62)).toBe('wrong');
    expect(m.stepIndex).toBe(0);
    expect(m.press(60)).toBe('step');
    expect(m.press(67)).toBe('hit');
    expect(m.press(67)).toBe('again');
    expect(m.remaining().sort()).toEqual([48, 64]);
    expect(m.press(48)).toBe('hit');
    expect(m.press(64)).toBe('step');
    expect(m.press(67)).toBe('done');
    expect(m.done).toBe(true);
    expect(m.correct).toBe(5);
    expect(m.wrong).toBe(1);
    expect(m.accuracy).toBeCloseTo(5 / 6);
  });
});

describe('play-along timing', () => {
  const expected = [
    { id: 'a', midi: 60, time: 1 },
    { id: 'b', midi: 62, time: 1.5 },
    { id: 'c', midi: 64, time: 2 },
    { id: 'd', midi: 60, time: 2.5 },
  ];

  it('marks presses on time, early or late, and wrong outside the window', () => {
    const j = new TimingJudge(expected, { onTimeMs: 100, hitWindowMs: 250 });
    expect(j.press(60, 1.05)).toMatchObject({ timing: 'on-time', note: { id: 'a' } });
    expect(j.press(62, 1.32)).toMatchObject({ timing: 'early', note: { id: 'b' } });
    expect(j.press(64, 2.2)).toMatchObject({ timing: 'late', note: { id: 'c' } });
    expect(j.press(65, 2.2)).toBeNull(); // not in the song
    expect(j.press(60, 2.0)).toBeNull(); // 'a' already played, 'd' still 500 ms away
    expect(j.sweep(2.6)).toEqual([]);
    expect(j.sweep(2.8).map((n) => n.id)).toEqual(['d']);
    expect(j.sweep(3)).toEqual([]); // reported once
    expect(j.summary()).toMatchObject({ notes: 4, hits: 3, onTime: 1, early: 1, late: 1, missed: 1, wrong: 2 });
    expect(j.summary().accuracy).toBeCloseTo(3 / 6);
    expect(j.summary().onTimeShare).toBeCloseTo(1 / 4);
  });

  it('matches the nearest unplayed note of the same key', () => {
    const j = new TimingJudge([{ id: 'x', midi: 60, time: 1 }, { id: 'y', midi: 60, time: 1.2 }], { onTimeMs: 50, hitWindowMs: 250 });
    expect(j.press(60, 1.15)?.note.id).toBe('y');
    expect(j.press(60, 1.15)?.note.id).toBe('x');
  });
});

describe('clean passes and grades', () => {
  it('needs accuracy, and timing in play-along', () => {
    expect(songPassClean({ mode: 'wait', accuracy: 0.96, onTime: null })).toBe(true);
    expect(songPassClean({ mode: 'wait', accuracy: 0.9, onTime: null })).toBe(false);
    expect(songPassClean({ mode: 'play-along', accuracy: 1, onTime: 0.8 })).toBe(false);
    expect(gradeSongPass({ mode: 'wait', accuracy: 0.7, onTime: null })).toBe(Rating.Again);
    expect(gradeSongPass({ mode: 'wait', accuracy: 0.9, onTime: null })).toBe(Rating.Hard);
    expect(gradeSongPass({ mode: 'wait', accuracy: 0.97, onTime: null })).toBe(Rating.Good);
    expect(gradeSongPass({ mode: 'wait', accuracy: 1, onTime: null })).toBe(Rating.Easy);
    expect(gradeSongPass({ mode: 'play-along', accuracy: 1, onTime: 0.97 })).toBe(Rating.Easy);
  });
});

describe('learning path', () => {
  const pass = (p: Partial<Pass>): Pass => ({ mode: 'wait', hands: 'right', tempo: 0.6, accuracy: 1, onTime: null, at: 1, ...p });

  it('moves on after two clean passes in a row at the step', () => {
    let p = newProgress();
    expect(requirement(p)).toEqual({ hands: 'right', mode: 'wait', tempo: 0.6 });
    p = applyPass(p, pass({}));
    expect([p.step, p.streak]).toEqual([0, 1]);
    p = applyPass(p, pass({ accuracy: 0.8 }));
    expect([p.step, p.streak]).toEqual([0, 0]);
    p = applyPass(applyPass(p, pass({})), pass({}));
    expect([p.step, p.streak]).toEqual([1, 0]);
    expect(describeStep(p)).toBe('Left hand, slow · wait mode at 60% · 0 of 2 clean passes');
  });

  it('only counts passes that meet the step', () => {
    const req = requirement(newProgress());
    expect(meets(pass({ hands: 'left' }), req)).toBe(false);
    expect(meets(pass({ tempo: 0.5 }), req)).toBe(false);
    expect(meets(pass({ mode: 'play-along', onTime: 1, tempo: 0.8 }), req)).toBe(true);
    const p = applyPass(newProgress(), pass({ hands: 'both' }));
    expect(p.streak).toBe(0);
    expect(p.passes).toBe(1);
  });

  it('raises the tempo by 5% after each clean pass, then finishes at 100%', () => {
    expect(progressiveTempo(0.6, true)).toBe(0.65);
    expect(progressiveTempo(0.6, false)).toBe(0.6);
    expect(progressiveTempo(0.98, true)).toBe(1);
    expect(progressiveTempo(1, true)).toBe(1);
    let p = { ...newProgress(), step: 3 };
    expect(requirement(p)).toEqual({ hands: 'both', mode: 'play-along', tempo: 0.6 });
    p = applyPass(p, pass({ mode: 'play-along', hands: 'both', onTime: 0.95 }));
    expect(p.speedTempo).toBe(0.65);
    p = applyPass(p, pass({ mode: 'play-along', hands: 'both', tempo: 0.65, onTime: 0.5 }));
    expect(p.speedTempo).toBe(0.65);
    p = applyPass(p, pass({ mode: 'play-along', hands: 'both', tempo: 1, onTime: 1 }));
    expect(p.step).toBe(LEARNED);
    expect(p.bestTempo).toBe(1);
    expect(describeStep(p)).toBe('Learned');
  });
});
