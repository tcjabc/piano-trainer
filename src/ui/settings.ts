/** Settings: MIDI input, controller mapping, Play, drill options, theme, export/import. */
import { ACTIONS, CC_MODE_LABELS, describeBinding, type ActionId, type CcMode } from '../core/controls';
import type { MidiDevice } from '../core/midi';
import { naturalsBetween, formatSpelling, spellingToMidi, displaySpelling, type Clef } from '../core/pitch';
import type { HandChoice, Settings, ThemePreference, VisualiserColors } from '../core/settings';
import { h, icon } from './dom';
import { FormBuilder } from './form';
import { formatNoteName } from './note-text';

export interface SettingsActions {
  change: (settings: Settings) => void;
  exportData: () => Promise<void>;
  importData: (file: File) => Promise<string>;
  /** Start listening for a control to map to an action. */
  learnControl: (action: ActionId) => void;
  cancelLearn: () => void;
}

/** Notes offered in the range pickers for each clef. */
const RANGE_CHOICES: Record<Clef, string[]> = {
  treble: naturalsBetween('C3', 'C7').map(formatSpelling),
  bass: naturalsBetween('C1', 'C5').map(formatSpelling),
};

const form = new FormBuilder('setting');

export class SettingsView {
  readonly el: HTMLElement;
  private settings: Settings;
  private devices: MidiDevice[] = [];
  private activeDevice: string | null = null;
  private body: HTMLElement;
  private message: HTMLElement;
  /** Ports listened to, keys port first. */
  private ports: string[] = [];
  /** The action waiting for a control, while learning. */
  private learning: ActionId | null = null;
  private controlsMessage: { text: string; warn: boolean } | null = null;

