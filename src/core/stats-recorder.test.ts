import { beforeEach, describe, expect, it } from 'vitest';
import { IDLE_MS, StatsRecorder } from './stats-recorder';
import { AFFINITY_HALF_LIFE_MS, decayAffinity, localDate, type ItemRef, type StatsDelta } from './stats';

const T0 = new Date(2026, 9, 24, 10, 0, 0).getTime();
const SONG: ItemRef = { id: 'song:s1', kind: 'song', songId: 's1' };
const SECTION: ItemRef = { id: 'section:s1:s0', kind: 'section', songId: 's1' };
const CHORD: ItemRef = { id: 'chord:C:maj7', kind: 'chord', songId: null };

let now = T0;
let saved: StatsDelta[] = [];
let failNext = false;
let rec: StatsRecorder;

beforeEach(() => {
  now = T0;
  saved = [];
  failNext = false;
  rec = new StatsRecorder(
    {
      applyStats: async (delta) => {
        if (failNext) {
          failNext = false;
          throw new Error('disk full');
        }
        saved.push(delta);
      },
    },
    () => now,
  );
});

const at = (seconds: number) => (now = T0 + seconds * 1000);
const press = (seconds: number, midi = 60) => {
  at(seconds);
  rec.notePlayed(midi);
};
const item = (ref: ItemRef) => rec.unsaved.items.get(ref.id);

describe('play counting', () => {
  it('counts one play per session at the first completed pass, however many loops follow', () => {
    rec.start({ voluntary: true }, [SONG, SECTION]);
    press(1);
    rec.completed();
    expect(item(SECTION)?.plays).toBe(1);
    press(5);
    rec.completed();
    rec.completed();
    at(8);
    rec.end();
    expect(item(SONG)?.plays).toBe(1);
    expect(item(SECTION)?.plays).toBe(1);
  });

  it('counts a play at the end of a session without a completed pass', () => {
    rec.start({ voluntary: true }, [SECTION]);
    press(2);
    expect(item(SECTION)?.plays).toBe(0);
    at(4);
    rec.end();
    expect(item(SECTION)?.plays).toBe(1);
    expect(item(SECTION)?.lastPlayed).toBe(T0 + 4000);
  });

  it('counts each session once', () => {
    for (let i = 0; i < 3; i++) {
      rec.start({ voluntary: true }, [CHORD]);
      press(i * 10 + 1);
      rec.end();
    }
    expect(item(CHORD)?.plays).toBe(3);
  });

  it('does not count an item that was only opened', () => {
    rec.start({ voluntary: true }, [SONG]);
    at(20);
    rec.end();
    expect(item(SONG)).toBeUndefined();
  });

  it('counts every card a drill session played, once each', () => {
    const other: ItemRef = { id: 'scale:D:major', kind: 'scale', songId: null };
    rec.start({ voluntary: false }, [CHORD]);
    press(1);
    rec.focus([other]);
    press(3);
    rec.focus([CHORD]);
    press(5);
    rec.start({ voluntary: false }, []);
    expect(item(CHORD)?.plays).toBe(1);
    expect(item(other)?.plays).toBe(1);
  });
});

