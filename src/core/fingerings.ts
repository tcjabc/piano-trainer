/**
 * Standard piano fingerings as data, for both hands (1 = thumb … 5 = little
 * finger). One module so drills, the Library and later songs share it.
 *
 * - Scales: the 12 major and the natural/harmonic/melodic minor scales (the
 *   usual published fingerings, including the black-key-start exceptions),
 *   one or two octaves; and the chromatic scale. Modes, pentatonics and
 *   blues have no standard fingering, so none is given.
 * - Chords: close-position triads, four-note chords (sevenths, sixths, add9)
 *   and five-note ninths, with the standard inversion fingerings.
 */
import { Note } from 'tonal';
import type { HandSide } from './chords';
import type { ScaleType } from './scales';

type Octave = [number, number, number, number, number, number, number, number];

/** One octave ascending, tonic to tonic; keyed by the tonic's pitch class (enharmonic keys share it). */
interface ScaleTable {
  R: Record<number, Octave>;
  L: Record<number, Octave>;
}

const STANDARD_R: Octave = [1, 2, 3, 1, 2, 3, 4, 5];
const STANDARD_L: Octave = [5, 4, 3, 2, 1, 3, 2, 1];

const MAJOR: ScaleTable = {
  R: {
    0: STANDARD_R, // C
    1: [2, 3, 1, 2, 3, 4, 1, 2], // D♭ / C♯
    2: STANDARD_R, // D
    3: [3, 1, 2, 3, 4, 1, 2, 3], // E♭
    4: STANDARD_R, // E
    5: [1, 2, 3, 4, 1, 2, 3, 4], // F
    6: [2, 3, 4, 1, 2, 3, 1, 2], // G♭ / F♯
    7: STANDARD_R, // G
    8: [3, 4, 1, 2, 3, 1, 2, 3], // A♭
    9: STANDARD_R, // A
    10: [4, 1, 2, 3, 1, 2, 3, 4], // B♭
    11: STANDARD_R, // B
  },
  L: {
    0: STANDARD_L,
    1: [3, 2, 1, 4, 3, 2, 1, 3],
    2: STANDARD_L,
    3: [3, 2, 1, 4, 3, 2, 1, 3],
    4: STANDARD_L,
    5: STANDARD_L,
    6: [4, 3, 2, 1, 3, 2, 1, 4],
    7: STANDARD_L,
    8: [3, 2, 1, 4, 3, 2, 1, 3],
    9: STANDARD_L,
    10: [3, 2, 1, 4, 3, 2, 1, 3],
    11: [4, 3, 2, 1, 4, 3, 2, 1],
  },
};

/** Natural, harmonic and melodic minor share these (the usual published fingerings). */
const MINOR: ScaleTable = {
  R: {
    0: STANDARD_R, // C
    1: [3, 4, 1, 2, 3, 1, 2, 3], // C♯
    2: STANDARD_R, // D
    3: [3, 1, 2, 3, 4, 1, 2, 3], // E♭ / D♯
    4: STANDARD_R, // E
    5: [1, 2, 3, 4, 1, 2, 3, 4], // F
    6: [3, 4, 1, 2, 3, 1, 2, 3], // F♯
    7: STANDARD_R, // G
    8: [3, 4, 1, 2, 3, 1, 2, 3], // G♯
    9: STANDARD_R, // A
    10: [4, 1, 2, 3, 1, 2, 3, 4], // B♭
    11: STANDARD_R, // B
  },
  L: {
    0: STANDARD_L,
    1: [3, 2, 1, 4, 3, 2, 1, 3],
    2: STANDARD_L,
    3: [2, 1, 4, 3, 2, 1, 3, 2],
    4: STANDARD_L,
    5: STANDARD_L,
    6: [4, 3, 2, 1, 3, 2, 1, 4],
    7: STANDARD_L,
    8: [3, 2, 1, 3, 2, 1, 4, 3],
    9: STANDARD_L,
    10: [2, 1, 3, 2, 1, 4, 3, 2],
    11: [4, 3, 2, 1, 4, 3, 2, 1],
  },
};

const TABLES: Partial<Record<ScaleType, ScaleTable>> = {
  major: MAJOR,
  ionian: MAJOR,
  'natural minor': MINOR,
  aeolian: MINOR,
  'harmonic minor': MINOR,
  'melodic minor': MINOR,
};

/**
 * Two octaves from one: the right hand repeats the first seven fingers and
 * ends on the top finger; the left hand plays the octave, then continues
 * from its second finger (the middle tonic is the octave's last finger).
 */
function extend(one: Octave, side: HandSide, octaves: 1 | 2): number[] {
  if (octaves === 1) return [...one];
  return side === 'R' ? [...one.slice(0, 7), ...one] : [...one, ...one.slice(1)];
}

const isBlack = (midi: number) => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);

/**
 * Chromatic: 3 on black keys, 1 on white keys, and 2 where two white keys
 * meet (right hand on F and C coming up from E and B; left hand on E and B).
 */
function chromatic(midis: number[], side: HandSide): number[] {
  return midis.map((m, i) => {
    if (isBlack(m)) return 3;
    if (side === 'R') return i > 0 && !isBlack(midis[i - 1]!) ? 2 : 1;
    return i < midis.length - 1 && !isBlack(midis[i + 1]!) ? 2 : 1;
  });
}

/**
 * Fingers for a scale played ascending (tonic to tonic), or null when there
 * is no standard fingering. `ascendingMidis` is needed for the chromatic scale.
 */
export function scaleFingering(
  tonic: string,
  type: ScaleType,
  side: HandSide,
  octaves: 1 | 2,
  ascendingMidis: number[] = [],
): number[] | null {
  if (type === 'chromatic') return ascendingMidis.length ? chromatic(ascendingMidis, side) : null;
  const table = TABLES[type];
  const one = table?.[side][Note.chroma(tonic)];
  return one ? extend(one, side, octaves) : null;
}

/** Fingers for a scale as played: ascending, then (for up-and-down) the same fingers coming back. */
export function scaleSequenceFingering(ascending: number[] | null, upDown: boolean): number[] | null {
  if (!ascending) return null;
  return upDown ? [...ascending, ...ascending.slice(0, -1).reverse()] : ascending;
}

/**
 * Fingers for a close-position chord, notes low to high.
 * Triads: RH 1-3-5 (first inversion 1-2-5); LH 5-3-1 (second inversion 5-2-1).
 * Four notes: RH 1-2-3-5, or 1-2-4-5 when the wider gap is in the middle;
 * LH 5-3-2-1, or 5-4-2-1 when the wider gap is in the middle.
 * Five notes: every finger.
 */
export function chordFingering(midis: number[], side: HandSide, inversion: number): number[] {
  const n = midis.length;
  if (n === 3) {
    if (side === 'R') return inversion === 1 ? [1, 2, 5] : [1, 3, 5];
    return inversion === 2 ? [5, 2, 1] : [5, 3, 1];
  }
  if (n === 4) {
    const gap = (i: number) => midis[i + 1]! - midis[i]!;
    if (side === 'R') return gap(1) > gap(2) ? [1, 2, 4, 5] : [1, 2, 3, 5];
    return gap(0) < gap(1) ? [5, 4, 2, 1] : [5, 3, 2, 1];
  }
  if (n === 5) return side === 'R' ? [1, 2, 3, 4, 5] : [5, 4, 3, 2, 1];
  return side === 'R' ? midis.map((_, i) => Math.min(5, i + 1)) : midis.map((_, i) => Math.max(1, 5 - i));
}
