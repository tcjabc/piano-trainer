// @vitest-environment happy-dom
import { Midi } from '@tonejs/midi';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import minuetXml from '../data/songs/minuet-in-g.musicxml?raw';
import odeXml from '../data/songs/ode-to-joy.musicxml?raw';
import twinkleXml from '../data/songs/twinkle-twinkle.musicxml?raw';
import { beatToSeconds, measureAt, notesIn, secondsToBeat, sectionBeats, stepsOf, type Measure, type SongData } from './song';
import { midiToSong, needsSplit, readMidi, splitCounts } from './song-midi';
import { parseMusicXml, setXmlFingering, unzipMxl } from './song-musicxml';
import { autoSections, mergeWithNext, splitSection } from './song-sections';

const ode = parseMusicXml(odeXml);
const minuet = parseMusicXml(minuetXml);
const twinkle = parseMusicXml(twinkleXml);

describe('MusicXML import (bundled songs)', () => {
  it('reads title, composer, key, time and tempo', () => {
    expect(ode.title).toBe('Ode to Joy');
    expect(ode.composer).toBe('Ludwig van Beethoven');
    expect(ode.data.key).toBe('C major');
    expect(ode.data.timeSignature).toEqual([4, 4]);
    expect(ode.data.tempos).toEqual([{ beat: 0, bpm: 100 }]);
    expect(minuet.data.key).toBe('G major');
    expect(minuet.data.timeSignature).toEqual([3, 4]);
    expect(twinkle.data.tempos[0]!.bpm).toBe(96);
  });

  it('splits hands by staff and keeps fingering', () => {
    const rh = ode.data.notes.filter((n) => n.hand === 'R');
    const lh = ode.data.notes.filter((n) => n.hand === 'L');
    expect(rh[0]).toMatchObject({ midi: 64, beat: 0, duration: 1, finger: 3, spelling: 'E4' });
    expect(Math.max(...lh.map((n) => n.midi))).toBeLessThan(60);
    expect(Math.min(...rh.map((n) => n.midi))).toBeGreaterThanOrEqual(55);
    expect(ode.data.notes.every((n) => n.finger !== null)).toBe(true);
    // Bar 4: dotted quarter E, eighth D, half D.
    const bar4 = notesIn(ode.data, 12, 16, ['R']);
    expect(bar4.map((n) => [n.midi, n.beat, n.duration])).toEqual([[64, 12, 1.5], [62, 13.5, 0.5], [62, 14, 2]]);
  });

  it('reads accidentals, chords and measures', () => {
    const fSharp = minuet.data.notes.find((n) => n.spelling === 'F#5')!;
    expect(fSharp.midi).toBe(78);
    // Bar 1 left hand: a G major triad, all starting together.
    const chord = notesIn(minuet.data, 0, 3, ['L']);
    expect(chord.map((n) => n.midi)).toEqual([55, 59, 62]);
    expect(stepsOf(chord)).toHaveLength(1);
    expect(minuet.data.measures).toHaveLength(16);
    expect(minuet.data.measures[7]).toMatchObject({ label: '8', beat: 21, length: 3, boundary: true });
  });

  it('gives every note a stable id and its place in the score', () => {
    const ids = new Set(ode.data.notes.map((n) => n.id));
    expect(ids.size).toBe(ode.data.notes.length);
    expect(ode.data.notes.every((n) => typeof n.xmlIndex === 'number')).toBe(true);
  });

  it('writes fingering back into the score', () => {
    const first = ode.data.notes[0]!;
    const changed = parseMusicXml(setXmlFingering(odeXml, first.xmlIndex!, 2));
    expect(changed.data.notes[0]!.finger).toBe(2);
    const cleared = parseMusicXml(setXmlFingering(odeXml, first.xmlIndex!, null));
    expect(cleared.data.notes[0]!.finger).toBeNull();
  });

  it('unzips .mxl files', () => {
    const container = '<?xml version="1.0"?><container><rootfiles><rootfile full-path="score/ode.musicxml"/></rootfiles></container>';
    const zip = zipSync({ 'META-INF/container.xml': strToU8(container), 'score/ode.musicxml': strToU8(odeXml) });
    expect(parseMusicXml(unzipMxl(zip)).title).toBe('Ode to Joy');
  });

  it('rejects files that are not MusicXML', () => {
    expect(() => parseMusicXml('<html><body/></html>')).toThrow(/partwise/);
    expect(() => parseMusicXml('not xml at all <')).toThrow(/not valid/);
  });
});

