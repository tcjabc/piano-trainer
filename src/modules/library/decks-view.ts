/**
 * Decks in the Library sidebar. A deck is a saved filter (e.g. "minor 7ths
 * in flat keys"): create one from the current filters, rename it, point it
 * at the current filters again, or delete it. Each deck can add all its
 * items to review or be practised freely, and shows its progress.
 */
import type { DeckRecord } from '../../core/storage';
import { h, icon } from '../../ui/dom';

export interface DeckProgress {
  total: number;
  inReview: number;
  due: number;
}

export interface DeckActions {
  apply: (deck: DeckRecord) => void;
  create: (name: string) => void;
  rename: (deck: DeckRecord, name: string) => void;
  useCurrentFilters: (deck: DeckRecord) => void;
  remove: (deck: DeckRecord) => void;
  addAll: (deck: DeckRecord) => void;
  practise: (deck: DeckRecord) => void;
  progress: (deck: DeckRecord) => DeckProgress;
}

export class DecksPanel {
  readonly el: HTMLElement;
  private decks: DeckRecord[] = [];
  /** Deck being edited, "new" while naming a new deck, or null. */
  private editing: string | null = null;

  constructor(private actions: DeckActions) {
    this.el = h('section.library-decks', { 'aria-label': 'Decks' });
    this.render();
  }

  setDecks(decks: DeckRecord[]): void {
    this.decks = decks;
    if (this.editing && this.editing !== 'new' && !decks.some((d) => d.id === this.editing)) this.editing = null;
    this.render();
  }

  /** Re-render (progress changes when cards are added or the hand changes). */
  refresh(): void {
    this.render();
  }

  private nameField(initial: string, save: (name: string) => void): HTMLElement {
    const input = h('input.control.deck-name-input', {
      type: 'text',
      value: initial,
      placeholder: 'Deck name',
      'aria-label': 'Deck name',
      maxLength: 80,
    });
    const commit = () => {
      const name = input.value.trim();
      if (name) save(name);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.editing = null;
        this.render();
      }
    });
    queueMicrotask(() => input.focus());
    return h(
      'div.deck-edit',
      null,
      input,
      h('button.button-outline', { type: 'button', onclick: commit }, 'Save'),
      h('button.button-outline', { type: 'button', onclick: () => ((this.editing = null), this.render()) }, 'Cancel'),
    );
  }

  private render(): void {
    const a = this.actions;
    this.el.replaceChildren(
      h('h2.subheading', null, 'Decks'),
      this.editing === 'new'
        ? this.nameField('', (name) => {
            this.editing = null;
            a.create(name);
          })
        : h(
            'button.button-outline.deck-new',
            { type: 'button', onclick: () => ((this.editing = 'new'), this.render()) },
            'Save filters as a deck',
          ),
      ...this.decks.map((deck) => {
        const p = a.progress(deck);
        const editing = this.editing === deck.id;
        return h(
          'div.deck',
          null,
          h('button.deck-title', { type: 'button', title: 'Show this deck', onclick: () => a.apply(deck) }, deck.name),
          h('p.deck-progress.num.muted', null, `${p.total} items · ${p.inReview} in review · ${p.due} due`),
          editing
            ? h(
                'div.deck-editing',
                null,
                this.nameField(deck.name, (name) => {
                  this.editing = null;
                  a.rename(deck, name);
                }),
                h(
                  'div.deck-actions',
                  null,
                  h('button.button-outline', { type: 'button', onclick: () => a.useCurrentFilters(deck) }, 'Use current filters'),
                  h('button.button-outline', { type: 'button', onclick: () => a.remove(deck) }, 'Delete'),
                ),
              )
            : h(
                'div.deck-actions',
                null,
                h('button.button-outline', { type: 'button', disabled: p.inReview === p.total, onclick: () => a.addAll(deck) }, 'Add all to review'),
                h('button.button-outline', { type: 'button', disabled: p.total === 0, onclick: () => a.practise(deck) }, icon('play'), h('span', null, 'Practise')),
                h('button.button-outline', { type: 'button', onclick: () => ((this.editing = deck.id), this.render()) }, 'Edit'),
              ),
        );
      }),
    );
  }
}
