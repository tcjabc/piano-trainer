import { Rating } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { GRADING, gradeScale, gradeTimed } from './grading';

describe('grading config', () => {
  it('gives chords more time than notes', () => {
    expect(gradeTimed(true, 2000, false, GRADING.notes)).toBe(Rating.Good);
    expect(gradeTimed(true, 2000, false, GRADING.chords)).toBe(Rating.Easy);
    expect(gradeTimed(true, 5000, false, GRADING.chords)).toBe(Rating.Good);
    expect(gradeTimed(true, 7000, false, GRADING.chords)).toBe(Rating.Hard);
    expect(gradeTimed(false, 500, false, GRADING.chords)).toBe(Rating.Again);
  });

  it('grades a scale on wrong notes, then speed per note', () => {
    expect(gradeScale(0, 7 * 300, 8, false)).toBe(Rating.Easy);
    expect(gradeScale(0, 7 * 500, 8, false)).toBe(Rating.Good);
    expect(gradeScale(0, 7 * 900, 8, false)).toBe(Rating.Hard);
    expect(gradeScale(1, 7 * 300, 8, false)).toBe(Rating.Hard);
    expect(gradeScale(GRADING.scales.maxErrorsToPass + 1, 1000, 8, false)).toBe(Rating.Again);
    expect(gradeScale(0, 7 * 300, 8, true)).toBe(Rating.Hard);
  });
});
