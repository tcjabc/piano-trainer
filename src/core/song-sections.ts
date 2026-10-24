/**
 * Splitting a song into sections to learn one at a time. Rehearsal marks
 * (MusicXML) start sections when there are any. Otherwise phrases end at
 * double bars and repeats, and anything longer than eight bars is cut into
 * four-bar sections (eight-bar ones for long pieces). A pickup bar joins the
 * first section. Sections can then be renamed, split and merged.
 */
import type { Measure, Section } from './song';

/** Section length when there's nothing better to go on. */
const BARS = 4;
const LONG_BARS = 8;
/** A song longer than this uses eight-bar sections. */
const LONG_SONG_BARS = 64;
/** A stretch this long or shorter stays one section. */
const MAX_PHRASE_BARS = 8;

const sectionName = (measures: Measure[], start: number, end: number) => {
  const first = measures[start]?.label ?? String(start + 1);
  const last = measures[end - 1]?.label ?? String(end);
  return first === last ? `Bar ${first}` : `Bars ${first}–${last}`;
};

function isPickup(measures: Measure[]): boolean {
  return measures.length > 1 && measures[0]!.length < measures[1]!.length - 1e-6;
}

export function autoSections(measures: Measure[]): Section[] {
  if (measures.length === 0) return [];
  const starts = new Set<number>([0]);
  const marks = measures.map((m, i) => (m.rehearsal ? i : -1)).filter((i) => i > 0);
  if (marks.length) {
    for (const i of marks) starts.add(i);
  } else {
    const size = measures.length > LONG_SONG_BARS ? LONG_BARS : BARS;
    const pickup = isPickup(measures) ? 1 : 0;
    // Phrases end at double bars and repeats.
    const phraseStarts = [pickup, ...measures.map((m, i) => (m.boundary ? i + 1 : -1)).filter((i) => i > pickup && i < measures.length)];
    phraseStarts.forEach((start, k) => {
      const end = phraseStarts[k + 1] ?? measures.length;
      starts.add(start);
      if (end - start <= MAX_PHRASE_BARS && phraseStarts.length > 1) return;
      for (let i = start + size; i < end; i += size) {
        // Don't leave a scrap of one bar at the end of a phrase.
        if (end - i >= 2) starts.add(i);
      }
    });
    starts.delete(pickup === 1 ? 1 : -1);
  }
  const sorted = [...starts].sort((a, b) => a - b);
  return sorted.map((start, k) => {
    const end = sorted[k + 1] ?? measures.length;
    const mark = measures[start]?.rehearsal;
    return { id: `s${start}`, name: mark ? `Section ${mark}` : sectionName(measures, start, end), start, end };
  });
}

/** Split a section at a measure (which becomes the start of a new one). */
export function splitSection(sections: Section[], measures: Measure[], at: number): Section[] {
  const i = sections.findIndex((s) => at > s.start && at < s.end);
  if (i < 0) return sections;
  const s = sections[i]!;
  const rename = (start: number, end: number, name: string) => (name === sectionName(measures, s.start, s.end) ? sectionName(measures, start, end) : name);
  return [
    ...sections.slice(0, i),
    { ...s, end: at, name: rename(s.start, at, s.name) },
    { id: `s${at}`, name: sectionName(measures, at, s.end), start: at, end: s.end },
    ...sections.slice(i + 1),
  ];
}

/** Merge a section with the one after it (it keeps the first one's id and progress). */
export function mergeWithNext(sections: Section[], measures: Measure[], id: string): Section[] {
  const i = sections.findIndex((s) => s.id === id);
  const s = sections[i];
  const next = sections[i + 1];
  if (!s || !next) return sections;
  const auto = s.name === sectionName(measures, s.start, s.end);
  return [...sections.slice(0, i), { ...s, end: next.end, name: auto ? sectionName(measures, s.start, next.end) : s.name }, ...sections.slice(i + 2)];
}
