import { describe, expect, it } from 'vitest';
import type { SongData, SongNote } from '../../core/song';
import { SongPlayer, type PassReport } from './song-player';

const note = (midi: number, beat: number, hand: 'L' | 'R' = 'R'): SongNote => ({ id: `n${beat}-${midi}`, midi, beat, duration: 1, hand, finger: null, velocity: 0.7 });

/** Two bars of 4/4 at 60 BPM: C D E F G, with a left-hand note under the first. */
const data: SongData = {
  notes: [note(60, 0), note(48, 0, 'L'), note(62, 1), note(64, 2), note(65, 3), note(67, 4)],
  measures: [{ label: '1', beat: 0, length: 4 }, { label: '2', beat: 4, length: 4 }],
  tempos: [{ beat: 0, bpm: 60 }],
  timeSignature: [4, 4],
  key: 'C major',
};

describe('song player, wait mode', () => {
  it('ends the pass as soon as the last note is played, before the song reaches the end', () => {
    const player = new SongPlayer(data, { hands: 'right', otherHand: 'mute', mode: 'wait', tempo: 1, loop: false, countIn: false, progressiveTempo: false });
    const passes: PassReport[] = [];
    player.on('pass', (p) => passes.push(p));
    player.setRange(0, 8);
    player.start();
    const t = performance.now();
    player.frame(t + 500);
    player.noteOn(61, t + 600); // a wrong note
    for (const midi of [60, 62, 64, 65]) player.noteOn(midi, t + 700);
    expect(passes).toHaveLength(0);
    player.noteOn(67, t + 800);
    // Eight beats at 60 BPM would take eight seconds; the pass is over at once.
    expect(passes).toHaveLength(1);
    expect(passes[0]).toMatchObject({ mode: 'wait', hands: 'right', wrong: 1, clean: false });
    expect(passes[0]!.accuracy).toBeCloseTo(5 / 6);
    expect(player.phase).toBe('finished');
  });

  it('loops straight back to the start when looping', () => {
    const player = new SongPlayer(data, { hands: 'right', otherHand: 'mute', mode: 'wait', tempo: 1, loop: true, countIn: false, progressiveTempo: false });
    const passes: PassReport[] = [];
    player.on('pass', (p) => passes.push(p));
    player.setRange(0, 8);
    player.start();
    for (const midi of [60, 62, 64, 65, 67]) player.noteOn(midi, performance.now());
    expect(passes).toHaveLength(1);
    expect(passes[0]!.clean).toBe(true);
    expect(player.phase).toBe('playing');
    expect(player.position).toBe(0);
    expect(player.waitingKeys).toEqual([60]);
  });
});
