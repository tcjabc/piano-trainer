/**
 * Hand legend: left and right hands side by side, thumbs facing inward, with
 * fingertips in the finger colours. Each hand toggles whether it is
 * practised (at least one stays selected).
 *
 * The icon is src/assets/hand-right.svg, used unchanged; the left hand is the
 * same SVG mirrored in CSS (scale(-1, 1)).
 */
import handRightSvg from '../assets/hand-right.svg?raw';
import { FINGER_NAMES, FINGERS } from '../core/fingering';
import { Emitter } from '../core/emitter';
import type { HandChoice } from '../core/settings';
import { h } from './dom';

type Side = 'left' | 'right';
type HandLegendEvents = { change: HandChoice };

const SVG_NS = 'http://www.w3.org/2000/svg';

export class HandLegend extends Emitter<HandLegendEvents> {
  readonly el: HTMLElement;
  private buttons: Record<Side, HTMLButtonElement>;
  private choice: HandChoice = 'right';

  constructor() {
    super();
    this.buttons = { left: this.makeHand('left', 1), right: this.makeHand('right', 2) };
    this.el = h(
      'div.hand-legend',
      { role: 'group', 'aria-label': 'Hands to practise' },
      this.buttons.left,
      this.buttons.right,
    );
  }

  set(choice: HandChoice): void {
    this.choice = choice;
    for (const side of ['left', 'right'] as const) {
      const on = choice === side || choice === 'both';
      this.buttons[side].setAttribute('aria-pressed', String(on));
    }
  }

  setNumbersVisible(visible: boolean): void {
    this.el.classList.toggle('show-numbers', visible);
  }

  /** Clicking a hand adds or removes it; the last selected hand cannot be removed. */
  private toggle(side: Side): void {
    const other: Side = side === 'left' ? 'right' : 'left';
    const next: HandChoice =
      this.choice === 'both' ? other : this.choice === side ? side : 'both';
    if (next === this.choice) return;
    this.set(next);
    this.emit('change', next);
  }

  private makeHand(side: Side, hotkey: number): HTMLButtonElement {
    const label = side === 'left' ? 'Left hand' : 'Right hand';
    const button = h('button.hand', {
      type: 'button',
      'aria-pressed': 'false',
      'aria-label': label,
      title: `${label} (${hotkey})`,
      onclick: () => this.toggle(side),
    });
    button.classList.add(`hand-${side}`);
    button.innerHTML = handRightSvg;
    const svg = button.querySelector('svg')!;
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'hand-svg');
    addFingerNumbers(svg);
    return button;
  }
}

/** Put the finger number on each fingertip dot (shown only when enabled). */
function addFingerNumbers(svg: SVGSVGElement): void {
  for (const finger of FINGERS) {
    const dot = svg.querySelector<SVGCircleElement>(`circle.finger-${finger}`);
    if (!dot) continue;
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('class', 'finger-number');
    text.setAttribute('x', dot.getAttribute('cx')!);
    text.setAttribute('y', dot.getAttribute('cy')!);
    text.textContent = String(finger);
    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = `Finger ${finger} (${FINGER_NAMES[finger]})`;
    dot.append(title);
    svg.append(text);
  }
}
