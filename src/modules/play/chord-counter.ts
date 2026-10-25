/**
 * Counting the chords played in Play, for the stats. A chord counts once it
 * has been held for CHORD_HOLD_MS, so passing chords on the way to another
 * (a key not yet down, a voicing being changed) don't. Held on, it counts
 * once. The same chord counts again only after a release: every key up, or
 * something else held long enough to count (another chord, or notes that
 * make none). So a legato C – F – C counts three chords, and Cmaj7 that
 * flickers through C for a moment while it is revoiced counts one. Chords
 * count by name: C/E is C, so changing inversion doesn't count again.
 *
 * A chord is counted when it ends (it changes, the keys are let go or Play
 * is left) and has lasted long enough; no timers.
 */
import { chordByName, detectChord } from './harmony';

export const CHORD_HOLD_MS = 300;

export class ChordCounter {
  /** What is held now (null: no chord), and since when. */
  private symbol: string | null = null;
  private since = 0;
  /** The last chord counted, until a release. */
  private lastCounted: string | null = null;

  /** The held keys changed at `time` (ms); returns the chord that just counted, if any. */
  update(held: Iterable<number>, time: number): string | null {
    const notes = [...held];
    const chord = detectChord(notes);
    const symbol = chord ? chordByName(chord.symbol) : null;
    if (symbol === this.symbol) {
      // The same chord with a note doubled or dropped carries on.
      if (notes.length === 0) this.lastCounted = null;
      return null;
    }
    const counted = this.close(time);
    if (notes.length === 0) this.lastCounted = null;
    this.symbol = symbol;
    this.since = time;
    return counted;
  }

  /** Play was left: the chord held now ends. */
  finish(time: number): string | null {
    const counted = this.close(time);
    this.symbol = null;
    this.lastCounted = null;
    return counted;
  }

  /** The held state ends at `time`: count it if it was a chord held long enough. */
  private close(time: number): string | null {
    if (time - this.since < CHORD_HOLD_MS) return null;
    if (this.symbol === null) {
      this.lastCounted = null;
      return null;
    }
    if (this.symbol === this.lastCounted) return null;
    this.lastCounted = this.symbol;
    return this.symbol;
  }
}
