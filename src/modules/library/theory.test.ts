import { describe, expect, it } from 'vitest';
import { CHORD_QUALITIES } from '../../core/chords';
import { SCALE_TYPES } from '../../core/scales';
import { CHORD_THEORY, SCALE_THEORY } from '../../data/theory';
import { allItems, itemById, makeChordItem, makeScaleItem } from './catalog';
import { compareItem, notesNotIn, theoryFor, theoryVars } from './theory';

describe('theory data', () => {
  it('has an entry for every chord quality and scale type', () => {
    expect(Object.keys(CHORD_THEORY).sort()).toEqual(CHORD_QUALITIES.map((q) => q.id).sort());
    expect(Object.keys(SCALE_THEORY).sort()).toEqual(SCALE_TYPES.map((t) => t.id).sort());
    for (const entry of [...Object.values(CHORD_THEORY), ...Object.values(SCALE_THEORY)]) {
      for (const text of [entry.short, entry.built, entry.name, entry.sound]) expect(text.trim()).not.toBe('');
    }
  });

  it('compares only with other qualities or scale types', () => {
    for (const [id, entry] of Object.entries(CHORD_THEORY)) {
      for (const c of entry.compare) {
        expect(c.with).not.toBe(id);
        expect(CHORD_QUALITIES.some((q) => q.id === c.with)).toBe(true);
      }
    }
    for (const [id, entry] of Object.entries(SCALE_THEORY)) {
      for (const c of entry.compare) {
        expect(c.with).not.toBe(id);
        expect(SCALE_TYPES.some((t) => t.id === c.with)).toBe(true);
      }
    }
  });

  it('fills every placeholder for every item in the catalog', () => {
    for (const item of allItems()) {
      const t = theoryFor(item);
      for (const text of [t.short, t.built, t.name, t.sound]) expect(text, `${item.id}: ${text}`).not.toMatch(/[{}]/);
    }
  });
});

describe('templating', () => {
  const chord = (root: string, quality: Parameters<typeof makeChordItem>[0]['quality'] = 'M') => makeChordItem({ root, quality, inversion: 0 });

  it('spells chord notes for the root', () => {
    expect(theoryFor(chord('C')).built).toContain('In C: C–E–G.');
    expect(theoryFor(chord('Eb')).built).toContain('In Eb: Eb–G–Bb.');
    expect(theoryFor(chord('F#')).built).toContain('In F#: F#–A#–C#.');
    expect(theoryFor(chord('Eb', 'm7b5')).built).toContain('Eb–Gb–Bbb–Db');
  });

  it('names where a dominant seventh leads', () => {
    expect(theoryFor(chord('C', '7')).sound).toContain('C7 leads to F.');
    expect(theoryFor(chord('Eb', '7')).sound).toContain('Eb7 leads to Ab.');
    expect(theoryFor(chord('F#', '7')).sound).toContain('F#7 leads to B.');
  });

  it('names the parent major key of a mode', () => {
    expect(theoryFor(makeScaleItem('C', 'dorian')).name).toContain('C Dorian uses the notes of Bb major');
    expect(theoryFor(makeScaleItem('Eb', 'dorian')).name).toContain('Eb Dorian uses the notes of Db major');
    expect(theoryFor(makeScaleItem('F#', 'dorian')).name).toContain('F# Dorian uses the notes of E major');
    expect(theoryVars(makeScaleItem('Eb', 'lydian')).parent).toBe('Bb');
    // G♭ Locrian's parent would be A𝄫: written G.
    expect(theoryVars(makeScaleItem('Gb', 'locrian')).parent).toBe('G');
  });

  it('names relative keys', () => {
    expect(theoryFor(makeScaleItem('C', 'major')).sound).toContain('C major shares its notes with A minor');
    expect(theoryFor(makeScaleItem('Eb', 'major')).sound).toContain('Eb major shares its notes with C minor');
    expect(theoryFor(makeScaleItem('F#', 'major')).sound).toContain('F# major shares its notes with D# minor');
    expect(theoryFor(makeScaleItem('Eb', 'natural minor')).name).toContain('Eb minor uses the notes of Gb major');
    expect(theoryFor(makeScaleItem('F#', 'natural minor')).name).toContain('F# minor uses the notes of A major');
  });

  it('spells scale notes for the tonic', () => {
    expect(theoryFor(makeScaleItem('Eb', 'harmonic minor')).built).toContain('Eb–F–Gb–Ab–Bb–Cb–D');
    expect(theoryFor(makeScaleItem('F#', 'major pentatonic')).built).toContain('F#–G#–A#–C#–D#');
  });
});

describe('compare', () => {
  it('keeps the root and, where it exists, the inversion', () => {
    const cOverG = itemById('chord:C:M:2')!;
    expect(compareItem(cOverG, 'm').id).toBe('chord:C:m:2');
    const thirdInv = itemById('chord:C:maj7:3')!;
    expect(compareItem(thirdInv, 'M').id).toBe('chord:C:M:0');
    expect(compareItem(makeScaleItem('D', 'dorian'), 'natural minor').id).toBe('scale:D:natural minor');
  });

  it('finds the notes that differ', () => {
    const major = chord('C');
    const minor = chord('C', 'm');
    expect(notesNotIn(major, minor)).toEqual(['E']);
    expect(notesNotIn(minor, major)).toEqual(['Eb']);
    const harmonic = makeScaleItem('A', 'harmonic minor');
    const natural = makeScaleItem('A', 'natural minor');
    expect(notesNotIn(harmonic, natural)).toEqual(['G#']);
    expect(notesNotIn(natural, harmonic)).toEqual(['G']);
  });

  function chord(root: string, quality: Parameters<typeof makeChordItem>[0]['quality'] = 'M') {
    return makeChordItem({ root, quality, inversion: 0 });
  }
});
