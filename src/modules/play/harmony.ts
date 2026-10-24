/** What is being held: note spellings and the detected chord (via tonal). */
import { Chord, Note } from 'tonal';
import { midiToName, parseSpelling, spellingToMidi } from '../../core/pitch';

export interface DetectedChord {
  /** Short symbol, e.g. "C", "Am7", "C/E". */
  symbol: string;
  /** Long name, e.g. "C major over E". */
  name: string;
  /** Pitch-class spellings from the chord, e.g. ["C", "E", "G"]. */
  notes: string[];
}

/** Qualities a player most likely means, in order of preference, when tonal offers several readings. */
const COMMON_QUALITIES = [
  'M', 'm', '7', 'maj7', 'm7', 'dim', 'dim7', 'm7b5', 'aug', 'sus4', 'sus2',
  '6', 'm6', '9', 'maj9', 'm9', '7sus4', 'add9', 'madd9', 'mMaj7', '5',
];

function qualityRank(symbol: string): number {
  const i = COMMON_QUALITIES.indexOf(Chord.get(symbol).aliases[0] ?? '');
  const slash = symbol.includes('/') ? 0.5 : 0; // root position reads more naturally
  return (i < 0 ? COMMON_QUALITIES.length : i) + slash;
}

/** Pitch classes in order from the lowest note, without repeats, spelled with sharps or flats. */
function pitchClassesFromBass(midis: number[], flats: boolean): string[] {
  const out: string[] = [];
  for (const m of [...midis].sort((a, b) => a - b)) {
    const pc = Note.pitchClass(flats ? Note.fromMidi(m) : Note.fromMidiSharps(m));
    if (!out.includes(pc)) out.push(pc);
  }
  return out;
}

/** Accidentals needed to spell a chord; double sharps and flats count extra. */
function spellingCost(symbol: string): number {
  return Chord.get(symbol).notes.reduce((sum, n) => {
    const acc = n.slice(1).length;
    return sum + acc + (acc > 1 ? 4 : 0);
  }, 0);
}

/** The chord formed by three or more held notes, or null. */
export function detectChord(midis: number[]): DetectedChord | null {
  if (midis.length < 3) return null;
  const sharps = pitchClassesFromBass(midis, false);
  if (sharps.length < 3) return null;
  // Black keys can be read either way; try both and keep the simplest spelling.
  const candidates = [...new Set([...Chord.detect(sharps), ...Chord.detect(pitchClassesFromBass(midis, true))])];
  if (candidates.length === 0) return null;
  const best = candidates.sort(
    (a, b) => qualityRank(a) - qualityRank(b) || spellingCost(a) - spellingCost(b),
  )[0]!;
  const chord = Chord.get(best);
  // tonal writes a major triad as "CM"; players write "C".
  const symbol = best.replace(/^([A-G][#b]*)M(?=$|\/)/, '$1');
  return { symbol, name: chord.name, notes: chord.notes };
}

/**
 * Spell held notes for the staff: by the chord's spelling when there is one
 * (so E♭ major shows E♭, not D♯), otherwise with sharps. Low to high.
 */
export function spellHeld(midis: number[], chord: DetectedChord | null = null): string[] {
  return [...midis]
    .sort((a, b) => a - b)
    .map((m) => {
      const pc = chord?.notes.find((n) => /^[A-G][#b]?$/.test(n) && ((spellingToMidi(`${n}4`) - m) % 12 + 12) % 12 === 0);
      if (!pc) return midiToName(m);
      // Octave numbers follow the letter, so B♯ / C♭ can sit in the neighbouring octave.
      const base = Math.floor(m / 12) - 1;
      for (const octave of [base, base - 1, base + 1]) {
        if (spellingToMidi(parseSpelling(`${pc}${octave}`)) === m) return `${pc}${octave}`;
      }
      return midiToName(m);
    });
}
