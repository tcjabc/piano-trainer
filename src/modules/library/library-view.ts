/**
 * Library area: a filter sidebar and search, the matching chords and scales,
 * and a detail panel (staff, keyboard highlight, name, formula, and an
 * About section on the theory, with comparisons). H hears the item, A plays
 * a chord as an arpeggio. Playing the item on the keyboard shows a quiet
 * tick; nothing is scored.
 */
import { CHORD_QUALITIES, INVERSION_NAMES, chordNotes, pitchClass, type ChordQuality } from '../../core/chords';
import { audio } from '../../core/audio';
import { drawStaff, GRAND_STAFF_HEIGHT, STAVE_MARGIN, type NotationNote } from '../../core/notation';
import { SCALE_TYPES, scaleInfo, scaleNotes, type ScaleType } from '../../core/scales';
import type { HandChoice, LibrarySettings } from '../../core/settings';
import { h, icon } from '../../ui/dom';
import type { Keyboard } from '../../ui/keyboard';
import { chipGroup, toggled } from '../../ui/chips';
import { formatDegrees, formatNoteName } from '../../ui/note-text';
import { checkChord, ScaleTracker } from '../drill/check';
import { ALL_ROOTS, EMPTY_FILTER, filterItems, itemById, QUALITY_LABELS, type ItemKind, type LibraryFilter, type LibraryItem } from './catalog';
import { notesNotIn, theoryFor } from './theory';
import { chordTarget, fingers, itemKeys, notation, scaleReference, voicings } from './voicing';

export interface LibraryActions {
  /** The filter, selection or octaves changed (to be remembered). */
  change: (settings: LibrarySettings) => void;
  setHand: (hand: HandChoice) => void;
  /** The selected item was played (the tick): for the stats, with how many notes it took. */
  played?: (item: LibraryItem, notes: number) => void;
}

const TICK_MS = 1600;
const SEARCH_EXAMPLES = 'F#m7, Bb maj7 1st inv, C/E, D dorian, half diminished';
/** Narrowest stave for a chord; scales get room for every note. */
const MIN_STAVE_WIDTH = 200;
const MAX_STAVE_WIDTH = 900;
const STAVE_WIDTH_PER_NOTE = 38;
/** Compare: the gap between the two items when heard (ms). */
const COMPARE_GAP_MS = 500;
const CHORD_COMPARE_MS = 1300;
const SCALE_STEP_MS = 180;

export class LibraryView {
  readonly el: HTMLElement;
  /** Extra content for the detail panel (review status and actions), set by the app. */
  detailExtras: (item: LibraryItem) => (HTMLElement | null)[] = () => [];
  /** A short status for a result row (e.g. "in review"), set by the app. */
  rowBadge: (item: LibraryItem) => string | null = () => null;

  private settings: LibrarySettings;
  private hand: HandChoice;
  private query = '';
  private results: LibraryItem[] = [];
  private selected: LibraryItem | null = null;
  private active = false;
  private search: HTMLInputElement;
  private filtersEl: HTMLElement;
  /** Below the filters: the decks. */
  private extrasEl: HTMLElement;
  private countEl: HTMLElement;
  private listEl: HTMLElement;
  private detailEl: HTMLElement;
  private tickEl: HTMLElement;
  /** The detail panel's staff; redrawn when its box changes shape. */
  private drawing: HTMLElement | null = null;
  private staveWidth = 0;
  /** Comparing the selected item with another (same root): what it is and its label. */
  private comparing: { other: LibraryItem; label: string } | null = null;
  private tickTimer = 0;
  private tracker: ScaleTracker | null = null;
  private showFingering = true;

