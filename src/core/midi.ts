/**
 * Web MIDI input. Connects on launch and on hot-plug. One port is the keys
 * port (auto mode prefers a keyboard's main port over DAW/control ports);
 * the device's other ports (e.g. the KeyLab's "MIDIIN2" DAW port with the
 * transport buttons) are listened to as well, for mapped controls.
 *
 * Every message first goes through `filter` (the controls mapper). Only
 * messages it doesn't consume, and only from the keys port, become note and
 * controller events, so mapped controls never play or answer a card.
 */
import type { MidiMessage } from './controls';
import { Emitter } from './emitter';

export type MidiStatus =
  | { kind: 'unsupported' }
  | { kind: 'denied' }
  | { kind: 'pending' }
  | { kind: 'disconnected' }
  | { kind: 'connected'; name: string };

export interface MidiDevice {
  id: string;
  name: string;
}

export interface NoteEvent {
  note: number;
  velocity: number;
  /** performance.now() timebase. */
  time: number;
}

export interface CCEvent {
  controller: number;
  value: number;
  time: number;
}

type MidiEvents = {
  noteOn: NoteEvent;
  noteOff: NoteEvent;
  cc: CCEvent;
  status: MidiStatus;
  devices: MidiDevice[];
};

const SECONDARY_PORT = /midiin\s*\d|daw|control|mcu|hui/i;

/** A port name reduced to its device, e.g. "MIDIIN2 (KeyLab Essential 61)" → "keylab essential 61". */
export function deviceOf(portName: string): string {
  let name = portName.trim();
  const wrapped = /^[^()]*\((.+)\)\s*$/.exec(name);
  if (wrapped) name = wrapped[1]!;
  name = name.replace(/^\d+-\s*/, ''); // Windows prefixes repeat ports with "2- "
  let before: string;
  do {
    before = name;
    name = name.replace(/\s+(midi|daw|mcu|hui|control|in|port\s*\d+)$/i, '');
  } while (name !== before);
  return name.toLowerCase();
}

export interface KeyRange {
  /** MIDI note numbers, inclusive. */
  low: number;
  high: number;
}

/**
 * Default (unshifted) key ranges by key count. Web MIDI does not report a
 * keyboard's size, so it is read from the device name (e.g. "KeyLab Essential 61").
 */
const RANGES_BY_KEY_COUNT: Record<number, KeyRange> = {
  25: { low: 48, high: 72 }, // C3–C5
  32: { low: 53, high: 84 }, // F3–C6
  37: { low: 48, high: 84 }, // C3–C6
  49: { low: 36, high: 84 }, // C2–C6
  61: { low: 36, high: 96 }, // C2–C7
  73: { low: 28, high: 100 }, // E1–E7
  76: { low: 28, high: 103 }, // E1–G7
  88: { low: 21, high: 108 }, // A0–C8
};

/** 61 keys, C2–C7, when the device is unknown. */
export const DEFAULT_KEY_RANGE = RANGES_BY_KEY_COUNT[61]!;

/** The key range of a MIDI keyboard, inferred from its name; null if the name doesn't say. */
export function keyRangeForDevice(name: string | null | undefined): KeyRange | null {
  const count = name?.match(/\b(25|32|37|49|61|73|76|88)\b/)?.[1];
  return count ? RANGES_BY_KEY_COUNT[Number(count)]! : null;
}

export class Midi extends Emitter<MidiEvents> {
  private access: MIDIAccess | null = null;
  private active: MIDIInput | null = null;
  /** Every port being listened to (the keys port and the device's other ports). */
  private listening = new Set<MIDIInput>();
  private preferredId: string | null = null;

  /** Return true to consume a message (it then never becomes a note or CC event). */
  filter: ((msg: MidiMessage) => boolean) | null = null;
  private _status: MidiStatus = { kind: 'pending' };

  get status(): MidiStatus {
    return this._status;
  }

  /** Names of the ports being listened to, keys port first. */
  get ports(): string[] {
    return [...this.listening].map((i) => i.name ?? 'MIDI input');
  }

  get devices(): MidiDevice[] {
    if (!this.access) return [];
    return [...this.access.inputs.values()]
      .filter((i) => i.state === 'connected')
      .map((i) => ({ id: i.id, name: i.name ?? 'MIDI input' }));
  }

  async init(preferredId: string | null): Promise<void> {
    this.preferredId = preferredId;
    if (!('requestMIDIAccess' in navigator)) {
      this.setStatus({ kind: 'unsupported' });
      return;
    }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch {
      this.setStatus({ kind: 'denied' });
      return;
    }
    this.access.addEventListener('statechange', () => this.connect());
    this.connect();
  }

  /** Choose a specific input id, or null for auto-select. */
  select(id: string | null): void {
    this.preferredId = id;
    this.connect();
  }

  private connect(): void {
    const inputs = this.devices;
    this.emit('devices', inputs);
    const chosen =
      inputs.find((d) => d.id === this.preferredId) ??
      inputs.find((d) => !SECONDARY_PORT.test(d.name)) ??
      inputs[0];
    const input = chosen ? this.access!.inputs.get(chosen.id) ?? null : null;
    this.active = input;

    const device = input ? deviceOf(input.name ?? '') : null;
    const wanted = new Set(
      [...this.access!.inputs.values()].filter(
        (i) => i.state === 'connected' && (i === input || (device !== null && deviceOf(i.name ?? '') === device)),
      ),
    );
    for (const old of this.listening) if (!wanted.has(old)) old.onmidimessage = null;
    for (const port of wanted) port.onmidimessage = (e) => this.handle(e, port);
    this.listening = new Set([...(input ? [input] : []), ...[...wanted].filter((p) => p !== input)]);
    this.setStatus(input ? { kind: 'connected', name: input.name ?? 'MIDI input' } : { kind: 'disconnected' });
  }

  private handle(e: MIDIMessageEvent, port: MIDIInput): void {
    const data = e.data;
    if (!data || data.length < 2) return;
    const status = data[0]!;
    if (status >= 0xf0) return; // system messages (clock, sysex) are not controls
    const type = status & 0xf0;
    const a = data[1]!;
    const b = data[2] ?? 0;
    const time = e.timeStamp || performance.now();
    const main = port === this.active;
    const message: MidiMessage = {
      port: port.name ?? 'MIDI input',
      main,
      type: type === 0x90 && b > 0 ? 'noteon' : type === 0x80 || type === 0x90 ? 'noteoff' : type === 0xb0 ? 'cc' : 'other',
      channel: status & 0x0f,
      data1: a,
      data2: b,
      time,
    };
    if (this.filter?.(message) || !main) return;
    if (type === 0x90 && b > 0) this.emit('noteOn', { note: a, velocity: b, time });
    else if (type === 0x80 || (type === 0x90 && b === 0)) this.emit('noteOff', { note: a, velocity: b, time });
    else if (type === 0xb0) this.emit('cc', { controller: a, value: b, time });
  }

  private setStatus(status: MidiStatus): void {
    const same = JSON.stringify(status) === JSON.stringify(this._status);
    this._status = status;
    if (!same) this.emit('status', status);
  }
}

export const midi = new Midi();
