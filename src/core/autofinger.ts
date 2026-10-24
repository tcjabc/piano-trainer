/**
 * Automatic fingering for songs: for each hand, a finger 1–5 for every note,
 * chosen by dynamic programming (Viterbi) over the possible fingers of each
 * step, minimising a cost model in the style of Parncutt, Sloboda, Clarke,
 * Raekallio & Desain (1997), "An ergonomic model of keyboard fingering for
 * melodic fragments", implemented from scratch:
 *
 * - Spans between two fingers (in semitones): practical limits (beyond them
 *   is impossible), comfortable limits (stretch: 2 points per semitone
 *   outside) and relaxed limits (1 point per semitone outside with the
 *   thumb, 2 without).
 * - Weak fingers (4, 5): 1 point. Thumb on a black key: 1 point, and 2 more
 *   for each white neighbour; little finger on black between whites: 2 per
 *   white neighbour. 3 followed by 4: 1 point; 3 on white next to 4 on
 *   black: 1 more. Crossing 3-4 or 4-5 is beyond the practical limits, so
 *   never chosen.
 * - Passing the thumb under (or a finger over it) is costed by the finger
 *   (3 easiest, then 4; 2 is awkward) and by the keys: from a finger on a
 *   black key to the thumb on a white key is easiest (the thumb has room
 *   under the raised key, worth a semitone of span); on the same level, or
 *   with the thumb onto a black key, costs 3. Passes are held to the
 *   comfortable stretch limits but not the relaxed ones (a pass is never
 *   relaxed). This is what puts the thumb on C and F in flat keys.
 * - Additions: the same finger on a different note soon after (4 points, 1
 *   after a pause), and moving the hand (2 points for a change of hand
 *   position, plus a quarter point per semitone the thumb's place moves).
 * - Chords: fingers in pitch order (thumb lowest in the right hand, highest
 *   in the left), every neighbouring pair within practical limits, held to
 *   the comfortable stretch, and about one finger per scale step apart (a
 *   third skips a finger, a fifth spans 1–5): 1 point per finger off. Between
 *   chords only the hand's movement counts.
 *
 * The left hand mirrors the right (pitches negated, key colours kept). Steps
 * after a pause of two beats or more cost little to reach: the hand can
 * reposition. Notes that already have a finger keep it and steer the rest.
 * Pure; a song of a few thousand notes takes milliseconds.
 */
import type { Finger } from './fingering';
import { stepsOf, type SongHand, type SongNote } from './song';

interface Span {
  minPrac: number;
  minComf: number;
  minRel: number;
  maxRel: number;
  maxComf: number;
  maxPrac: number;
}

/**
 * Right-hand spans for each finger pair (lower-numbered finger first), in
 * semitones from the lower-numbered finger's key to the higher-numbered
 * finger's key (negative: the higher finger plays the lower key).
 */
const SPANS: Record<string, Span> = {
  '1-2': { minPrac: -5, minComf: -3, minRel: 1, maxRel: 5, maxComf: 8, maxPrac: 10 },
  '1-3': { minPrac: -4, minComf: -2, minRel: 3, maxRel: 7, maxComf: 10, maxPrac: 12 },
  '1-4': { minPrac: -3, minComf: -1, minRel: 5, maxRel: 9, maxComf: 12, maxPrac: 14 },
  '1-5': { minPrac: -1, minComf: 1, minRel: 7, maxRel: 10, maxComf: 13, maxPrac: 15 },
  '2-3': { minPrac: 1, minComf: 1, minRel: 1, maxRel: 2, maxComf: 3, maxPrac: 5 },
  '2-4': { minPrac: 1, minComf: 1, minRel: 3, maxRel: 4, maxComf: 5, maxPrac: 7 },
  '2-5': { minPrac: 2, minComf: 2, minRel: 5, maxRel: 6, maxComf: 8, maxPrac: 10 },
  '3-4': { minPrac: 1, minComf: 1, minRel: 1, maxRel: 2, maxComf: 2, maxPrac: 4 },
  '3-5': { minPrac: 1, minComf: 1, minRel: 3, maxRel: 4, maxComf: 5, maxPrac: 7 },
  '4-5': { minPrac: 1, minComf: 1, minRel: 1, maxRel: 2, maxComf: 3, maxPrac: 5 },
};

/** Where each finger sits relative to the thumb in a relaxed five-finger position (semitones). */
const OFFSET = [0, 0, 2, 4, 5, 7];
/** Average semitones per scale step, to turn a chord's intervals into finger gaps. */
const SEMITONES_PER_STEP = 1.75;
/** The thumb's place moving more than this (semitones) is a change of hand position. */
const POSITION_SLACK = 2;
/** Passing the thumb under (or over) each finger: 3 is easiest, then 4; 2 is awkward, 5 rarely done. */
const PASS_FINGER = [0, 0, 2.5, 1, 1.5, 4];

