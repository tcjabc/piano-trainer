/** The staff panel: a card holding the notation, with feedback and pause states. */
import { drawStaff, type NotationNote, type StaffKind } from '../core/notation';
import { h } from './dom';
import { setNoteText } from './note-text';

export type StaffState = 'idle' | 'correct' | 'wrong' | 'paused';

export class StaffView {
  readonly el: HTMLElement;
  private drawing: HTMLElement;
  private caption: HTMLElement;
  private corner: HTMLElement;

  constructor() {
    this.drawing = h('div.staff-drawing');
    this.caption = h('p.staff-caption', { 'aria-live': 'polite' });
    this.corner = h('span.staff-corner.num');
    this.el = h('section.panel.staff-panel', { 'aria-label': 'Staff' }, this.corner, this.drawing, this.caption);
  }

  show(staff: StaffKind, notes: NotationNote[]): void {
    drawStaff(this.drawing, staff, notes);
    this.setState('idle');
  }

  setState(state: StaffState, caption = ''): void {
    this.el.dataset.state = state;
    setNoteText(this.caption, caption);
  }

  /** Small text in the panel corner, e.g. cards left. */
  setCorner(text: string): void {
    this.corner.textContent = text;
  }
}
