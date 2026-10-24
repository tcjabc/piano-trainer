/**
 * Play area panel: a live grand staff of whatever is held (chords stacked),
 * the held note names, and the chord name when three or more notes are held.
 * Nothing here is scored or recorded.
 */
import { drawStaff, GRAND_STAFF_HEIGHT, STAVE_MARGIN, type NotationNote } from '../../core/notation';
import { displaySpelling, MIDDLE_C, spellingToMidi } from '../../core/pitch';
import { h } from '../../ui/dom';
import { detectChord, prettyChord, spellHeld } from './harmony';

/** Stave width limits; within them the stave takes the drawing area's proportions so it fills the card. */
const MIN_STAVE_WIDTH = 300;
const MAX_STAVE_WIDTH = 640;

export class PlayView {
  readonly el: HTMLElement;
  private drawing: HTMLElement;
  private notesEl: HTMLElement;
  private chordSymbol: HTMLElement;
  private chordName: HTMLElement;
  private held: number[] = [];
  private frame = 0;
  private staveWidth = MIN_STAVE_WIDTH;

  constructor() {
    this.drawing = h('div.staff-drawing.play-drawing');
    this.notesEl = h('p.play-notes', { 'aria-live': 'polite' });
    this.chordSymbol = h('span.play-chord-symbol');
    this.chordName = h('span.play-chord-name.muted');
    this.el = h(
      'section.panel.play-panel',
      { 'aria-label': 'What you are playing' },
      this.drawing,
      h('div.play-readout', null, this.notesEl, h('p.play-chord', null, this.chordSymbol, this.chordName)),
    );
    this.render();
    // Redraw when the card changes shape (window size, visualiser on/off).
    new ResizeObserver(() => {
      const width = this.fittedStaveWidth();
      if (Math.abs(width - this.staveWidth) > 4) this.render();
    }).observe(this.drawing);
  }

  /** A stave width whose drawing has the same proportions as the area it is shown in. */
  private fittedStaveWidth(): number {
    const { clientWidth: w, clientHeight: h } = this.drawing;
    if (w === 0 || h === 0) return this.staveWidth;
    const fitted = (w / h) * GRAND_STAFF_HEIGHT - STAVE_MARGIN;
    return Math.round(Math.min(MAX_STAVE_WIDTH, Math.max(MIN_STAVE_WIDTH, fitted)));
  }

  /** The keys physically held down (MIDI numbers). Redraws once per frame at most. */
  setHeld(notes: Iterable<number>): void {
    this.held = [...notes];
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  /** Draw again (e.g. after the music font loads or the panel is shown). */
  render(): void {
    const chord = detectChord(this.held);
    const spellings = spellHeld(this.held, chord);
    const byClef = (clef: 'treble' | 'bass'): NotationNote[] => {
      const notes = spellings.filter((s) => (spellingToMidi(s) >= MIDDLE_C) === (clef === 'treble'));
      return notes.length ? [{ clef, spellings: notes }] : [];
    };
    this.staveWidth = this.fittedStaveWidth();
    drawStaff(this.drawing, 'grand', [...byClef('treble'), ...byClef('bass')], { staveWidth: this.staveWidth });

    this.notesEl.textContent = spellings.length ? spellings.map(displaySpelling).join('  ') : 'Play something';
    this.notesEl.classList.toggle('muted', spellings.length === 0);
    this.chordSymbol.textContent = chord ? prettyChord(chord.symbol) : '';
    this.chordName.textContent = chord ? prettyChord(chord.name) : '';
  }
}
