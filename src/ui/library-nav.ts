/** The Library's two places: chords and scales, and songs. Quiet tabs, like Study's. */
import { h } from './dom';

export type LibraryTab = 'items' | 'songs';

const TABS: { tab: LibraryTab; label: string; hotkey: string }[] = [
  { tab: 'items', label: 'Chords & scales', hotkey: 'C' },
  { tab: 'songs', label: 'Songs', hotkey: 'G' },
];

export class LibraryNav {
  readonly el: HTMLElement;
  private tabs = new Map<LibraryTab, HTMLButtonElement>();

  constructor(onSelect: (tab: LibraryTab) => void) {
    for (const { tab, label, hotkey } of TABS) {
      this.tabs.set(
        tab,
        h('button.tab', { type: 'button', title: `${label} (${hotkey})`, onclick: () => onSelect(tab) }, h('span', null, label), h('kbd', null, hotkey)),
      );
    }
    this.el = h('nav.tabs.library-tabs', { 'aria-label': 'Library' }, ...this.tabs.values());
  }

  set(tab: LibraryTab): void {
    for (const [t, el] of this.tabs) {
      if (t === tab) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    }
  }
}