const COST = {
  stretch: 2,
  relaxThumb: 1,
  relax: 2,
  weak: 0.5,
  threeFour: 1,
  fourOnBlack: 1,
  thumbOnBlack: 1,
  blackNeighbour: 2,
  /** Passing on the same level (white to white, black to black), or with the thumb onto a black key. */
  passLevel: 3,
  sameFinger: 4,
  sameFingerAfterPause: 1,
  handMove: 0.25,
  positionChange: 2,
  chordGap: 1,
  /** Unavoidable leaps (no finger pair reaches): a big but finite cost, so the hand jumps. */
  jump: 40,
};

/** A pause this long (beats) lets the hand reposition freely. */
const PAUSE_BEATS = 2;
const PAUSE_FACTOR = 0.2;
/** The same finger on another note this soon (beats) is costed in full. */
const QUICK_BEATS = 1;

const isBlack = (midi: number) => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);

/** A note in right-hand space: pitch (negated for the left hand) and key colour. */
interface Key {
  pitch: number;
  black: boolean;
}

/** One way to finger a step: its keys low to high (right-hand space) with fingers in the same order. */
interface State {
  keys: Key[];
  fingers: Finger[];
  /** Where the thumb would be, for hand movement. */
  thumb: number;
  /** Cost of the step on its own (weak fingers, black keys, the chord's own spans). */
  own: number;
}

/** Cost of two fingers on two keys (spans), or Infinity beyond the practical limits. */
export function spanCost(fa: Finger, pa: number, fb: Finger, pb: number, melodic = true): number {
  if (fa === fb) return pa === pb ? 0 : Infinity;
  const [lo, hi, plo, phi] = fa < fb ? [fa, fb, pa, pb] : [fb, fa, pb, pa];
  const t = SPANS[`${lo}-${hi}`]!;
  const s = phi - plo;
  if (s < t.minPrac || s > t.maxPrac) return Infinity;
  let c = 0;
  if (s < t.minComf) c += COST.stretch * (t.minComf - s);
  if (s > t.maxComf) c += COST.stretch * (s - t.maxComf);
  if (melodic || lo !== 1) {
    const w = lo === 1 ? COST.relaxThumb : COST.relax;
    if (s < t.minRel) c += w * (t.minRel - s);
    if (s > t.maxRel) c += w * (s - t.maxRel);
  }
  return c;
}

/** Ways to finger a step of k keys (sorted low to high): k fingers in increasing order. */
function statesFor(keys: Key[], fixed: (Finger | null)[]): State[] {
  const k = keys.length;
  const out: State[] = [];
  const pick = (start: number, chosen: Finger[]) => {
    if (chosen.length === k) {
      out.push(makeState(keys, [...chosen]));
      return;
    }
    for (let f = start; f <= 5; f++) pick(f + 1, [...chosen, f as Finger]);
  };
  if (k >= 1 && k <= 5) pick(1, []);
  const possible = out.filter((s) => Number.isFinite(s.own));
  const matching = possible.filter((s) => s.fingers.every((f, i) => fixed[i] === null || fixed[i] === f));
  return matching.length ? matching : possible;
}

function makeState(keys: Key[], fingers: Finger[]): State {
  let own = 0;
  keys.forEach((key, i) => {
    const f = fingers[i]!;
    if (f >= 4) own += COST.weak;
    if (f === 1 && key.black) own += COST.thumbOnBlack;
  });
  // A chord's neighbouring notes: within reach, and about one finger per scale step apart.
  for (let i = 1; i < keys.length; i++) {
    own += spanCost(fingers[i - 1]!, keys[i - 1]!.pitch, fingers[i]!, keys[i]!.pitch, false);
    const steps = Math.min(4, Math.max(1, Math.round((keys[i]!.pitch - keys[i - 1]!.pitch) / SEMITONES_PER_STEP)));
    own += COST.chordGap * Math.abs(fingers[i]! - fingers[i - 1]! - steps);
  }
  const thumb = keys.reduce((sum, key, i) => sum + key.pitch - OFFSET[fingers[i]!]!, 0) / keys.length;
  return { keys, fingers, thumb, own };
}

