/**
 * How answers become FSRS grades, per kind of card. All thresholds live here.
 *
 * Notes and chords: wrong = Again; correct → Easy / Good / Hard by response
 * time (chords allow more time). Hearing the answer first caps at Hard.
 * Scales: graded when finished, on wrong notes and speed per note.
 */
import { Rating, type Grade } from 'ts-fsrs';

export const GRADING = {
  /** Time from the card appearing to the right key. */
  notes: { easyUnderMs: 1000, hardOverMs: 3000 },
  /** Time from the card appearing to the whole chord held. */
  chords: { easyUnderMs: 2500, hardOverMs: 6000 },
  /** Average time per note from the first note to the last; wrong notes allowed before it counts as failed. */
  scales: { easyMsPerNote: 350, hardMsPerNote: 800, maxErrorsToPass: 2 },
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
