/**
 * The Library: every chord (with each inversion) and scale the app offers,
 * filters over them, and a search that understands names like "F#m7",
 * "Bb maj7 1st inv" or "D dorian". Pure data; no DOM.
 */
import { Chord } from 'tonal';
import {
  CHORD_QUALITIES,
  chordFormula,
  chordName,
  chordRoots,
  chordSymbol,
  inversionCount,
  qualityInfo,
  type ChordQuality,
  type ChordSpec,
} from '../../core/chords';
import { EMPTY_FILTER, type ItemKind, type LibraryFilter } from '../../core/filter';
import { SCALE_TYPES, scaleFormula, scaleInfo, scaleRoots, type ScaleType } from '../../core/scales';

export { EMPTY_FILTER };
export type { ItemKind, LibraryFilter };

export interface ChordItem {
  kind: 'chord';
  id: string;
  spec: ChordSpec;
  symbol: string;
  name: string;
  formula: string[];
}

export interface ScaleItem {
  kind: 'scale';
  id: string;
  tonic: string;
  type: ScaleType;
  name: string;
  formula: string[];
}

export type LibraryItem = ChordItem | ScaleItem;

export function chordItemId(spec: ChordSpec): string {
  return `chord:${spec.root}:${spec.quality}:${spec.inversion}`;
}

export function scaleItemId(tonic: string, type: ScaleType): string {
  return `scale:${tonic}:${type}`;
}

function buildCatalog(): LibraryItem[] {
  const items: LibraryItem[] = [];
  for (const q of CHORD_QUALITIES) {
    for (const root of chordRoots(q.id)) {
      for (let inversion = 0; inversion < inversionCount(q.id); inversion++) {
        const spec: ChordSpec = { root, quality: q.id, inversion };
        items.push({
          kind: 'chord',
          id: chordItemId(spec),
          spec,
          symbol: chordSymbol(spec),
          name: chordName(spec),
          formula: chordFormula(q.id),
        });
      }
    }
  }
  for (const t of SCALE_TYPES) {
    for (const tonic of scaleRoots(t.id)) {
      items.push({
        kind: 'scale',
        id: scaleItemId(tonic, t.id),
        tonic,
        type: t.id,
        name: `${tonic} ${t.name}`,
        formula: scaleFormula(tonic, t.id),
      });
    }
  }
  return items;
}

let catalog: LibraryItem[] | null = null;

/** All items, built once on first use (about a thousand). */
export function allItems(): LibraryItem[] {
  catalog ??= buildCatalog();
  return catalog;
}

export function itemById(id: string): LibraryItem | undefined {
  return allItems().find((i) => i.id === id);
}

// ── Filters ────────────────────────────────────────────────────────────

/** Every root spelling used anywhere, in keyboard order. */
export const ALL_ROOTS = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'Bb', 'B'];

export function matchesFilter(item: LibraryItem, f: LibraryFilter): boolean {
  if (f.kinds.length && !f.kinds.includes(item.kind)) return false;
  if (item.kind === 'chord') {
    // A filter that only names scale types excludes chords (and vice versa).
    if (!f.kinds.length && f.scaleTypes.length && !f.qualities.length) return false;
    if (f.qualities.length && !f.qualities.includes(item.spec.quality)) return false;
    if (f.roots.length && !f.roots.includes(item.spec.root)) return false;
    if (f.inversions.length && !f.inversions.includes(item.spec.inversion)) return false;
  } else {
    if (!f.kinds.length && f.qualities.length && !f.scaleTypes.length) return false;
    if (f.scaleTypes.length && !f.scaleTypes.includes(item.type)) return false;
    if (f.roots.length && !f.roots.includes(item.tonic)) return false;
  }
  return true;
}

export function filterItems(f: LibraryFilter, query = ''): LibraryItem[] {
  const parsed = parseQuery(query);
  return allItems().filter((item) => matchesFilter(item, f) && matchesQuery(item, parsed));
}

// ── Search ─────────────────────────────────────────────────────────────

export interface ParsedQuery {
  root?: string;
  quality?: ChordQuality;
  inversion?: number;
  /** Bass note from a slash chord ("C/E"); resolved to an inversion per item. */
  bass?: string;
  scaleType?: ScaleType;
  kind?: ItemKind;
  /** Anything not understood, matched against item names. */
  words: string[];
}

