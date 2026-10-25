/**
 * MIDI-learn navigation: map pads, buttons, transport keys and knobs on the
 * controller to app actions. UI-agnostic: it receives raw MIDI messages,
 * says whether each one was consumed (so it never also plays a note or
 * answers a card), and emits the actions to run.
 *
 * Supported controls:
 * - note-on (pads, Mackie Control transport buttons on a DAW port)
 * - CC buttons: value > 63 is a press; only the press triggers
 * - HUI buttons: CC 0x0F selects a zone, CC 0x2F reports a port press/release
 * - knobs (continuous actions): absolute CC or one of three relative encodings
 */
import { Emitter } from './emitter';

export type ActionId =
  | 'area-play'
  | 'area-study'
  | 'area-library'
  | 'area-stats'
  | 'start-pause'
  | 'restart'
  | 'next'
  | 'previous'
  | 'hear'
  | 'toggle-visualiser'
  | 'toggle-fingering'
  | 'hand-left'
  | 'hand-right'
  | 'hand-both'
  | 'zoom-in'
  | 'zoom-out'
  | 'settings'
  | 'back'
  | 'metronome'
  | 'tap-tempo'
  | 'tempo-up'
  | 'tempo-down'
  | 'loop-a'
  | 'loop-b'
  | 'song-view'
  | 'song-wait'
  | 'zoom'
  | 'tempo';

export interface ActionInfo {
  id: ActionId;
  label: string;
  /** The computer key that does the same thing. */
  hotkey?: string;
  /** Driven by a knob rather than pressed. */
  continuous?: boolean;
}

export const ACTIONS: readonly ActionInfo[] = [
  { id: 'area-play', label: 'Play area', hotkey: 'P' },
  { id: 'area-study', label: 'Study area', hotkey: 'T' },
  { id: 'area-library', label: 'Library', hotkey: 'L' },
  { id: 'area-stats', label: 'Stats', hotkey: 'S' },
  { id: 'start-pause', label: 'Start / pause', hotkey: 'Space' },
  { id: 'restart', label: 'Restart card', hotkey: 'R' },
  { id: 'next', label: 'Skip / next', hotkey: '→' },
  { id: 'previous', label: 'Previous', hotkey: '←' },
  { id: 'hear', label: 'Hear answer', hotkey: 'H' },
  { id: 'toggle-visualiser', label: 'Toggle visualiser', hotkey: 'V' },
  { id: 'toggle-fingering', label: 'Toggle fingering', hotkey: 'F' },
  { id: 'hand-left', label: 'Left hand', hotkey: '1' },
  { id: 'hand-right', label: 'Right hand', hotkey: '2' },
  { id: 'hand-both', label: 'Both hands', hotkey: '3' },
  { id: 'zoom-in', label: 'Zoom in', hotkey: '=' },
  { id: 'zoom-out', label: 'Zoom out', hotkey: '-' },
  { id: 'settings', label: 'Settings', hotkey: 'Q' },
  { id: 'back', label: 'Back', hotkey: 'Esc' },
  { id: 'metronome', label: 'Metronome start / stop', hotkey: 'M' },
  { id: 'tap-tempo', label: 'Tap tempo', hotkey: 'B' },
  { id: 'tempo-up', label: 'Tempo +1', hotkey: '.' },
  { id: 'tempo-down', label: 'Tempo −1', hotkey: ',' },
  { id: 'loop-a', label: 'Song: loop start (A)', hotkey: '[' },
  { id: 'loop-b', label: 'Song: loop end (B)', hotkey: ']' },
  { id: 'song-view', label: 'Song: falling notes / notation', hotkey: 'V' },
  { id: 'song-wait', label: 'Song: wait mode / play-along', hotkey: 'W' },
  { id: 'zoom', label: 'Keyboard zoom (knob)', continuous: true },
  { id: 'tempo', label: 'Tempo (knob)', continuous: true },
];

export function actionInfo(id: ActionId): ActionInfo {
  return ACTIONS.find((a) => a.id === id)!;
}

/** How a knob's CC values are read. */
export type CcMode = 'absolute' | 'relative-offset' | 'relative-twos' | 'relative-sign';

export const CC_MODE_LABELS: Record<CcMode, string> = {
  absolute: 'Absolute (0–127)',
  'relative-offset': 'Relative (64 = no change)',
  'relative-twos': 'Relative (127 = −1)',
  'relative-sign': 'Relative (65 = −1)',
};

export interface ControlBinding {
  /** MIDI input port name (more stable across sessions than the port id). */
  port: string;
  kind: 'note' | 'cc' | 'hui';
  /** 0–15 (ignored for HUI). */
  channel: number;
  /** Note or CC number; for HUI, zone × 16 + port. */
  number: number;
  /** Knobs only. */
  mode?: CcMode;
}

export type ControlMap = Partial<Record<ActionId, ControlBinding>>;

