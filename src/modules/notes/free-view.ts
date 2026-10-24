/**
 * Free practice (Study): choose what to drill, then cards come at random with
 * no limit. Attempts are logged but never change the review schedule.
 *
 * The selection is organised by practice kind so it can grow into the
 * library: Notes works now; Chords and Scales are listed for later.
 */
import { formatSpelling, midiToName, naturalsBetween, spellingToMidi, type Clef } from '../../core/pitch';
import type { FreeNoteSettings, FreePracticeKind, FreePracticeSettings, HandChoice } from '../../core/settings';
import { h, icon } from '../../ui/dom';
import { FormBuilder, type Choice } from '../../ui/form';
import { formatNoteName } from '../../ui/note-text';
import { freeContents } from './free';

export interface FreePracticeActions {
  change: (settings: FreePracticeSettings) => void;
  start: () => void;
}

/** Practice kinds. Only notes are available; the others arrive with the Phase 2 library. */
const KINDS: Choice<FreePracticeKind | 'chords' | 'scales'>[] = [
  { value: 'notes', label: 'Notes' },
  { value: 'chords', label: 'Chords', disabled: true, title: 'Coming with the library' },
  { value: 'scales', label: 'Scales', disabled: true, title: 'Coming with the library' },
];

const HANDS: Choice<HandChoice>[] = [
  { value: 'left', label: 'Left · bass' },
  { value: 'right', label: 'Right · treble' },
  { value: 'both', label: 'Both · grand staff' },
];

const RANGE_CHOICES: Record<Clef, string[]> = {
  treble: naturalsBetween('C3', 'C7').map(formatSpelling),
  bass: naturalsBetween('C1', 'C5').map(formatSpelling),
};

export class FreePracticeView {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private settings: FreePracticeSettings;
  private form = new FormBuilder('free');

  constructor(initial: FreePracticeSettings, private actions: FreePracticeActions) {
    this.settings = structuredClone(initial);
    this.body = h('div.settings-body');
    this.el = h(
      'section.panel.settings-panel.free-panel',
      { 'aria-labelledby': 'free-title' },
      h('h1.heading', { id: 'free-title' }, 'Free practice'),
      this.body,
    );
    this.render();
  }

  setSettings(settings: FreePracticeSettings): void {
    this.settings = structuredClone(settings);
    this.render();
  }

  /** Cards in the current selection. */
  get size(): number {
    return freeContents(this.settings.notes).length;
  }

  /** Picking specific keys: played or clicked keys are added or removed. */
  get picking(): boolean {
    return this.settings.notes.selection === 'specific';
  }

  toggleKey(midi: number): void {
    if (!this.picking) return;
    this.commit((n) => {
      n.specific = n.specific.includes(midi) ? n.specific.filter((m) => m !== midi) : [...n.specific, midi].sort((a, b) => a - b);
    });
  }

  setHand(hand: HandChoice): void {
    this.commit((n) => (n.hand = hand));
  }

  private commit(mutate: (notes: FreeNoteSettings) => void): void {
    mutate(this.settings.notes);
    this.actions.change(structuredClone(this.settings));
    this.render();
  }

  private render(): void {
    const focusedId = (document.activeElement as HTMLElement | null)?.id;
    const f = this.form;
    const n = this.settings.notes;
    const count = this.size;
    f.reset();

    this.body.replaceChildren(
      h(
        'p.muted.field-note',
        null,
        'Choose what to practise. Cards come in random order with no limit; attempts are logged but never change your review schedule.',
      ),
      f.section(
        'Practise',
        f.field(
          'Kind',
          f.segmented('kind', KINDS, this.settings.kind, (v) => {
            if (v === 'notes') this.settings.kind = v;
          }),
        ),
      ),
      f.section(
        'Notes',
        f.field('Hand', f.segmented('hand', HANDS, n.hand, (v) => this.commit((x) => (x.hand = v)))),
        f.field(
          'Choose by',
          f.segmented<FreeNoteSettings['selection']>(
            'selection',
            [
              { value: 'range', label: 'Range' },
              { value: 'specific', label: 'Picking keys' },
            ],
            n.selection,
            (v) => this.commit((x) => (x.selection = v)),
          ),
        ),
        ...(n.selection === 'range' ? this.rangeFields(n) : this.pickFields(n)),
        f.field(
          'Accidentals',
          f.checkbox(
            n.accidentals,
            (v) => this.commit((x) => (x.accidentals = v)),
            n.selection === 'range' ? 'Include sharps and flats' : 'Black keys as both sharp and flat',
          ),
        ),
      ),
      h(
        'div.free-start',
        null,
        h('p.num.muted', null, `${count} ${count === 1 ? 'card' : 'cards'}`),
        h(
          'button.button-primary',
          { type: 'button', disabled: count === 0, onclick: () => this.actions.start() },
          h('span', null, 'Start free practice'),
          icon('chevron-right'),
        ),
        h('p.today-hint.muted', null, 'Press ', h('kbd', null, 'Space'), ' to start'),
      ),
    );

    if (focusedId) document.getElementById(focusedId)?.focus();
  }

  private rangeFields(n: FreeNoteSettings): HTMLElement[] {
    const clefs: Clef[] = n.hand === 'left' ? ['bass'] : n.hand === 'right' ? ['treble'] : ['treble', 'bass'];
    return [
      ...clefs.map((clef) => this.rangeField(clef)),
      this.form.field(
        'Ledger lines',
        this.form.checkbox(n.ledgerLines, (v) => this.commit((x) => (x.ledgerLines = v)), 'Include notes on ledger lines'),
      ),
    ];
  }

  private rangeField(clef: Clef): HTMLElement {
    const f = this.form;
    const range = this.settings.notes[clef];
    const label = clef === 'treble' ? 'Treble range' : 'Bass range';
    const choices = RANGE_CHOICES[clef].map((v) => ({ value: v, label: v }));
    const set = (end: 'low' | 'high') => (value: string) =>
      this.commit((x) => {
        const r = x[clef];
        r[end] = value;
        if (spellingToMidi(r.low) > spellingToMidi(r.high)) r[end === 'low' ? 'high' : 'low'] = value;
      });
    return f.field(
      label,
      h(
        'div.range-row',
        null,
        f.select(choices, range.low, set('low'), `${label} lowest note`),
        h('span.muted', null, 'to'),
        f.select(choices, range.high, set('high'), `${label} highest note`),
      ),
    );
  }

  private pickFields(n: FreeNoteSettings): HTMLElement[] {
    const chips = n.specific.map((midi) =>
      h(
        'button.note-chip',
        { type: 'button', title: 'Remove', onclick: () => this.toggleKey(midi) },
        formatNoteName(midiToName(midi)),
      ),
    );
    return [
      h(
        'div.free-picker',
        null,
        h('p.muted.field-note', null, 'Play keys on your keyboard (or click the on-screen keys) to add or remove them.'),
        h('div.note-chips', { 'aria-live': 'polite' }, ...(chips.length ? chips : [h('span.muted.field-note', null, 'No keys picked yet.')])),
        chips.length
          ? h('button.button-outline', { type: 'button', onclick: () => this.commit((x) => (x.specific = [])) }, 'Clear')
          : null,
      ),
    ];
  }
}
