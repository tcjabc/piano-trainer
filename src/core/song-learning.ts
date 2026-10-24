/**
 * The learning path for a song section: right hand slow → left hand slow →
 * hands together slow (all in wait mode) → up to tempo (play-along, with the
 * tempo raised after each clean pass until 100%). A pass counts towards the
 * current step when it was played at least as demandingly as the step asks.
 * Thresholds are in GRADING.songs.
 */
import { GRADING, songPassClean, type SongPassResult } from './grading';
import type { HandChoice } from './settings';

export type SongMode = 'wait' | 'play-along' | 'listen';

export interface LearningStep {
  label: string;
  hands: HandChoice;
  mode: 'wait' | 'play-along';
}

export const LEARNING_STEPS: readonly LearningStep[] = [
  { label: 'Right hand, slow', hands: 'right', mode: 'wait' },
  { label: 'Left hand, slow', hands: 'left', mode: 'wait' },
  { label: 'Hands together, slow', hands: 'both', mode: 'wait' },
  { label: 'Up to tempo', hands: 'both', mode: 'play-along' },
];

/** Step index once every step is done. */
export const LEARNED = LEARNING_STEPS.length;

export interface SectionProgress {
  /** 0…LEARNING_STEPS.length (learned). */
  step: number;
  /** Clean passes in a row at the current step. */
  streak: number;
  /** The up-to-tempo step's current tempo (0–1+). */
  speedTempo: number;
  /** Fastest clean pass (tempo factor), 0 if none yet. */
  bestTempo: number;
  lastAccuracy: number | null;
  bestAccuracy: number | null;
  lastPractised: number | null;
  passes: number;
}

export function newProgress(): SectionProgress {
  return {
    step: 0,
    streak: 0,
    speedTempo: GRADING.songs.slowTempo,
    bestTempo: 0,
    lastAccuracy: null,
    bestAccuracy: null,
    lastPractised: null,
    passes: 0,
  };
}

export interface Requirement {
  hands: HandChoice;
  mode: 'wait' | 'play-along';
  /** Tempo factor, e.g. 0.6. */
  tempo: number;
}

/** What the current step asks for; once learned, hands together at full tempo. */
export function requirement(p: SectionProgress): Requirement {
  const step = LEARNING_STEPS[p.step];
  if (!step) return { hands: 'both', mode: 'play-along', tempo: 1 };
  return { hands: step.hands, mode: step.mode, tempo: step.mode === 'play-along' ? p.speedTempo : GRADING.songs.slowTempo };
}

/** Raise the tempo after a clean pass, by one step, until 100%. */
export function progressiveTempo(current: number, clean: boolean, target = 1): number {
  if (!clean || current >= target) return current;
  return Math.min(target, Math.round((current + GRADING.songs.tempoStep) * 100) / 100);
}

export interface Pass extends SongPassResult {
  hands: HandChoice;
  /** Tempo factor it was played at. */
  tempo: number;
  at: number;
}

/** Whether a pass meets a requirement: same hands, the same mode or a stricter one, at least as fast. */
export function meets(pass: Pass, req: Requirement): boolean {
  const modeOk = pass.mode === req.mode || (req.mode === 'wait' && pass.mode === 'play-along');
  return pass.hands === req.hands && modeOk && pass.tempo >= req.tempo - 1e-6;
}

/** Record a pass: stats always; the learning path only when the pass meets the current step. */
export function applyPass(p: SectionProgress, pass: Pass): SectionProgress {
  const clean = songPassClean(pass);
  const next: SectionProgress = {
    ...p,
    passes: p.passes + 1,
    lastPractised: pass.at,
    lastAccuracy: pass.accuracy,
    bestAccuracy: Math.max(p.bestAccuracy ?? 0, pass.accuracy),
    bestTempo: clean ? Math.max(p.bestTempo, pass.tempo) : p.bestTempo,
  };
  if (p.step >= LEARNED || !meets(pass, requirement(p))) return next;
  const step = LEARNING_STEPS[p.step]!;
  if (step.mode === 'play-along') {
    if (!clean) return next;
    // Up to tempo: a clean pass at 100% finishes the path; otherwise go a little faster.
    if (pass.tempo >= 1 - 1e-6) return { ...next, step: LEARNED, streak: 0, speedTempo: 1 };
    return { ...next, speedTempo: progressiveTempo(Math.max(p.speedTempo, pass.tempo), true) };
  }
  if (!clean) return { ...next, streak: 0 };
  const streak = p.streak + 1;
  if (streak >= GRADING.songs.cleanPassesToAdvance) return { ...next, step: p.step + 1, streak: 0 };
  return { ...next, streak };
}

const pct = (t: number) => `${Math.round(t * 100)}%`;

/** "Left hand, slow · wait mode at 60% · 1 of 2 clean passes" (or "Learned"). */
export function describeStep(p: SectionProgress): string {
  const step = LEARNING_STEPS[p.step];
  if (!step) return 'Learned';
  const req = requirement(p);
  const mode = req.mode === 'wait' ? 'wait mode' : 'play-along';
  const streak = step.mode === 'wait' ? ` · ${p.streak} of ${GRADING.songs.cleanPassesToAdvance} clean passes` : '';
  return `${step.label} · ${mode} at ${pct(req.tempo)}${streak}`;
}
