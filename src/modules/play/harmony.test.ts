import { describe, expect, it } from 'vitest';
import { detectChord, spellHeld } from './harmony';

describe('detectChord', () => {
  it('needs three or more distinct notes', () => {
    expect(detectChord([60, 64])).toBeNull();
    expect(detectChord([60, 72, 64])).toBeNull();
  });

  it('names triads and sevenths the way players write them', () => {
    expect(detectChord([60, 64, 67])?.symbol).toBe('C');
    expect(detectChord([60, 64, 67])?.name).toBe('C major');
    expect(detectChord([57, 60, 64])?.symbol).toBe('Am');
    expect(detectChord([60, 64, 67, 70])?.symbol).toBe('C7');
  });

  it('prefers a plain inversion over an unusual root-position reading', () => {
    // E–G–C: tonal lists "Em#5" first; "C/E" is what a player means.
    expect(detectChord([64, 67, 72])?.symbol).toBe('C/E');
  });
});

describe('spellHeld', () => {
  it('uses sharps without a chord', () => {
    expect(spellHeld([63, 61])).toEqual(['C#4', 'D#4']);
  });

  it('follows the chord spelling', () => {
    const eb = detectChord([63, 67, 70]);
    expect(eb?.symbol).toBe('Eb');
    expect(spellHeld([70, 63, 67], eb)).toEqual(['Eb4', 'G4', 'Bb4']);
  });
});
