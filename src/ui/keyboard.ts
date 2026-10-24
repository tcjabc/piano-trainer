/**
 * On-screen 88-key keyboard. Shows a full range (normally the connected
 * keyboard's keys) and zooms from fitting all of it down to about two
 * octaves; when zoomed in it follows the current card's note and the keys
 * being played. Shows pressed keys live, feedback flashes, a target key and
 * finger badges. Pointer presses are reported so it can stand in for a MIDI
 * keyboard. Key height never changes; zooming only changes key width.
 */
import { fingerColorVar, fingeringLabel, type Fingering } from '../core/fingering';
import { isBlackKey, MIDDLE_C, midiToName, PIANO_HIGH, PIANO_LOW } from '../core/pitch';
import { Emitter } from '../core/emitter';
import { h } from './dom';
import { clampFirst, revealFirst, visibleForZoom, type Viewport } from './keyboard-viewport';

export type KeyFlash = 'correct' | 'wrong';

type KeyboardEvents = { press: { note: number; velocity: number }; release: { note: number } };

const POINTER_VELOCITY = 80;

export class Keyboard extends Emitter<KeyboardEvents> {
  readonly el: HTMLElement;
  private track: HTMLElement;
  private keys = new Map<number, HTMLElement>();
  /** Index of the white key at or to the right of each note. */
  private whiteIndex = new Map<number, number>();
  private range: [number, number] = [36, 96];
  private zoom = 0;
  /** Left edge of the view, in white keys; null until the first layout. */
  private first: number | null = null;
  /** The current card's note, kept in view while zoomed in. */
  private focusNote: number | null = null;
  private flashTimers = new Map<number, number>();
  private pointerNotes = new Map<number, number>();
  private laidOut = false;

  constructor() {
    super();
    this.track = h('div.keyboard-track');
    this.el = h('div.keyboard', { role: 'group', 'aria-label': 'Piano keyboard' }, this.track);
    this.build();
    new ResizeObserver(() => this.layout()).observe(this.el);
  }

  private build(): void {
    let white = 0;
    for (let note = PIANO_LOW; note <= PIANO_HIGH; note++) {
      const black = isBlackKey(note);
      this.whiteIndex.set(note, white);
      const name = midiToName(note);
      const key = h(
        black ? 'div.key.key-black' : 'div.key.key-white',
        { dataset: { note: String(note) }, 'aria-label': name },
        note % 12 === 0
          ? h(note === MIDDLE_C ? 'span.key-label.key-label-middle' : 'span.key-label', null, name)
          : h('span.key-name', null, name.replace(/-?\d+$/, '').replace('#', '♯')),
      );
      key.style.setProperty('--i', String(white));
      key.addEventListener('pointerdown', (e) => this.pointerDown(e, note));
      this.track.append(key);
      this.keys.set(note, key);
      if (!black) white++;
    }
    this.track.style.setProperty('--white-count', String(white));
    window.addEventListener('pointerup', (e) => this.pointerUp(e));
    window.addEventListener('pointercancel', (e) => this.pointerUp(e));
  }

  /** The keys that can be shown (MIDI numbers, inclusive); zoom 0 fits all of them. */
  setRange(low: number, high: number): void {
    if (low === this.range[0] && high === this.range[1]) return;
    this.range = [low, high];
    this.layout();
  }

  /** 0 fits the full range, 1 shows about two octaves. Zooms around the middle of the view. */
  setZoom(zoom: number): void {
    if (zoom === this.zoom) return;
    const before = this.view();
    this.zoom = zoom;
    if (before) {
      const after = this.view()!;
      this.first = before.first + (before.visible - after.visible) / 2;
    }
    this.layout();
  }

  /** Keep the current card's note in view (null when there is no card). */
  setFocus(note: number | null): void {
    this.focusNote = note;
    if (note !== null) this.reveal(note);
  }

  /** Scroll, if needed, so a played key is in view without losing the card's note. */
  reveal(note: number): void {
    const view = this.view();
    if (!view) return;
    const keep = this.focusNote === null || this.focusNote === note ? null : this.centreOf(this.focusNote);
    const first = revealFirst(view, this.centreOf(note), keep);
    if (first !== view.first) {
      this.first = first;
      this.layout();
    }
  }

  /** Centre of a key in white-key units. Black keys sit on the boundary between two white keys. */
  private centreOf(note: number): number {
    const i = this.whiteIndex.get(note)!;
    return isBlackKey(note) ? i : i + 0.5;
  }

