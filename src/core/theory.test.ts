import { describe, expect, it } from 'vitest';
import { chordFormula, chordName, chordNotes, chordSymbol, voiceChord } from './chords';
import { scaleFormula, scaleNotes, scaleSequence } from './scales';

describe('chord spelling', () => {
  it('spells every chord from its root', () => {
    expect(chordNotes('F#', 'M')).toEqual(['F#', 'A#', 'C#']);
    expect(chordNotes('Gb', 'maj7')).toEqual(['Gb', 'Bb', 'Db', 'F']);
    expect(chordNotes('D#', 'dim7')).toEqual(['D#', 'F#', 'A', 'C']);
    expect(chordNotes('Bb', 'add9')).toEqual(['Bb', 'D', 'F', 'C']);
    expect(chordNotes('E', 'aug')).toEqual(['E', 'G#', 'B#']);
  });

  it('names symbols, inversions and formulas', () => {
    expect(chordSymbol({ root: 'Bb', quality: 'maj7', inversion: 1 })).toBe('Bbmaj7/D');
    expect(chordName({ root: 'C#', quality: 'm', inversion: 2 })).toBe('C# minor, 2nd inversion');
    expect(chordFormula('m7b5')).toEqual(['1', 'b3', 'b5', 'b7']);
    expect(chordFormula('dim7')).toEqual(['1', 'b3', 'b5', 'bb7']);
  });

  it('voices inversions close and ascending for each hand', () => {
    expect(voiceChord({ root: 'C', quality: 'M', inversion: 1 }, 'R').map((v) => v.spelling)).toEqual(['E4', 'G4', 'C5']);
    expect(voiceChord({ root: 'B', quality: 'M', inversion: 0 }, 'L').map((v) => v.spelling)).toEqual(['B3', 'D#4', 'F#4']);
    // B#3 is the same key as C4, so it is the lowest note at or above middle C.
    expect(voiceChord({ root: 'E', quality: 'aug', inversion: 2 }, 'R').map((v) => `${v.spelling}=${v.midi}`)).toEqual([
      'B#3=60',
      'E4=64',
      'G#4=68',
    ]);
  });
});

describe('scale spelling', () => {
  it('uses key spelling, with the blues and chromatic fixes', () => {
    expect(scaleNotes('F#', 'major')).toEqual(['F#', 'G#', 'A#', 'B', 'C#', 'D#', 'E#']);
    expect(scaleNotes('Eb', 'blues')).toEqual(['Eb', 'Gb', 'Ab', 'A', 'Bb', 'Db']);
    expect(scaleNotes('Eb', 'chromatic')).toEqual(['Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B', 'C', 'Db', 'D']);
    expect(scaleFormula('D', 'dorian')).toEqual(['1', '2', 'b3', '4', '5', '6', 'b7']);
  });

  it('plays one or two octaves, up or up-and-down; melodic minor comes down natural', () => {
    expect(scaleSequence({ tonic: 'C', type: 'major', octaves: 2 }, 'R').map((v) => v.midi)).toHaveLength(15);
    const melodic = scaleSequence({ tonic: 'A', type: 'melodic minor', octaves: 1 }, 'R', 'updown').map((v) => v.spelling);
    expect(melodic).toEqual(['A4', 'B4', 'C5', 'D5', 'E5', 'F#5', 'G#5', 'A5', 'G5', 'F5', 'E5', 'D5', 'C5', 'B4', 'A4']);
  });
});
