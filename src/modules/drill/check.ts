/**
 * Checking what is played against a chord or scale. Pure logic, shared by the
 * drills and the Library's play-along.
 */

const pc = (midi: number) => ((midi % 12) + 12) % 12;

// ── Chords ─────────────────────────────────────────────────────────────

export interface ChordTarget {
  /** Pitch classes of the chord. */
  pcs: number[];
  /** Pitch class that must be lowest (the inversion's bass), or null for any. */
  bass: number | null;
  /** Hands together: the whole chord in each hand. */
  both: boolean;
}

export interface ChordCheck {
  /** Exactly the chord, voiced as required. */
  complete: boolean;
  /** Held keys that are not in the chord. */
  extra: number[];
  /** Chord pitch classes not held at all. */
  missing: number[];
  /** The lowest note is the required bass (true when no bass is required or nothing is held). */
  bassOk: boolean;
}

/** Can these (sorted) notes be the chord, with the right bass? */
function isVoicing(notes: number[], t: ChordTarget): boolean {
  if (notes.length === 0) return false;
  const present = new Set(notes.map(pc));
  if (!t.pcs.every((p) => present.has(p))) return false;
  if (notes.some((n) => !t.pcs.includes(pc(n)))) return false;
  return t.bass === null || pc(notes[0]!) === t.bass;
}

/** Any voicing and octave counts; with `both`, some split must give each hand the full chord. */
export function checkChord(held: Iterable<number>, t: ChordTarget): ChordCheck {
  const notes = [...new Set(held)].sort((a, b) => a - b);
  const present = new Set(notes.map(pc));
  const extra = notes.filter((n) => !t.pcs.includes(pc(n)));
  const missing = t.pcs.filter((p) => !present.has(p));
  const bassOk = notes.length === 0 || t.bass === null || pc(notes[0]!) === t.bass;
  let complete = false;
  if (!t.both) complete = isVoicing(notes, t);
  else {
    for (let k = 1; k < notes.length && !complete; k++) {
      complete = isVoicing(notes.slice(0, k), t) && isVoicing(notes.slice(k), t);
    }
  }
  return { complete, extra, missing, bassOk };
}

// ── Scales ─────────────────────────────────────────────────────────────

export type ScaleStep = 'ok' | 'wrong' | 'done';

/**
 * Follows a scale as it is played, note by note. One hand: exact steps, in
 * whatever octave the first (tonic) note is played. Hands together: each
 * step needs its pitch class played twice (one note per hand), in either
 * order. A wrong note is counted and the scale continues from the note that
 * was expected.
 */
export class ScaleTracker {
  /** Index of the next expected step. */
  index = 0;
  errors = 0;
  firstAt: number | null = null;
  lastAt: number | null = null;
  private offset: number | null = null;
  private pairFirst: number | null = null;

  constructor(
    /** The scale as voiced in the app (one hand), ascending/descending as practised. */
    private readonly expected: number[],
    private readonly both = false,
  ) {}

  get length(): number {
    return this.expected.length;
  }

  get done(): boolean {
    return this.index >= this.expected.length;
  }

  /** The key the next note should be (in the octave being played), for marking it. */
  nextKey(): number | null {
    if (this.done) return null;
    const ref = this.expected[this.index]!;
    return this.offset === null ? ref : ref + this.offset;
  }

  press(note: number, time = performance.now()): ScaleStep {
    if (this.done) return 'done';
    this.firstAt ??= time;
    this.lastAt = time;
    const want = this.expected[this.index]!;

    if (this.both) {
      if (pc(note) !== pc(want) || note === this.pairFirst) return this.miss();
      if (this.pairFirst === null) {
        this.pairFirst = note;
        return 'ok';
      }
      this.pairFirst = null;
      return this.advance();
    }

    if (this.offset === null) {
      // The first note fixes the octave; it must be the tonic.
      if (pc(note) !== pc(want)) return this.miss();
      this.offset = note - want;
      return this.advance();
    }
    return note === want + this.offset ? this.advance() : this.miss();
  }

  private advance(): ScaleStep {
    this.index++;
    return this.done ? 'done' : 'ok';
  }

  private miss(): ScaleStep {
    this.errors++;
    return 'wrong';
  }

  /** Time from the first to the last note. */
  get elapsedMs(): number {
    return this.firstAt === null || this.lastAt === null ? 0 : this.lastAt - this.firstAt;
  }
}
