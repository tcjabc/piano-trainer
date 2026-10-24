/** Settings: MIDI input, controller mapping, Play, drill options, theme, export/import. */
import { ACTIONS, CC_MODE_LABELS, describeBinding, type ActionId, type CcMode } from '../core/controls';
import type { MidiDevice } from '../core/midi';
import { naturalsBetween, formatSpelling, spellingToMidi, displaySpelling, type Clef } from '../core/pitch';
import type { HandChoice, Settings, ThemePreference, VisualiserColors } from '../core/settings';
import { h, icon } from './dom';
import { formatNoteName } from './note-text';
import type { IconName } from './icon-list';

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

let fieldId = 0;

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

  setSettings(settings: Settings): void {
    this.settings = structuredClone(settings);
    this.render();
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
    fieldId = 0;

    this.body.replaceChildren(
      section(
        'MIDI input',
        field(
          'Device',
          select(
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
      section(
        'Play',
        field(
          'Key names',
          checkbox(s.showKeyNames, (v) => this.commit((x) => (x.showKeyNames = v)), 'Show note names on every on-screen key (N)'),
        ),
        field(
          'Visualiser',
          checkbox(
            s.visualiser.enabled,
            (v) => this.commit((x) => (x.visualiser.enabled = v)),
            'Glowing bars rise from the keys you play (V)',
          ),
        ),
        field(
          'Colours',
          segmented<VisualiserColors>(
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
        field(
          'Particles',
          checkbox(s.visualiser.sparks, (v) => this.commit((x) => (x.visualiser.sparks = v)), 'Embers rise from the keys you play'),
        ),
        field(
          'Staff overlay',
          checkbox(
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
      section(
        'Note drill',
        field(
          'Hand',
          segmented<HandChoice>(
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
        field(
          'Ledger lines',
          checkbox(d.ledgerLines, (v) => this.commit((x) => (x.noteDrill.ledgerLines = v)), 'Include notes on ledger lines'),
        ),
        field(
          'Accidentals',
          checkbox(d.accidentals, (v) => this.commit((x) => (x.noteDrill.accidentals = v)), 'Include sharps and flats'),
        ),
        field(
          'New cards per day',
          numberInput(d.newPerDay, 0, 100, (v) => this.commit((x) => (x.noteDrill.newPerDay = v))),
        ),
      ),
      section(
        'Appearance',
        field(
          'Theme',
          segmented<ThemePreference>(
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
        field(
          'Finger numbers',
          checkbox(
            s.showFingerNumbers,
            (v) => this.commit((x) => (x.showFingerNumbers = v)),
            'Show 1–5 on the fingertips of the hand legend',
          ),
        ),
      ),
      section(
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
          ? select(
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
    return section(
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
    return field(
      label,
      h(
        'div.range-row',
        null,
        select(choices, range.low, set('low'), `${label} lowest note`),
        h('span.muted', null, 'to'),
        select(choices, range.high, set('high'), `${label} highest note`),
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

// ── Small form builders ────────────────────────────────────────────────────

function section(title: string, ...children: (HTMLElement | null)[]): HTMLElement {
  return h('div.settings-section', null, h('h2.subheading', null, title), ...children);
}

function field(label: string, control: HTMLElement): HTMLElement {
  const target = control.matches('select, input') ? control : control.querySelector('select, input');
  const id = target?.id;
  return h(
    'div.field',
    null,
    control.matches('.segmented') ? h('span.field-label', { id: `${control.id}-label` }, label) : h('label.field-label', { htmlFor: id }, label),
    control,
  );
}

function nextId(): string {
  return `setting-${++fieldId}`;
}

function select(
  options: { value: string; label: string }[],
  value: string,
  onChange: (value: string) => void,
  ariaLabel?: string,
): HTMLSelectElement {
  const el = h(
    'select.control',
    { id: nextId(), 'aria-label': ariaLabel },
    ...options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)),
  );
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

function checkbox(checked: boolean, onChange: (v: boolean) => void, text: string): HTMLElement {
  const input = h('input.checkbox', { type: 'checkbox', id: nextId(), checked });
  input.addEventListener('change', () => onChange(input.checked));
  return h('span.checkbox-row', null, input, h('label.muted', { htmlFor: input.id }, text));
}

function numberInput(value: number, min: number, max: number, onChange: (v: number) => void): HTMLInputElement {
  const el = h('input.control.control-number.num', { type: 'number', id: nextId(), min, max, value: String(value) });
  el.addEventListener('change', () => {
    const v = Math.round(Number(el.value));
    onChange(Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : value);
  });
  return el;
}

function segmented<T extends string>(
  name: string,
  options: { value: T; label: string; icon?: IconName }[],
  value: T,
  onChange: (v: T) => void,
): HTMLElement {
  const id = nextId();
  return h(
    'div.segmented',
    { id, role: 'radiogroup', 'aria-labelledby': `${id}-label` },
    ...options.map((o) => {
      const input = h('input.visually-hidden', { type: 'radio', name, value: o.value, id: `${id}-${o.value}`, checked: o.value === value });
      input.addEventListener('change', () => input.checked && onChange(o.value));
      return h('label.segment', { htmlFor: input.id }, input, o.icon ? icon(o.icon) : null, h('span', null, o.label));
    }),
  );
}