const ORDINALS: Record<string, number> = {
  '1st': 1, first: 1, '2nd': 2, second: 2, '3rd': 3, third: 3, '4th': 4, fourth: 4,
};

/** Scale names people type, longest first so "minor pentatonic" wins over "minor". */
const SCALE_WORDS: [string, ScaleType][] = [
  ['natural minor', 'natural minor'],
  ['harmonic minor', 'harmonic minor'],
  ['melodic minor', 'melodic minor'],
  ['minor pentatonic', 'minor pentatonic'],
  ['major pentatonic', 'major pentatonic'],
  ['pentatonic', 'major pentatonic'],
  ['major scale', 'major'],
  ['minor scale', 'natural minor'],
  ...SCALE_TYPES.filter((t) => t.group !== 'major/minor').map((t) => [t.name, t.id] as [string, ScaleType]),
];

/** Words for qualities that tonal's symbol parser doesn't take. */
const QUALITY_WORDS: [RegExp, ChordQuality][] = [
  [/^(half[- ]?dim(inished)?( ?7(th)?)?|ø7?)$/, 'm7b5'],
  [/^(dim(inished)? ?7(th)?|°7)$/, 'dim7'],
  [/^(dominant ?(7|seventh)|seventh)$/, '7'],
  [/^(major ?(7|seventh)|maj ?7)$/, 'maj7'],
  [/^(minor ?(7|seventh)|min ?7)$/, 'm7'],
  [/^(major|maj)$/, 'M'],
  [/^(minor|min)$/, 'm'],
  [/^(diminished|°)$/, 'dim'],
  [/^(augmented|\+)$/, 'aug'],
];

/** Chord qualities keyed by their interval list, to map tonal's parse back to ours. */
let byIntervals: Map<string, ChordQuality> | null = null;
function qualityFromIntervals(intervals: string[]): ChordQuality | undefined {
  byIntervals ??= new Map(CHORD_QUALITIES.map((q) => [Chord.get(`C${q.id}`).intervals.join(' '), q.id]));
  return byIntervals.get(intervals.join(' '));
}

function normaliseRoot(letter: string, acc: string): string {
  return letter.toUpperCase() + acc.replace('♯', '#').replace('♭', 'b').replace('sharp', '#').replace('flat', 'b');
}

