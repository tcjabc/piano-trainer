/** Pitch helpers shared by every module. A "spelling" is a written note such as "C#4" or "Db4". */

export type Letter = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
export type Accidental = '' | '#' | 'b';
export type Clef = 'treble' | 'bass';

export interface Spelling {
  letter: Letter;
  accidental: Accidental;
  octave: number;
}

export const LETTERS: readonly Letter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_SEMITONES: Record<Letter, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Lowest and highest keys of an 88-key piano (A0 and C8). */
export const PIANO_LOW = 21;
export const PIANO_HIGH = 108;
export const MIDDLE_C = 60;

export function parseSpelling(name: string): Spelling {
  const match = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!match) throw new Error(`Not a note name: ${name}`);
  return {
    letter: match[1] as Letter,
    accidental: (match[2] ?? '') as Accidental,
    octave: Number(match[3]),
  };
}

export function formatSpelling(s: Spelling): string {
  return `${s.letter}${s.accidental}${s.octave}`;
}

export function spellingToMidi(s: Spelling | string): number {
  const sp = typeof s === 'string' ? parseSpelling(s) : s;
  const offset = sp.accidental === '#' ? 1 : sp.accidental === 'b' ? -1 : 0;
  return (sp.octave + 1) * 12 + LETTER_SEMITONES[sp.letter] + offset;
}

/** Note name using sharps, e.g. 61 → "C#4". */
export function midiToName(midi: number): string {
  return `${SHARP_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

export function isBlackKey(midi: number): boolean {
  return [1, 3, 6, 8, 10].includes(midi % 12);
}

/**
 * Diatonic step index (C0 = 0, D0 = 1 … ) — the vertical staff position,
 * independent of accidentals.
 */
export function diatonicIndex(s: Spelling): number {
  return s.octave * 7 + LETTERS.indexOf(s.letter);
}

/** Diatonic positions of the bottom and top staff lines for each clef. */
const STAFF_LINES: Record<Clef, { bottom: string; top: string }> = {
  treble: { bottom: 'E4', top: 'F5' },
  bass: { bottom: 'G2', top: 'A3' },
};

/**
 * Number of ledger lines a note needs on the given clef (0 when it sits on
 * or within one step of the five-line staff).
 */
export function ledgerLineCount(s: Spelling, clef: Clef): number {
  const pos = diatonicIndex(s);
  const bottom = diatonicIndex(parseSpelling(STAFF_LINES[clef].bottom));
  const top = diatonicIndex(parseSpelling(STAFF_LINES[clef].top));
  if (pos < bottom - 1) return Math.floor((bottom - pos) / 2);
  if (pos > top + 1) return Math.floor((pos - top) / 2);
  return 0;
}

/** All natural spellings from low to high inclusive, e.g. C4…G4. */
export function naturalsBetween(low: string, high: string): Spelling[] {
  const lo = diatonicIndex(parseSpelling(low));
  const hi = diatonicIndex(parseSpelling(high));
  const out: Spelling[] = [];
  for (let i = lo; i <= hi; i++) {
    out.push({ letter: LETTERS[i % 7]!, accidental: '', octave: Math.floor(i / 7) });
  }
  return out;
}

/** Human-readable spelling with real accidental glyphs: "C♯4". */
export function displaySpelling(name: string): string {
  return name.replace('#', '♯').replace(/(?<=[A-G])b/, '♭');
}
