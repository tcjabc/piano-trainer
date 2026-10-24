/**
 * How answers become FSRS grades, per kind of card. All thresholds live here.
 *
 * Notes and chords: wrong = Again; correct → Easy / Good / Hard by response
 * time (chords allow more time). Hearing the answer first caps at Hard.
 * Scales: graded when finished, on wrong notes and speed per note.
 * Songs: a pass through a section is judged on accuracy and timing, and
 * drives the learning path (see song-learning.ts).
 */
import { Rating, type Grade } from 'ts-fsrs';

export const GRADING = {
  /** Time from the card appearing to the right key. */
  notes: { easyUnderMs: 1000, hardOverMs: 3000 },
  /** Time from the card appearing to the whole chord held. */
  chords: { easyUnderMs: 2500, hardOverMs: 6000 },
  /** Average time per note from the first note to the last; wrong notes allowed before it counts as failed. */
  scales: { easyMsPerNote: 350, hardMsPerNote: 800, maxErrorsToPass: 2 },
  songs: {
    /** Play-along: this close to the note's time is on time… */
    onTimeMs: 100,
    /** …and up to this far early or late still counts as the note (marked early/late). */
    hitWindowMs: 250,
    /** A clean pass: share of notes right (wrong presses count against it)… */
    cleanAccuracy: 0.95,
    /** …and, in play-along, the share of notes on time. */
    cleanOnTime: 0.9,
    /** Learning path: the slow steps' tempo, clean passes in a row to move on, and the speed-up step. */
    slowTempo: 0.6,
    cleanPassesToAdvance: 2,
    tempoStep: 0.05,
    /** Review cards: below this accuracy is Again; a clean pass this much on time is Easy. */
    againUnderAccuracy: 0.8,
    easyOnTime: 0.95,
  },
} as const;

export interface Thresholds {
  easyUnderMs: number;
  hardOverMs: number;
}

/** A timed right/wrong answer (notes, chords). */
export function gradeTimed(correct: boolean, ms: number, hinted: boolean, t: Thresholds): Grade {
  if (!correct) return Rating.Again;
  if (hinted || ms > t.hardOverMs) return Rating.Hard;
  if (ms < t.easyUnderMs) return Rating.Easy;
  return Rating.Good;
}

/** A finished scale: more than a couple of wrong notes fails it; otherwise speed decides. */
export function gradeScale(errors: number, ms: number, notes: number, hinted: boolean): Grade {
  const s = GRADING.scales;
  if (errors > s.maxErrorsToPass) return Rating.Again;
  const perNote = ms / Math.max(1, notes - 1);
  if (errors > 0 || hinted || perNote > s.hardMsPerNote) return Rating.Hard;
  if (perNote < s.easyMsPerNote) return Rating.Easy;
  return Rating.Good;
}

/** Whether a finished scale counts as played correctly (for logs and feedback). */
export function scalePassed(errors: number): boolean {
  return errors <= GRADING.scales.maxErrorsToPass;
}

/** How a pass through a song section went. */
export interface SongPassResult {
  mode: 'wait' | 'play-along';
  /** Notes right ÷ (notes + wrong presses), 0–1. */
  accuracy: number;
  /** Play-along: share of notes on time, 0–1; null in wait mode. */
  onTime: number | null;
}

/** Clean: accurate enough, and in play-along, on time enough. */
export function songPassClean(r: SongPassResult): boolean {
  const s = GRADING.songs;
  return r.accuracy >= s.cleanAccuracy && (r.onTime === null || r.onTime >= s.cleanOnTime);
}

/** A section review card: a poor pass is Again, an untidy one Hard; a clean one Good, or Easy when it was right on time. */
export function gradeSongPass(r: SongPassResult): Grade {
  const s = GRADING.songs;
  if (r.accuracy < s.againUnderAccuracy) return Rating.Again;
  if (!songPassClean(r)) return Rating.Hard;
  const easy = r.onTime === null ? r.accuracy >= 1 : r.onTime >= s.easyOnTime;
  return easy ? Rating.Easy : Rating.Good;
}
