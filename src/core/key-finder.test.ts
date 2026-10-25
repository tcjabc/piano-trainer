// @vitest-environment happy-dom
import { Midi } from '@tonejs/midi';
import { describe, expect, it } from 'vitest';
import minuetXml from '../data/songs/minuet-in-g.musicxml?raw';
import odeXml from '../data/songs/ode-to-joy.musicxml?raw';
import { findKey, modeForSignature, pitchClassHistogram, songKey } from './key-finder';
import { midiToSong, readMidi } from './song-midi';
import { parseMusicXml } from './song-musicxml';

/** Notes from MIDI numbers, each one beat unless given as [midi, beats]. */
const notes = (...list: (number | [number, number])[]) =>
  list.map((n) => (Array.isArray(n) ? { midi: n[0], duration: n[1] } : { midi: n, duration: 1 }));

const withoutKey = (xml: string) => xml.replace(/<key>.*?<\/key>/g, '');
const withoutMode = (xml: string) => xml.replace(/<mode>.*?<\/mode>/g, '');

describe('Krumhansl-Schmuckler key finding', () => {
  it('finds C major from its scale with a long tonic', () => {
    expect(findKey(notes([60, 2], 62, 64, 65, [67, 2], 69, 71, [72, 2]))).toMatchObject({ tonic: 0, mode: 'major', name: 'C major' });
  });

  it('finds A minor from a harmonic-minor line', () => {
    expect(findKey(notes([57, 2], 59, 60, 62, [64, 2], 65, 68, [69, 2], 64, 60, [57, 3]))).toMatchObject({ tonic: 9, mode: 'minor', name: 'A minor' });
  });

  it('weights by note length', () => {
    const hist = pitchClassHistogram(notes([60, 3], [72, 1], [67, 0.5]));
    expect(hist[0]).toBe(4);
    expect(hist[7]).toBe(0.5);
  });

  it('spells keys the usual way', () => {
    // G♭ major: tonic triad and scale on the black keys.
    expect(findKey(notes([66, 3], 68, 70, 71, [73, 2], 75, 77, [78, 3], 70, 73))?.name).toBe('Gb major');
    // E♭ minor rather than D♯ minor.
    expect(findKey(notes([63, 3], 65, 66, 68, [70, 2], 71, 74, [75, 3], 70, 66, [63, 3]))?.name).toBe('Eb minor');
    // F♯ minor keeps its sharps.
    expect(findKey(notes([66, 3], 68, 69, 71, [73, 2], 74, 77, [78, 3], 73, 69, [66, 3]))?.name).toBe('F# minor');
  });

  it('has no answer without notes, or when every pitch class is equal', () => {
    expect(findKey([])).toBeNull();
    expect(findKey(notes(60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71))).toBeNull();
    expect(songKey([], null)).toEqual({ key: null });
  });

  it('finds the bundled songs’ keys without their key signatures', () => {
    expect(parseMusicXml(withoutKey(odeXml)).data).toMatchObject({ key: 'C major', keySource: 'detected' });
    expect(parseMusicXml(withoutKey(minuetXml)).data).toMatchObject({ key: 'G major', keySource: 'detected' });
  });
});

describe('song keys', () => {
  it('uses the key signature when the file has one', () => {
    expect(parseMusicXml(minuetXml).data).toMatchObject({ key: 'G major', keySource: 'signature' });
    // A stated mode is trusted even when the notes lean elsewhere.
    expect(songKey(notes([57, 4], 60, 64), { fifths: 0, mode: 'major' })).toEqual({ key: 'C major', keySource: 'signature' });
  });

  it('decides between major and relative minor when the signature has no mode', () => {
    const aMinor = notes([57, 2], 59, 60, 62, [64, 2], 65, 68, [69, 2], 64, 60, [57, 3]);
    expect(modeForSignature(aMinor, 0)).toBe('minor');
    expect(songKey(aMinor, { fifths: 0, mode: null })).toEqual({ key: 'A minor', keySource: 'signature' });
    expect(parseMusicXml(withoutMode(odeXml)).data.key).toBe('C major');
    // Nothing to go on: major.
    expect(modeForSignature([], -3)).toBe('major');
  });

  it('uses a MIDI file’s key signature, or finds the key from its notes', () => {
    const midi = new Midi();
    const track = midi.addTrack();
    [67, 71, 74, 72, 71, 69, 67, 66, 67].forEach((n, i) => track.addNote({ midi: n, ticks: i * midi.header.ppq, durationTicks: midi.header.ppq * (n === 67 ? 2 : 1) }));
    const parsed = readMidi(midi.toArray());
    expect(parsed.keySignature).toBeNull();
    expect(midiToSong(parsed)).toMatchObject({ key: 'G major', keySource: 'detected' });
    // (@tonejs/midi can't write key signatures that read back, so this one is set directly.)
    expect(midiToSong({ ...parsed, keySignature: { fifths: 2, mode: 'major' } })).toMatchObject({ key: 'D major', keySource: 'signature' });
  });
});
