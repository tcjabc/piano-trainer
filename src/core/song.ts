/**
 * Songs: the model shared by import, storage, the player and the learning
 * path. Time is kept in quarter-note beats from the start of the song; a
 * tempo map turns beats into seconds. UI-agnostic.
 */
import type { Finger } from './fingering';

export type SongHand = 'L' | 'R';

export interface SongNote {
  /** Stable within the song (used to save fingering edits). */
  id: string;
  midi: number;
  /** Start and length in quarter-note beats from the start of the song. */
  beat: number;
  duration: number;
  hand: SongHand;
  /** 1–5 when known. */
  finger: Finger | null;
  /** The finger was suggested by automatic fingering (not from the score or set by hand). */
  suggested?: boolean;
  /** Written spelling from MusicXML, e.g. "F#4"; absent for MIDI. */
  spelling?: string;
  /** 0–1 */
  velocity: number;
  /** Position among the score's <note> elements (MusicXML), to write fingering back. */
  xmlIndex?: number;
}

export interface Measure {
  /** As printed, e.g. "1" (a pickup is often "0"). */
  label: string;
  beat: number;
  length: number;
  /** Rehearsal mark at the start of the measure, e.g. "A". */
  rehearsal?: string;
  /** Ends with a double bar, final bar or repeat: a natural place for a section to end. */
  boundary?: boolean;
}

export interface TempoChange {
  beat: number;
  /** Quarter notes per minute. */
  bpm: number;
}

export interface SongData {
  /** Sorted by beat, then pitch. */
  notes: SongNote[];
  measures: Measure[];
  tempos: TempoChange[];
  timeSignature: [number, number];
  /** e.g. "G major", or null when unknown. */
  key: string | null;
}

/** A stretch of whole measures, [start, end) by measure index. */
export interface Section {
  id: string;
  name: string;
  start: number;
  end: number;
}

export const DEFAULT_BPM = 100;
/** Notes starting this close together (in beats) belong to the same step. */
const SAME_ONSET = 1e-3;

export function sortNotes(notes: SongNote[]): SongNote[] {
  return notes.sort((a, b) => a.beat - b.beat || a.midi - b.midi);
}

export function songEndBeat(data: SongData): number {
  const last = data.measures[data.measures.length - 1];
  if (last) return last.beat + last.length;
  return Math.max(0, ...data.notes.map((n) => n.beat + n.duration));
}

function tempoList(data: SongData): TempoChange[] {
  return data.tempos.length && data.tempos[0]!.beat <= 0 ? data.tempos : [{ beat: 0, bpm: data.tempos[0]?.bpm ?? DEFAULT_BPM }, ...data.tempos];
}

/** The tempo in force at a beat (quarter notes per minute, at 100%). */
export function tempoAt(data: SongData, beat: number): number {
  let bpm = tempoList(data)[0]!.bpm;
  for (const t of tempoList(data)) if (t.beat <= beat) bpm = t.bpm;
  return bpm;
}

/** Seconds from the start of the song to a beat, at 100% tempo. */
export function beatToSeconds(data: SongData, beat: number): number {
  const tempos = tempoList(data);
  let seconds = 0;
  for (let i = 0; i < tempos.length; i++) {
    const t = tempos[i]!;
    const next = tempos[i + 1]?.beat ?? Infinity;
    if (beat <= t.beat) break;
    seconds += ((Math.min(beat, next) - t.beat) * 60) / t.bpm;
  }
  return seconds;
}

/** The beat reached after some seconds, at 100% tempo. */
export function secondsToBeat(data: SongData, seconds: number): number {
  const tempos = tempoList(data);
  let left = seconds;
  for (let i = 0; i < tempos.length; i++) {
    const t = tempos[i]!;
    const next = tempos[i + 1]?.beat ?? Infinity;
    const span = ((next - t.beat) * 60) / t.bpm;
    if (left <= span) return t.beat + (left * t.bpm) / 60;
    left -= span;
  }
  return 0;
}

/** Index of the measure containing a beat. */
export function measureAt(data: SongData, beat: number): number {
  let index = 0;
  data.measures.forEach((m, i) => {
    if (m.beat <= beat + SAME_ONSET) index = i;
  });
  return index;
}

/** Beat range [start, end) of a section. */
export function sectionBeats(data: SongData, section: Pick<Section, 'start' | 'end'>): [number, number] {
  const start = data.measures[section.start]?.beat ?? 0;
  const last = data.measures[section.end - 1];
  return [start, last ? last.beat + last.length : songEndBeat(data)];
}

export function handsOf(choice: 'left' | 'right' | 'both'): SongHand[] {
  return choice === 'left' ? ['L'] : choice === 'right' ? ['R'] : ['L', 'R'];
}

/** Notes of the given hands that start in [start, end). */
export function notesIn(data: SongData, start: number, end: number, hands: readonly SongHand[]): SongNote[] {
  return data.notes.filter((n) => hands.includes(n.hand) && n.beat >= start - SAME_ONSET && n.beat < end - SAME_ONSET);
}

/** A moment the player waits for: every note starting at the same beat. */
export interface Step {
  beat: number;
  notes: SongNote[];
}

/** Group notes into steps by start time. */
export function stepsOf(notes: readonly SongNote[]): Step[] {
  const steps: Step[] = [];
  for (const n of [...notes].sort((a, b) => a.beat - b.beat || a.midi - b.midi)) {
    const last = steps[steps.length - 1];
    if (last && Math.abs(last.beat - n.beat) < SAME_ONSET) last.notes.push(n);
    else steps.push({ beat: n.beat, notes: [n] });
  }
  return steps;
}

/** Build measures from a time signature until `end` (for files without explicit measures). */
export function measuresFor(timeSignature: [number, number], end: number, changes: { beat: number; ts: [number, number] }[] = []): Measure[] {
  const measures: Measure[] = [];
  let beat = 0;
  let ts = timeSignature;
  while (beat < end - SAME_ONSET || measures.length === 0) {
    for (const c of changes) if (c.beat <= beat + SAME_ONSET) ts = c.ts;
    const length = (ts[0] * 4) / ts[1];
    measures.push({ label: String(measures.length + 1), beat, length });
    beat += length;
  }
  return measures;
}

const MAJOR_KEYS = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
const MINOR_KEYS = ['Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#'];

/** A key name from a key signature (−7…7 sharps) and mode. */
export function keyName(fifths: number, mode: 'major' | 'minor'): string | null {
  const list = mode === 'minor' ? MINOR_KEYS : MAJOR_KEYS;
  const name = list[fifths + 7];
  return name ? `${name} ${mode}` : null;
}

/** Length of the whole song in seconds at 100% tempo. */
export function songSeconds(data: SongData): number {
  return beatToSeconds(data, songEndBeat(data));
}
