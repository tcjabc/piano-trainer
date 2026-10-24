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

  it('formats altered extensions in chord symbols', () => {
    const flat = { accidental: 'flat' };
    const sharp = { accidental: 'sharp' };
    expect(splitNoteText('Bbm7b5')).toEqual(['B', flat, 'm7', flat, '5']);
    expect(splitNoteText('C7#5')).toEqual(['C7', sharp, '5']);
    expect(splitNoteText('G7b9')).toEqual(['G7', flat, '9']);
    expect(splitNoteText('E7#9')).toEqual(['E7', sharp, '9']);
    expect(splitNoteText('Fmaj7#11')).toEqual(['Fmaj7', sharp, '11']);
    expect(splitNoteText('A7b13')).toEqual(['A7', flat, '13']);
    expect(splitNoteText('C7(b9)')).toEqual(['C7(', flat, '9)']);
    expect(splitNoteText('D7#9b13')).toEqual(['D7', sharp, '9', flat, '13']);
    expect(splitNoteText('F#m7b5/A')).toEqual(['F', sharp, 'm7', flat, '5/A']);
    expect(splitNoteText('B♭m7♭5')).toEqual(['B', flat, 'm7', flat, '5']);
  });

  it('only formats extensions that can be altered', () => {
    expect(splitNoteText('C7b6 C7#4 C7b10')).toEqual(['C7b6 C7#4 C7b10']);
    expect(splitNoteText('a b5 here')).toEqual(['a b5 here']);
    // A note letter wins: these are note names, not extensions.
    expect(splitNoteText('Cb5 and Ab9')).toEqual(['C', { accidental: 'flat' }, '5 and A', { accidental: 'flat' }, '9']);
  });

  it('leaves ordinary words alone', () => {
    expect(splitNoteText('That was not it — play Ab4')).toEqual(['That was not it — play A', { accidental: 'flat' }, '4']);
    expect(splitNoteText('Bob Bach Debug')).toEqual(['Bob Bach Debug']);
    expect(splitNoteText('C major over E')).toEqual(['C major over E']);
  });
});
