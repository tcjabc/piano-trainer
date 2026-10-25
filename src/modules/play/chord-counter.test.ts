import { describe, expect, it } from 'vitest';
import { CHORD_HOLD_MS, ChordCounter } from './chord-counter';

const C = [60, 64, 67];
const C_DOUBLED = [48, 60, 64, 67];
const F = [60, 65, 69];
const CMAJ7 = [60, 64, 67, 71];

/** Hold each set of keys from its time; returns the chords counted. */
function play(steps: [number, number[]][], end?: number): string[] {
  const counter = new ChordCounter();
  const counted: string[] = [];
  for (const [time, held] of steps) {
    const chord = counter.update(held, time);
    if (chord) counted.push(chord);
  }
  if (end !== undefined) {
    const chord = counter.finish(end);
    if (chord) counted.push(chord);
  }
  return counted;
}

describe('chord counting in Play', () => {
  it('counts a chord held for 300 ms, not one held shorter', () => {
    expect(play([[0, C], [CHORD_HOLD_MS, []]])).toEqual(['C']);
    expect(play([[0, C], [CHORD_HOLD_MS - 1, []]])).toEqual([]);
  });

  it('counts a chord held on once, through doubled and dropped notes', () => {
    expect(play([[0, C], [500, C_DOUBLED], [900, C], [1400, []]])).toEqual(['C']);
  });

  it('ignores the notes on the way to a chord', () => {
    // C then E then G, a few ms apart: only the C major triad is a chord (and the 4th note makes Cmaj7).
    expect(play([[0, [60]], [20, [60, 64]], [40, C], [60, CMAJ7], [1000, []]])).toEqual(['Cmaj7']);
  });

  it('counts the same chord again only after a release', () => {
    // Let go and play it again.
    expect(play([[0, C], [400, []], [500, C], [900, []]])).toEqual(['C', 'C']);
    // Revoiced through a passing C for a moment: still one Cmaj7.
    expect(play([[0, CMAJ7], [500, C], [550, CMAJ7], [1200, []]])).toEqual(['Cmaj7']);
    // Something without a chord held long enough is a release too.
    expect(play([[0, C], [400, [60, 64]], [800, C], [1200, []]])).toEqual(['C', 'C']);
  });

  it('counts every chord of a legato progression', () => {
    expect(play([[0, C], [500, F], [1000, C], [1500, []]])).toEqual(['C', 'F', 'C']);
  });

  it('counts chords by name, so a change of inversion is the same chord', () => {
    expect(play([[0, C], [500, [64, 67, 72]], [1000, []]])).toEqual(['C']);
  });

  it('counts the chord still held when Play is left', () => {
    expect(play([[0, C]], 400)).toEqual(['C']);
    expect(play([[0, C]], 100)).toEqual([]);
  });
});
