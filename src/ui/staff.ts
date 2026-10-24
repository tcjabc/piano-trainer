/**
 * The drill panel: a card holding the prompt (a chord or scale name), the
 * notation, feedback and pause states.
 */
import { drawStaff, type NotationNote, type StaffKind } from '../core/notation';
import { h } from './dom';
import { setNoteText } from './note-text';

export type StaffState = 'idle' | 'correct' | 'wrong' | 'paused';

export class StaffView {
  readonly el: HTMLElement;
  private title: HTMLElement;
  private subtitle: HTMLElement;
  private drawing: HTMLElement;
  private caption: HTMLElement;
  private corner: HTMLElement;
  private reminder: HTMLElement;

  constructor() {
    this.title = h('p.staff-prompt');
    this.subtitle = h('p.staff-prompt-sub.muted');
    this.drawing = h('div.staff-drawing');
    this.caption = h('p.staff-caption', { 'aria-live': 'polite' });
    this.corner = h('span.staff-corner.num');
    this.reminder = h('p.staff-reminder', { 'aria-live': 'polite' });
    this.el = h(
      'section.panel.staff-panel',
      { 'aria-label': 'Drill' },
      this.corner,
      h('div.staff-prompt-block', null, this.title, this.subtitle),
      this.drawing,
      this.caption,
      this.reminder,
    );
  }

  /** A line about the card just answered; it stays while the next card is shown. */
  setReminder(text: string): void {
    setNoteText(this.reminder, text);
  }

  /** A note card: just the staff. */
  show(staff: StaffKind, notes: NotationNote[]): void {
    this.setPrompt(null);
    this.drawing.hidden = false;
    drawStaff(this.drawing, staff, notes);
    this.setState('idle');
  }

  /** A chord or scale card: its name, and optionally the staff. */
  showPrompt(title: string, subtitle: string, staff?: { kind: StaffKind; notes: NotationNote[]; staveWidth?: number }): void {
    this.setPrompt(title, subtitle);
    this.drawing.hidden = !staff;
    if (staff) drawStaff(this.drawing, staff.kind, staff.notes, { staveWidth: staff.staveWidth });
    else this.drawing.replaceChildren();
    this.setState('idle');
  }

  private setPrompt(title: string | null, subtitle = ''): void {
    this.el.classList.toggle('has-prompt', title !== null);
    setNoteText(this.title, title ?? '');
    setNoteText(this.subtitle, subtitle);
  }

  setState(state: StaffState, caption = ''): void {
    this.el.dataset.state = state;
    // A wrong answer shakes the panel (restarted each time; CSS turns it off for reduced motion).
    this.el.classList.remove('is-shaking');
    if (state === 'wrong') {
      void this.el.offsetWidth;
      this.el.classList.add('is-shaking');
    }
    setNoteText(this.caption, caption);
  }

  /** Small text in the panel corner, e.g. cards left. */
  setCorner(text: string): void {
    this.corner.textContent = text;
  }
}
