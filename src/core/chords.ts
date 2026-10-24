/**
 * Chords: the qualities the app knows, which roots each is offered on,
 * correct spelling (via tonal), inversions, formulas and voicings.
 */
import { Chord, Interval, Note } from 'tonal';

export type ChordQuality =
  | 'M' | 'm' | 'dim' | 'aug' | 'sus2' | 'sus4' | '6' | 'm6' | '7' | 'maj7' | 'm7' | 'm7b5' | 'dim7' | 'add9' | '9';

export interface ChordQualityInfo {
  id: ChordQuality;
  /** Suffix in a chord symbol ("" for major). */
  symbol: string;
  name: string;
  /** Minor-family chords are offered on minor-key roots, the rest on major-key roots. */
  family: 'major' | 'minor';
}

export const CHORD_QUALITIES: readonly ChordQualityInfo[] = [
  { id: 'M', symbol: '', name: 'major', family: 'major' },
  { id: 'm', symbol: 'm', name: 'minor', family: 'minor' },
  { id: 'dim', symbol: 'dim', name: 'diminished', family: 'minor' },
  { id: 'aug', symbol: 'aug', name: 'augmented', family: 'major' },
  { id: 'sus2', symbol: 'sus2', name: 'suspended 2nd', family: 'major' },
  { id: 'sus4', symbol: 'sus4', name: 'suspended 4th', family: 'major' },
  { id: '6', symbol: '6', name: 'sixth', family: 'major' },
  { id: 'm6', symbol: 'm6', name: 'minor sixth', family: 'minor' },
  { id: '7', symbol: '7', name: 'dominant seventh', family: 'major' },
  { id: 'maj7', symbol: 'maj7', name: 'major seventh', family: 'major' },
  { id: 'm7', symbol: 'm7', name: 'minor seventh', family: 'minor' },
  { id: 'm7b5', symbol: 'm7b5', name: 'half-diminished seventh', family: 'minor' },
  { id: 'dim7', symbol: 'dim7', name: 'diminished seventh', family: 'minor' },
  { id: 'add9', symbol: 'add9', name: 'added ninth', family: 'major' },
  { id: '9', symbol: '9', name: 'dominant ninth', family: 'major' },
];

export function qualityInfo(q: ChordQuality): ChordQualityInfo {
  return CHORD_QUALITIES.find((c) => c.id === q)!;
}

/**
 * Roots in their conventional key spelling (major and minor key signatures).
 * Both spellings are offered where both are common: C♯/D♭ and F♯/G♭ major,
 * D♯/E♭ minor. Rare ones (C♭ major, A♭ and A♯ minor) are left out.
 */
export const MAJOR_ROOTS = ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
export const MINOR_ROOTS = ['C', 'C#', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'] as const;

export function chordRoots(q: ChordQuality): readonly string[] {
  return qualityInfo(q).family === 'major' ? MAJOR_ROOTS : MINOR_ROOTS;
}

export interface ChordSpec {
  root: string;
  quality: ChordQuality;
  /** 0 = root position, 1 = first inversion, … */
  inversion: number;
}

/** Spelled pitch classes in root position, e.g. F#m7 → F# A C# E. */
export function chordNotes(root: string, quality: ChordQuality): string[] {
  return Chord.get(`${root}${quality}`).notes;
}

export function chordIntervals(quality: ChordQuality): string[] {
  return Chord.get(`C${quality}`).intervals;
}

/** Number of inversions including root position (= number of notes). */
export function inversionCount(quality: ChordQuality): number {
  return chordIntervals(quality).length;
}

/** Pitch classes in voicing order for an inversion: the inverted bass first. */
export function invertedNotes(spec: ChordSpec): string[] {
  const notes = chordNotes(spec.root, spec.quality);
  return [...notes.slice(spec.inversion), ...notes.slice(0, spec.inversion)];
}

export function bassNote(spec: ChordSpec): string {
  return invertedNotes(spec)[0]!;
}

export const INVERSION_NAMES = ['root position', '1st inversion', '2nd inversion', '3rd inversion', '4th inversion'];

/** "F#m7", or "F#m7/A" for an inversion. */
export function chordSymbol(spec: ChordSpec): string {
  const base = `${spec.root}${qualityInfo(spec.quality).symbol}`;
  return spec.inversion === 0 ? base : `${base}/${bassNote(spec)}`;
}

/** "F# minor seventh, 1st inversion". */
export function chordName(spec: ChordSpec): string {
  const name = `${spec.root} ${qualityInfo(spec.quality).name}`;
  return spec.inversion === 0 ? name : `${name}, ${INVERSION_NAMES[spec.inversion]}`;
}

/** A scale degree for display: "b3", "#5", "bb7", "9". */
export function degreeLabel(interval: string): string {
  const { num, alt } = Interval.get(interval);
  const acc = alt < 0 ? 'b'.repeat(-alt) : '#'.repeat(alt);
  return `${acc}${num}`;
}

/** Formula as degrees, e.g. ["1", "b3", "5", "b7"]. */
export function chordFormula(quality: ChordQuality): string[] {
  return chordIntervals(quality).map(degreeLabel);
}

export interface Voiced {
  /** Spelled with octave, e.g. "F#4". */
  spelling: string;
  midi: number;
}

/**
 * Close voicing, ascending from the bass. The bass sits in the octave from
 * `lowest` up (C4 = 60 for the right hand, C3 = 48 for the left).
 */
export function voiceUp(pcs: string[], lowest: number): Voiced[] {
  const out: Voiced[] = [];
  let prev = lowest - 1;
  for (const pc of pcs) {
    // Lowest octave that puts this note above the previous one.
    let octave = Math.floor((prev + 1) / 12) - 2;
    let midi = Note.midi(`${pc}${octave}`)!;
    while (midi <= prev) midi = Note.midi(`${pc}${++octave}`)!;
    out.push({ spelling: `${pc}${octave}`, midi });
    prev = midi;
  }
  return out;
}

export type HandSide = 'L' | 'R';

/** Where each hand plays by default: right from middle C, left an octave lower. */
export const HAND_BASE: Record<HandSide, number> = { R: 60, L: 48 };

/** The chord voiced for one hand. */
export function voiceChord(spec: ChordSpec, hand: HandSide): Voiced[] {
  return voiceUp(invertedNotes(spec), HAND_BASE[hand]);
}

export function pitchClass(note: string | number): number {
  return typeof note === 'number' ? ((note % 12) + 12) % 12 : Note.chroma(note);
}
