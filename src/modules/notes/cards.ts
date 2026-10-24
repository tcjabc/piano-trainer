/** Which note cards exist for a set of drill options, and the order new ones are introduced. */
import { newFsrsState } from '../../core/scheduler';
import {
  formatSpelling,
  ledgerLineCount,
  MIDDLE_C,
  naturalsBetween,
  spellingToMidi,
  type Clef,
  type Spelling,
} from '../../core/pitch';
import type { NoteDrillOptions } from '../../core/settings';
import { uuid, type CardRecord, type NoteCardContent } from '../../core/storage';

export function cardKey(clef: Clef, spelling: string): string {
  return `notes:${clef}:${spelling}`;
}

export function clefsFor(options: NoteDrillOptions): Clef[] {
  return options.clef === 'both' ? ['treble', 'bass'] : [options.clef];
}

/** Spellings for one clef, low to high. Accidentals add a sharp and a flat card per black key. */
export function spellingsFor(clef: Clef, options: NoteDrillOptions): Spelling[] {
  const range = options[clef];
  const naturals = naturalsBetween(range.low, range.high);
  const lowMidi = spellingToMidi(range.low);
  const highMidi = spellingToMidi(range.high);
  const out: Spelling[] = [];
  for (const n of naturals) {
    out.push(n);
    if (!options.accidentals) continue;
    // Sharp of this letter and flat of the next one name the same black key.
    if (n.letter !== 'E' && n.letter !== 'B') {
      const sharp: Spelling = { ...n, accidental: '#' };
      if (spellingToMidi(sharp) <= highMidi) out.push(sharp);
    }
    if (n.letter !== 'C' && n.letter !== 'F') {
      const flat: Spelling = { ...n, accidental: 'b' };
      if (spellingToMidi(flat) >= lowMidi) out.push(flat);
    }
  }
  const visible = options.ledgerLines ? out : out.filter((s) => ledgerLineCount(s, clef) === 0);
  return visible.sort((a, b) => spellingToMidi(a) - spellingToMidi(b));
}

export function contentsFor(options: NoteDrillOptions): NoteCardContent[] {
  return clefsFor(options).flatMap((clef) =>
    spellingsFor(clef, options).map((s) => ({ clef, spelling: formatSpelling(s), midi: spellingToMidi(s) })),
  );
}

export function newCard(content: NoteCardContent, now: number): CardRecord {
  return {
    id: uuid(),
    key: cardKey(content.clef, content.spelling),
    module: 'notes',
    content,
    fsrs: newFsrsState(now),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Order for introducing new cards: outward from middle C, naturals before
 * accidentals, treble before bass on ties.
 */
export function introductionOrder(a: NoteCardContent, b: NoteCardContent): number {
  const dist = (c: NoteCardContent) => Math.abs(c.midi - MIDDLE_C);
  const acc = (c: NoteCardContent) => (c.spelling.length > 2 ? 1 : 0);
  return (
    acc(a) - acc(b) ||
    dist(a) - dist(b) ||
    (a.clef === b.clef ? 0 : a.clef === 'treble' ? -1 : 1) ||
    a.midi - b.midi
  );
}
