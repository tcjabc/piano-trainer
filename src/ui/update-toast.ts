/** A quiet "Update available — Reload" toast for a new app version (hotkey U). */
import { h } from './dom';
import { isTyping } from './hotkeys';

export class UpdateToast {
  readonly el: HTMLElement;
  private apply: (() => void) | null = null;

  constructor() {
    this.el = h(
      'div.update-toast',
      { role: 'status', hidden: true },
      h('span', null, 'Update available'),
      h(
        'button.button-outline',
        { type: 'button', title: 'Reload to update (U)', onclick: () => this.accept() },
        h('span', null, 'Reload'),
        h('kbd', null, 'U'),
      ),
    );
    window.addEventListener('keydown', (e) => {
      if (!this.apply || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.toLowerCase() !== 'u' || isTyping(e.target)) return;
      e.preventDefault();
      this.accept();
    });
  }

  /** Show the toast; `apply` activates the new version and reloads. */
  show(apply: () => void): void {
    this.apply = apply;
    this.el.hidden = false;
  }

  private accept(): void {
    const apply = this.apply;
    if (!apply) return;
    this.apply = null;
    this.el.replaceChildren(h('span', null, 'Updating…'));
    apply();
  }
}
