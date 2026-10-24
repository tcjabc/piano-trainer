/**
 * How a Library item is laid out for each hand: the notes it is voiced as,
 * how it is drawn on the staff, heard, and checked when played.
 */
import { bassNote, chordNotes, pitchClass, voiceChord, type HandSide, type Voiced } from '../../core/chords';
import type { NotationNote } from '../../core/notation';
import { scaleSequence, type ScaleDirection } from '../../core/scales';
import type { HandChoice } from '../../core/settings';
import type { ChordTarget } from '../drill/check';
import type { LibraryItem } from './catalog';

export function handSides(hand: HandChoice): HandSide[] {
  return hand === 'left' ? ['L'] : hand === 'right' ? ['R'] : ['L', 'R'];
}

/** Notes per hand: a close chord voicing, or the scale ascending (and back, for updown). */
export function voicings(
  item: LibraryItem,
  hand: HandChoice,
  octaves: 1 | 2,
  direction: ScaleDirection = 'up',
): Partial<Record<HandSide, Voiced[]>> {
  const out: Partial<Record<HandSide, Voiced[]>> = {};
  for (const side of handSides(hand)) {
    out[side] =
      item.kind === 'chord'
        ? voiceChord(item.spec, side)
        : scaleSequence({ tonic: item.tonic, type: item.type, octaves }, side, direction);
  }
  return out;
}

/** Every key the item uses, for highlighting. */
export function itemKeys(item: LibraryItem, hand: HandChoice, octaves: 1 | 2): number[] {
  const v = voicings(item, hand, octaves);
  return [...new Set([...(v.L ?? []), ...(v.R ?? [])].map((n) => n.midi))];
}

/**
 * Staff notes: the right hand on the treble staff, the left on the bass.
 * A chord is one stacked note; a scale is a run of notes. `fingers` gives a
 * finger per voiced note (same order), or null.
 */
export function notation(
  item: LibraryItem,
  hand: HandChoice,
  octaves: 1 | 2,
  fingers: Partial<Record<HandSide, (number | null)[] | null>> = {},
): NotationNote[] {
  const v = voicings(item, hand, octaves);
  const out: NotationNote[] = [];
  for (const side of ['R', 'L'] as const) {
    const notes = v[side];
    if (!notes) continue;
    const clef = side === 'R' ? 'treble' : 'bass';
    const f = fingers[side] ?? null;
    if (item.kind === 'chord') {
      out.push({ clef, spellings: notes.map((n) => n.spelling), fingers: f as NotationNote['fingers'] });
    } else {
      notes.forEach((n, i) => out.push({ clef, spellings: [n.spelling], fingers: f ? ([f[i] ?? null] as NotationNote['fingers']) : undefined }));
    }
  }
  return out;
}

export function chordTarget(item: LibraryItem & { kind: 'chord' }, hand: HandChoice): ChordTarget {
  return {
    pcs: chordNotes(item.spec.root, item.spec.quality).map(pitchClass),
    bass: pitchClass(bassNote(item.spec)),
    both: hand === 'both',
  };
}

/** The reference sequence a scale is checked against (one hand's notes; both hands play the same pitch classes). */
export function scaleReference(item: LibraryItem & { kind: 'scale' }, octaves: 1 | 2, direction: ScaleDirection): number[] {
  return scaleSequence({ tonic: item.tonic, type: item.type, octaves }, 'R', direction).map((n) => n.midi);
}
