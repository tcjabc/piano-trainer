/**
 * Computer-keyboard shortcuts and the hint bar that lists them. Each
 * shortcut can name the app action it performs, so a learned MIDI control
 * for that action runs the same thing and is shown next to the key.
 */
import type { ActionId } from '../core/controls';
import { h } from './dom';
import { formatNoteName } from './note-text';

export interface Hotkey {
  /** KeyboardEvent.key values that trigger it. */
  keys: string[];
  /** Keys shown in the hint bar; several separated by spaces, e.g. "1 2 3". */
  label: string;
  hint: string;
  run: () => void;
  /** Works but is not listed (it shares another entry's hint). */
  hidden?: boolean;
  /** Listed only when there is room (dropped first, last one first). */
  optional?: boolean;
  /** The app action this performs, for mapped MIDI controls. */
  action?: ActionId;
}

export const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  target.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]), select, textarea');

export class Hotkeys {
  readonly el: HTMLElement;
  private active: Hotkey[] = [];

  /** Short name of the MIDI control mapped to an action, if any. Set by the app. */
  controlLabel: (action: ActionId) => string | null = () => null;

  constructor() {
    this.el = h('footer.hint-bar', { 'aria-label': 'Keyboard shortcuts' });
    window.addEventListener('keydown', (e) => this.handle(e));
    new ResizeObserver(() => this.fit()).observe(this.el);
    void document.fonts.ready.then(() => this.fit());
  }

  /** Replace the active set of shortcuts (one set per screen). */
  set(hotkeys: Hotkey[]): void {
    this.active = hotkeys;
    this.render();
  }

  private hints: { el: HTMLElement; optional: boolean }[] = [];

  /** Redraw the hints (e.g. after a control is learned). */
  render(): void {
    this.hints = this.active
      .filter((k) => !k.hidden)
      .map((k) => {
        const control = k.action ? this.controlLabel(k.action) : null;
        const el = h(
          'span.hint',
          { title: `${k.label} — ${k.hint}` },
          ...k.label.split(' ').map((key) => h('kbd', null, key)),
          control ? h('span.hint-control', { title: `Mapped control: ${control}` }, formatNoteName(control)) : null,
          h('span.hint-text', null, k.hint),
        );
        return { el, optional: !!k.optional };
      });
    this.el.replaceChildren(...this.hints.map((x) => x.el));
    this.fit();
  }

  /**
   * Never clip: when the hints don't fit, drop the mapped controls, then the
   * optional hints (last first), then the descriptions (keys only), then
   * hints from the end until the rest fit.
   */
  private fit(): void {
    const el = this.el;
    el.classList.remove('is-compact', 'is-keys-only');
    for (const x of this.hints) x.el.classList.remove('is-dropped');
    const fits = () => el.scrollWidth <= el.clientWidth;
    if (el.clientWidth === 0 || fits()) return;
    el.classList.add('is-compact');
    if (fits()) return;
    const drop = (list: typeof this.hints) => {
      for (const x of [...list].reverse()) {
        x.el.classList.add('is-dropped');
        if (fits()) return true;
      }
      return false;
    };
    if (drop(this.hints.filter((x) => x.optional))) return;
    el.classList.add('is-keys-only');
    if (fits()) return;
    drop(this.hints.filter((x) => !x.optional).slice(1));
  }

  /** Run the current screen's shortcut for an action (from a mapped MIDI control). */
  trigger(action: ActionId): boolean {
    const hotkey = this.active.find((k) => k.action === action);
    hotkey?.run();
    return !!hotkey;
  }

  private handle(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    // Let form controls keep their keys, except Esc which always goes back.
    if (isTyping(e.target) && e.key !== 'Escape') return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const hotkey = this.active.find((k) => k.keys.includes(key));
    if (!hotkey) return;
    e.preventDefault();
    hotkey.run();
  }
}
