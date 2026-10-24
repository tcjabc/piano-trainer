/** Today (home): due count, time estimate and one Start button. */
import type { TodaySummary } from '../modules/notes/deck';
import { h, icon } from './dom';

export interface TodayActions {
  start: () => void;
  practiseAhead: () => void;
}

export class TodayView {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private summary: TodaySummary | null = null;

  constructor(private actions: TodayActions) {
    this.body = h('div.today-body');
    this.el = h('section.panel.today-panel', { 'aria-labelledby': 'today-title' }, h('h1.heading', { id: 'today-title' }, 'Today'), this.body);
    this.body.append(h('p.muted', null, 'Loading…'));
  }

  get hasDue(): boolean {
    return !!this.summary && this.summary.reviews.length + this.summary.newCards.length > 0;
  }

  update(summary: TodaySummary): void {
    this.summary = summary;
    const due = summary.reviews.length + summary.newCards.length;
    if (due > 0) {
      this.body.replaceChildren(
        h('p.today-count', null, h('span.num.display', null, String(due)), h('span.today-unit', null, due === 1 ? 'card due' : 'cards due')),
        h(
          'p.today-detail.muted',
          null,
          h('span.num', null, String(summary.reviews.length)),
          ' reviews · ',
          h('span.num', null, String(summary.newCards.length)),
          ' new · about ',
          h('span.num', null, String(Math.max(1, summary.estimateMinutes))),
          ' min',
        ),
        kindsLine(summary),
        h(
          'button.button-primary',
          { type: 'button', onclick: this.actions.start },
          h('span', null, 'Start'),
          icon('chevron-right'),
        ),
        h('p.today-hint.muted', null, 'Press ', h('kbd', null, 'Space'), ' to start'),
      );
    } else {
      this.body.replaceChildren(
        h('p.today-count', null, h('span.today-unit', null, 'All caught up')),
        h('p.today-detail.muted', null, nextDueText(summary.nextDue)),
        h(
          'button.button-outline',
          { type: 'button', onclick: this.actions.practiseAhead },
          icon('play'),
          h('span', null, 'Practise ahead'),
        ),
        h('p.today-hint.muted', null, 'Press ', h('kbd', null, 'Space'), ' to practise new or soonest-due cards'),
      );
    }
  }

  /** Space on Today: start, or practise ahead when nothing is due. */
  primaryAction(): void {
    if (!this.summary) return;
    if (this.hasDue) this.actions.start();
    else this.actions.practiseAhead();
  }
}

/** "Notes 6 · Chords 3 · Scales 1" when more than notes are due. */
function kindsLine(summary: TodaySummary): HTMLElement {
  const labels = { notes: 'Notes', chords: 'Chords', scales: 'Scales' } as const;
  const parts = (Object.keys(labels) as (keyof typeof labels)[])
    .map((k) => [labels[k], summary.counts[k].reviews + summary.counts[k].new] as const)
    .filter(([, n]) => n > 0);
  const onlyNotes = parts.length === 1 && parts[0]![0] === 'Notes';
  return h('p.today-kinds.muted', { hidden: parts.length === 0 || onlyNotes }, parts.map(([label, n]) => `${label} ${n}`).join(' · '));
}

function nextDueText(nextDue: number | null): string {
  if (nextDue === null) return 'No cards yet.';
  const minutes = Math.max(1, Math.round((nextDue - Date.now()) / 60_000));
  if (minutes < 60) return `Next review in ${minutes} min.`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `Next review in ${hours} h.`;
  return `Next review in ${Math.round(hours / 24)} days.`;
}
