/**
 * The drill: shows one card at a time (a note, chord or scale), passes what
 * is played to that card's task, records the first outcome of each showing
 * with the source, and moves on when the card is done. Pause, restart, skip,
 * previous and hear work the same for every kind of card.
 */
import { cssTimeMs } from '../../ui/dom';
import type { Keyboard } from '../../ui/keyboard';
import type { StaffView } from '../../ui/staff';
import type { DrillItem, DrillOptions } from './items';
import { ReviewSource, type DrillSource, type Outcome } from './sources';
import { baseTasks, type Task, type TaskFactory, type TaskHost } from './tasks';

export interface DrillHooks {
  /** The source ran out of cards. */
  finished: () => void;
  /** A card was answered (played correctly, or a scale finished). */
  answered?: (item: DrillItem) => void;
}

type Phase = 'answering' | 'advancing' | 'paused' | 'stopped';

export class Drill {
  private source: DrillSource = new ReviewSource([], 'treble', {}, () => undefined);
  private item: DrillItem | null = null;
  private task: Task | null = null;
  private phase: Phase = 'stopped';
  private resumePhase: Phase = 'answering';
  private shownAt = 0;
  private pausedAt = 0;
  private pausedTotal = 0;
  /** This showing's outcome is already recorded (or it is ungraded practice). */
  private graded = false;
  private hinted = false;
  private advanceTimer = 0;
  /** Cards shown before the current one, for "previous". */
  private history: DrillItem[] = [];
  private options: DrillOptions = { scaleDirection: 'up', chordStaff: false, fingering: true };
  /** Makes the task for a card; extended as kinds of cards are added. */
  tasks: TaskFactory = baseTasks;

  constructor(
    private staff: StaffView,
    private keyboard: Keyboard,
    private hooks: DrillHooks,
  ) {}

  get active(): boolean {
    return this.phase !== 'stopped';
  }

  get paused(): boolean {
    return this.phase === 'paused';
  }

  start(source: DrillSource, options: DrillOptions): void {
    this.stop();
    this.source = source;
    this.options = options;
    this.phase = 'answering';
    this.item = null;
    this.history = [];
    this.showNext();
  }

  stop(): void {
    window.clearTimeout(this.advanceTimer);
    this.phase = 'stopped';
    this.item = null;
    this.task = null;
    this.keyboard.setTargets([]);
    this.keyboard.setFocus(null);
    this.keyboard.clearFingers();
  }

  // ── Input ────────────────────────────────────────────────────────────

  noteOn(note: number, time: number, held: ReadonlySet<number>): void {
    if (this.phase !== 'answering') return;
    this.task?.noteOn(note, time, held);
  }

  noteOff(note: number, time: number, held: ReadonlySet<number>): void {
    if (this.phase !== 'answering') return;
    this.task?.noteOff(note, time, held);
  }

  // ── Hotkey actions ───────────────────────────────────────────────────

  togglePause(): void {
    if (this.phase === 'paused') {
      this.pausedTotal += performance.now() - this.pausedAt;
      this.phase = this.resumePhase;
      this.staff.setState('idle');
      if (this.phase === 'advancing') this.showNext();
    } else if (this.phase === 'answering' || this.phase === 'advancing') {
      window.clearTimeout(this.advanceTimer);
      this.resumePhase = this.phase;
      this.pausedAt = performance.now();
      this.phase = 'paused';
      this.staff.setState('paused', 'Paused — press Space to continue');
    }
  }

  /** Start this card again (timer and progress). A grade already given stays. */
  restart(): void {
    if (this.phase !== 'answering' || !this.task) return;
    this.resetTiming();
    this.task.restart();
  }

  skip(): void {
    if (this.phase !== 'answering' || !this.item) return;
    // A failed card is already back in the queue; an unanswered one goes to the end.
    if (!this.graded) this.source.skip(this.item);
    this.keyboard.setTargets([]);
    this.showNext();
  }

  /**
   * Go back to the previous card and play it again as practice (it was
   * already recorded, so this showing isn't). The current card stays queued.
   */
  previous(): void {
    if (this.phase !== 'answering' || !this.item) return;
    const prev = this.history.pop();
    if (!prev) return;
    if (!this.graded) this.source.pushFront(this.item);
    this.keyboard.setTargets([]);
    this.showItem(prev, { practice: true });
  }

  /** Play the answer. Caps the grade at Hard if used before answering. */
  hint(): void {
    if (!this.task || this.phase === 'stopped') return;
    if (!this.graded) this.hinted = true;
    this.task.hint();
  }

  // ── Internals ────────────────────────────────────────────────────────

  /**
   * What tasks may use. Getters, because class fields are set before the
   * constructor's parameter properties.
   */
  private host: TaskHost = ((self: Drill): TaskHost => ({
    get keyboard() {
      return self.keyboard;
    },
    get staff() {
      return self.staff;
    },
    get options() {
      return self.options;
    },
    elapsed: (time) => Math.max(0, time - self.shownAt - self.pausedTotal),
    outcome: (o: Outcome) => {
      if (self.graded || !self.item) return;
      self.graded = true;
      void self.source.record(self.item, o, self.hinted);
    },
    complete: () => {
      if (self.item) self.hooks.answered?.(self.item);
      self.advance();
    },
  }))(this);

  private advance(): void {
    this.phase = 'advancing';
    this.advanceTimer = window.setTimeout(() => {
      if (this.phase === 'advancing') {
        this.phase = 'answering';
        this.showNext();
      }
    }, cssTimeMs('--drill-advance-delay', 320));
  }

  private showNext(): void {
    const next = this.source.next(Date.now());
    if (!next) {
      this.stop();
      this.hooks.finished();
      return;
    }
    if (this.item) this.history.push(this.item);
    this.showItem(next, { practice: false });
  }

  private showItem(item: DrillItem, { practice }: { practice: boolean }): void {
    this.item = item;
    this.phase = 'answering';
    this.graded = practice; // a practice showing is never recorded
    this.hinted = false;
    this.keyboard.setTargets([]);
    this.keyboard.clearFingers();
    this.task = this.tasks(item, this.host, this.source.noteStaff);
    if (!this.task) {
      // A kind of card this drill can't show yet: skip it.
      this.showNext();
      return;
    }
    this.task.show();
    if (practice) this.staff.setState('idle', 'Practice — not graded');
    this.staff.setCorner(this.source.corner());
    this.resetTiming();
  }

  private resetTiming(): void {
    this.shownAt = performance.now();
    this.pausedTotal = 0;
  }
}

