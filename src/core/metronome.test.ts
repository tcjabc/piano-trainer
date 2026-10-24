import { describe, expect, it } from 'vitest';
import {
  clampBpm,
  clicksPerBeat,
  ClickScheduler,
  clickLevel,
  meterOf,
  secondsPerBeat,
  TapTempo,
  type Click,
  type Pattern,
  type SchedulerTimers,
} from './metronome';

describe('tempo and meter', () => {
  it('counts quarter notes in x/4, dotted quarters in 6/8 and 12/8, eighths in 7/8', () => {
    expect(meterOf('2/4')).toEqual({ beats: 2, beatEighths: 2, groupStarts: [] });
    expect(meterOf('5/4')).toEqual({ beats: 5, beatEighths: 2, groupStarts: [] });
    expect(meterOf('6/8')).toEqual({ beats: 2, beatEighths: 3, groupStarts: [] });
    expect(meterOf('12/8')).toEqual({ beats: 4, beatEighths: 3, groupStarts: [] });
    expect(meterOf('7/8')).toEqual({ beats: 7, beatEighths: 1, groupStarts: [2, 4] });
  });

  it('subdivides by note value', () => {
    const four = meterOf('4/4');
    const six = meterOf('6/8');
    expect([clicksPerBeat(four, 'none'), clicksPerBeat(four, '8ths'), clicksPerBeat(four, 'triplets'), clicksPerBeat(four, '16ths')]).toEqual([1, 2, 3, 4]);
    expect([clicksPerBeat(six, '8ths'), clicksPerBeat(six, '16ths'), clicksPerBeat(six, 'triplets')]).toEqual([3, 6, 3]);
    expect(clicksPerBeat(meterOf('7/8'), '8ths')).toBe(1);
  });

  it('accents the first beat and the 7/8 groups', () => {
    const seven = meterOf('7/8');
    expect([0, 1, 2, 3, 4, 5, 6].map((b) => clickLevel(seven, b, 0))).toEqual(['accent', 'beat', 'group', 'beat', 'group', 'beat', 'beat']);
    expect(clickLevel(meterOf('4/4'), 0, 1)).toBe('sub');
  });

  it('clamps and rounds the tempo', () => {
    expect(clampBpm(12)).toBe(30);
    expect(clampBpm(300)).toBe(240);
    expect(clampBpm(97.6)).toBe(98);
    expect(clampBpm(Number.NaN)).toBe(80);
    expect(secondsPerBeat(120)).toBe(0.5);
  });
});

describe('tap tempo', () => {
  it('averages the last four taps', () => {
    const tap = new TapTempo();
    expect(tap.tap(0)).toBeNull();
    expect(tap.tap(500)).toBeCloseTo(120);
    expect(tap.tap(1000)).toBeCloseTo(120);
    expect(tap.tap(1600)).toBeCloseTo(60000 / (1600 / 3));
    // Fifth tap: the first is dropped, so the average covers 500…2100.
    expect(tap.tap(2100)).toBeCloseTo(60000 / (1600 / 3));
  });

  it('starts again after two seconds without a tap', () => {
    const tap = new TapTempo();
    tap.tap(0);
    tap.tap(400);
    expect(tap.tap(2401)).toBeNull();
    expect(tap.tap(3401)).toBeCloseTo(60);
  });
});

/** A clock and interval timer under the test's control. */
function fakeTime() {
  let now = 0;
  let fn: (() => void) | null = null;
  let every = 0;
  let due = 0;
  const timers: SchedulerTimers = {
    setInterval: (f, ms) => {
      fn = f;
      every = ms / 1000;
      due = now + every;
      return 1;
    },
    clearInterval: () => (fn = null),
  };
  return {
    timers,
    clock: () => now,
    /** Advance the clock, firing the interval as it comes due (late by `lag` seconds each time). */
    advance(seconds: number, lag = 0) {
      const end = now + seconds;
      while (fn && due + lag <= end) {
        now = due + lag;
        fn();
        due += every;
      }
      now = end;
    },
  };
}

function run(pattern: Pattern, seconds: number, { countIn = 0, lag = 0 } = {}) {
  const time = fakeTime();
  const clicks: (Click & { scheduledAt: number })[] = [];
  const s = new ClickScheduler(time.clock, (c) => clicks.push({ ...c, scheduledAt: time.clock() }), { timers: time.timers }, pattern);
  const downbeat = s.start(1, countIn);
  time.advance(seconds, lag);
  return { clicks, downbeat, scheduler: s, time };
}