/** A raw MIDI message from any port of the connected device. */
export interface MidiMessage {
  port: string;
  /** From the keys port (the one that plays notes). */
  main: boolean;
  type: 'noteon' | 'noteoff' | 'cc' | 'other';
  channel: number;
  data1: number;
  data2: number;
  time: number;
}

type ControlEvents = {
  action: ActionId;
  /** Knob movement: either an absolute position (0–1) or a step count (+/-). */
  continuous: { action: ActionId; absolute?: number; delta?: number };
  learned: { action: ActionId; binding: ControlBinding; replaced: ActionId | null };
  /** Something was pressed during learning that can't be used. */
  rejected: { action: ActionId; reason: string };
};

const HUI_ZONE_CC = 0x0f;
const HUI_PORT_CC = 0x2f;
const SUSTAIN_CC = 64;
/** How long after a knob is learned its values are watched to guess its encoding. */
const DETECT_MS = 800;

/** Mackie Control button notes, for naming learned transport buttons. */
const MACKIE_NAMES: Record<number, string> = {
  46: 'Bank ←',
  47: 'Bank →',
  48: 'Channel ←',
  49: 'Channel →',
  80: 'Save',
  81: 'Undo',
  86: 'Loop',
  89: 'Click',
  91: 'Rewind',
  92: 'Fast forward',
  93: 'Stop',
  94: 'Play',
  95: 'Record',
};

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

function sameControl(a: ControlBinding, b: ControlBinding): boolean {
  return a.port === b.port && a.kind === b.kind && a.number === b.number && (a.kind === 'hui' || a.channel === b.channel);
}

/** Human-readable name of a learned control, e.g. "Pad C2 · ch 10" or "Play (Mackie) · MIDIIN2 port". */
export function describeBinding(b: ControlBinding, mainPort: string | null): string {
  const where = b.port === mainPort ? '' : ` · ${b.port}`;
  if (b.kind === 'hui') return `HUI zone ${b.number >> 4} button ${b.number & 15}${where}`;
  if (b.kind === 'cc') return `CC ${b.number} · ch ${b.channel + 1}${where}`;
  const mackie = b.port !== mainPort && b.channel === 0 ? MACKIE_NAMES[b.number] : undefined;
  if (mackie) return `${mackie} (Mackie)${where}`;
  const name = `${NOTE_NAMES[b.number % 12]}${Math.floor(b.number / 12) - 1}`;
  return `Note ${name} · ch ${b.channel + 1}${where}`;
}

/** Compact name for the hint bar, e.g. "Play", "C2 ch10", "CC74". */
export function shortBinding(b: ControlBinding, mainPort: string | null): string {
  if (b.kind === 'hui') return `HUI ${b.number >> 4}.${b.number & 15}`;
  if (b.kind === 'cc') return `CC${b.number}`;
  const mackie = b.port !== mainPort && b.channel === 0 ? MACKIE_NAMES[b.number] : undefined;
  return mackie ?? `${NOTE_NAMES[b.number % 12]}${Math.floor(b.number / 12) - 1} ch${b.channel + 1}`;
}

/** Steps a relative knob moved (positive = clockwise). */
export function relativeDelta(value: number, mode: CcMode): number {
  switch (mode) {
    case 'relative-offset':
      return value - 64;
    case 'relative-twos':
      return value < 64 ? value : value - 128;
    case 'relative-sign':
      return value & 0x40 ? -(value & 0x3f) : value & 0x3f;
    default:
      return 0;
  }
}

/**
 * Guess a knob's encoding from values seen while turning it. Relative knobs
 * repeat small codes (1, 1, 1 or 65, 65); absolute knobs walk through values.
 */
export function classifyCc(values: number[]): CcMode {
  const repeats = values.some((v, i) => i > 0 && v === values[i - 1]);
  const small = (v: number) => v >= 1 && v <= 15;
  if (values.every((v) => small(v) || v >= 113)) return 'relative-twos';
  if (values.every((v) => small(v) || (v >= 65 && v <= 79)) && values.some(small)) return 'relative-sign';
  if (repeats && values.every((v) => v >= 56 && v <= 72)) return 'relative-offset';
  return 'absolute';
}

export class Controls extends Emitter<ControlEvents> {
  private bindings: ControlMap = {};
  private learning: ActionId | null = null;
  private huiZone = new Map<string, number>();
  private ccValues = new Map<string, number>();
  private detecting: { action: ActionId; binding: ControlBinding; values: number[]; until: number } | null = null;

  /** Messages that are piano keys (never learnable, always played). Set by the app. */
  isPianoKey: (msg: MidiMessage) => boolean = () => false;

  setBindings(map: ControlMap): void {
    this.bindings = { ...map };
  }

  get map(): ControlMap {
    return { ...this.bindings };
  }

  get learningAction(): ActionId | null {
    return this.learning;
  }

  learn(action: ActionId): void {
    this.learning = action;
  }

