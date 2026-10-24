import { describe, expect, it } from 'vitest';
import { splitNoteText } from './note-text';

describe('splitNoteText', () => {
  it('finds ASCII and Unicode accidentals after note letters', () => {
    expect(splitNoteText('C#4')).toEqual(['C', { accidental: 'sharp' }, '4']);
    expect(splitNoteText('Bb7/F#')).toEqual(['B', { accidental: 'flat' }, '7/F', { accidental: 'sharp' }]);
    expect(splitNoteText('E♭ major')).toEqual(['E', { accidental: 'flat' }, ' major']);
    expect(splitNoteText('G♮')).toEqual(['G', { accidental: 'natural' }]);
  });

  it('reads doubles before singles', () => {
    expect(splitNoteText('F##5 Bbb3')).toEqual(['F', { accidental: 'doubleSharp' }, '5 B', { accidental: 'doubleFlat' }, '3']);
    expect(splitNoteText('C𝄪 D𝄫')).toEqual(['C', { accidental: 'doubleSharp' }, ' D', { accidental: 'doubleFlat' }]);
  });

  it('leaves ordinary words alone', () => {
    expect(splitNoteText('That was not it — play Ab4')).toEqual(['That was not it — play A', { accidental: 'flat' }, '4']);
    expect(splitNoteText('Bob Bach Debug')).toEqual(['Bob Bach Debug']);
    expect(splitNoteText('C major over E')).toEqual(['C major over E']);
  });
});