describe('click scheduler', () => {
  const p = (bpm: number, ts: Parameters<typeof meterOf>[0] = '4/4', subdivision: Pattern['subdivision'] = 'none'): Pattern => ({
    bpm,
    meter: meterOf(ts),
    subdivision,
  });

  it('places beats on an exact grid, ahead of the clock', () => {
    const { clicks } = run(p(120), 30);
    const beats = clicks.filter((c) => c.time <= 30);
    expect(beats[0]!.time).toBe(1);
    beats.forEach((c, i) => {
      expect(c.time).toBeCloseTo(1 + i * 0.5, 9);
      // Scheduled before it sounds, by at most the lookahead.
      expect(c.time - c.scheduledAt).toBeGreaterThanOrEqual(0);
      expect(c.time - c.scheduledAt).toBeLessThanOrEqual(0.1 + 1e-9);
    });
    expect(beats.map((c) => c.level).slice(0, 5)).toEqual(['accent', 'beat', 'beat', 'beat', 'accent']);
  });

  it('does not drift over many beats', () => {
    const { clicks } = run(p(97), 600);
    const last = clicks[clicks.length - 1]!;
    const n = clicks.length - 1;
    expect(Math.abs(last.time - (1 + (n * 60) / 97))).toBeLessThan(1e-9);
  });

  it('stays on the grid when the timer fires late', () => {
    const { clicks } = run(p(120), 10, { lag: 0.02 });
    clicks.forEach((c, i) => expect(c.time).toBeCloseTo(1 + i * 0.5, 9));
  });

  it('subdivides, with compound beats in 6/8', () => {
    const { clicks } = run(p(60, '6/8', '8ths'), 3);
    expect(clicks.slice(0, 7).map((c) => [c.beat, c.sub, c.level])).toEqual([
      [0, 0, 'accent'], [0, 1, 'sub'], [0, 2, 'sub'], [1, 0, 'beat'], [1, 1, 'sub'], [1, 2, 'sub'], [0, 0, 'accent'],
    ]);
    expect(clicks[1]!.time - clicks[0]!.time).toBeCloseTo(1 / 3, 9);
  });

  it('counts in one bar of beats, then starts bar 0 with subdivisions', () => {
    const { clicks, downbeat } = run(p(120, '3/4', '8ths'), 4, { countIn: 1 });
    expect(downbeat).toBeCloseTo(2.5, 9);
    const countIn = clicks.filter((c) => c.countIn);
    expect(countIn.map((c) => [c.bar, c.beat, c.time])).toEqual([[-1, 0, 1], [-1, 1, 1.5], [-1, 2, 2]]);
    const first = clicks.find((c) => !c.countIn)!;
    expect([first.bar, first.beat, first.time, first.level]).toEqual([0, 0, 2.5, 'accent']);
    expect(clicks[clicks.indexOf(first) + 1]!.time).toBeCloseTo(2.75, 9);
  });

  it('changes tempo from the next beat and meter from the next bar', () => {
    const time = fakeTime();
    const clicks: Click[] = [];
    const s = new ClickScheduler(time.clock, (c) => clicks.push(c), { timers: time.timers }, p(60));
    s.start(0);
    time.advance(1.2); // beats at 0 and 1 played (lookahead reaches 1.3)
    s.update({ bpm: 120, meter: meterOf('3/4') });
    time.advance(5);
    const times = clicks.map((c) => c.time);
    expect(times.slice(0, 5)).toEqual([0, 1, 2, 2.5, 3]);
    // 4/4 bar finishes (beats 0–3), then 3/4 bars.
    expect(clicks.slice(0, 8).map((c) => c.beat)).toEqual([0, 1, 2, 3, 0, 1, 2, 0]);
  });

  it('reports the next beat time', () => {
    const { scheduler, time } = run(p(120, '4/4', '16ths'), 0.26);
    // Clock at 0.26 after starting at 1: the first beat (1.0) is still ahead.
    expect(scheduler.nextBeatTime()).toBe(1);
    time.advance(0.9); // now 1.16; clicks up to 1.26 scheduled
    expect(scheduler.nextBeatTime()).toBeCloseTo(1.5, 9);
    scheduler.stop();
    expect(scheduler.nextBeatTime()).toBeNull();
  });

  it('looks further ahead after the main thread stalls, so later stalls make no click late', () => {
    // The timer wakes every 25 ms, except for a 150 ms block every 400 ms.
    let now = 0;
    let fn: (() => void) | null = null;
    const timers: SchedulerTimers = { setInterval: (f) => ((fn = f), 1), clearInterval: () => (fn = null) };
    const clicks: (Click & { scheduledAt: number })[] = [];
    const s = new ClickScheduler(() => now, (c) => clicks.push({ ...c, scheduledAt: now }), { timers }, p(120));
    s.start(0.05);
    let nextBlock = 0.4;
    while (now < 30) {
      now += 0.025;
      if (now >= nextBlock) {
        now += 0.15;
        nextBlock += 0.4;
      }
      fn!();
    }
    const late = clicks.filter((c) => c.scheduledAt > c.time);
    // Only the first stall can catch a click out; after it the lookahead covers the stalls.
    expect(late.every((c) => c.time < 1)).toBe(true);
    expect(clicks.filter((c) => c.time > 1 && c.time < 29).length).toBe(56);
    expect(s.lookahead).toBeGreaterThan(0.2);
    expect(s.lookahead).toBeLessThanOrEqual(0.5);
  });

  it('skips clicks that are already late instead of playing them in a burst', () => {
    const time = fakeTime();
    const clicks: Click[] = [];
    const s = new ClickScheduler(time.clock, (c) => clicks.push(c), { timers: time.timers }, p(120));
    s.start(0);
    time.advance(0.01);
    const before = clicks.length;
    time.advance(5, 4); // the timer stalls for four seconds
    const after = clicks.slice(before);
    expect(after.every((c) => c.time >= 4)).toBe(true);
  });
});