  cancelLearn(): void {
    this.learning = null;
  }

  /** The action a binding is mapped to, if any. */
  actionFor(binding: ControlBinding): ActionId | null {
    return (Object.keys(this.bindings) as ActionId[]).find((id) => sameControl(this.bindings[id]!, binding)) ?? null;
  }

  /** Handle one message; returns true when it was a control (so it must not play or answer). */
  handle(msg: MidiMessage): boolean {
    if (msg.type === 'cc' && msg.data1 === HUI_ZONE_CC && !msg.main) {
      this.huiZone.set(msg.port, msg.data2);
      return true;
    }
    if (msg.type === 'cc' && msg.data1 === HUI_PORT_CC && !msg.main) {
      const zone = this.huiZone.get(msg.port);
      if (zone === undefined) return true;
      const pressed = (msg.data2 & 0x40) !== 0;
      const binding: ControlBinding = { port: msg.port, kind: 'hui', channel: 0, number: zone * 16 + (msg.data2 & 0x0f) };
      if (this.learning) return pressed ? this.bind(binding) : true;
      const action = this.actionFor(binding);
      if (action && pressed) this.emit('action', action);
      return true;
    }
    if (msg.type === 'other') return !msg.main;

    if (this.learning) return this.learnFrom(msg);

    if (this.detecting && msg.type === 'cc') this.watchKnob(msg);

    const binding = this.bindingOf(msg);
    const action = this.actionFor(binding);
    if (!action) {
      // Unmapped messages from the keys port play as usual; other ports never play.
      return !msg.main;
    }
    const info = actionInfo(action);
    if (msg.type === 'noteon' && !info.continuous) this.emit('action', action);
    if (msg.type === 'cc') {
      const key = `${msg.port}|${msg.channel}|${msg.data1}`;
      const before = this.ccValues.get(key) ?? 0;
      this.ccValues.set(key, msg.data2);
      if (info.continuous) {
        const mode = this.bindings[action]!.mode ?? 'absolute';
        if (mode === 'absolute') this.emit('continuous', { action, absolute: msg.data2 / 127 });
        else this.emit('continuous', { action, delta: relativeDelta(msg.data2, mode) });
      } else if (msg.data2 > 63 && before <= 63) {
        this.emit('action', action);
      }
    }
    return true;
  }

  private bindingOf(msg: MidiMessage): ControlBinding {
    return { port: msg.port, kind: msg.type === 'cc' ? 'cc' : 'note', channel: msg.channel, number: msg.data1 };
  }

  private learnFrom(msg: MidiMessage): boolean {
    const action = this.learning!;
    const continuous = actionInfo(action).continuous;
    if (this.isPianoKey(msg)) {
      if (msg.type === 'noteon') {
        this.emit('rejected', { action, reason: 'That’s a piano key. Use a pad, button or knob instead.' });
      }
      return false;
    }
    if (msg.type === 'cc' && msg.main && msg.data1 === SUSTAIN_CC) {
      this.emit('rejected', { action, reason: 'That’s the sustain pedal. Use a pad, button or knob instead.' });
      return false;
    }
    if (continuous) {
      if (msg.type === 'noteon') {
        this.emit('rejected', { action, reason: 'This action needs a knob. Turn a knob instead.' });
        return true;
      }
      if (msg.type !== 'cc') return true;
      const binding = { ...this.bindingOf(msg), mode: classifyCc([msg.data2]) };
      this.detecting = { action, binding, values: [msg.data2], until: msg.time + DETECT_MS };
      return this.bind(binding);
    }
    if (msg.type === 'noteon' || (msg.type === 'cc' && msg.data2 > 63)) {
      if (msg.type === 'cc') this.ccValues.set(`${msg.port}|${msg.channel}|${msg.data1}`, msg.data2);
      return this.bind(this.bindingOf(msg));
    }
    return true; // releases and the like: swallow while learning
  }

  private bind(binding: ControlBinding): boolean {
    const action = this.learning!;
    const replaced = this.actionFor(binding);
    if (replaced && replaced !== action) delete this.bindings[replaced];
    this.bindings[action] = binding;
    this.learning = null;
    this.emit('learned', { action, binding, replaced: replaced === action ? null : replaced });
    return true;
  }

  /** Refine a just-learned knob's encoding from the next values it sends. */
  private watchKnob(msg: MidiMessage): void {
    const d = this.detecting!;
    if (msg.time > d.until) {
      this.detecting = null;
      return;
    }
    if (!sameControl(d.binding, this.bindingOf(msg))) return;
    d.values.push(msg.data2);
    const mode = classifyCc(d.values);
    if (mode !== d.binding.mode) {
      d.binding = { ...d.binding, mode };
      this.bindings[d.action] = d.binding;
      this.emit('learned', { action: d.action, binding: d.binding, replaced: null });
    }
  }
}

export const controls = new Controls();
