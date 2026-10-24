import { beforeEach, describe, expect, it } from 'vitest';
import { classifyCc, Controls, describeBinding, relativeDelta, type ActionId, type MidiMessage } from './controls';

const MAIN = 'KeyLab Essential 61';
const DAW = 'MIDIIN2 (KeyLab Essential 61)';

let t = 0;
const msg = (m: Partial<MidiMessage>): MidiMessage => ({
  port: MAIN,
  main: true,
  type: 'noteon',
  channel: 0,
  data1: 60,
  data2: 100,
  time: (t += 10),
  ...m,
});

let c: Controls;
let actions: ActionId[];

beforeEach(() => {
  c = new Controls();
  c.isPianoKey = (m) => m.main && (m.type === 'noteon' || m.type === 'noteoff') && m.channel !== 9;
  actions = [];
  c.on('action', (a) => actions.push(a));
});

describe('learning', () => {
  it('learns a pad and then runs its action without letting it play', () => {
    c.learn('restart');
    expect(c.handle(msg({ channel: 9, data1: 36 }))).toBe(true);
    expect(c.learningAction).toBeNull();
    expect(c.handle(msg({ channel: 9, data1: 36 }))).toBe(true);
    expect(c.handle(msg({ type: 'noteoff', channel: 9, data1: 36, data2: 0 }))).toBe(true);
    expect(actions).toEqual(['restart']);
  });

  it('refuses piano keys and lets them play', () => {
    const rejected: string[] = [];
    c.on('rejected', (r) => rejected.push(r.reason));
    c.learn('hear');
    expect(c.handle(msg({ data1: 60 }))).toBe(false);
    expect(rejected[0]).toMatch(/piano key/);
    expect(c.learningAction).toBe('hear');
  });

  it('moves a control from one action to another and reports it', () => {
    const learned: (ActionId | null)[] = [];
    c.on('learned', (l) => learned.push(l.replaced));
    c.learn('hear');
    c.handle(msg({ port: DAW, main: false, data1: 94 }));
    c.learn('start-pause');
    c.handle(msg({ port: DAW, main: false, data1: 94 }));
    expect(learned).toEqual([null, 'hear']);
    expect(c.map).toEqual({ 'start-pause': { port: DAW, kind: 'note', channel: 0, number: 94 } });
  });
});

describe('CC buttons', () => {
  it('trigger once per press (value > 63), not on release', () => {
    c.learn('next');
    c.handle(msg({ type: 'cc', data1: 20, data2: 127 }));
    c.handle(msg({ type: 'cc', data1: 20, data2: 0 }));
    c.handle(msg({ type: 'cc', data1: 20, data2: 127 }));
    c.handle(msg({ type: 'cc', data1: 20, data2: 127 }));
    expect(actions).toEqual(['next']);
  });

  it('never learns the sustain pedal', () => {
    c.learn('next');
    expect(c.handle(msg({ type: 'cc', data1: 64, data2: 127 }))).toBe(false);
    expect(c.learningAction).toBe('next');
  });
});

describe('HUI', () => {
  it('reads zone + port pairs as buttons', () => {
    const daw = { port: DAW, main: false, type: 'cc' as const };
    c.learn('start-pause');
    c.handle(msg({ ...daw, data1: 0x0f, data2: 0x0e }));
    c.handle(msg({ ...daw, data1: 0x2f, data2: 0x44 }));
    expect(c.map['start-pause']).toMatchObject({ kind: 'hui', number: 0x0e * 16 + 4 });
    c.handle(msg({ ...daw, data1: 0x2f, data2: 0x04 })); // release
    c.handle(msg({ ...daw, data1: 0x0f, data2: 0x0e }));
    c.handle(msg({ ...daw, data1: 0x2f, data2: 0x44 }));
    expect(actions).toEqual(['start-pause']);
  });
});

describe('knobs', () => {
  it('decodes the relative encodings', () => {
    expect(relativeDelta(65, 'relative-offset')).toBe(1);
    expect(relativeDelta(62, 'relative-offset')).toBe(-2);
    expect(relativeDelta(1, 'relative-twos')).toBe(1);
    expect(relativeDelta(127, 'relative-twos')).toBe(-1);
    expect(relativeDelta(3, 'relative-sign')).toBe(3);
    expect(relativeDelta(66, 'relative-sign')).toBe(-2);
  });

  it('guesses the encoding from what the knob sends', () => {
    expect(classifyCc([1, 1, 2])).toBe('relative-twos');
    expect(classifyCc([127, 126])).toBe('relative-twos');
    expect(classifyCc([1, 66, 65])).toBe('relative-sign');
    expect(classifyCc([65, 65, 66])).toBe('relative-offset');
    expect(classifyCc([60, 61, 62, 63])).toBe('absolute');
  });

  it('learns a knob for a continuous action and refines its mode', () => {
    const moves: { absolute?: number; delta?: number }[] = [];
    c.on('continuous', (m) => moves.push(m));
    c.learn('zoom');
    c.handle(msg({ type: 'cc', data1: 74, data2: 65 }));
    c.handle(msg({ type: 'cc', data1: 74, data2: 65 }));
    c.handle(msg({ type: 'cc', data1: 74, data2: 65 }));
    expect(c.map.zoom?.mode).toBe('relative-offset');
    expect(moves.at(-1)).toEqual({ action: 'zoom', delta: 1 });
  });

  it('asks for a knob when a pad is pressed for a continuous action', () => {
    const rejected: string[] = [];
    c.on('rejected', (r) => rejected.push(r.reason));
    c.learn('zoom');
    c.handle(msg({ channel: 9, data1: 40 }));
    expect(rejected[0]).toMatch(/knob/);
  });
});

describe('describeBinding', () => {
  it('names transport buttons, pads and CCs', () => {
    expect(describeBinding({ port: DAW, kind: 'note', channel: 0, number: 94 }, MAIN)).toBe(`Play (Mackie) · ${DAW}`);
    expect(describeBinding({ port: MAIN, kind: 'note', channel: 9, number: 36 }, MAIN)).toBe('Note C2 · ch 10');
    expect(describeBinding({ port: MAIN, kind: 'cc', channel: 0, number: 74 }, MAIN)).toBe('CC 74 · ch 1');
  });
});

describe('unmapped messages', () => {
  it('play from the keys port but never from other ports', () => {
    expect(c.handle(msg({ data1: 60 }))).toBe(false);
    expect(c.handle(msg({ port: DAW, main: false, data1: 94 }))).toBe(true);
  });
});
