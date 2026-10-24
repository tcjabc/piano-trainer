/**
 * What a drill does with each kind of card: how it is shown, how played
 * notes are checked, and what hint and restart mean.
 */
import { audio } from '../../core/audio';
import { chordName, chordNotes, chordSymbol, pitchClass } from '../../core/chords';
import { scalePassed } from '../../core/grading';
import { scaleName, scaleSequence } from '../../core/scales';
import type { StaffKind } from '../../core/notation';
import { midiToName } from '../../core/pitch';
import type { HandChoice } from '../../core/settings';
import type { ChordCardContent, NoteCardContent, ScaleCardContent } from '../../core/storage';
import type { Keyboard } from '../../ui/keyboard';
import type { StaffView } from '../../ui/staff';
import type { ChordItem, ScaleItem } from '../library/catalog';
import { chordTarget, fingers, notation, scaleReference, voicings } from '../library/voicing';
import { checkChord, ScaleTracker, type ChordCheck } from './check';
import { libraryItemFor, type DrillItem, type DrillOptions } from './items';
import type { Outcome } from './sources';

export interface TaskHost {
  readonly keyboard: Keyboard;
  readonly staff: StaffView;
  readonly options: DrillOptions;
  /** Milliseconds since the card appeared, not counting pauses. */
  elapsed(time: number): number;
  /** Record how the showing went (only the first call per showing counts). */
  outcome(o: Outcome): void;
  /** Done: success flash, then the next card. */
  complete(): void;
}

export interface Task {
  show(): void;
  noteOn(note: number, time: number, held: ReadonlySet<number>): void;
  noteOff(note: number, time: number, held: ReadonlySet<number>): void;
  /** R: start this card again (a grade already given stays). */
  restart(): void;
  /** H: play the answer. */
  hint(): void;
}

export type TaskFactory = (item: DrillItem, host: TaskHost, noteStaff: StaffKind) => Task | null;

export const HAND_LABELS: Record<HandChoice, string> = {
  left: 'Left hand',
  right: 'Right hand',
  both: 'Hands together',
};

export function staffForHand(hand: HandChoice): StaffKind {
  return hand === 'both' ? 'grand' : hand === 'left' ? 'bass' : 'treble';
}

// ── Notes ──────────────────────────────────────────────────────────────

/** One note on the staff; the right key, in the right octave. */
export class NoteTask implements Task {
  constructor(
    private c: NoteCardContent,
    private host: TaskHost,
    private staffKind: StaffKind,
  ) {}

  show(): void {
    this.host.staff.show(this.staffKind, [{ clef: this.c.clef, spellings: [this.c.spelling] }]);
    this.host.keyboard.setFocus(this.c.midi);
  }

  noteOn(note: number, time: number): void {
    const { keyboard, staff } = this.host;
    const correct = note === this.c.midi;
    this.host.outcome({ correct, ms: this.host.elapsed(time) });
    if (correct) {
      keyboard.flash(note, 'correct');
      keyboard.setTargets([]);
      staff.setState('correct');
      this.host.complete();
    } else {
      keyboard.flash(note, 'wrong');
      keyboard.setTargets([this.c.midi]);
      staff.setState('wrong', `That was not it — play ${this.c.spelling}`);
    }
  }

  noteOff(): void {}

  restart(): void {
    this.host.keyboard.setTargets([]);
    this.host.staff.setState('idle');
  }

  hint(): void {
    audio.preview(this.c.midi);
  }
}

// ── Chords ─────────────────────────────────────────────────────────────

/**
 * A chord by name, played anywhere on the keyboard. Pitch classes are
 * compared, so any voicing or octave counts, but the inversion's bass must
 * be lowest. A note outside the chord is wrong at once; letting go without
 * the whole chord is wrong too. Either way the missing keys are shown and
 * the card waits for the chord.
 */
export class ChordTask implements Task {
  private item: ChordItem;
  private attempt = new Set<number>();

  constructor(
    private c: ChordCardContent,
    private host: TaskHost,
  ) {
    this.item = libraryItemFor({ id: '', module: 'chords', content: c }) as ChordItem;
  }

  private get voiced(): number[] {
    const v = voicings(this.item, this.c.hand, 1);
    return [...(v.L ?? []), ...(v.R ?? [])].map((n) => n.midi);
  }

  show(): void {
    const { options, staff, keyboard } = this.host;
    const f = options.fingering ? fingers(this.item, this.c.hand, 1) : {};
    staff.showPrompt(
      chordSymbol(this.c),
      `${chordName(this.c)} · ${HAND_LABELS[this.c.hand]}`,
      options.chordStaff ? { kind: staffForHand(this.c.hand), notes: notation(this.item, this.c.hand, 1, f) } : undefined,
    );
    keyboard.setFocus(this.voiced[0]!);
  }

  noteOn(note: number, time: number, held: ReadonlySet<number>): void {
    this.attempt.add(note);
    const check = checkChord(held, chordTarget(this.item, this.c.hand));
    if (check.complete) {
      this.host.outcome({ correct: true, ms: this.host.elapsed(time) });
      for (const n of held) this.host.keyboard.flash(n, 'correct');
      this.host.keyboard.setTargets([]);
      this.host.staff.setState('correct');
      this.host.complete();
    } else if (check.extra.length > 0) {
      for (const n of check.extra) this.host.keyboard.flash(n, 'wrong');
      this.wrong(check, time);
    }
  }

  noteOff(_note: number, time: number, held: ReadonlySet<number>): void {
    if (held.size > 0 || this.attempt.size === 0) return;
    const check = checkChord(this.attempt, chordTarget(this.item, this.c.hand));
    this.attempt.clear();
    if (!check.complete) this.wrong(check, time);
  }