  private view(): Viewport | null {
    const [low, high] = this.range;
    const lo = this.whiteIndex.get(low)! - (isBlackKey(low) ? 0.5 : 0);
    const hi = this.whiteIndex.get(high)! + (isBlackKey(high) ? 0.5 : 1);
    const visible = visibleForZoom(hi - lo, this.zoom);
    if (this.first === null) return null;
    return { first: clampFirst(this.first, visible, lo, hi), visible, lo, hi };
  }

  private layout(): void {
    const width = this.el.clientWidth;
    if (width === 0) return;
    if (this.first === null) {
      // Start centred on middle C; clamped to the range below.
      this.first = 0;
      this.first = this.centreOf(MIDDLE_C) - this.view()!.visible / 2;
    }
    const view = this.view()!;
    this.first = view.first;
    if (this.focusNote !== null && view.visible < view.hi - view.lo) {
      this.first = revealFirst(view, this.centreOf(this.focusNote));
    }
    const keyWidth = width / view.visible;
    // Animate zoom and scroll, but not the first layout.
    this.el.classList.toggle('is-animated', this.laidOut);
    this.track.style.setProperty('--wk', `${keyWidth}px`);
    this.track.style.transform = `translateX(${-this.first * keyWidth}px)`;
    this.laidOut = true;
  }

  /** Show note names on every key (C labels are always shown). */
  setShowNames(show: boolean): void {
    this.el.classList.toggle('show-names', show);
  }

  /**
   * Where keys are on screen right now, relative to the keyboard's left edge:
   * key centre x = x0 + centre × unit. Read from the rendered keys, so it
   * stays right during zoom and scroll animations.
   */
  measure(): { x0: number; unit: number; left: number } {
    const lowest = this.keys.get(PIANO_LOW)!.getBoundingClientRect();
    const highest = this.keys.get(PIANO_HIGH)!.getBoundingClientRect();
    const box = this.el.getBoundingClientRect();
    const whites = this.whiteIndex.get(PIANO_HIGH)! + 1;
    return { x0: lowest.left - box.left, unit: (highest.right - lowest.left) / whites, left: box.left };
  }

  /** Key centre in white-key units, and whether it is a black key. */
  keyPosition(note: number): { centre: number; black: boolean } {
    return { centre: this.centreOf(note), black: isBlackKey(note) };
  }

  setPressed(note: number, pressed: boolean): void {
    this.keys.get(note)?.classList.toggle('is-pressed', pressed);
  }

  /** Brief feedback colour on a key. */
  flash(note: number, kind: KeyFlash, ms = 500): void {
    const key = this.keys.get(note);
    if (!key) return;
    window.clearTimeout(this.flashTimers.get(note));
    key.classList.remove('flash-correct', 'flash-wrong');
    void key.offsetWidth; // restart the transition
    key.classList.add(`flash-${kind}`);
    this.flashTimers.set(note, window.setTimeout(() => key.classList.remove(`flash-${kind}`), ms));
  }

  /** Mark the key that should have been played (null clears it). */
  setTarget(note: number | null): void {
    for (const key of this.track.querySelectorAll('.is-target')) key.classList.remove('is-target');
    if (note !== null) this.keys.get(note)?.classList.add('is-target');
  }

  /** Show a finger number and colour on a key (null removes it). */
  setFinger(note: number, fingering: Fingering | null): void {
    const key = this.keys.get(note);
    if (!key) return;
    key.querySelector('.finger-badge')?.remove();
    if (!fingering) return;
    const badge = h(
      'span.finger-badge',
      { title: fingeringLabel(fingering), dataset: { hand: fingering.hand } },
      String(fingering.finger),
      h('span.finger-hand', null, fingering.hand),
    );
    badge.style.setProperty('--finger-color', fingerColorVar(fingering.finger));
    key.append(badge);
  }

  clearFingers(): void {
    for (const badge of this.track.querySelectorAll('.finger-badge')) badge.remove();
  }

  private pointerDown(e: PointerEvent, note: number): void {
    e.preventDefault();
    this.pointerNotes.set(e.pointerId, note);
    this.emit('press', { note, velocity: POINTER_VELOCITY });
  }

  private pointerUp(e: PointerEvent): void {
    const note = this.pointerNotes.get(e.pointerId);
    if (note === undefined) return;
    this.pointerNotes.delete(e.pointerId);
    this.emit('release', { note });
  }
}
