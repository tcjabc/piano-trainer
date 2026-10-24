import type { ControlMap } from './controls';
import { EMPTY_FILTER, type LibraryFilter } from './filter';
import type { Clef } from './pitch';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ClefChoice = Clef | 'both';
/** Which hand is practised. */
export type HandChoice = 'left' | 'right' | 'both';
/** Visualiser colour presets: by pitch class, hot pink/red, cyan/blue, or one accent colour. */
export type VisualiserColors = 'rainbow' | 'neon' | 'ice' | 'accent';
const VISUALISER_COLORS: readonly VisualiserColors[] = ['rainbow', 'neon', 'ice', 'accent'];

export interface VisualiserSettings {
  enabled: boolean;
  colors: VisualiserColors;
  /** Ember particles (always off when the system asks for reduced motion). */
  sparks: boolean;
  /** Compact staff and note readout over the visualiser stage. */
  overlay: boolean;
}

export interface NoteRange {
  /** Natural note names, inclusive, e.g. "C4". */
  low: string;
  high: string;
}

/** Stored note-drill settings. The clef is not stored: it follows the practised hand. */
export interface NoteDrillSettings {
  treble: NoteRange;
  bass: NoteRange;
  ledgerLines: boolean;
  accidentals: boolean;
  /** New cards introduced per day. */
  newPerDay: number;
}

/** Note-drill options as the drill uses them. */
export interface NoteDrillOptions extends NoteDrillSettings {
  clef: ClefChoice;
}

/** Free practice: what to drill, chosen freely; served at random with no limit. */
export interface FreeNoteSettings {
  hand: HandChoice;
  /** A range per clef, or a hand-picked set of keys. */
  selection: 'range' | 'specific';
  treble: NoteRange;
  bass: NoteRange;
  ledgerLines: boolean;
  /** Include sharps/flats (for picked black keys: both spellings, otherwise sharps only). */
  accidentals: boolean;
  /** Picked keys (MIDI numbers) for the "specific" selection. */
  specific: number[];
}

/** What free practice drills. Only notes for now; chords and scales come with the library. */
export type FreePracticeKind = 'notes';

export interface FreePracticeSettings {
  kind: FreePracticeKind;
  notes: FreeNoteSettings;
}

/** The Library's remembered state. */
export interface LibrarySettings {
  filter: LibraryFilter;
  /** Item id shown in the detail panel. */
  selected: string | null;
  /** Scales are shown, heard and added over this many octaves. */
  octaves: 1 | 2;
}

export interface Settings {
  /** Selected MIDI input id; null means auto-select. */
  midiInputId: string | null;
  theme: ThemePreference;
  hand: HandChoice;
  /** Show fingering (F): finger numbers on keys, the staff and the hand legend. */
  showFingerNumbers: boolean;
  /** On-screen keyboard zoom: 0 fits the full range, 1 shows about two octaves. */
  keyboardZoom: number;
  /** Note names on every on-screen key (C labels are always shown). */
  showKeyNames: boolean;
  visualiser: VisualiserSettings;
  /** Controller buttons, pads and knobs learned for app actions. */
  controls: ControlMap;
  noteDrill: NoteDrillSettings;
  /** The last free-practice selection, remembered. */
  freePractice: FreePracticeSettings;
  library: LibrarySettings;
}

export const DEFAULT_SETTINGS: Settings = {
  midiInputId: null,
  theme: 'system',
  hand: 'right',
  showFingerNumbers: true,
  keyboardZoom: 0,
  showKeyNames: false,
  visualiser: { enabled: false, colors: 'rainbow', sparks: true, overlay: true },
  controls: {},
  noteDrill: {
    treble: { low: 'C4', high: 'G4' },
    bass: { low: 'C3', high: 'G3' },
    ledgerLines: true,
    accidentals: false,
    newPerDay: 10,
  },
  freePractice: {
    kind: 'notes',
    notes: {
      hand: 'right',
      selection: 'range',
      treble: { low: 'C4', high: 'G4' },
      bass: { low: 'C3', high: 'G3' },
      ledgerLines: true,
      accidentals: false,
      specific: [],
    },
  },
  library: { filter: EMPTY_FILTER, selected: null, octaves: 1 },
};

const CLEF_FOR_HAND: Record<HandChoice, ClefChoice> = { left: 'bass', right: 'treble', both: 'both' };
const HAND_FOR_CLEF: Record<ClefChoice, HandChoice> = { bass: 'left', treble: 'right', both: 'both' };

/** Left hand reads the bass clef, right hand the treble, both hands the grand staff. */
export function clefForHand(hand: HandChoice): ClefChoice {
  return CLEF_FOR_HAND[hand];
}

export function noteDrillOptions(settings: Settings): NoteDrillOptions {
  return { ...settings.noteDrill, clef: CLEF_FOR_HAND[settings.hand] };
}

type LegacySettings = Omit<Partial<Settings>, 'noteDrill'> & {
  noteDrill?: Partial<NoteDrillSettings> & { clef?: ClefChoice };
};

function visualiserWithDefaults(partial: Partial<VisualiserSettings> | undefined): VisualiserSettings {
  const merged = { ...DEFAULT_SETTINGS.visualiser, ...partial };
  // An earlier version offered "fingers"; anything unknown falls back to rainbow.
  if (!VISUALISER_COLORS.includes(merged.colors)) merged.colors = 'rainbow';
  return merged;
}

/** Fill in any missing fields (e.g. after an app update adds a setting) and migrate old ones. */
export function withDefaults(partial: LegacySettings | undefined): Settings {
  const { clef: legacyClef, ...noteDrill } = partial?.noteDrill ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...partial,
    // Before the hand setting existed, the clef was stored with the drill options.
    hand: partial?.hand ?? (legacyClef ? HAND_FOR_CLEF[legacyClef] : DEFAULT_SETTINGS.hand),
    visualiser: visualiserWithDefaults(partial?.visualiser),
    controls: { ...partial?.controls },
    library: {
      ...DEFAULT_SETTINGS.library,
      ...partial?.library,
      filter: { ...EMPTY_FILTER, ...partial?.library?.filter },
    },
    freePractice: {
      ...DEFAULT_SETTINGS.freePractice,
      ...partial?.freePractice,
      notes: {
        ...DEFAULT_SETTINGS.freePractice.notes,
        ...partial?.freePractice?.notes,
        treble: { ...DEFAULT_SETTINGS.freePractice.notes.treble, ...partial?.freePractice?.notes?.treble },
        bass: { ...DEFAULT_SETTINGS.freePractice.notes.bass, ...partial?.freePractice?.notes?.bass },
      },
    },
    noteDrill: {
      ...DEFAULT_SETTINGS.noteDrill,
      ...noteDrill,
      treble: { ...DEFAULT_SETTINGS.noteDrill.treble, ...noteDrill.treble },
      bass: { ...DEFAULT_SETTINGS.noteDrill.bass, ...noteDrill.bass },
    },
  };
}