  constructor(initial: Settings, private actions: SettingsActions) {
    // Esc cancels learning before it reaches the screen's "back" hotkey.
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape' || !this.learning || !this.el.isConnected) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        this.stopLearning({ text: 'Learning cancelled.', warn: false });
      },
      true,
    );
    this.settings = structuredClone(initial);
    this.body = h('div.settings-body');
    this.message = h('p.settings-message.muted', { role: 'status' });
    this.el = h(
      'section.panel.settings-panel',
      { 'aria-labelledby': 'settings-title' },
      h('h1.heading', { id: 'settings-title' }, 'Settings'),
      this.body,
    );
    this.render();
  }

  /** Take a new copy of the settings; `render` false just keeps the copy current (nothing on screen changes). */
  setSettings(settings: Settings, render = true): void {
    this.settings = structuredClone(settings);
    if (render) this.render();
  }

  setDevices(devices: MidiDevice[], activeName: string | null, ports: string[]): void {
    this.devices = devices;
    this.activeDevice = activeName;
    this.ports = ports;
    this.render();
  }

  /** Learning finished, failed or was cancelled: show what happened. */
  stopLearning(message: { text: string; warn: boolean } | null): void {
    if (this.learning) this.actions.cancelLearn();
    this.learning = null;
    this.controlsMessage = message;
    this.render();
  }

  /** Show a note while still learning (e.g. a piano key was pressed). */
  learningNote(text: string): void {
    this.controlsMessage = { text, warn: true };
    this.render();
  }

  private startLearning(action: ActionId): void {
    this.learning = action;
    this.controlsMessage = null;
    this.actions.learnControl(action);
    this.render();
  }

  /** Move focus to the first control, for keyboard-only use. */
  focusFirst(): void {
    this.body.querySelector<HTMLElement>('select, input, button')?.focus();
  }

  private commit(mutate: (s: Settings) => void): void {
    mutate(this.settings);
    this.actions.change(structuredClone(this.settings));
    this.render();
  }

  private render(): void {
    const focusedId = (document.activeElement as HTMLElement | null)?.id;
    const s = this.settings;
    const d = s.noteDrill;
    form.reset();

    this.body.replaceChildren(
      form.section(
        'MIDI input',
        form.field(
          'Device',
          form.select(
            [
              { value: '', label: `Automatic${this.activeDevice ? ` (${this.activeDevice})` : ''}` },
              ...this.devices.map((dev) => ({ value: dev.id, label: dev.name })),
            ],
            s.midiInputId ?? '',
            (v) => this.commit((x) => (x.midiInputId = v || null)),
          ),
        ),
        this.devices.length === 0 ? h('p.muted.field-note', null, 'No MIDI inputs found. Plug in your keyboard; it connects automatically.') : null,
      ),
      this.controlsSection(),
      form.section(
        'Play',
        form.field(
          'Key names',
          form.checkbox(s.showKeyNames, (v) => this.commit((x) => (x.showKeyNames = v)), 'Show note names on every on-screen key (N)'),
        ),
        form.field(
          'Visualiser',
          form.checkbox(
            s.visualiser.enabled,
            (v) => this.commit((x) => (x.visualiser.enabled = v)),
            'Glowing bars rise from the keys you play (V)',
          ),
        ),
        form.field(
          'Colours',
          form.segmented<VisualiserColors>(
            'viz-colors',
            [
              { value: 'rainbow', label: 'Rainbow' },
              { value: 'neon', label: 'Neon' },
              { value: 'ice', label: 'Ice' },
              { value: 'accent', label: 'Single colour' },
            ],
            s.visualiser.colors,
            (v) => this.commit((x) => (x.visualiser.colors = v)),
          ),
        ),
        form.field(
          'Particles',
          form.checkbox(s.visualiser.sparks, (v) => this.commit((x) => (x.visualiser.sparks = v)), 'Embers rise from the keys you play'),
        ),
        form.field(
          'Staff overlay',
          form.checkbox(
            s.visualiser.overlay,
            (v) => this.commit((x) => (x.visualiser.overlay = v)),
            'Show the staff and note names over the visualiser (O)',
          ),
        ),
        h(
          'p.muted.field-note',
          null,
          'When your system asks for reduced motion, bars fade in place and there are no particles.',
        ),
      ),
      form.section(
        'Study',
        form.field(
          'Hand',
          form.segmented<HandChoice>(
            'hand',
            [
              { value: 'left', label: 'Left · bass' },
              { value: 'right', label: 'Right · treble' },
              { value: 'both', label: 'Both · grand staff' },
            ],
            s.hand,
            (v) => this.commit((x) => (x.hand = v)),
          ),
        ),
        this.rangeField('treble', 'Treble range'),
        this.rangeField('bass', 'Bass range'),
        form.field(
          'Ledger lines',
          form.checkbox(d.ledgerLines, (v) => this.commit((x) => (x.noteDrill.ledgerLines = v)), 'Include notes on ledger lines'),
        ),
        form.field(
          'Accidentals',
          form.checkbox(d.accidentals, (v) => this.commit((x) => (x.noteDrill.accidentals = v)), 'Include sharps and flats'),
        ),
        form.field(
          'New notes per day',
          form.numberInput(d.newPerDay, 0, 100, (v) => this.commit((x) => (x.noteDrill.newPerDay = v))),
        ),
        form.field(
          'New chords per day',
          form.numberInput(s.chordDrill.newPerDay, 0, 50, (v) => this.commit((x) => (x.chordDrill.newPerDay = v))),
        ),
        form.field(
          'Chord cards',
          form.checkbox(
            s.chordDrill.showStaff,
            (v) => this.commit((x) => (x.chordDrill.showStaff = v)),
            'Show the chord on the staff as well as its name',
          ),
        ),
        form.field(
          'New scales per day',
          form.numberInput(s.scaleDrill.newPerDay, 0, 30, (v) => this.commit((x) => (x.scaleDrill.newPerDay = v))),
        ),
        form.field(
          'Theory reminders',
          form.checkbox(
            s.theoryReminders,
            (v) => this.commit((x) => (x.theoryReminders = v)),
            'After a chord or scale card, show a line about what it is',
          ),
        ),
        form.field(
          'Scale cards',
          form.segmented<'up' | 'updown'>(
            'scale-direction',
            [
              { value: 'up', label: 'Ascending' },
              { value: 'updown', label: 'Up and down' },
            ],
            s.scaleDrill.direction,
            (v) => this.commit((x) => (x.scaleDrill.direction = v)),
          ),
        ),
        h(
          'p.muted.field-note',
          null,
          'Each kind has its own daily limit for new cards, so adding a large deck never crowds out the rest. Due reviews are never limited.',
        ),
      ),
      form.section(
        'Appearance',
        form.field(
          'Theme',
          form.segmented<ThemePreference>(
            'theme',
            [
              { value: 'system', label: 'System', icon: 'monitor' },
              { value: 'light', label: 'Light', icon: 'sun' },
              { value: 'dark', label: 'Dark', icon: 'moon' },
            ],
            s.theme,
            (v) => this.commit((x) => (x.theme = v)),
          ),
        ),
        form.field(
          'Fingering',
          form.checkbox(
            s.showFingerNumbers,
            (v) => this.commit((x) => (x.showFingerNumbers = v)),
            'Show finger numbers on keys, staff and hand legend (F)',
          ),
        ),
      ),
      form.section(
        'Data',
        h(
          'div.button-row',
          null,
          h('button.button-outline', { type: 'button', onclick: () => void this.runExport() }, icon('download'), h('span', null, 'Export JSON')),
          this.importButton(),
        ),
        h('p.muted.field-note', null, 'Cards, review history and settings. Importing merges by record; newer changes win.'),
        this.message,
        h('p.muted.field-note', null, 'Version: build ', h('span.num', null, buildLabel())),
      ),
    );

    if (focusedId) document.getElementById(focusedId)?.focus();
  }

  private controlsSection(): HTMLElement {
    const map = this.settings.controls;
    const mainPort = this.ports[0] ?? null;
    const rows = ACTIONS.map((a) => {
      const binding = map[a.id];
      const learning = this.learning === a.id;
      const status = learning
        ? h('span.control-learning', { role: 'status' }, 'Press a control on your keyboard… ', h('kbd', null, 'Esc'), ' to cancel')
        : binding
          ? h('span.control-name', null, formatNoteName(describeBinding(binding, mainPort)))
          : h('span.control-name.muted', null, 'Not set');
      const mode =
        a.continuous && binding && !learning
          ? form.select(
              (Object.keys(CC_MODE_LABELS) as CcMode[]).map((m) => ({ value: m, label: CC_MODE_LABELS[m] })),
              binding.mode ?? 'absolute',
              (v) => this.commit((x) => (x.controls[a.id] = { ...binding, mode: v as CcMode })),
              `${a.label}: how the knob sends values`,
            )
          : null;
      return h(
        'div.control-row',
        { dataset: { learning: learning ? 'true' : 'false' } },
        h('span.control-action', null, a.label, a.hotkey ? h('kbd', null, a.hotkey) : null),
        status,
        h(
          'span.control-buttons',
          null,
          mode,
          h(
            'button.button-outline',
            {
              type: 'button',
              id: `learn-${a.id}`,
              onclick: () => (learning ? this.stopLearning(null) : this.startLearning(a.id)),
            },
            learning ? 'Cancel' : binding ? 'Re-learn' : 'Learn',
          ),
          binding && !learning
            ? h(
                'button.button-outline',
                { type: 'button', id: `clear-${a.id}`, onclick: () => this.commit((x) => delete x.controls[a.id]) },
                'Clear',
              )
            : null,
        ),
      );
    });
    return form.section(
      'Controls',
      h(
        'p.muted.field-note',
        null,
        'Map pads, buttons, transport keys and knobs on your controller to app actions. Piano keys can’t be mapped, and mapped controls never play a note. ',
        this.ports.length ? `Listening on: ${this.ports.join(', ')}.` : 'No controller connected.',
      ),
      this.controlsMessage
        ? h(
            this.controlsMessage.warn ? 'p.controls-message.is-warning' : 'p.controls-message',
            { role: 'status' },
            formatNoteName(this.controlsMessage.text),
          )
        : null,
      h('div.control-list', null, ...rows),
    );
  }

  private rangeField(clef: Clef, label: string): HTMLElement {
    const range = this.settings.noteDrill[clef];
    const choices = RANGE_CHOICES[clef].map((n) => ({ value: n, label: displaySpelling(n) }));
    const set = (end: 'low' | 'high') => (value: string) =>
      this.commit((x) => {
        const r = x.noteDrill[clef];
        r[end] = value;
        // Keep low ≤ high by moving the other end.
        if (spellingToMidi(r.low) > spellingToMidi(r.high)) r[end === 'low' ? 'high' : 'low'] = value;
      });
    return form.field(
      label,
      h(
        'div.range-row',
        null,
        form.select(choices, range.low, set('low'), `${label} lowest note`),
        h('span.muted', null, 'to'),
        form.select(choices, range.high, set('high'), `${label} highest note`),
      ),
    );
  }

  private importButton(): HTMLElement {
    const input = h('input.visually-hidden', { type: 'file', accept: 'application/json,.json', tabIndex: -1 });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      this.message.textContent = await this.actions.importData(file);
    });
    return h(
      'span',
      null,
      input,
      h('button.button-outline', { type: 'button', onclick: () => input.click() }, icon('upload'), h('span', null, 'Import JSON')),
    );
  }

  private async runExport(): Promise<void> {
    await this.actions.exportData();
    this.message.textContent = 'Export saved to your downloads.';
  }
}

/** The build timestamp in local time, e.g. "2026-10-24 23:41". */
function buildLabel(): string {
  const d = new Date(__APP_BUILD__);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
