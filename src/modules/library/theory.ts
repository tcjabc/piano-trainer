/**
 * Theory notes for a Library item: the entry for its quality or scale type
 * (src/data/theory.ts) with the placeholders filled in for its root, and
 * the items it can be compared with.
 */
import { Note } from 'tonal';
import { chordNotes, inversionCount, pitchClass } from '../../core/chords';
import { scaleNotes, type ScaleType } from '../../core/scales';
import { CHORD_THEORY, SCALE_THEORY, type HeardIn } from '../../data/theory';
import { makeChordItem, makeScaleItem, type LibraryItem } from './catalog';

export interface TheoryText {
  short: string;
  built: string;
  name: string;
  sound: string;
  heardIn: HeardIn[];
  compare: { label: string; item: LibraryItem }[];
}

/** How far each mode's tonic sits above the major key whose notes it uses. */
const MODE_DEGREE: Partial<Record<ScaleType, string>> = {
  ionian: '1P',
  dorian: '2M',
  phrygian: '3M',
  lydian: '4P',
  mixolydian: '5P',
  aeolian: '6M',
  locrian: '7M',
};

/** From a scale to its relative key: major down a minor third, minor up one. */
const RELATIVE: Partial<Record<ScaleType, string>> = {
  major: '-3m',
  ionian: '-3m',
  'natural minor': '3m',
  aeolian: '3m',
  'minor pentatonic': '3m',
};

/** A transposed pitch class, respelled only if it needs a double sharp or flat (A𝄫 → G). */
function transposed(note: string, interval: string): string {
  const pc = Note.pitchClass(Note.transpose(note, interval));
  return /##|bb/.test(pc) ? Note.simplify(pc) : pc;
}

export function theoryVars(item: LibraryItem): Record<string, string> {
  const root = item.kind === 'chord' ? item.spec.root : item.tonic;
  const notes = item.kind === 'chord' ? chordNotes(root, item.spec.quality) : scaleNotes(root, item.type);
  const vars: Record<string, string> = { root, notes: notes.join('–'), resolvesTo: transposed(root, '4P') };
  if (item.kind === 'scale') {
    const degree = MODE_DEGREE[item.type];
    if (degree) vars.parent = transposed(root, `-${degree}`);
    const relative = RELATIVE[item.type];
    if (relative) vars.relative = transposed(root, relative);
  }
  return vars;
}

/** Fill {placeholders}; an unknown one is left as written, so a typo in the data shows. */
export function fillTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => vars[key] ?? whole);
}

/** The same root (and inversion, where the other chord has it) with another quality or scale type. */
export function compareItem(item: LibraryItem, other: string): LibraryItem {
  if (item.kind === 'chord') {
    const quality = other as typeof item.spec.quality;
    const inversion = item.spec.inversion < inversionCount(quality) ? item.spec.inversion : 0;
    return makeChordItem({ root: item.spec.root, quality, inversion });
  }
  return makeScaleItem(item.tonic, other as ScaleType);
}

export function theoryFor(item: LibraryItem): TheoryText {
  const entry = item.kind === 'chord' ? CHORD_THEORY[item.spec.quality] : SCALE_THEORY[item.type];
  const vars = theoryVars(item);
  const fill = (text: string) => fillTemplate(text, vars);
  return {
    short: fill(entry.short),
    built: fill(entry.built),
    name: fill(entry.name),
    sound: fill(entry.sound),
    heardIn: entry.heardIn,
    compare: entry.compare.map((c) => ({ label: c.label, item: compareItem(item, c.with) })),
  };
}

/** Spelled notes of an item that the other lacks (by pitch class), in order. */
export function notesNotIn(a: LibraryItem, b: LibraryItem): string[] {
  const spelled = (i: LibraryItem) => (i.kind === 'chord' ? chordNotes(i.spec.root, i.spec.quality) : scaleNotes(i.tonic, i.type));
  const other = new Set(spelled(b).map(pitchClass));
  return spelled(a).filter((n) => !other.has(pitchClass(n)));
}
