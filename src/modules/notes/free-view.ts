/**
 * Free practice (Study): choose what to drill, then cards come at random with
 * no limit. Attempts are logged but never change the review schedule.
 *
 * The selection is organised by practice kind (notes, chords, scales); chords
 * and scales are chosen with the same filters as the Library.
 */
import { CHORD_QUALITIES, INVERSION_NAMES, type ChordQuality } from '../../core/chords';
import { SCALE_TYPES, type ScaleType } from '../../core/scales';
import type { LibraryFilter } from '../../core/filter';
import { formatSpelling, midiToName, naturalsBetween, spellingToMidi, type Clef } from '../../core/pitch';
import type { FreeNoteSettings, FreePracticeKind, FreePracticeSettings, HandChoice } from '../../core/settings';
import { chipGroup, toggled } from '../../ui/chips';
import { h, icon } from '../../ui/dom';
import { FormBuilder, type Choice } from '../../ui/form';
import { formatNoteName } from '../../ui/note-text';
import { ALL_ROOTS, filterItems, QUALITY_LABELS } from '../library/catalog';
import { freeContents } from './free';

/** Kinds free practice can drill. */
export const FREE_KINDS: ReadonlySet<FreePracticeKind> = new Set(['notes', 'chords', 'scales']);

export interface FreePracticeActions {
  change: (settings: FreePracticeSettings) => void;
  start: () => void;
}

const KIND_LABELS: Record<FreePracticeKind, string> = { notes: 'Notes', chords: 'Chords', scales: 'Scales' };

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
    const s = this.settings;
    if (s.kind === 'chords') return filterItems({ ...s.chords, kinds: ['chord'] }).length;
    if (s.kind === 'scales') return filterItems({ ...s.scales, kinds: ['scale'] }).length;
    return freeContents(s.notes).length;
  }

  /** Picking specific keys: played or clicked keys are added or removed. */
  get picking(): boolean {
    return this.settings.kind === 'notes' && this.settings.notes.selection === 'specific';
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
    this.save();
  }

  private save(): void {
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
          f.segmented<FreePracticeKind>(
            'kind',
            (Object.keys(KIND_LABELS) as FreePracticeKind[]).map((k) => ({
              value: k,
              label: KIND_LABELS[k],
              disabled: !FREE_KINDS.has(k),
              title: FREE_KINDS.has(k) ? undefined : 'Coming soon',
            })),
            this.settings.kind,
            (v) => {
              this.settings.kind = v;
              this.save();
            },
          ),
        ),
        f.field('Hand', f.segmented('hand', HANDS, n.hand, (v) => this.commit((x) => (x.hand = v)))),
      ),
      ...this.kindSections(),
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

  /** The selection for the chosen kind. */
  private kindSections(): HTMLElement[] {
    const f = this.form;
    const n = this.settings.notes;
    if (this.settings.kind === 'chords') return [this.chordSection()];
    if (this.settings.kind === 'scales') return [this.scaleSection()];
    return [
      f.section(
        'Notes',
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
    ];
  }

  private scaleSection(): HTMLElement {
    const sc = this.settings.scales;
    const update = (patch: Partial<LibraryFilter>) => {
      this.settings.scales = { ...sc, ...patch };
      this.save();
    };
    return this.form.section(
      'Scales',
      h('p.muted.field-note', null, 'Leave a group empty for all of it. Play each scale in order in the hand above, in any octave.'),
      chipGroup<ScaleType>('Type', SCALE_TYPES.map((s) => s.id), sc.scaleTypes, (t) => t, (t) => update({ scaleTypes: toggled(sc.scaleTypes, t) })),
      chipGroup<string>('Tonic', ALL_ROOTS, sc.roots, (r) => formatNoteName(r), (r) => update({ roots: toggled(sc.roots, r) })),
      chipGroup<number>('Octaves', [1, 2], [this.settings.octaves], (o) => `${o} octave${o === 2 ? 's' : ''}`, (o) => {
        this.settings.octaves = o as 1 | 2;
        this.save();
      }),
    );
  }

  private chordSection(): HTMLElement {
    const c = this.settings.chords;
    const update = (patch: Partial<LibraryFilter>) => {
      this.settings.chords = { ...c, ...patch };
      this.save();
    };
    return this.form.section(
      'Chords',
      h('p.muted.field-note', null, 'Leave a group empty for all of it. Each chord is played in the hand above; any voicing counts, with the inversion’s bass lowest.'),
      chipGroup<ChordQuality>('Quality', CHORD_QUALITIES.map((q) => q.id), c.qualities, (q) => QUALITY_LABELS[q], (q) => update({ qualities: toggled(c.qualities, q) })),
      chipGroup<string>('Root', ALL_ROOTS, c.roots, (r) => formatNoteName(r), (r) => update({ roots: toggled(c.roots, r) })),
      chipGroup<number>('Inversion', [0, 1, 2, 3, 4], c.inversions, (i) => (i === 0 ? 'Root' : INVERSION_NAMES[i]!.split(' ')[0]!), (i) =>
        update({ inversions: toggled(c.inversions, i) }),
      ),
    );
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
