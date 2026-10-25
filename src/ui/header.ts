/** Slim app header: name, area tabs (Play / Study / Library / Stats), metronome, MIDI status, sample loading, due count, settings. */
import type { AudioLoad } from '../core/audio';
import type { MidiStatus } from '../core/midi';
import { h, icon } from './dom';

/** Top-level areas. */
export type Area = 'play' | 'study' | 'library' | 'stats';

const AREAS: { area: Area; label: string; hotkey: string }[] = [
  { area: 'play', label: 'Play', hotkey: 'P' },
  { area: 'study', label: 'Study', hotkey: 'T' },
  { area: 'library', label: 'Library', hotkey: 'L' },
  { area: 'stats', label: 'Stats', hotkey: 'S' },
];

export class Header {
  readonly el: HTMLElement;
  private midiEl: HTMLElement;
  private audioEl: HTMLElement;
  private dueEl: HTMLElement;
  private metaEl: HTMLElement;
  private tabs: Map<Area, HTMLButtonElement>;

  constructor(onSettings: () => void, onArea: (area: Area) => void) {
    this.tabs = new Map(
      AREAS.map(({ area, label, hotkey }) => [
        area,
        h(
          'button.tab',
          { type: 'button', title: `${label} (${hotkey})`, onclick: () => onArea(area) },
          h('span', null, label),
          h('kbd', null, hotkey),
        ),
      ]),
    );
    this.midiEl = h('span.status', { role: 'status' });
    this.audioEl = h('span.status.status-audio', { role: 'status' });
    this.dueEl = h('span.due-count.num', null, '0');
    this.el = h(
      'header.app-header',
      null,
      h(
        'div.header-start',
        null,
        h('div.brand', null, icon('piano'), h('span', null, 'Piano Trainer')),
        h('nav.tabs', { 'aria-label': 'Areas' }, ...this.tabs.values()),
      ),
      (this.metaEl = h(
        'div.header-meta',
        null,
        this.audioEl,
        this.midiEl,
        h('span.status', { title: 'Cards due today' }, icon('calendar-clock'), this.dueEl, h('span.status-label', null, 'due')),
        h(
          'button.icon-button',
          { type: 'button', title: 'Settings (Q)', 'aria-label': 'Settings', onclick: onSettings },
          icon('settings'),
        ),
      )),
    );
    this.setMidi({ kind: 'pending' });
  }

  /** Put the metronome pill at the start of the status area. */
  setMetronome(el: HTMLElement): void {
    this.metaEl.prepend(el);
  }

  setMidi(status: MidiStatus): void {
    const text: Record<MidiStatus['kind'], string> = {
      unsupported: 'Web MIDI not supported — use Chrome or Edge',
      denied: 'MIDI access blocked',
      pending: 'Connecting MIDI…',
      disconnected: 'No MIDI keyboard',
      connected: status.kind === 'connected' ? status.name : '',
    };
    const ok = status.kind === 'connected';
    this.midiEl.replaceChildren(icon(ok ? 'midi-port' : 'unplug'), h('span.status-label', null, text[status.kind]));
    this.midiEl.classList.toggle('is-muted', !ok);
  }

  setAudio(load: AudioLoad): void {
    if (load.ready) {
      this.audioEl.hidden = true;
      return;
    }
    this.audioEl.hidden = false;
    this.audioEl.replaceChildren(
      icon('volume-2'),
      load.error
        ? h('span.status-label', null, 'Piano sound unavailable offline')
        : h('span.status-label.num', null, load.total ? `${load.loaded}/${load.total}` : 'Loading piano…'),
    );
  }

  /** Highlight the current area (null while in settings, which belongs to neither). */
  setArea(area: Area | null): void {
    for (const [a, tab] of this.tabs) {
      if (a === area) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }
  }

  setDue(count: number): void {
    this.dueEl.textContent = String(count);
  }
}
