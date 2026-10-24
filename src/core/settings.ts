import type { ControlMap } from './controls';
import type { Clef } from './pitch';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ClefChoice = Clef | 'both';
/** Which hand is practised. */
export type HandChoice = 'left' | 'right' | 'both';
/** Visualiser bar colours: by pitch class, one accent colour, or finger colours (when fingering is known). */
export type VisualiserColors = 'rainbow' | 'accent' | 'fingers';

export interface VisualiserSettings {
  enabled: boolean;
  colors: VisualiserColors;
  /** Spark burst on note-on (always off when the system asks for reduced motion). */
  sparks: boolean;
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

export interface Settings {
  /** Selected MIDI input id; null means auto-select. */
  midiInputId: string | null;
  theme: ThemePreference;
  hand: HandChoice;
  /** Show 1–5 on the fingertips of the hand legend. */
  showFingerNumbers: boolean;
  /** On-screen keyboard zoom: 0 fits the full range, 1 shows about two octaves. */
  keyboardZoom: number;
  /** Note names on every on-screen key (C labels are always shown). */
  showKeyNames: boolean;
  visualiser: VisualiserSettings;
  /** Controller buttons, pads and knobs learned for app actions. */
  controls: ControlMap;
  noteDrill: NoteDrillSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  midiInputId: null,
  theme: 'system',
  hand: 'right',
  showFingerNumbers: true,
  keyboardZoom: 0,
  showKeyNames: false,
  visualiser: { enabled: false, colors: 'rainbow', sparks: true },
  controls: {},
  noteDrill: {
    treble: { low: 'C4', high: 'G4' },
    bass: { low: 'C3', high: 'G3' },
    ledgerLines: true,
    accidentals: false,
    newPerDay: 10,
  },
};

const CLEF_FOR_HAND: Record<HandChoice, ClefChoice> = { left: 'bass', right: 'treble', both: 'both' };
const HAND_FOR_CLEF: Record<ClefChoice, HandChoice> = { bass: 'left', treble: 'right', both: 'both' };

/** Left hand reads the bass clef, right hand the treble, both hands the grand staff. */
export function noteDrillOptions(settings: Settings): NoteDrillOptions {
  return { ...settings.noteDrill, clef: CLEF_FOR_HAND[settings.hand] };
}

type LegacySettings = Omit<Partial<Settings>, 'noteDrill'> & {
  noteDrill?: Partial<NoteDrillSettings> & { clef?: ClefChoice };
};

/** Fill in any missing fields (e.g. after an app update adds a setting) and migrate old ones. */
export function withDefaults(partial: LegacySettings | undefined): Settings {
  const { clef: legacyClef, ...noteDrill } = partial?.noteDrill ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...partial,
    // Before the hand setting existed, the clef was stored with the drill options.
    hand: partial?.hand ?? (legacyClef ? HAND_FOR_CLEF[legacyClef] : DEFAULT_SETTINGS.hand),
    visualiser: { ...DEFAULT_SETTINGS.visualiser, ...partial?.visualiser },
    controls: { ...partial?.controls },
    noteDrill: {
      ...DEFAULT_SETTINGS.noteDrill,
      ...noteDrill,
      treble: { ...DEFAULT_SETTINGS.noteDrill.treble, ...noteDrill.treble },
      bass: { ...DEFAULT_SETTINGS.noteDrill.bass, ...noteDrill.bass },
    },
  };
}