  private wrong(check: ChordCheck, time: number): void {
    this.host.outcome({ correct: false, ms: this.host.elapsed(time) });
    const spelled = chordNotes(this.c.root, this.c.quality);
    const name = (pc: number) => spelled.find((n) => pitchClass(n) === pc) ?? '';
    const target = chordTarget(this.item, this.c.hand);
    let message: string;
    let show: number[];
    if (check.extra.length > 0) {
      message = `Not in the chord: ${check.extra.map((n) => midiToName(n).replace(/-?\d+$/, '')).join(' ')}`;
      show = this.voiced.filter((m) => check.missing.includes(pitchClass(m)));
    } else if (check.missing.length > 0) {
      message = `Missing ${check.missing.map(name).join(' ')}`;
      show = this.voiced.filter((m) => check.missing.includes(pitchClass(m)));
    } else if (!check.bassOk && target.bass !== null) {
      message = `Needs ${name(target.bass)} in the bass`;
      show = this.voiced.filter((m) => pitchClass(m) === target.bass).slice(0, 1);
    } else {
      message = this.c.hand === 'both' ? 'Play the chord in each hand' : 'Not quite — play the chord';
      show = this.voiced;
    }
    this.host.keyboard.setTargets(show);
    this.host.staff.setState('wrong', message);
  }

  restart(): void {
    this.attempt.clear();
    this.host.keyboard.setTargets([]);
    this.host.staff.setState('idle');
  }

  hint(): void {
    audio.playNotes(this.voiced, { seconds: 1.6 });
  }
}

// ── Scales ─────────────────────────────────────────────────────────────

/**
 * A scale by name, played in order (ascending, or up and down — a setting)
 * in any octave. A wrong note is marked and counted, and the scale carries
 * on from the note that was expected. Graded when finished, on wrong notes
 * and total time. Fingering is shown on the keys (unless switched off).
 */
export class ScaleTask implements Task {
  private item: ScaleItem;
  private tracker: ScaleTracker;

  constructor(
    private c: ScaleCardContent,
    private host: TaskHost,
  ) {
    this.item = libraryItemFor({ id: '', module: 'scales', content: c }) as ScaleItem;
    this.tracker = this.newTracker();
  }

  private get direction() {
    return this.host.options.scaleDirection;
  }

  private newTracker(): ScaleTracker {
    return new ScaleTracker(scaleReference(this.item, this.c.octaves, this.direction), this.c.hand === 'both');
  }

  /** Spelled name (no octave) of the note at a step, for messages. */
  private noteName(index: number): string {
    const seq = scaleSequence({ tonic: this.c.tonic, type: this.c.type, octaves: this.c.octaves }, 'R', this.direction);
    return seq[index]?.spelling.replace(/-?\d+$/, '') ?? '';
  }

  private progress(): string {
    return `${this.tracker.index} / ${this.tracker.length}`;
  }

  show(): void {
    const { staff, keyboard, options } = this.host;
    const octaves = this.c.octaves === 1 ? '1 octave' : '2 octaves';
    const way = this.direction === 'up' ? 'ascending' : 'up and down';
    staff.showPrompt(scaleName(this.c), `${octaves} · ${way} · ${HAND_LABELS[this.c.hand]}`);
    staff.setState('idle', this.progress());
    const v = voicings(this.item, this.c.hand, this.c.octaves);
    if (options.fingering) {
      const f = fingers(this.item, this.c.hand, this.c.octaves);
      for (const side of ['L', 'R'] as const) {
        const list = f[side];
        v[side]?.forEach((n, i) => {
          const finger = list?.[i];
          if (finger) keyboard.setFinger(n.midi, { finger: finger as 1 | 2 | 3 | 4 | 5, hand: side });
        });
      }
    }
    keyboard.setFocus((v.R ?? v.L)![0]!.midi);
  }

  noteOn(note: number, time: number): void {
    const { keyboard, staff } = this.host;
    const step = this.tracker.press(note, time);
    if (step === 'wrong') {
      keyboard.flash(note, 'wrong');
      const next = this.tracker.nextKey();
      keyboard.setTargets(next === null ? [] : [next]);
      staff.setState('wrong', `Wrong note — next is ${this.noteName(this.tracker.index)} · ${this.progress()}`);
    } else if (step === 'ok') {
      keyboard.flash(note, 'correct', 200);
      keyboard.setTargets([]);
      staff.setState('idle', this.progress());
    } else {
      const errors = this.tracker.errors;
      const passed = scalePassed(errors);
      this.host.outcome({ correct: passed, ms: this.tracker.elapsedMs, errors, notes: this.tracker.length });
      keyboard.setTargets([]);
      staff.setState(passed ? 'correct' : 'wrong', errors === 0 ? '' : `${errors} wrong note${errors === 1 ? '' : 's'}`);
      this.host.complete();
    }
  }

  noteOff(): void {}

  restart(): void {
    this.tracker = this.newTracker();
    this.host.keyboard.setTargets([]);
    this.host.staff.setState('idle', this.progress());
  }

  hint(): void {
    const seq = scaleReference(this.item, this.c.octaves, this.direction);
    const shift = this.c.hand === 'left' ? -12 : 0;
    audio.playNotes(seq.map((n) => n + shift), { stepMs: 200, seconds: 0.45 });
    if (this.c.hand === 'both') audio.playNotes(seq.map((n) => n - 12), { stepMs: 200, seconds: 0.45 });
  }
}

export const baseTasks: TaskFactory = (item, host, noteStaff) => {
  if (item.module === 'notes') return new NoteTask(item.content, host, noteStaff);
  if (item.module === 'chords') return new ChordTask(item.content, host);
  return new ScaleTask(item.content, host);
};