export function parseQuery(query: string): ParsedQuery {
  let q = ` ${query.replace(/♯/g, '#').replace(/♭/g, 'b').replace(/\s+/g, ' ').trim()} `;
  const parsed: ParsedQuery = { words: [] };
  if (!q.trim()) return parsed;

  // Inversion: "1st inv", "second inversion", "root position".
  const inv = /\s(1st|2nd|3rd|4th|first|second|third|fourth)\s*inv(ersion)?\.?\s/i.exec(q);
  if (inv) {
    parsed.inversion = ORDINALS[inv[1]!.toLowerCase()];
    q = q.replace(inv[0], ' ');
  } else if (/\sroot( position)?\s/i.test(q)) {
    parsed.inversion = 0;
    q = q.replace(/\sroot( position)?\s/i, ' ');
  }

  // Scale type words.
  const lower = q.toLowerCase();
  for (const [word, type] of SCALE_WORDS) {
    const at = lower.indexOf(` ${word} `);
    if (at >= 0) {
      parsed.scaleType = type;
      parsed.kind = 'scale';
      q = q.slice(0, at) + ' ' + q.slice(at + word.length + 1);
      break;
    }
  }
  if (/\sscales?\s/i.test(q)) {
    parsed.kind = 'scale';
    q = q.replace(/\sscales?\s/i, ' ');
  }
  if (/\schords?\s/i.test(q)) {
    parsed.kind ??= 'chord';
    q = q.replace(/\schords?\s/i, ' ');
  }

  // Root at the start: a letter, then an optional accidental ("Bb", "F#", "C sharp").
  const rootMatch = /^\s*([a-g])(#|♯|sharp|(?:b|flat)(?=$|[\s/0-9]|m|maj|dim|aug|sus|add|\+|°|ø|b))?/i.exec(q);
  let rest = q;
  if (rootMatch) {
    parsed.root = normaliseRoot(rootMatch[1]!, (rootMatch[2] ?? '').toLowerCase());
    rest = q.slice(rootMatch[0].length);
  }

  // Slash bass: "C/E".
  const slash = /\/\s*([a-g])(#|b)?/i.exec(rest);
  if (slash) {
    parsed.bass = normaliseRoot(slash[1]!, slash[2] ?? '');
    rest = rest.replace(slash[0], ' ');
  }

  const remainder = rest.trim();
  if (remainder && parsed.kind !== 'scale') {
    const quality = parsed.root ? qualityOf(parsed.root, remainder) : undefined;
    if (quality) {
      parsed.quality = quality;
      parsed.kind = 'chord';
      return parsed;
    }
    // A quality on its own ("add9", "dim", "7") can start with a note letter.
    const alone = qualityOf('C', q.trim());
    if (alone && !parsed.bass) {
      parsed.root = undefined;
      parsed.quality = alone;
      parsed.kind = 'chord';
      return parsed;
    }
  }
  if (parsed.root && parsed.bass && !remainder) {
    parsed.quality = 'M';
    parsed.kind = 'chord';
  }
  if (remainder) parsed.words = remainder.toLowerCase().split(/\s+/).filter(Boolean);
  return parsed;
}

/** A chord quality from symbol text after a root ("m7", "maj7", "half dim"). */
function qualityOf(root: string, text: string): ChordQuality | undefined {
  const lower = text.toLowerCase().trim();
  if (!lower) return undefined;
  const word = QUALITY_WORDS.find(([re]) => re.test(lower));
  if (word) return word[1];
  return qualityFromIntervals(Chord.get(`${root}${text.replace(/\s+/g, '')}`).intervals);
}

export function matchesQuery(item: LibraryItem, p: ParsedQuery): boolean {
  if (p.kind && item.kind !== p.kind) return false;
  if (item.kind === 'chord') {
    if (p.scaleType) return false;
    if (p.root && item.spec.root !== p.root) return false;
    if (p.quality && item.spec.quality !== p.quality) return false;
    if (p.inversion !== undefined && item.spec.inversion !== p.inversion) return false;
    if (p.bass && item.symbol.split('/')[1] !== p.bass && !(item.spec.inversion === 0 && item.spec.root === p.bass)) {
      return false;
    }
  } else {
    if (p.quality || p.inversion !== undefined || p.bass) return false;
    if (p.root && item.tonic !== p.root) return false;
    if (p.scaleType && item.type !== p.scaleType) return false;
  }
  const text = `${item.name} ${item.kind === 'chord' ? item.symbol + ' ' + qualityInfo(item.spec.quality).name : scaleInfo(item.type).group}`.toLowerCase();
  return p.words.every((w) => text.includes(w));
}

// ── Starter decks ──────────────────────────────────────────────────────

export interface DeckDefinition {
  name: string;
  filter: LibraryFilter;
  /** Scales in this deck are practised over this many octaves. */
  octaves?: 1 | 2;
}

const f = (patch: Partial<LibraryFilter>): LibraryFilter => ({ ...EMPTY_FILTER, ...patch });

/** Offered on first run; nothing is added to review until you ask. */
export const STARTER_DECKS: DeckDefinition[] = [
  { name: 'Major triads in C, G, F, D (+ inversions)', filter: f({ kinds: ['chord'], qualities: ['M'], roots: ['C', 'G', 'F', 'D'] }) },
  { name: 'Minor triads in A, E, D (+ inversions)', filter: f({ kinds: ['chord'], qualities: ['m'], roots: ['A', 'E', 'D'] }) },
  { name: 'Dominant sevenths, root position', filter: f({ kinds: ['chord'], qualities: ['7'], inversions: [0] }) },
  { name: 'Minor sevenths in flat keys', filter: f({ kinds: ['chord'], qualities: ['m7'], roots: ['D', 'G', 'C', 'F', 'Bb', 'Eb'] }) },
  { name: 'Major scales with sharps, one octave', filter: f({ kinds: ['scale'], scaleTypes: ['major'], roots: ['G', 'D', 'A', 'E', 'B', 'F#', 'C#'] }), octaves: 1 },
  { name: 'Major scales with flats, one octave', filter: f({ kinds: ['scale'], scaleTypes: ['major'], roots: ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb'] }), octaves: 1 },
  { name: 'Harmonic minor scales, one octave', filter: f({ kinds: ['scale'], scaleTypes: ['harmonic minor'] }), octaves: 1 },
];
