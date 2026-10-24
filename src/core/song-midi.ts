/**
 * MIDI import (via @tonejs/midi). Hands come from the tracks when there are
 * exactly two with notes (the lower one is the left hand); otherwise every
 * note is split at a chosen key, middle C by default.
 */
import { Midi } from '@tonejs/midi';
import { measuresFor, keyName, sortNotes, type SongData, type SongHand, type SongNote, type TempoChange } from './song';

export const MIDDLE_C = 60;

export interface MidiTrackNotes {
  name: string;
  notes: { midi: number; beat: number; duration: number; velocity: number }[];
}

export interface ParsedMidi {
  title: string;
  /** Tracks that have notes, in file order. */
  tracks: MidiTrackNotes[];
  tempos: TempoChange[];
  timeSignature: [number, number];
  timeSignatureChanges: { beat: number; ts: [number, number] }[];
  key: string | null;
}

export function readMidi(bytes: ArrayBuffer | Uint8Array): ParsedMidi {
  const midi = new Midi(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const ppq = midi.header.ppq;
  const beat = (ticks: number) => ticks / ppq;
  const tracks = midi.tracks
    .filter((t) => t.notes.length > 0)
    .map((t) => ({
      name: t.name,
      notes: t.notes.map((n) => ({ midi: n.midi, beat: beat(n.ticks), duration: beat(n.durationTicks), velocity: n.velocity })),
    }));
  const signatures = midi.header.timeSignatures.map((s) => ({ beat: beat(s.ticks), ts: [s.timeSignature[0]!, s.timeSignature[1]!] as [number, number] }));
  const key = midi.header.keySignatures[0];
  const fifths = key ? keyFifths(key.key, key.scale === 'minor' ? 'minor' : 'major') : null;
  return {
    title: midi.header.name.trim(),
    tracks,
    tempos: midi.header.tempos.map((t) => ({ beat: beat(t.ticks), bpm: t.bpm })),
    timeSignature: signatures[0]?.ts ?? [4, 4],
    timeSignatureChanges: signatures,
    key: key && fifths !== null ? keyName(fifths, key.scale === 'minor' ? 'minor' : 'major') : null,
  };
}

/** Whether the file needs a split point (it doesn't have exactly two tracks with notes). */
export function needsSplit(parsed: ParsedMidi): boolean {
  return parsed.tracks.length !== 2;
}

function averagePitch(track: MidiTrackNotes): number {
  return track.notes.reduce((sum, n) => sum + n.midi, 0) / track.notes.length;
}

/**
 * Song data with hands assigned: by track when there are two (the lower
 * track is the left hand), else notes below `split` go to the left hand.
 */
export function midiToSong(parsed: ParsedMidi, split = MIDDLE_C): SongData {
  const notes: SongNote[] = [];
  const add = (n: MidiTrackNotes['notes'][number], hand: SongHand) =>
    notes.push({ id: '', midi: n.midi, beat: n.beat, duration: n.duration, hand, finger: null, velocity: n.velocity });
  if (!needsSplit(parsed)) {
    const [a, b] = parsed.tracks as [MidiTrackNotes, MidiTrackNotes];
    const leftFirst = averagePitch(a) <= averagePitch(b);
    for (const n of a.notes) add(n, leftFirst ? 'L' : 'R');
    for (const n of b.notes) add(n, leftFirst ? 'R' : 'L');
  } else {
    for (const t of parsed.tracks) for (const n of t.notes) add(n, n.midi < split ? 'L' : 'R');
  }
  sortNotes(notes).forEach((n, i) => (n.id = `n${i}`));
  const end = Math.max(0, ...notes.map((n) => n.beat + n.duration));
  return {
    notes,
    measures: measuresFor(parsed.timeSignature, end, parsed.timeSignatureChanges),
    tempos: parsed.tempos.length ? parsed.tempos : [],
    timeSignature: parsed.timeSignature,
    key: parsed.key,
  };
}

/** How many notes each hand gets at a split point (for the import preview). */
export function splitCounts(parsed: ParsedMidi, split: number): { left: number; right: number } {
  const data = midiToSong(parsed, split);
  return { left: data.notes.filter((n) => n.hand === 'L').length, right: data.notes.filter((n) => n.hand === 'R').length };
}

const SHARPS_MAJOR = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
const FLATS_MAJOR = ['C', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'];
const SHARPS_MINOR = ['A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#'];
const FLATS_MINOR = ['A', 'D', 'G', 'C', 'F', 'Bb', 'Eb', 'Ab'];

/** Key signature (sharps positive) of a key name as @tonejs/midi reports it. */
function keyFifths(key: string, mode: 'major' | 'minor'): number | null {
  const sharps = (mode === 'minor' ? SHARPS_MINOR : SHARPS_MAJOR).indexOf(key);
  if (sharps >= 0) return sharps;
  const flats = (mode === 'minor' ? FLATS_MINOR : FLATS_MAJOR).indexOf(key);
  return flats >= 0 ? -flats : null;
}
