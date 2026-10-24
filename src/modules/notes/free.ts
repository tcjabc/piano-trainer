/** The card set for free practice, built from the remembered selection. */
import type { StaffKind } from '../../core/notation';
import { isBlackKey, midiToName, MIDDLE_C, spellingToMidi, type Clef } from '../../core/pitch';
import { clefForHand, type FreeNoteSettings, type HandChoice } from '../../core/settings';
import type { NoteCardContent } from '../../core/storage';
import { contentsFor } from './cards';

export function staffForHand(hand: HandChoice): StaffKind {
  const clef = clefForHand(hand);
  return clef === 'both' ? 'grand' : clef;
}

/** Which staff a picked key is shown on: the hand's clef, or split at middle C for both hands. */
function clefForKey(midi: number, hand: HandChoice): Clef {
  if (hand === 'left') return 'bass';
  if (hand === 'right') return 'treble';
  return midi >= MIDDLE_C ? 'treble' : 'bass';
}

/** Spellings for a picked key: naturals as-is; black keys as a sharp, plus the flat with accidentals on. */
function spellingsForKey(midi: number, accidentals: boolean): string[] {
  const sharp = midiToName(midi);
  if (!isBlackKey(midi)) return [sharp];
  if (!accidentals) return [sharp];
  const above = midiToName(midi + 1); // the white key a semitone up, e.g. D4 for C#4/Db4
  const flat = `${above[0]}b${above.slice(1)}`;
  return [sharp, flat];
}

export function freeContents(s: FreeNoteSettings): NoteCardContent[] {
  if (s.selection === 'range') {
    return contentsFor({ ...s, clef: clefForHand(s.hand), newPerDay: 0 });
  }
  return [...new Set(s.specific)]
    .sort((a, b) => a - b)
    .flatMap((midi) =>
      spellingsForKey(midi, s.accidentals).map((spelling) => ({ clef: clefForKey(midi, s.hand), spelling, midi })),
    )
    .filter((c) => spellingToMidi(c.spelling) === c.midi);
}

/** Lowest and highest keys in the set, for the on-screen keyboard. */
export function freeRange(s: FreeNoteSettings): [number, number] | null {
  const midis = freeContents(s).map((c) => c.midi);
  return midis.length ? [Math.min(...midis), Math.max(...midis)] : null;
}
