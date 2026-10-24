/**
 * Scales: the types the app knows, which tonics each is offered on, correct
 * spelling (via tonal, with two fixes) and the played sequence.
 */
import { Interval, Note, Scale } from 'tonal';
import { degreeLabel, HAND_BASE, MAJOR_ROOTS, MINOR_ROOTS, voiceUp, type HandSide, type Voiced } from './chords';

export type ScaleType =
  | 'major' | 'natural minor' | 'harmonic minor' | 'melodic minor'
  | 'ionian' | 'dorian' | 'phrygian' | 'lydian' | 'mixolydian' | 'aeolian' | 'locrian'
  | 'major pentatonic' | 'minor pentatonic' | 'blues' | 'chromatic';

export interface ScaleTypeInfo {
  id: ScaleType;
  name: string;
  group: 'major/minor' | 'mode' | 'other';
  family: 'major' | 'minor' | 'chromatic';
  /** tonal's name for the scale. */
  tonal: string;
}

export const SCALE_TYPES: readonly ScaleTypeInfo[] = [
  { id: 'major', name: 'major', group: 'major/minor', family: 'major', tonal: 'major' },
  { id: 'natural minor', name: 'natural minor', group: 'major/minor', family: 'minor', tonal: 'minor' },
  { id: 'harmonic minor', name: 'harmonic minor', group: 'major/minor', family: 'minor', tonal: 'harmonic minor' },
  { id: 'melodic minor', name: 'melodic minor', group: 'major/minor', family: 'minor', tonal: 'melodic minor' },
  { id: 'ionian', name: 'ionian', group: 'mode', family: 'major', tonal: 'ionian' },
  { id: 'dorian', name: 'dorian', group: 'mode', family: 'minor', tonal: 'dorian' },
  { id: 'phrygian', name: 'phrygian', group: 'mode', family: 'minor', tonal: 'phrygian' },
  { id: 'lydian', name: 'lydian', group: 'mode', family: 'major', tonal: 'lydian' },
  { id: 'mixolydian', name: 'mixolydian', group: 'mode', family: 'major', tonal: 'mixolydian' },
  { id: 'aeolian', name: 'aeolian', group: 'mode', family: 'minor', tonal: 'aeolian' },
  { id: 'locrian', name: 'locrian', group: 'mode', family: 'minor', tonal: 'locrian' },
  { id: 'major pentatonic', name: 'major pentatonic', group: 'other', family: 'major', tonal: 'major pentatonic' },
  { id: 'minor pentatonic', name: 'minor pentatonic', group: 'other', family: 'minor', tonal: 'minor pentatonic' },
  { id: 'blues', name: 'blues', group: 'other', family: 'minor', tonal: 'minor blues' },
  { id: 'chromatic', name: 'chromatic', group: 'other', family: 'chromatic', tonal: 'chromatic' },
];

export function scaleInfo(t: ScaleType): ScaleTypeInfo {
  return SCALE_TYPES.find((s) => s.id === t)!;
}

const CHROMATIC_ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

export function scaleRoots(t: ScaleType): readonly string[] {
  const family = scaleInfo(t).family;
  return family === 'major' ? MAJOR_ROOTS : family === 'minor' ? MINOR_ROOTS : CHROMATIC_ROOTS;
}

const isDouble = (pc: string) => /##|bb|x/.test(pc.slice(1));

/** Spelled pitch classes ascending from the tonic (one octave, tonic not repeated). */
export function scaleNotes(tonic: string, type: ScaleType): string[] {
  if (type === 'chromatic') {
    // tonal spells chromatic scales from flat keys with F♭/B𝄫; use plain sharps (or flats for flat tonics).
    const start = Note.midi(`${tonic}4`)!;
    const name = tonic.includes('b') ? Note.fromMidi : Note.fromMidiSharps;
    return Array.from({ length: 12 }, (_, i) => Note.pitchClass(name(start + i)));
  }
  const notes = Scale.get(`${tonic} ${scaleInfo(type).tonal}`).notes;
  if (type === 'blues') {
    // The blue note is ♭5, written ♯4 where ♭5 would need a double flat (E♭ blues: A, not B𝄫).
    return notes.map((pc, i) => (isDouble(pc) ? Note.transpose(notes[i - 1]!, '1A') : pc));
  }
  return notes;
}

export function scaleIntervals(tonic: string, type: ScaleType): string[] {
  return scaleNotes(tonic, type).map((pc) => Interval.distance(tonic, pc)).map((iv) => (iv === '' ? '1P' : iv));
}

/** Formula as degrees, e.g. ["1", "2", "b3", …]. */
export function scaleFormula(tonic: string, type: ScaleType): string[] {
  return scaleIntervals(tonic, type).map(degreeLabel);
}

export interface ScaleSpec {
  tonic: string;
  type: ScaleType;
  octaves: 1 | 2;
}

export type ScaleDirection = 'up' | 'updown';

export function scaleName(spec: ScaleSpec): string {
  return `${spec.tonic} ${scaleInfo(spec.type).name}`;
}

/**
 * The notes played, ascending (tonic to tonic, `octaves` octaves) and, for
 * "updown", back down. Melodic minor comes down as natural minor.
 */
export function scaleSequence(spec: ScaleSpec, hand: HandSide, direction: ScaleDirection = 'up'): Voiced[] {
  const pcs = scaleNotes(spec.tonic, spec.type);
  const upPcs = [...Array.from({ length: spec.octaves }, () => pcs).flat(), spec.tonic];
  const up = voiceUp(upPcs, HAND_BASE[hand]);
  if (direction === 'up') return up;
  let down = up.slice(0, -1).reverse();
  if (spec.type === 'melodic minor') {
    const natural = scaleNotes(spec.tonic, 'natural minor');
    const melodic = pcs;
    down = down.map((v) => {
      const i = melodic.indexOf(Note.pitchClass(v.spelling));
      const pc = natural[i]!;
      const octave = Number(v.spelling.slice(Note.pitchClass(v.spelling).length));
      const spelling = `${pc}${octave}`;
      return { spelling, midi: Note.midi(spelling)! };
    });
  }
  return [...up, ...down];
}
