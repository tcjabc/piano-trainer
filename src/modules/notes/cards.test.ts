import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, noteDrillOptions, type NoteDrillOptions } from '../../core/settings';
import { contentsFor, introductionOrder } from './cards';

const defaults = noteDrillOptions(DEFAULT_SETTINGS);
const opts = (o: Partial<NoteDrillOptions>): NoteDrillOptions => ({ ...defaults, ...o });

describe('note cards', () => {
  it('defaults to treble C4–G4 naturals', () => {
    expect(contentsFor(defaults).map((c) => c.spelling)).toEqual(['C4', 'D4', 'E4', 'F4', 'G4']);
  });

  it('adds both spellings of each black key inside the range', () => {
    const spellings = contentsFor(opts({ accidentals: true })).map((c) => c.spelling);
    expect(spellings).toEqual(['C4', 'C#4', 'Db4', 'D4', 'D#4', 'Eb4', 'E4', 'F4', 'F#4', 'Gb4', 'G4']);
  });

  it('drops ledger-line notes when ledger lines are off', () => {
    expect(contentsFor(opts({ ledgerLines: false })).map((c) => c.spelling)).toEqual(['D4', 'E4', 'F4', 'G4']);
  });

  it('covers both clefs', () => {
    const cards = contentsFor(opts({ clef: 'both' }));
    expect(cards.filter((c) => c.clef === 'bass').map((c) => c.spelling)).toEqual(['C3', 'D3', 'E3', 'F3', 'G3']);
    expect(cards).toHaveLength(10);
  });

  it('introduces naturals outward from middle C first', () => {
    const order = contentsFor(opts({ clef: 'both', accidentals: true }))
      .sort(introductionOrder)
      .map((c) => `${c.clef[0]}${c.spelling}`);
    expect(order.slice(0, 4)).toEqual(['tC4', 'tD4', 'tE4', 'tF4']);
    expect(order.indexOf('bG3')).toBeLessThan(order.indexOf('tC#4'));
  });
});