/** Cost of going from one step to the next. */
function transition(a: State, b: State, gapBeats: number): number {
  const moved = Math.abs(b.thumb - a.thumb);
  let c = COST.handMove * moved + (moved > POSITION_SLACK ? COST.positionChange : 0);
  if (a.keys.length === 1 && b.keys.length === 1) {
    const [ka, kb] = [a.keys[0]!, b.keys[0]!];
    const [fa, fb] = [a.fingers[0]!, b.fingers[0]!];
    // Thumb under (going up onto the thumb) or a finger over it (going down from it).
    const passing = (fb === 1 && fa > 1 && kb.pitch > ka.pitch) || (fa === 1 && fb > 1 && kb.pitch < ka.pitch);
    if (fa === fb && ka.pitch !== kb.pitch) c += gapBeats < QUICK_BEATS ? COST.sameFinger : COST.sameFingerAfterPause;
    else if (passing) {
      const [thumbKey, fingerKey, finger] = fa === 1 ? [ka, kb, fb] : [kb, ka, fa];
      const easy = fingerKey.black && !thumbKey.black;
      // The practical limits hold as they are; the room under a black key only makes it more comfortable.
      if (!Number.isFinite(spanCost(1, thumbKey.pitch, finger, fingerKey.pitch, false))) c += Infinity;
      else c += spanCost(1, thumbKey.pitch - (easy ? 1 : 0), finger, fingerKey.pitch, false);
      c += PASS_FINGER[finger]! + (easy ? 0 : COST.passLevel);
    } else c += spanCost(fa, ka.pitch, fb, kb.pitch);
    if (fa === 3 && fb === 4) c += COST.threeFour;
    if ((fa === 3 && fb === 4 && !ka.black && kb.black) || (fa === 4 && fb === 3 && ka.black && !kb.black)) c += COST.fourOnBlack;
    // Thumb or little finger on black next to a white key.
    for (const [f, here, there] of [[fb, kb, ka], [fa, ka, kb]] as const) {
      if ((f === 1 || f === 5) && here.black && !there.black) c += COST.blackNeighbour;
    }
  }
  if (!Number.isFinite(c)) c = COST.jump;
  return gapBeats >= PAUSE_BEATS ? c * PAUSE_FACTOR : c;
}

/** Fingers for one hand's notes (notes that already have a finger keep it). */
function fingerHand(notes: SongNote[], hand: SongHand): Map<string, Finger> {
  const sign = hand === 'L' ? -1 : 1;
  const steps = stepsOf(notes).map((step) => {
    const sorted = [...step.notes].sort((x, y) => sign * (x.midi - y.midi));
    const keys = sorted.map((n) => ({ pitch: sign * n.midi, black: isBlack(n.midi) }));
    return { beat: step.beat, end: Math.max(...step.notes.map((n) => n.beat + n.duration)), notes: sorted, states: statesFor(keys, sorted.map((n) => n.finger)) };
  });

  // Viterbi: best cost to finish each state of each step, and where it came from.
  const cost: number[][] = [];
  const from: number[][] = [];
  steps.forEach((step, i) => {
    cost.push([]);
    from.push([]);
    step.states.forEach((state, s) => {
      if (i === 0 || steps[i - 1]!.states.length === 0) {
        cost[i]![s] = state.own;
        from[i]![s] = -1;
        return;
      }
      const prev = steps[i - 1]!;
      const gap = step.beat - prev.end;
      let best = Infinity;
      let arg = 0;
      prev.states.forEach((p, ps) => {
        const total = cost[i - 1]![ps]! + transition(p, state, gap);
        if (total < best) {
          best = total;
          arg = ps;
        }
      });
      cost[i]![s] = best + state.own;
      from[i]![s] = arg;
    });
  });

  // Walk back from the cheapest last state; a step with no possible fingering starts afresh.
  const out = new Map<string, Finger>();
  let s = -1;
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i]!;
    if (step.states.length === 0) {
      s = -1;
      continue;
    }
    if (s < 0) s = cost[i]!.indexOf(Math.min(...cost[i]!));
    const state = step.states[s]!;
    step.notes.forEach((n, j) => {
      if (n.finger === null) out.set(n.id, state.fingers[j]!);
    });
    s = from[i]![s]!;
  }
  return out;
}

/**
 * Suggested fingers, by note id, for every note that has none. Notes with
 * a finger (from the score, or set by hand) keep it and guide the rest.
 */
export function suggestFingering(notes: readonly SongNote[]): Map<string, Finger> {
  const out = new Map<string, Finger>();
  for (const hand of ['L', 'R'] as SongHand[]) {
    for (const [id, f] of fingerHand(notes.filter((n) => n.hand === hand), hand)) out.set(id, f);
  }
  return out;
}


/** The notes with suggested fingers filled in (marked `suggested`) where they had none. */
export function withSuggestedFingering(notes: readonly SongNote[]): SongNote[] {
  const got = suggestFingering(notes);
  return notes.map((n) => {
    const finger = got.get(n.id);
    return finger ? { ...n, finger, suggested: true } : n;
  });
}

/** The notes with every suggested finger taken off (fingers from the score or set by hand stay). */
export function withoutSuggestedFingering(notes: readonly SongNote[]): SongNote[] {
  return notes.map((n) => {
    if (!n.suggested) return n;
    const { suggested: _, ...rest } = n;
    return { ...rest, finger: null };
  });
}
