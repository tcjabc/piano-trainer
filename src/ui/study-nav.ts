/** Study's two places: Today (the review queue) and Free practice. Quiet tabs, like the header's. */
import { h } from './dom';

export type StudyView = 'today' | 'free';

const VIEWS: { view: StudyView; label: string; hotkey: string }[] = [
  { view: 'today', label: 'Today', hotkey: 'T' },
  { view: 'free', label: 'Free practice', hotkey: 'E' },
];

export class StudyNav {
  readonly el: HTMLElement;
  private tabs = new Map<StudyView, HTMLButtonElement>();

  constructor(onSelect: (view: StudyView) => void) {
    for (const { view, label, hotkey } of VIEWS) {
      this.tabs.set(
        view,
        h('button.tab', { type: 'button', title: `${label} (${hotkey})`, onclick: () => onSelect(view) }, h('span', null, label), h('kbd', null, hotkey)),
      );
    }
    this.el = h('nav.tabs.study-tabs', { 'aria-label': 'Study' }, ...this.tabs.values());
  }

  set(view: StudyView): void {
    for (const [v, tab] of this.tabs) {
      if (v === view) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }
  }
}
