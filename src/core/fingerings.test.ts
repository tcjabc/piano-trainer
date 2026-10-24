import { describe, expect, it } from 'vitest';
import { voiceChord } from './chords';
import { chordFingering, scaleFingering, scaleSequenceFingering } from './fingerings';
import { scaleSequence } from './scales';

describe('scale fingerings', () => {
  it('gives the standard one-octave fingerings, both hands', () => {
    expect(scaleFingering('C', 'major', 'R', 1)).toEqual([1, 2, 3, 1, 2, 3, 4, 5]);
    expect(scaleFingering('C', 'major', 'L', 1)).toEqual([5, 4, 3, 2, 1, 3, 2, 1]);
    expect(scaleFingering('F', 'major', 'R', 1)).toEqual([1, 2, 3, 4, 1, 2, 3, 4]);
    expect(scaleFingering('Bb', 'major', 'R', 1)).toEqual([4, 1, 2, 3, 1, 2, 3, 4]);
    expect(scaleFingering('Bb', 'major', 'L', 1)).toEqual([3, 2, 1, 4, 3, 2, 1, 3]);
    expect(scaleFingering('B', 'major', 'L', 1)).toEqual([4, 3, 2, 1, 4, 3, 2, 1]);
  });

  it('shares fingerings between enharmonic keys', () => {
    expect(scaleFingering('F#', 'major', 'R', 1)).toEqual(scaleFingering('Gb', 'major', 'R', 1));
    expect(scaleFingering('D#', 'harmonic minor', 'L', 1)).toEqual([2, 1, 4, 3, 2, 1, 3, 2]);
  });

  it('covers the minor forms and modes that are the same scale', () => {
    expect(scaleFingering('F#', 'harmonic minor', 'R', 1)).toEqual([3, 4, 1, 2, 3, 1, 2, 3]);
    expect(scaleFingering('C#', 'melodic minor', 'L', 1)).toEqual([3, 2, 1, 4, 3, 2, 1, 3]);
    expect(scaleFingering('A', 'aeolian', 'R', 1)).toEqual(scaleFingering('A', 'natural minor', 'R', 1));
    expect(scaleFingering('D', 'dorian', 'R', 1)).toBeNull();
    expect(scaleFingering('C', 'blues', 'R', 1)).toBeNull();
  });

  it('extends to two octaves', () => {
    expect(scaleFingering('C', 'major', 'R', 2)).toEqual([1, 2, 3, 1, 2, 3, 4, 1, 2, 3, 1, 2, 3, 4, 5]);
    expect(scaleFingering('C', 'major', 'L', 2)).toEqual([5, 4, 3, 2, 1, 3, 2, 1, 4, 3, 2, 1, 3, 2, 1]);
    expect(scaleFingering('B', 'major', 'L', 2)).toEqual([4, 3, 2, 1, 4, 3, 2, 1, 3, 2, 1, 4, 3, 2, 1]);
  });

  it('fingers the chromatic scale and mirrors fingers coming down', () => {
    const midis = scaleSequence({ tonic: 'C', type: 'chromatic', octaves: 1 }, 'R').map((v) => v.midi);
    expect(scaleFingering('C', 'chromatic', 'R', 1, midis)).toEqual([1, 3, 1, 3, 1, 2, 3, 1, 3, 1, 3, 1, 2]);
    expect(scaleFingering('C', 'chromatic', 'L', 1, midis)).toEqual([1, 3, 1, 3, 2, 1, 3, 1, 3, 1, 3, 2, 1]);
    expect(scaleSequenceFingering([1, 2, 3], true)).toEqual([1, 2, 3, 2, 1]);
  });
});

describe('chord fingerings', () => {
  const fingers = (root: string, quality: Parameters<typeof voiceChord>[0]['quality'], inversion: number, side: 'L' | 'R') =>
    chordFingering(voiceChord({ root, quality, inversion }, side).map((v) => v.midi), side, inversion);

  it('fingers triads and their inversions', () => {
    expect(fingers('C', 'M', 0, 'R')).toEqual([1, 3, 5]);
    expect(fingers('C', 'M', 1, 'R')).toEqual([1, 2, 5]);
    expect(fingers('C', 'M', 2, 'R')).toEqual([1, 3, 5]);
    expect(fingers('C', 'M', 0, 'L')).toEqual([5, 3, 1]);
    expect(fingers('C', 'M', 1, 'L')).toEqual([5, 3, 1]);
    expect(fingers('C', 'M', 2, 'L')).toEqual([5, 2, 1]);
  });

  it('fingers seventh chords by where the second falls', () => {
    expect(fingers('C', '7', 0, 'R')).toEqual([1, 2, 3, 5]);
    expect(fingers('C', '7', 1, 'R')).toEqual([1, 2, 4, 5]); // E G B♭ C
    expect(fingers('C', '7', 2, 'R')).toEqual([1, 2, 3, 5]); // G B♭ C E
    expect(fingers('C', '7', 3, 'R')).toEqual([1, 2, 4, 5]); // B♭ C E G
    expect(fingers('C', '7', 0, 'L')).toEqual([5, 3, 2, 1]);
    expect(fingers('C', '7', 3, 'L')).toEqual([5, 4, 2, 1]);
    expect(fingers('C', '9', 0, 'R')).toEqual([1, 2, 3, 4, 5]);
  });
});
