/**
 * MusicXML import (.musicxml/.xml, and compressed .mxl). Hands come from the
 * staves: a two-staff piano part is right hand on top, left hand below;
 * separate parts are assigned by their clef (treble right, bass left).
 * Fingering, ties, chords, tempo marks, rehearsal marks and double bars are
 * read; repeats are played straight through. Uses the browser's DOMParser.
 */
import { strFromU8, unzipSync } from 'fflate';
import type { Finger } from './fingering';
import { keyName, sortNotes, type Measure, type SongData, type SongHand, type SongNote, type TempoChange } from './song';

export interface ParsedMusicXml {
  title: string;
  composer: string;
  data: SongData;
}

const STEP_SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const BEAT_UNITS: Record<string, number> = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25 };
const DEFAULT_VELOCITY = 0.7;

function child(el: Element | null | undefined, name: string): Element | null {
  if (!el) return null;
  for (const c of el.children) if (c.localName === name) return c;
  return null;
}

function children(el: Element, name: string): Element[] {
  return [...el.children].filter((c) => c.localName === name);
}

function text(el: Element | null | undefined, name?: string): string {
  const target = name ? child(el, name) : el;
  return target?.textContent?.trim() ?? '';
}

function num(el: Element | null | undefined, name: string, fallback = 0): number {
  const v = Number(text(el, name));
  return Number.isFinite(v) && text(el, name) !== '' ? v : fallback;
}

export function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('This file is not valid MusicXML.');
  return doc;
}

/** Unzip a compressed .mxl and return the score's XML. */
export function unzipMxl(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  const container = files['META-INF/container.xml'];
  let path: string | undefined;
  if (container) {
    const doc = parseXml(strFromU8(container));
    path = doc.getElementsByTagName('rootfile')[0]?.getAttribute('full-path') ?? undefined;
  }
  path ??= Object.keys(files).find((f) => !f.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(f));
  const file = path ? files[path] : undefined;
  if (!file) throw new Error('No score was found inside this .mxl file.');
  return strFromU8(file);
}

/** A part's hand(s): a two-staff part is split by staff; otherwise its first clef decides. */
function partHands(part: Element, index: number, partCount: number): (staff: number) => SongHand {
  const attributes = part.getElementsByTagName('attributes')[0];
  const staves = num(attributes, 'staves', 1);
  if (staves >= 2) return (staff) => (staff >= 2 ? 'L' : 'R');
  const sign = text(child(attributes, 'clef'), 'sign');
  const hand: SongHand = sign === 'F' ? 'L' : sign === 'G' ? 'R' : partCount > 1 && index > 0 ? 'L' : 'R';
  return () => hand;
}

