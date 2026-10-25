// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { ChordCardContent, ScaleCardContent } from '../../core/storage';
import type { Keyboard } from '../../ui/keyboard';
import type { StaffView } from '../../ui/staff';
import { ChordTask, ScaleTask, type TaskHost } from './tasks';

/** A drill host that only remembers what the stats were told. */
function host() {
  const tallies: boolean[] = [];
  const confusions: string[] = [];
  const keyboard = { flash() {}, setTargets() {}, setFocus() {}, setFinger() {} } as unknown as Keyboard;
  const staff = { setState() {}, showPrompt() {} } as unknown as StaffView;
  const h: TaskHost = {
    keyboard,
    staff,
    options: { scaleDirection: 'up', chordStaff: false, fingering: false },
    elapsed: () => 0,
    outcome: () => undefined,
    complete: () => undefined,
    stage: () => undefined,
    tally: (correct) => tallies.push(correct),
    confused: (symbol) => confusions.push(symbol),
  };
  return { h, tallies, confusions };
}

/** Press these keys together, then let them all go. */
function attempt(task: ChordTask, notes: number[]): void {
  const held = new Set<number>();
  for (const n of notes) {
    held.add(n);
    task.noteOn(n, 0, held);
  }
  for (const n of notes) {
    held.delete(n);
    task.noteOff(n, 0, held);
  }
}

const cmaj7: ChordCardContent = { root: 'C', quality: 'maj7', inversion: 0, hand: 'right' };

describe('chord drill stats', () => {
  it('counts each attempt once, and a chord that was another chord as a confusion', () => {
    const { h, tallies, confusions } = host();
    const task = new ChordTask(cmaj7, h);
    attempt(task, [60, 64, 67, 70]); // C7: B♭ is not in the chord (wrong at once, then again on release)
    attempt(task, [60, 64, 67]); // C major: let go without the seventh
    attempt(task, [60, 64, 67, 71]);
    expect(tallies).toEqual([false, false, true]);
    expect(confusions).toEqual(['C7', 'C']);
  });

  it('is no confusion when the notes were right but the voicing was not', () => {
    const { h, tallies, confusions } = host();
    const task = new ChordTask({ ...cmaj7, inversion: 1 }, h);
    attempt(task, [60, 64, 67, 71]); // root position, but first inversion wanted
    expect(tallies).toEqual([false]);
    expect(confusions).toEqual([]);
  });

  it('is no confusion when the notes make no chord', () => {
    const { h, confusions } = host();
    attempt(new ChordTask(cmaj7, h), [60, 61]);
    expect(confusions).toEqual([]);
  });
});

describe('scale drill stats', () => {
  it('counts every note', () => {
    const { h, tallies } = host();
    const c: ScaleCardContent = { tonic: 'C', type: 'major', hand: 'right', octaves: 1 };
    const task = new ScaleTask(c, h);
    for (const n of [60, 62, 63, 64, 65, 67, 69, 71, 72]) task.noteOn(n, 0);
    expect(tallies.filter((t) => t)).toHaveLength(8);
    expect(tallies.filter((t) => !t)).toHaveLength(1);
  });
});
