import { describe, expect, it } from 'vitest';
import { ledgerLineCount, midiToName, naturalsBetween, parseSpelling, spellingToMidi, formatSpelling } from './pitch';

describe('pitch', () => {
  it('converts spellings to MIDI numbers', () => {
    expect(spellingToMidi('C4')).toBe(60);
    expect(spellingToMidi('A0')).toBe(21);
    expect(spellingToMidi('C8')).toBe(108);
    expect(spellingToMidi('C#4')).toBe(61);
    expect(spellingToMidi('Db4')).toBe(61);
    expect(spellingToMidi('Cb4')).toBe(59);
  });

  it('names MIDI numbers with sharps', () => {
    expect(midiToName(60)).toBe('C4');
    expect(midiToName(70)).toBe('A#4');
  });

  it('lists naturals in a range', () => {
    expect(naturalsBetween('C4', 'G4').map(formatSpelling)).toEqual(['C4', 'D4', 'E4', 'F4', 'G4']);
    expect(naturalsBetween('A3', 'C4').map(formatSpelling)).toEqual(['A3', 'B3', 'C4']);
  });

  it('counts ledger lines', () => {
    const t = (n: string) => ledgerLineCount(parseSpelling(n), 'treble');
    const b = (n: string) => ledgerLineCount(parseSpelling(n), 'bass');
    expect(t('C4')).toBe(1);
    expect(t('D4')).toBe(0);
    expect(t('G5')).toBe(0);
    expect(t('A5')).toBe(1);
    expect(t('A3')).toBe(2);
    expect(b('C4')).toBe(1);
    expect(b('B3')).toBe(0);
    expect(b('F2')).toBe(0);
    expect(b('E2')).toBe(1);
  });
});