export function parseMusicXml(xml: string): ParsedMusicXml {
  const doc = parseXml(xml);
  const root = doc.documentElement;
  if (root.localName !== 'score-partwise') throw new Error('Only “partwise” MusicXML scores are supported.');
  const title = text(child(root, 'work'), 'work-title') || text(root, 'movement-title');
  const composer =
    [...(child(root, 'identification')?.getElementsByTagName('creator') ?? [])].find((c) => c.getAttribute('type') === 'composer')?.textContent?.trim() ?? '';
  const allNotes = [...doc.getElementsByTagName('note')];
  const xmlIndex = new Map(allNotes.map((n, i) => [n, i]));

  const parts = children(root, 'part');
  const notes: SongNote[] = [];
  const measures: Measure[] = [];
  const tempos: TempoChange[] = [];
  let timeSignature: [number, number] | null = null;
  let key: string | null = null;

  parts.forEach((part, partIndex) => {
    const handOf = partHands(part, partIndex, parts.length);
    let divisions = 1;
    let measureBeat = 0;
    const openTies = new Map<string, SongNote>();
    children(part, 'measure').forEach((measure, mIndex) => {
      let pos = 0; // beats from the start of this measure
      let maxPos = 0;
      let lastStart = 0;
      let rehearsal: string | undefined;
      let boundary = false;
      const at = () => measureBeat + pos;

      for (const el of measure.children) {
        switch (el.localName) {
          case 'attributes': {
            divisions = num(el, 'divisions', divisions);
            const time = child(el, 'time');
            if (time && !timeSignature) timeSignature = [num(time, 'beats', 4), num(time, 'beat-type', 4)];
            const k = child(el, 'key');
            if (k && key === null) key = keyName(num(k, 'fifths'), text(k, 'mode') === 'minor' ? 'minor' : 'major');
            break;
          }
          case 'backup':
            pos -= num(el, 'duration') / divisions;
            break;
          case 'forward':
            pos += num(el, 'duration') / divisions;
            maxPos = Math.max(maxPos, pos);
            break;
          case 'direction': {
            if (partIndex === 0) {
              const mark = el.getElementsByTagName('rehearsal')[0];
              if (mark?.textContent?.trim()) rehearsal ??= mark.textContent.trim();
              const tempo = tempoOf(el);
              if (tempo) tempos.push({ beat: at(), bpm: tempo });
            }
            break;
          }
          case 'sound': {
            const tempo = Number(el.getAttribute('tempo'));
            if (partIndex === 0 && tempo > 0) tempos.push({ beat: at(), bpm: tempo });
            break;
          }
          case 'barline': {
            const style = text(el, 'bar-style');
            if (style === 'light-light' || style === 'light-heavy' || child(el, 'repeat')?.getAttribute('direction') === 'backward') boundary = true;
            break;
          }
          case 'note': {
            if (child(el, 'grace') || child(el, 'cue')) break;
            const duration = num(el, 'duration') / divisions;
            const isChord = !!child(el, 'chord');
            const start = isChord ? lastStart : pos;
            if (!isChord) {
              lastStart = pos;
              pos += duration;
              maxPos = Math.max(maxPos, pos);
            }
            const pitch = child(el, 'pitch');
            if (!pitch) break; // a rest
            const step = text(pitch, 'step');
            const alter = num(pitch, 'alter');
            const octave = num(pitch, 'octave', 4);
            const midi = (octave + 1) * 12 + (STEP_SEMITONES[step] ?? 0) + alter;
            const hand = handOf(num(el, 'staff', 1));
            const ties = children(el, 'tie').map((t) => t.getAttribute('type'));
            const tieKey = `${hand}:${midi}`;
            const open = openTies.get(tieKey);
            if (ties.includes('stop') && open) {
              open.duration = measureBeat + start + duration - open.beat;
              if (!ties.includes('start')) openTies.delete(tieKey);
              break;
            }
            const note: SongNote = {
              id: '',
              midi,
              beat: measureBeat + start,
              duration,
              hand,
              finger: fingerOf(el),
              spelling: `${step}${alter > 0 ? '#'.repeat(alter) : 'b'.repeat(-alter)}${octave}`,
              velocity: DEFAULT_VELOCITY,
              xmlIndex: xmlIndex.get(el),
            };
            notes.push(note);
            if (ties.includes('start')) openTies.set(tieKey, note);
            break;
          }
        }
      }

      // The first part defines the measures (pickups and all).
      if (partIndex === 0) {
        const nominal = timeSignature ? (timeSignature[0] * 4) / timeSignature[1] : 4;
        const length = maxPos > 0 ? maxPos : nominal;
        measures.push({ label: measure.getAttribute('number') ?? String(mIndex + 1), beat: measureBeat, length, rehearsal, boundary });
      } else if (boundary && measures[mIndex]) {
        measures[mIndex].boundary = true;
      }
      measureBeat += partIndex === 0 ? measures[mIndex]!.length : (measures[mIndex]?.length ?? maxPos);
    });
  });

  sortNotes(notes).forEach((n, i) => (n.id = `x${n.xmlIndex ?? i}`));
  return {
    title,
    composer,
    data: { notes, measures, tempos: dedupeTempos(tempos), timeSignature: timeSignature ?? [4, 4], key },
  };
}

/**
 * A note's finger from <notations><technical><fingering> (where MuseScore,
 * Finale, Sibelius and Dorico put it): the first digit 1–5, so a
 * substitution such as "3-1" counts as 3. Other <fingering> elements (guitar
 * frames) are ignored.
 */
function fingerOf(note: Element): Finger | null {
  for (const notations of children(note, 'notations')) {
    for (const technical of children(notations, 'technical')) {
      for (const fingering of children(technical, 'fingering')) {
        const m = /^\s*([1-5])/.exec(fingering.textContent ?? '');
        if (m) return Number(m[1]) as Finger;
      }
    }
  }
  return null;
}

/** Tempo from a <direction>: its <sound tempo>, else a metronome mark. */
function tempoOf(direction: Element): number | null {
  const sound = child(direction, 'sound');
  const tempo = Number(sound?.getAttribute('tempo'));
  if (tempo > 0) return tempo;
  const metronome = direction.getElementsByTagName('metronome')[0];
  if (!metronome) return null;
  const unit = BEAT_UNITS[text(metronome, 'beat-unit')] ?? 1;
  const dotted = child(metronome, 'beat-unit-dot') ? 1.5 : 1;
  const perMinute = num(metronome, 'per-minute');
  return perMinute > 0 ? perMinute * unit * dotted : null;
}

function dedupeTempos(tempos: TempoChange[]): TempoChange[] {
  const out: TempoChange[] = [];
  for (const t of tempos.sort((a, b) => a.beat - b.beat)) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.beat - t.beat) < 1e-6) last.bpm = t.bpm;
    else if (!last || last.bpm !== t.bpm) out.push({ ...t });
  }
  return out;
}

/** Write (or remove, with null) the fingering of the score's nth <note>; returns the new XML. */
export function setXmlFingering(xml: string, index: number, finger: Finger | null): string {
  const doc = parseXml(xml);
  const note = doc.getElementsByTagName('note')[index];
  if (!note) return xml;
  const ns = doc.documentElement.namespaceURI;
  const make = (name: string) => doc.createElementNS(ns, name);
  for (const f of [...note.getElementsByTagName('fingering')]) f.remove();
  if (finger !== null) {
    let notations = child(note, 'notations');
    if (!notations) {
      notations = make('notations');
      note.appendChild(notations);
    }
    let technical = child(notations, 'technical');
    if (!technical) {
      technical = make('technical');
      notations.appendChild(technical);
    }
    const fingering = make('fingering');
    fingering.textContent = String(finger);
    technical.appendChild(fingering);
  }
  return new XMLSerializer().serializeToString(doc);
}
