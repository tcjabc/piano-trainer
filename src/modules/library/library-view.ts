/**
 * Library area: a filter sidebar and search, the matching chords and scales,
 * and a detail panel (staff, keyboard highlight, name, formula). H hears the
 * item, A plays a chord as an arpeggio. Playing the item on the keyboard
 * shows a quiet tick; nothing is scored.
 */
import { CHORD_QUALITIES, INVERSION_NAMES, chordNotes, type ChordQuality } from '../../core/chords';
import { audio } from '../../core/audio';
import { drawStaff } from '../../core/notation';
import { SCALE_TYPES, scaleInfo, scaleNotes, type ScaleType } from '../../core/scales';
import type { HandChoice, LibrarySettings } from '../../core/settings';
import { h, icon } from '../../ui/dom';
import type { Keyboard } from '../../ui/keyboard';
import { formatDegrees, formatNoteName } from '../../ui/note-text';
import { checkChord, ScaleTracker } from '../drill/check';
import { ALL_ROOTS, EMPTY_FILTER, filterItems, itemById, type ItemKind, type LibraryFilter, type LibraryItem } from './catalog';
import { chordTarget, fingers, itemKeys, notation, scaleReference, voicings } from './voicing';

export interface LibraryActions {
  /** The filter, selection or octaves changed (to be remembered). */
  change: (settings: LibrarySettings) => void;
  setHand: (hand: HandChoice) => void;
}

const QUALITY_LABELS: Record<ChordQuality, string> = {
  M: 'major', m: 'minor', dim: 'dim', aug: 'aug', sus2: 'sus2', sus4: 'sus4', '6': '6', m6: 'm6',
  '7': '7', maj7: 'maj7', m7: 'm7', m7b5: 'half-dim', dim7: 'dim7', add9: 'add9', '9': '9',
};

const TICK_MS = 1600;

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
  private countEl: HTMLElement;
  private listEl: HTMLElement;
  private detailEl: HTMLElement;
  private tickEl: HTMLElement;
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
      placeholder: 'Search: F#m7, Bb maj7 1st inv, D dorian',
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
    this.countEl = h('p.library-count.num.muted');
    this.listEl = h('div.library-list', { role: 'listbox', 'aria-label': 'Chords and scales' });
    this.listEl.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      if (row) this.select(row.dataset.id!);
    });
    this.tickEl = h('p.play-along', { role: 'status', 'aria-live': 'polite' }, icon('check'), h('span', null, 'Played'));
    this.detailEl = h('section.panel.library-detail', { 'aria-label': 'Details' });
    this.el = h(
      'div.library',
      null,
      h('aside.library-filters', { 'aria-label': 'Filters' }, this.search, this.filtersEl),
      h('div.library-results', null, this.countEl, this.listEl),
      this.detailEl,
    );
    this.selected = (this.settings.selected && itemById(this.settings.selected)) || null;
    this.renderFilters();
    this.refresh();
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
      if (checkChord(held, chordTarget(item, this.hand)).complete) this.tick();
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
      this.tick();
      this.tracker = null;
    }
  }

  private newTracker(item: LibraryItem & { kind: 'scale' }): ScaleTracker {
    return new ScaleTracker(scaleReference(item, this.settings.octaves, 'up'), this.hand === 'both');
  }

  private tick(): void {
    window.clearTimeout(this.tickTimer);
    this.tickEl.classList.add('is-shown');
    this.tickTimer = window.setTimeout(() => this.tickEl.classList.remove('is-shown'), TICK_MS);
  }

  /** Re-render the detail panel (e.g. after its review status changed). */
  refreshDetail(): void {
    this.renderDetail();
    this.renderList();
  }

  // ── Rendering ────────────────────────────────────────────────────────

  private commit(): void {
    this.actions.change(structuredClone(this.settings));
    this.renderFilters();
    this.refresh();
  }

  private refresh(): void {
    this.results = filterItems(this.settings.filter, this.query);
    if (!this.selected || !this.results.includes(this.selected)) this.selected = this.results[0] ?? null;
    this.renderList();
    this.renderDetail();
  }

  private select(id: string): void {
    const item = this.results.find((i) => i.id === id) ?? itemById(id) ?? null;
    if (!item || item === this.selected) return;
    this.selected = item;
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
      this.detailEl.replaceChildren(h('p.muted', null, 'Nothing matches these filters.'));
      if (this.active) this.keyboard.setHighlights([]);
      return;
    }
    const notes = item.kind === 'chord' ? chordNotes(item.spec.root, item.spec.quality) : scaleNotes(item.tonic, item.type);
    const drawing = h('div.staff-drawing.library-drawing');
    const octaves = this.settings.octaves;
    this.detailEl.replaceChildren(
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
      drawing,
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
    );
    const count = item.kind === 'chord' ? 1 : notation(item, this.hand, octaves).length / (this.hand === 'both' ? 2 : 1);
    drawStaff(drawing, 'grand', notation(item, this.hand, octaves, this.fingersFor(item)), {
      staveWidth: Math.max(260, 70 + count * 38),
    });
    if (this.active) {
      this.keyboard.setHighlights(itemKeys(item, this.hand, octaves));
      this.showFingersOnKeys(item);
    }
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
    const toggle = <T>(list: T[], value: T): T[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
    const update = (patch: Partial<LibraryFilter>) => {
      this.settings.filter = { ...this.settings.filter, ...patch };
      this.commit();
    };
    const chips = <T extends string | number>(
      title: string,
      values: readonly T[],
      selected: T[],
      label: (v: T) => string | Node,
      onToggle: (v: T) => void,
    ) =>
      h(
        'div.filter-group',
        null,
        h('h2.subheading', null, title),
        h(
          'div.chips',
          null,
          ...values.map((v) =>
            h('button.chip', { type: 'button', 'aria-pressed': String(selected.includes(v)), onclick: () => onToggle(v) }, label(v)),
          ),
        ),
      );
    const showChords = f.kinds.length === 0 || f.kinds.includes('chord');
    const showScales = f.kinds.length === 0 || f.kinds.includes('scale');
    const hands: [HandChoice, string][] = [
      ['left', 'Left'],
      ['right', 'Right'],
      ['both', 'Both'],
    ];

    this.filtersEl.replaceChildren(
      ...present(
      chips<ItemKind>('Type', ['chord', 'scale'], f.kinds, (k) => (k === 'chord' ? 'Chords' : 'Scales'), (k) => update({ kinds: toggle(f.kinds, k) })),
      showChords
        ? chips<ChordQuality>('Chord quality', CHORD_QUALITIES.map((q) => q.id), f.qualities, (q) => QUALITY_LABELS[q], (q) =>
            update({ qualities: toggle(f.qualities, q) }),
          )
        : null,
      showChords
        ? chips<number>('Inversion', [0, 1, 2, 3, 4], f.inversions, (i) => (i === 0 ? 'Root' : INVERSION_NAMES[i]!.split(' ')[0]!), (i) =>
            update({ inversions: toggle(f.inversions, i) }),
          )
        : null,
      showScales
        ? chips<ScaleType>('Scale type', SCALE_TYPES.map((s) => s.id), f.scaleTypes, (s) => s, (s) => update({ scaleTypes: toggle(f.scaleTypes, s) }))
        : null,
      chips<string>('Root', ALL_ROOTS, f.roots, (r) => formatNoteName(r), (r) => update({ roots: toggle(f.roots, r) })),
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
        ? chips<number>('Scale octaves', [1, 2], [this.settings.octaves], (o) => `${o} octave${o === 2 ? 's' : ''}`, (o) => {
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
