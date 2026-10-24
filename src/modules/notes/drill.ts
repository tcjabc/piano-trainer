/**
 * Note drill: shows one note at a time and grades what is played.
 * Correct → success flash, next card. Wrong → error flash on the played key,
 * the correct key is shown, and the card waits until that key is played.
 */
import { audio } from '../../core/audio';
import { autoGrade, recordReview, SessionQueue } from '../../core/scheduler';
import type { NoteDrillOptions } from '../../core/settings';
import { storage, type CardRecord } from '../../core/storage';
import { displaySpelling } from '../../core/pitch';
import type { StaffKind } from '../../core/notation';
import { cssTimeMs } from '../../ui/dom';
import type { Keyboard } from '../../ui/keyboard';
import type { StaffView } from '../../ui/staff';

export interface DrillHooks {
  /** A review was saved (refresh due counts). */
  reviewed: () => void;
  /** The queue is empty or the drill was stopped. */
  finished: () => void;
}

type Phase = 'answering' | 'advancing' | 'paused' | 'stopped';

export class NoteDrill {
  private queue: SessionQueue = new SessionQueue([]);
  private card: CardRecord | null = null;
  private phase: Phase = 'stopped';
  private resumePhase: Phase = 'answering';
  private shownAt = 0;
  private pausedAt = 0;
  private pausedTotal = 0;
  /** Whether this showing of the card has already been graded (a wrong answer). */
  private graded = false;
  private hinted = false;
  private advanceTimer = 0;
  private options: NoteDrillOptions | null = null;
  /** The current card as it is now (updated once graded), and the cards shown before it. */
  private latest: CardRecord | null = null;
  private history: CardRecord[] = [];

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

  start(cards: CardRecord[], options: NoteDrillOptions, { ahead = false } = {}): void {
    this.options = options;
    this.queue = new SessionQueue(cards, { ahead });
    this.phase = 'answering';
    this.card = null;
    this.history = [];
    this.showNext();
  }

  stop(): void {
    window.clearTimeout(this.advanceTimer);
    this.phase = 'stopped';
    this.card = null;
    this.keyboard.setTarget(null);
    this.keyboard.setFocus(null);
  }

  // ── Input ────────────────────────────────────────────────────────────

  noteOn(note: number, time: number): void {
    if (this.phase !== 'answering' || !this.card) return;
    const target = this.card.content.midi;
    const correct = note === target;

    if (!this.graded) {
      const responseMs = Math.max(0, time - this.shownAt - this.pausedTotal);
      void this.grade(correct, responseMs);
    }
    if (correct) {
      this.keyboard.flash(note, 'correct');
      this.keyboard.setTarget(null);
      this.staff.setState('correct');
      this.advance();
    } else {
      this.keyboard.flash(note, 'wrong');
      this.keyboard.setTarget(target);
      this.staff.setState('wrong', `That was not it — play ${displaySpelling(this.card.content.spelling)}`);
    }
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

  /** Reset the timer and feedback for the current card. A grade already given stays. */
  restart(): void {
    if (this.phase !== 'answering' || !this.card) return;
    this.resetTiming();
    this.keyboard.setTarget(null);
    this.staff.setState('idle');
  }

  skip(): void {
    if (this.phase !== 'answering' || !this.card) return;
    // A failed card is already back in the queue; an unanswered one goes to the end.
    if (!this.graded) this.queue.deferToEnd(this.card);
    this.keyboard.setTarget(null);
    this.showNext();
  }

  /**
   * Go back to the previous card and play it again as practice (it was
   * already graded, so this showing isn't). The current card stays queued.
   */
  previous(): void {
    if (this.phase !== 'answering' || !this.card) return;
    const prev = this.history.pop();
    if (!prev) return;
    if (!this.graded) this.queue.pushFront(this.card);
    this.keyboard.setTarget(null);
    this.showCard(prev, { practice: true });
  }

  /** Play the correct note. Caps the grade at Hard if used before answering. */
  hint(): void {
    if (!this.card || this.phase === 'stopped') return;
    if (!this.graded) this.hinted = true;
    audio.preview(this.card.content.midi);
  }

  // ── Internals ────────────────────────────────────────────────────────

  private async grade(correct: boolean, responseMs: number): Promise<void> {
    const card = this.card!;
    this.graded = true;
    const now = Date.now();
    const result = recordReview(card, autoGrade(correct, responseMs, this.hinted), responseMs, now);
    this.latest = result.card;
    this.queue.requeue(result.card, now);
    await storage.recordReview(result.review, result.card);
    this.hooks.reviewed();
  }

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
    const next = this.queue.next(Date.now());
    if (!next) {
      this.stop();
      this.hooks.finished();
      return;
    }
    if (this.latest) this.history.push(this.latest);
    this.showCard(next, { practice: false });
  }

  private showCard(card: CardRecord, { practice }: { practice: boolean }): void {
    this.card = card;
    this.latest = card;
    this.phase = 'answering';
    this.graded = practice; // a practice showing is never graded
    this.hinted = false;
    this.staff.show(this.staffKind(), [{ clef: card.content.clef, spellings: [card.content.spelling] }]);
    if (practice) this.staff.setState('idle', 'Practice — not graded');
    this.staff.setCorner(`${this.queue.size + 1} left`);
    this.keyboard.setFocus(card.content.midi);
    this.resetTiming();
  }

  private resetTiming(): void {
    this.shownAt = performance.now();
    this.pausedTotal = 0;
  }

  private staffKind(): StaffKind {
    const clef = this.options?.clef ?? 'treble';
    return clef === 'both' ? 'grand' : clef;
  }
}
