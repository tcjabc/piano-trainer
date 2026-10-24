/** Keyboard zoom: zoom-out button, slider (fit full range … about two octaves), zoom-in button. */
import { Emitter } from '../core/emitter';
import { h, icon } from './dom';

/** Step for the buttons and the - / = hotkeys. */
export const ZOOM_STEP = 0.125;

type ZoomEvents = {
  /** Live while dragging. */
  input: number;
  /** A settled value, worth saving. */
  commit: number;
};

export class ZoomControl extends Emitter<ZoomEvents> {
  readonly el: HTMLElement;
  private slider: HTMLInputElement;

  constructor() {
    super();
    this.slider = h('input.zoom-slider', {
      type: 'range',
      min: '0',
      max: '1',
      step: '0.01',
      value: '0',
      'aria-label': 'Keyboard zoom',
      title: 'Keyboard zoom (- and =, 0 to fit)',
    });
    this.slider.addEventListener('input', () => this.emit('input', this.value));
    this.slider.addEventListener('change', () => {
      this.emit('commit', this.value);
      this.slider.blur(); // hand the arrow keys back to the drill hotkeys
    });
    this.el = h(
      'div.zoom-control',
      null,
      h('button.icon-button.zoom-button', { type: 'button', title: 'Zoom out (-)', 'aria-label': 'Zoom out', onclick: () => this.step(-1) }, icon('zoom-out')),
      this.slider,
      h('button.icon-button.zoom-button', { type: 'button', title: 'Zoom in (=)', 'aria-label': 'Zoom in', onclick: () => this.step(1) }, icon('zoom-in')),
    );
  }

  get value(): number {
    return Number(this.slider.value);
  }

  set(zoom: number): void {
    this.slider.value = String(zoom);
  }

  /** Zoom in (+1) or out (-1) by one step. */
  step(direction: 1 | -1): void {
    this.setAndCommit(Math.round((this.value + direction * ZOOM_STEP) / ZOOM_STEP) * ZOOM_STEP);
  }

  fit(): void {
    this.setAndCommit(0);
  }

  private setAndCommit(zoom: number): void {
    const next = Math.min(1, Math.max(0, zoom));
    if (next === this.value) return;
    this.set(next);
    this.emit('input', next);
    this.emit('commit', next);
  }
}
