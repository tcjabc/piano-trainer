import { describe, expect, it } from 'vitest';
import { allItems, EMPTY_FILTER, filterItems, matchesFilter, parseQuery, STARTER_DECKS } from './catalog';

const names = (q: string, f = EMPTY_FILTER) => filterItems(f, q).map((i) => (i.kind === 'chord' ? i.symbol : i.name));

describe('catalog', () => {
  it('has every chord quality with its inversions and every scale type', () => {
    const items = allItems();
    expect(items.filter((i) => i.kind === 'chord' && i.spec.root === 'C' && i.spec.quality === '9')).toHaveLength(5);
    expect(items.filter((i) => i.kind === 'chord' && i.spec.root === 'C' && i.spec.quality === 'M')).toHaveLength(3);
    expect(new Set(items.filter((i) => i.kind === 'scale').map((i) => i.kind === 'scale' && i.type)).size).toBe(15);
    expect(items.length).toBeGreaterThan(900);
  });

  it('offers both spellings only where both are common', () => {
    const roots = (q: string) => [...new Set(allItems().filter((i) => i.kind === 'chord' && i.spec.quality === q).map((i) => i.kind === 'chord' && i.spec.root))];
    expect(roots('M')).toEqual(expect.arrayContaining(['F#', 'Gb', 'C#', 'Db']));
    expect(roots('M')).not.toContain('Cb');
    expect(roots('m')).toEqual(expect.arrayContaining(['D#', 'Eb', 'G#']));
    expect(roots('m')).not.toContain('Ab');
  });
});

describe('search', () => {
  it('reads chord symbols', () => {
    expect(parseQuery('F#m7')).toMatchObject({ root: 'F#', quality: 'm7', kind: 'chord' });
    expect(names('F#m7')).toEqual(['F#m7', 'F#m7/A', 'F#m7/C#', 'F#m7/E']);
    expect(parseQuery('Ebm')).toMatchObject({ root: 'Eb', quality: 'm' });
    expect(parseQuery('bb')).toMatchObject({ root: 'Bb' });
  });

  it('reads inversions and slash chords', () => {
    expect(parseQuery('Bb maj7 1st inv')).toMatchObject({ root: 'Bb', quality: 'maj7', inversion: 1 });
    expect(names('Bb maj7 1st inv')).toEqual(['Bbmaj7/D']);
    expect(names('C/E')).toEqual(['C/E']);
    expect(names('Cm second inversion')).toEqual(['Cm/G']);
  });

  it('reads scale names', () => {
    expect(parseQuery('D dorian')).toMatchObject({ root: 'D', scaleType: 'dorian', kind: 'scale' });
    expect(names('D dorian')).toEqual(['D dorian']);
    expect(names('b dorian')).toEqual(['B dorian']);
    expect(names('G major scale')).toEqual(['G major']);
    expect(names('Eb harmonic minor')).toEqual(['Eb harmonic minor']);
  });

  it('lists the chord and the scale for a root and "major" or "minor"', () => {
    expect(parseQuery('Eb major')).toMatchObject({ root: 'Eb', quality: 'M', orScale: 'major' });
    expect(parseQuery('Eb major').kind).toBeUndefined();
    expect(names('Eb major')).toEqual(['Eb', 'Eb major', 'Eb/G', 'Eb/Bb']);
    expect(names('a minor')).toEqual(['Am', 'A natural minor', 'Am/C', 'Am/E']);
    expect(names('E♭ major')).toEqual(['Eb', 'Eb major', 'Eb/G', 'Eb/Bb']);
  });

  it('keeps chord-only searches to chords', () => {
    expect(names('Ebmaj')).toEqual(['Eb', 'Eb/G', 'Eb/Bb']);
    expect(names('Eb major 1st inv')).toEqual(['Eb/G']);
    expect(names('Eb major chord')).toEqual(['Eb', 'Eb/G', 'Eb/Bb']);
    expect(names('Eb major/G')).toEqual(['Eb/G']);
    expect(names('Eb major', { ...EMPTY_FILTER, kinds: ['scale'] })).toEqual(['Eb major']);
  });

  it('reads a quality on its own', () => {
    expect(parseQuery('add9')).toMatchObject({ quality: 'add9', root: undefined });
    expect(parseQuery('half diminished')).toMatchObject({ quality: 'm7b5' });
    expect(filterItems(EMPTY_FILTER, 'dim7').every((i) => i.kind === 'chord' && i.spec.quality === 'dim7')).toBe(true);
  });
});

describe('filters and decks', () => {
  it('combines kinds, qualities, roots and inversions', () => {
    const f = { ...EMPTY_FILTER, qualities: ['M' as const], roots: ['C', 'G'], inversions: [0] };
    expect(names('', f)).toEqual(['C', 'G']);
    const scalesOnly = { ...EMPTY_FILTER, scaleTypes: ['dorian' as const], roots: ['D'] };
    expect(names('', scalesOnly)).toEqual(['D dorian']);
  });

  it('starter decks match what their names say', () => {
    const deck = (n: string) => STARTER_DECKS.find((d) => d.name.startsWith(n))!;
    const triads = allItems().filter((i) => matchesFilter(i, deck('Major triads').filter));
    expect(triads).toHaveLength(12); // 4 roots × 3 positions
    const sharps = allItems().filter((i) => matchesFilter(i, deck('Major scales with sharps').filter));
    expect(sharps.map((i) => i.kind === 'scale' && i.tonic)).toEqual(['G', 'D', 'A', 'E', 'B', 'F#', 'C#'].sort((a, b) => ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'].indexOf(a) - ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'].indexOf(b)));
  });
});