  constructor(
    initial: LibrarySettings,
    hand: HandChoice,
    private actions: LibraryActions,
    private keyboard: Keyboard,
  ) {
    this.settings = structuredClone(initial);
    this.hand = hand;
    this.search = h('input.control.library-search', {
      type: 'search',
      placeholder: 'Search, e.g. F#m7',
      title: `Search by name, e.g. ${SEARCH_EXAMPLES}`,
      'aria-label': 'Search the library (/)',
      autocomplete: 'off',
      spellcheck: false,
    });
    this.search.addEventListener('input', () => {
      this.query = this.search.value;
      this.refresh();
    });
    this.search.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.move(e.key === 'ArrowDown' ? 1 : -1);
      } else if (e.key === 'Enter') {
        this.search.blur();
      }
    });
    this.filtersEl = h('div.library-filter-groups');
    this.extrasEl = h('div.library-sidebar-extras');
    this.countEl = h('p.library-count.num.muted');
    this.listEl = h('div.library-list', { role: 'listbox', 'aria-label': 'Chords and scales' });
    this.listEl.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      if (row) this.select(row.dataset.id!);
    });
    this.tickEl = h('p.play-along', { role: 'status', 'aria-live': 'polite' }, icon('check'), h('span', null, 'Played'));
    this.detailEl = h('section.panel.library-detail', { 'aria-label': 'Details' });
    new ResizeObserver(() => {
      if (this.drawing && Math.abs(this.fittedStaveWidth() - this.staveWidth) > 4) this.drawStaff();
    }).observe(this.detailEl);
    this.el = h(
      'div.library',
      null,
      h('aside.library-filters', { 'aria-label': 'Filters' }, this.search, this.filtersEl, this.extrasEl),
      h('div.library-results', null, this.countEl, this.listEl),
      this.detailEl,
    );
    this.selected = (this.settings.selected && itemById(this.settings.selected)) || null;
    this.renderFilters();
    this.refresh();
  }

  /** Put a panel (the decks) under the filters. */
  setSidebarExtras(el: HTMLElement): void {
    this.extrasEl.replaceChildren(el);
  }

  get current(): LibraryItem | null {
    return this.selected;
  }

  get octaves(): 1 | 2 {
    return this.settings.octaves;
  }

  get filter(): LibraryFilter {
    return this.settings.filter;
  }

  /** Items currently listed (filters and search). */
  get listed(): LibraryItem[] {
    return this.results;
  }

  setSettings(settings: LibrarySettings): void {
    if (JSON.stringify(settings) === JSON.stringify(this.settings)) return;
    this.settings = structuredClone(settings);
    this.renderFilters();
    this.refresh();
  }

  /** Apply a saved filter (a deck), clearing the search. */
  applyFilter(filter: LibraryFilter, octaves?: 1 | 2): void {
    this.settings.filter = structuredClone(filter);
    if (octaves) this.settings.octaves = octaves;
    this.query = '';
    this.search.value = '';
    this.commit();
  }

  setHand(hand: HandChoice): void {
    this.hand = hand;
    this.comparing = null;
    this.renderFilters();
    this.renderDetail();
  }

  /** Shown: mark the selected item's keys. */
  activate(): void {
    this.active = true;
    this.renderDetail();
  }

  deactivate(): void {
    this.active = false;
    this.keyboard.setHighlights([]);
    this.keyboard.clearFingers();
  }

  /** Fingering on or off (F): on the keys and on the staff. */
  setFingering(visible: boolean): void {
    if (visible === this.showFingering) return;
    this.showFingering = visible;
    this.renderDetail();
  }

  focusSearch(): void {
    this.search.focus();
    this.search.select();
  }

  /** Esc: clear the search first. Returns false if there was nothing to clear. */
  clearSearch(): boolean {
    if (!this.query) return false;
    this.query = '';
    this.search.value = '';
    this.refresh();
    return true;
  }

  move(delta: number): void {
    if (this.results.length === 0) return;
    const at = this.selected ? this.results.indexOf(this.selected) : -1;
    const next = this.results[Math.min(this.results.length - 1, Math.max(0, at + delta))]!;
    this.select(next.id);
    this.listEl.querySelector(`[data-id="${CSS.escape(next.id)}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  /** H: a chord as a block, a scale up and down. A (arpeggio): a chord one note at a time. */
  hear(arpeggio = false): void {
    const item = this.selected;
    if (!item) return;
    if (item.kind === 'chord') {
      const notes = itemKeys(item, this.hand, 1).sort((a, b) => a - b);
      audio.playNotes(notes, arpeggio ? { stepMs: 160, seconds: 1.6 } : { seconds: 1.6 });
    } else {
      const up = scaleReference(item, this.settings.octaves, 'updown');
      const shift = this.hand === 'left' ? -12 : 0;
      const both = this.hand === 'both';
      audio.playNotes(up.map((n) => n + shift), { stepMs: 200, seconds: 0.45 });
      if (both) audio.playNotes(up.map((n) => n - 12), { stepMs: 200, seconds: 0.45 });
    }
  }

  /** A key was pressed: tick when the item has been played. */
  notePressed(note: number, held: Set<number>): void {
    const item = this.selected;
    if (!item || !this.active) return;
    if (item.kind === 'chord') {
      if (checkChord(held, chordTarget(item, this.hand)).complete) this.tick(item, 1);
      return;
    }
    this.tracker ??= this.newTracker(item);
    let step = this.tracker.press(note);
    if (step === 'wrong') {
      // Start again; the wrong note may be the start of a new attempt.
      this.tracker = this.newTracker(item);
      step = this.tracker.press(note);
      if (step === 'wrong') this.tracker = null;
    }
    if (step === 'done') {
      this.tick(item, this.tracker!.length);
      this.tracker = null;
    }
  }

  private newTracker(item: LibraryItem & { kind: 'scale' }): ScaleTracker {
    return new ScaleTracker(scaleReference(item, this.settings.octaves, 'up'), this.hand === 'both');
  }

  private tick(item: LibraryItem, notes: number): void {
    this.actions.played?.(item, notes);
    window.clearTimeout(this.tickTimer);
    this.tickEl.classList.add('is-shown');
    this.tickTimer = window.setTimeout(() => this.tickEl.classList.remove('is-shown'), TICK_MS);
  }

  /** Re-render the detail panel (e.g. after its review status changed). */
  refreshDetail(): void {
    this.renderDetail();
    this.renderList();
  }

  clearFilters(): void {
    this.settings.filter = { ...EMPTY_FILTER };
    this.commit();
  }

  // ── Rendering ────────────────────────────────────────────────────────

  private commit(): void {
    this.actions.change(structuredClone(this.settings));
    this.renderFilters();
    this.refresh();
  }

  private refresh(): void {
    this.results = filterItems(this.settings.filter, this.query);
    if (!this.selected || !this.results.includes(this.selected)) {
      this.selected = this.results[0] ?? null;
      this.comparing = null;
    }
    this.renderList();
    this.renderDetail();
  }

  private select(id: string): void {
    const item = this.results.find((i) => i.id === id) ?? itemById(id) ?? null;
    if (!item || item === this.selected) return;
    this.selected = item;
    this.comparing = null;
    this.settings.selected = item.id;
    this.tracker = null;
    this.actions.change(structuredClone(this.settings));
    for (const row of this.listEl.querySelectorAll('[aria-selected="true"]')) row.setAttribute('aria-selected', 'false');
    this.listEl.querySelector(`[data-id="${CSS.escape(id)}"]`)?.setAttribute('aria-selected', 'true');
    this.renderDetail();
  }

  private renderList(): void {
    const n = this.results.length;
    this.countEl.textContent = `${n} ${n === 1 ? 'item' : 'items'}`;
    if (n === 0 && JSON.stringify(this.settings.filter) !== JSON.stringify(EMPTY_FILTER)) {
      // Search works within the filters; say so when they hide everything.
      this.listEl.replaceChildren(
        h(
          'p.muted.library-empty',
          null,
          'Nothing matches with the current filters. ',
          h('button.link-button', { type: 'button', onclick: () => this.clearFilters() }, 'Clear filters'),
        ),
      );
      return;
    }
    if (n === 0) {
      this.listEl.replaceChildren(h('p.muted.library-empty', null, formatNoteName(`Nothing found. Try ${SEARCH_EXAMPLES}.`)));
      return;
    }
    this.listEl.replaceChildren(
      ...this.results.map((item) => {
        const badge = this.rowBadge(item);
        return h(
          'div.library-row',
          { role: 'option', 'aria-selected': String(item === this.selected), dataset: { id: item.id } },
          h('span.library-row-title', null, formatNoteName(item.kind === 'chord' ? item.symbol : item.name)),
          h('span.library-row-sub.muted', null, formatNoteName(item.kind === 'chord' ? item.name : scaleInfo(item.type).group)),
          badge ? h('span.library-row-badge', null, badge) : null,
        );
      }),
    );
  }

  private renderDetail(): void {
    const item = this.selected;
    if (!item) {
      this.drawing = null;
      this.detailEl.replaceChildren(h('p.muted', null, 'Nothing matches these filters.'));
      if (this.active) this.keyboard.setHighlights([]);
      return;
    }
    const notes = item.kind === 'chord' ? chordNotes(item.spec.root, item.spec.quality) : scaleNotes(item.tonic, item.type);
    const octaves = this.settings.octaves;
    this.drawing = h('div.staff-drawing.library-drawing');
    // Three rows: facts, the staff (takes the height that is left), actions.
    this.detailEl.replaceChildren(
      h(
        'div.library-info',
        null,
        ...present(
          h('p.subheading', null, item.kind === 'chord' ? 'Chord' : `Scale · ${scaleInfo(item.type).group}`),
          h('h1.heading.library-title', null, formatNoteName(item.kind === 'chord' ? item.symbol : item.name)),
          item.kind === 'chord' ? h('p.library-name', null, formatNoteName(item.name)) : null,
          h(
            'dl.library-facts',
            null,
            h('dt', null, 'Formula'),
            h('dd', null, formatDegrees(item.formula)),
            h('dt', null, 'Notes'),
            h('dd', null, formatNoteName(notes.join('  '))),
          ),
          this.aboutSection(item),
          this.compareNote(item),
        ),
      ),
      this.drawing,
      h(
        'div.library-actions',
        null,
        ...present(
          h(
            'div.button-row',
            null,
            h('button.button-outline', { type: 'button', onclick: () => this.hear(false) }, icon('volume-2'), h('span', null, item.kind === 'chord' ? 'Hear' : 'Hear up and down'), h('kbd', null, 'H')),
            item.kind === 'chord'
              ? h('button.button-outline', { type: 'button', onclick: () => this.hear(true) }, h('span', null, 'Arpeggio'), h('kbd', null, 'A'))
              : null,
          ),
          ...this.detailExtras(item),
          this.tickEl,
        ),
      ),
    );
    this.drawStaff();
    if (this.active) {
      this.keyboard.setHighlights(itemKeys(item, this.hand, octaves));
      this.keyboard.setMarked(this.comparing ? this.differingKeys(item, this.comparing.other) : []);
      this.showFingersOnKeys(item);
    }
  }

  /** What it is, why it's called that, how it sounds, where it's heard; and comparisons. */
  private aboutSection(item: LibraryItem): HTMLElement {
    const t = theoryFor(item);
    const about = h(
      'details.library-about',
      { open: this.settings.aboutOpen },
      h('summary.library-about-title', null, 'About'),
      h('p', null, formatNoteName(t.built)),
      h('p', null, formatNoteName(t.name)),
      h('p', null, formatNoteName(t.sound)),
      t.heardIn.length
        ? h('p.library-heard', null, 'Heard in ', t.heardIn.map((x) => `“${x.title}” (${x.artist})`).join(', '))
        : null,
      t.compare.length
        ? h(
            'div.library-compare-buttons',
            null,
            ...t.compare.map((c) =>
              h(
                'button.button-outline.chip-button',
                {
                  type: 'button',
                  title: `Hear ${item.name}, then ${c.item.name}, and mark the notes that differ`,
                  'aria-pressed': String(this.comparing?.other.id === c.item.id),
                  onclick: () => this.compare(c.item, c.label),
                },
                formatNoteName(c.label),
              ),
            ),
          )
        : null,
    );
    about.addEventListener('toggle', () => {
      if (about.open === this.settings.aboutOpen) return;
      this.settings.aboutOpen = about.open;
      this.actions.change(structuredClone(this.settings));
    });
    return about;
  }

  /** While comparing: which notes differ, and a way back. */
  private compareNote(item: LibraryItem): HTMLElement | null {
    const c = this.comparing;
    if (!c) return null;
    const onlyA = notesNotIn(item, c.other);
    const onlyB = notesNotIn(c.other, item);
    const list = (name: string, notes: string[]) => `${name}: ${notes.length ? notes.join(' ') : 'nothing extra'}`;
    return h(
      'p.library-compare',
      { role: 'status' },
      h('span.library-compare-swatch', { 'aria-hidden': 'true' }),
      h('span', null, formatNoteName(`Only in ${list(item.name, onlyA)} · only in ${list(c.other.name, onlyB)}`)),
      h('button.link-button', { type: 'button', onclick: () => this.endCompare() }, 'Done'),
    );
  }

  /** Hear the item, then the other one, with the notes that differ marked on the staff and keys. */
  compare(other: LibraryItem, label: string): void {
    const item = this.selected;
    if (!item) return;
    this.comparing = { other, label };
    this.renderDetail();
    // On a short screen the About text can push the staff out of view.
    this.drawing?.scrollIntoView({ block: 'nearest' });
    const first = this.heardNotes(item);
    const firstMs = item.kind === 'chord' ? CHORD_COMPARE_MS : first.length * SCALE_STEP_MS;
    const play = (notes: number[], delayMs: number) =>
      item.kind === 'chord'
        ? audio.playNotes(notes, { seconds: 1.2, delayMs })
        : audio.playNotes(notes, { stepMs: SCALE_STEP_MS, seconds: 0.4, delayMs });
    play(first, 0);
    play(this.heardNotes(other), firstMs + COMPARE_GAP_MS);
  }

  private endCompare(): void {
    this.comparing = null;
    this.renderDetail();
  }

  /** What compare plays: a chord as a block, a scale ascending (in the left hand's octave for the left hand). */
  private heardNotes(item: LibraryItem): number[] {
    if (item.kind === 'chord') return itemKeys(item, this.hand, 1).sort((a, b) => a - b);
    const shift = this.hand === 'left' ? -12 : 0;
    return scaleReference(item, this.settings.octaves, 'up').map((n) => n + shift);
  }

  /** Keys of either item whose pitch class the other lacks. */
  private differingKeys(a: LibraryItem, b: LibraryItem): number[] {
    const octaves = this.settings.octaves;
    const pcsA = new Set(itemKeys(a, this.hand, octaves).map(pitchClass));
    const pcsB = new Set(itemKeys(b, this.hand, octaves).map(pitchClass));
    return [
      ...itemKeys(a, this.hand, octaves).filter((k) => !pcsB.has(pitchClass(k))),
      ...itemKeys(b, this.hand, octaves).filter((k) => !pcsA.has(pitchClass(k))),
    ];
  }

  /**
   * The staff: the item (with fingering, when shown), or while comparing,
   * the item then the other after a barline, with the notes that differ marked.
   */
  private staffNotes(): NotationNote[] {
    const item = this.selected!;
    const octaves = this.settings.octaves;
    const c = this.comparing;
    if (!c) return notation(item, this.hand, octaves, this.fingersFor(item));
    const mark = (notes: NotationNote[], differs: Set<number>, bar: boolean): NotationNote[] => {
      const seen = new Set<string>();
      return notes.map((n) => {
        const first = !seen.has(n.clef);
        seen.add(n.clef);
        return { ...n, marked: n.spellings.map((s) => differs.has(pitchClass(s))), barBefore: bar && first };
      });
    };
    const pcs = (i: LibraryItem) => new Set(itemKeys(i, this.hand, octaves).map(pitchClass));
    const a = pcs(item);
    const b = pcs(c.other);
    const onlyA = new Set([...a].filter((pc) => !b.has(pc)));
    const onlyB = new Set([...b].filter((pc) => !a.has(pc)));
    return [...mark(notation(item, this.hand, octaves), onlyA, false), ...mark(notation(c.other, this.hand, octaves), onlyB, true)];
  }

  /** Draw the selected item's staff, shaped to fill the box it has. */
  private drawStaff(): void {
    const item = this.selected;
    if (!item || !this.drawing) return;
    this.staveWidth = this.fittedStaveWidth();
    drawStaff(this.drawing, 'grand', this.staffNotes(), { staveWidth: this.staveWidth });
  }

  /**
   * As wide as the box's proportions allow (so the staff fills its height),
   * but never narrower than the notes need; the drawing then scales down.
   */
  private fittedStaveWidth(): number {
    const item = this.selected;
    if (!item || !this.drawing) return 0;
    const notes = this.staffNotes();
    const count = Math.max(...(['treble', 'bass'] as const).map((clef) => notes.filter((n) => n.clef === clef).length));
    const needed = Math.max(MIN_STAVE_WIDTH, 70 + count * STAVE_WIDTH_PER_NOTE);
    const { clientWidth: w, clientHeight: hgt } = this.drawing;
    const fitted = w > 0 && hgt > 0 ? (w / hgt) * GRAND_STAFF_HEIGHT - STAVE_MARGIN : needed;
    return Math.round(Math.min(MAX_STAVE_WIDTH, Math.max(needed, fitted)));
  }

  /** Finger numbers for the staff, when fingering is shown. */
  private fingersFor(item: LibraryItem): Parameters<typeof notation>[3] {
    return this.showFingering ? fingers(item, this.hand, this.settings.octaves) : {};
  }

  /** Finger numbers on the keys (left hand first, so the right hand wins where they share a key). */
  private showFingersOnKeys(item: LibraryItem): void {
    this.keyboard.clearFingers();
    if (!this.showFingering) return;
    const v = voicings(item, this.hand, this.settings.octaves);
    const f = fingers(item, this.hand, this.settings.octaves);
    for (const side of ['L', 'R'] as const) {
      const list = f[side];
      if (!list) continue;
      v[side]?.forEach((note, i) => {
        const finger = list[i];
        if (finger) this.keyboard.setFinger(note.midi, { finger: finger as 1 | 2 | 3 | 4 | 5, hand: side });
      });
    }
  }

  private renderFilters(): void {
    const f = this.settings.filter;
    const update = (patch: Partial<LibraryFilter>) => {
      this.settings.filter = { ...this.settings.filter, ...patch };
      this.commit();
    };
    const showChords = f.kinds.length === 0 || f.kinds.includes('chord');
    const showScales = f.kinds.length === 0 || f.kinds.includes('scale');
    const hands: [HandChoice, string][] = [
      ['left', 'Left'],
      ['right', 'Right'],
      ['both', 'Both'],
    ];

    this.filtersEl.replaceChildren(
      ...present(
      chipGroup<ItemKind>('Type', ['chord', 'scale'], f.kinds, (k) => (k === 'chord' ? 'Chords' : 'Scales'), (k) => update({ kinds: toggled(f.kinds, k) })),
      showChords
        ? chipGroup<ChordQuality>('Chord quality', CHORD_QUALITIES.map((q) => q.id), f.qualities, (q) => QUALITY_LABELS[q], (q) =>
            update({ qualities: toggled(f.qualities, q) }),
          )
        : null,
      showChords
        ? chipGroup<number>('Inversion', [0, 1, 2, 3, 4], f.inversions, (i) => (i === 0 ? 'Root' : INVERSION_NAMES[i]!.split(' ')[0]!), (i) =>
            update({ inversions: toggled(f.inversions, i) }),
          )
        : null,
      showScales
        ? chipGroup<ScaleType>('Scale type', SCALE_TYPES.map((s) => s.id), f.scaleTypes, (s) => s, (s) => update({ scaleTypes: toggled(f.scaleTypes, s) }))
        : null,
      chipGroup<string>('Root', ALL_ROOTS, f.roots, (r) => formatNoteName(r), (r) => update({ roots: toggled(f.roots, r) })),
      h(
        'div.filter-group',
        null,
        h('h2.subheading', null, 'Hand'),
        h(
          'div.chips',
          null,
          ...hands.map(([value, label]) =>
            h('button.chip', { type: 'button', 'aria-pressed': String(this.hand === value), onclick: () => this.actions.setHand(value) }, label),
          ),
        ),
      ),
      showScales
        ? chipGroup<number>('Scale octaves', [1, 2], [this.settings.octaves], (o) => `${o} octave${o === 2 ? 's' : ''}`, (o) => {
            this.settings.octaves = o as 1 | 2;
            this.commit();
          })
        : null,
      h(
        'button.button-outline.filter-clear',
        { type: 'button', disabled: JSON.stringify(f) === JSON.stringify(EMPTY_FILTER), onclick: () => update({ ...EMPTY_FILTER }) },
        'Clear filters',
      ),
      ),
    );
  }
}

/** Leave out the parts that don't apply. */
function present(...nodes: (Node | null)[]): Node[] {
  return nodes.filter((n): n is Node => n !== null);
}