/** A bundled song written out as a MIDI file, with one track per hand or all in one. */
function asMidi(data: SongData, tracks: 'two' | 'one'): Uint8Array {
  const midi = new Midi();
  midi.header.setTempo(data.tempos[0]?.bpm ?? 100);
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: data.timeSignature });
  const ppq = midi.header.ppq;
  const rh = midi.addTrack();
  const lh = tracks === 'two' ? midi.addTrack() : rh;
  for (const n of data.notes) {
    (n.hand === 'R' ? rh : lh).addNote({ midi: n.midi, ticks: Math.round(n.beat * ppq), durationTicks: Math.round(n.duration * ppq), velocity: 0.7 });
  }
  return midi.toArray();
}

describe('MIDI import and hand splitting', () => {
  it('uses the tracks when there are two (the lower one is the left hand)', () => {
    const parsed = readMidi(asMidi(ode.data, 'two'));
    expect(needsSplit(parsed)).toBe(false);
    const data = midiToSong(parsed);
    const byHand = (h: 'L' | 'R', d: SongData) => d.notes.filter((n) => n.hand === h).map((n) => [n.midi, n.beat]);
    expect(byHand('R', data)).toEqual(byHand('R', ode.data));
    expect(byHand('L', data)).toEqual(byHand('L', ode.data));
    expect(data.measures).toHaveLength(16);
    expect(data.tempos[0]!.bpm).toBeCloseTo(100);
  });

  it('splits a single track at middle C, or at a chosen key', () => {
    const parsed = readMidi(asMidi(twinkle.data, 'one'));
    expect(needsSplit(parsed)).toBe(true);
    const data = midiToSong(parsed);
    expect(data.notes.filter((n) => n.midi >= 60).every((n) => n.hand === 'R')).toBe(true);
    expect(data.notes.filter((n) => n.midi < 60).every((n) => n.hand === 'L')).toBe(true);
    const atC = splitCounts(parsed, 60);
    const atG = splitCounts(parsed, 55);
    expect(atC.left + atC.right).toBe(twinkle.data.notes.length);
    expect(atG.left).toBeLessThan(atC.left);
  });

  it('reads 3/4 into three-beat measures', () => {
    const data = midiToSong(readMidi(asMidi(minuet.data, 'two')));
    expect(data.timeSignature).toEqual([3, 4]);
    expect(data.measures[1]).toMatchObject({ beat: 3, length: 3 });
  });
});

describe('tempo map', () => {
  const data: SongData = { notes: [], measures: [], timeSignature: [4, 4], key: null, tempos: [{ beat: 0, bpm: 120 }, { beat: 8, bpm: 60 }] };

  it('converts beats to seconds and back across tempo changes', () => {
    expect(beatToSeconds(data, 8)).toBe(4);
    expect(beatToSeconds(data, 10)).toBe(6);
    expect(secondsToBeat(data, 6)).toBe(10);
    expect(secondsToBeat(data, 2)).toBe(4);
  });
});

describe('sections', () => {
  const bars = (n: number, length = 4): Measure[] => Array.from({ length: n }, (_, i) => ({ label: String(i + 1), beat: i * length, length }));

  it('cuts songs into four-bar sections', () => {
    expect(autoSections(ode.data.measures).map((s) => [s.start, s.end, s.name])).toEqual([
      [0, 4, 'Bars 1–4'], [4, 8, 'Bars 5–8'], [8, 12, 'Bars 9–12'], [12, 16, 'Bars 13–16'],
    ]);
    expect(autoSections(twinkle.data.measures)).toHaveLength(3);
  });

  it('ends phrases at double bars', () => {
    expect(autoSections(minuet.data.measures).map((s) => [s.start, s.end])).toEqual([[0, 8], [8, 16]]);
  });

  it('starts sections at rehearsal marks', () => {
    const m = bars(12);
    m[4]!.rehearsal = 'B';
    m[0]!.rehearsal = 'A';
    expect(autoSections(m).map((s) => [s.start, s.end, s.name])).toEqual([[0, 4, 'Section A'], [4, 12, 'Section B']]);
  });

  it('joins a pickup bar to the first section and uses eight bars for long songs', () => {
    const m = [{ label: '0', beat: 0, length: 1 }, ...bars(8).map((b) => ({ ...b, beat: b.beat + 1 }))];
    expect(autoSections(m).map((s) => [s.start, s.end])).toEqual([[0, 5], [5, 9]]);
    expect(autoSections(bars(80))[1]!.start).toBe(8);
  });

  it('splits and merges', () => {
    const m = bars(8);
    const two = autoSections(m);
    const merged = mergeWithNext(two, m, two[0]!.id);
    expect(merged).toEqual([{ id: 's0', name: 'Bars 1–8', start: 0, end: 8 }]);
    expect(splitSection(merged, m, 2).map((s) => [s.start, s.end, s.name])).toEqual([[0, 2, 'Bars 1–2'], [2, 8, 'Bars 3–8']]);
    expect(sectionBeats(ode.data, { start: 4, end: 8 })).toEqual([16, 32]);
    expect(measureAt(ode.data, 17)).toBe(4);
  });
});