describe('active time', () => {
  it('counts gaps between key presses up to the idle limit, and none of a longer one', () => {
    rec.start({ voluntary: true }, [CHORD]);
    press(10);
    press(20);
    press(20 + IDLE_MS / 1000 + 15); // idle: none of these 45 s
    press(70);
    at(75);
    rec.end();
    expect(item(CHORD)?.practiceMs).toBe((10 + 10 + 5 + 5) * 1000);
    expect(rec.unsaved.daily.get(localDate(T0))?.practiceMs).toBe(30_000);
  });

  it('counts a gap of exactly the idle limit', () => {
    rec.start({ voluntary: true }, [CHORD]);
    press(IDLE_MS / 1000);
    expect(item(CHORD)?.practiceMs).toBe(IDLE_MS);
  });

  it('pauses while the tab is hidden', () => {
    rec.start({ voluntary: true }, [CHORD]);
    press(5);
    at(10);
    rec.setHidden(true);
    press(60); // keys still count, time doesn't
    at(300);
    rec.setHidden(false);
    press(304);
    rec.end();
    expect(item(CHORD)?.practiceMs).toBe((5 + 5 + 4) * 1000);
    expect(rec.unsaved.keyHits.get(60)).toBe(3);
  });

  it('keeps scheduled reviews out of voluntary time', () => {
    rec.start({ voluntary: false }, [SECTION]);
    press(10);
    rec.start({ voluntary: true }, [SECTION]);
    press(30);
    rec.end();
    expect(item(SECTION)).toMatchObject({ practiceMs: 30_000, voluntaryMs: 20_000 });
  });

  it('gives time to what was in focus when it was spent', () => {
    rec.start({ voluntary: true }, [SONG, SECTION]);
    press(10);
    rec.focus([SONG]);
    press(15);
    rec.end();
    expect(item(SONG)?.practiceMs).toBe(15_000);
    expect(item(SECTION)?.practiceMs).toBe(10_000);
  });

  it('counts key presses outside a session, without time', () => {
    press(1, 64);
    press(2, 64);
    expect(rec.unsaved.keyHits.get(64)).toBe(2);
    expect(rec.unsaved.daily.get(localDate(T0))).toEqual({ practiceMs: 0, notesPlayed: 2 });
    expect(rec.unsaved.items.size).toBe(0);
  });
});

describe('saving', () => {
  it('saves pending counts as one batch, and nothing when there is nothing new', async () => {
    rec.start({ voluntary: true }, [CHORD]);
    press(1);
    rec.result(CHORD, true);
    rec.result(CHORD, false);
    rec.confusion(CHORD.id, 'C7');
    rec.confusion(CHORD.id, 'C7');
    await rec.flush();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.items.get(CHORD.id)).toMatchObject({ hits: 1, misses: 1, practiceMs: 1000 });
    expect(saved[0]!.confusions.get('chord:C:maj7>C7')?.count).toBe(2);
    await rec.flush();
    expect(saved).toHaveLength(1);
  });

  it('does not count the gap still running when it saves', async () => {
    rec.start({ voluntary: true }, [CHORD]);
    press(5);
    at(20);
    await rec.flush();
    expect(saved[0]!.items.get(CHORD.id)?.practiceMs).toBe(5000);
    // The gap turns out idle: none of it counts.
    press(5 + IDLE_MS / 1000 + 1);
    rec.end();
    await rec.flush();
    expect(saved[1]!.items.get(CHORD.id)?.practiceMs).toBe(0);
  });

  it('keeps counts from a failed save for the next one', async () => {
    rec.start({ voluntary: true }, [SECTION]);
    press(1);
    rec.result(SECTION, true, 'L');
    failNext = true;
    await rec.flush();
    rec.result(SECTION, false, 'R');
    rec.measureMiss('s1', 3);
    await rec.flush();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.items.get(SECTION.id)).toMatchObject({ hits: 1, misses: 1, hands: { L: { hits: 1, misses: 0 }, R: { hits: 0, misses: 1 } } });
    expect(saved[0]!.measureMisses.get('s1:3')?.misses).toBe(1);
  });
});

describe('affinity decay', () => {
  it('halves every 30 days', () => {
    expect(decayAffinity(1000, T0, T0)).toBe(1000);
    expect(decayAffinity(1000, T0, T0 + AFFINITY_HALF_LIFE_MS)).toBeCloseTo(500);
    expect(decayAffinity(1000, T0, T0 + 2 * AFFINITY_HALF_LIFE_MS)).toBeCloseTo(250);
    // Never grows when the clock goes backwards.
    expect(decayAffinity(1000, T0, T0 - AFFINITY_HALF_LIFE_MS)).toBe(1000);
  });

  it('applied step by step gives the same as all at once', () => {
    const day = 24 * 60 * 60 * 1000;
    let value = 0;
    let since = T0;
    for (let d = 1; d <= 10; d++) {
      value = decayAffinity(value, since, T0 + d * day) + 60_000;
      since = T0 + d * day;
    }
    let direct = 0;
    for (let d = 1; d <= 10; d++) direct += 60_000 * 2 ** (-((10 - d) * day) / AFFINITY_HALF_LIFE_MS);
    expect(value).toBeCloseTo(direct, 6);
  });
});
