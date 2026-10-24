import { describe, expect, it } from 'vitest';
import { bassNote, chordNotes, pitchClass, type ChordSpec } from '../../core/chords';
import { checkChord, ScaleTracker, type ChordTarget } from './check';

const target = (spec: ChordSpec, both = false): ChordTarget => ({
  pcs: chordNotes(spec.root, spec.quality).map(pitchClass),
  bass: pitchClass(bassNote(spec)),
  both,
});

describe('checkChord', () => {
  const cMajor = target({ root: 'C', quality: 'M', inversion: 0 });

  it('accepts any voicing and octave with the right bass', () => {
    expect(checkChord([60, 64, 67], cMajor).complete).toBe(true);
    expect(checkChord([48, 67, 76], cMajor).complete).toBe(true); // open voicing
    expect(checkChord([36, 48, 64, 67, 72], cMajor).complete).toBe(true); // doubled root
  });

  it('requires the inversion’s bass', () => {
    expect(checkChord([64, 67, 72], cMajor)).toMatchObject({ complete: false, bassOk: false });
    const firstInv = target({ root: 'C', quality: 'M', inversion: 1 });
    expect(checkChord([64, 67, 72], firstInv).complete).toBe(true);
    expect(checkChord([52, 60, 67, 72], firstInv).complete).toBe(true);
  });

  it('reports extra and missing notes', () => {
    expect(checkChord([60, 64, 66, 67], cMajor)).toMatchObject({ complete: false, extra: [66], missing: [] });
    expect(checkChord([60, 67], cMajor)).toMatchObject({ complete: false, missing: [4] });
  });

  it('recognises spelled chords enharmonically (F#m7 / Gbm7 keys)', () => {
    const fsm7 = target({ root: 'F#', quality: 'm7', inversion: 2 }); // bass C#
    expect(checkChord([61, 64, 66, 69], fsm7).complete).toBe(true);
    const ebdim7 = target({ root: 'Eb', quality: 'dim7', inversion: 0 }); // Eb Gb Bbb Dbb
    expect(checkChord([63, 66, 69, 72], ebdim7).complete).toBe(true);
  });

  it('hands together needs the chord in each hand', () => {
    const both = target({ root: 'C', quality: 'M', inversion: 0 }, true);
    expect(checkChord([48, 52, 55, 60, 64, 67], both).complete).toBe(true);
    expect(checkChord([48, 52, 55, 67], both).complete).toBe(false);
  });
});

describe('ScaleTracker', () => {
  const cMajor = [60, 62, 64, 65, 67, 69, 71, 72];

  it('follows a scale in any octave', () => {
    const t = new ScaleTracker(cMajor);
    const steps = [72, 74, 76, 77, 79, 81, 83, 84].map((n) => t.press(n));
    expect(steps.at(-1)).toBe('done');
    expect(t.errors).toBe(0);
  });

  it('counts a wrong note and continues from the expected one', () => {
    const t = new ScaleTracker(cMajor);
    expect(t.press(60)).toBe('ok');
    expect(t.press(63)).toBe('wrong');
    expect(t.nextKey()).toBe(62);
    for (const n of [62, 64, 65, 67, 69, 71]) t.press(n);
    expect(t.press(72)).toBe('done');
    expect(t.errors).toBe(1);
  });

  it('must start on the tonic', () => {
    const t = new ScaleTracker(cMajor);
    expect(t.press(62)).toBe('wrong');
    expect(t.press(48)).toBe('ok');
    expect(t.nextKey()).toBe(50);
  });

  it('hands together needs each note in both hands', () => {
    const t = new ScaleTracker([60, 62, 64], true);
    expect(t.press(48)).toBe('ok');
    expect(t.index).toBe(0);
    expect(t.press(48)).toBe('wrong'); // same key twice is not two hands
    expect(t.press(60)).toBe('ok');
    expect(t.index).toBe(1);
    t.press(62);
    t.press(50);
    t.press(64);
    expect(t.press(52)).toBe('done');
  });
});
