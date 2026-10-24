/**
 * Fingering: one colour per finger (1 = thumb … 5 = little finger), shared by
 * both hands, plus a hand marker. Colours live in tokens.css as
 * --finger-1 … --finger-5; use these everywhere fingering is shown.
 */
export type Finger = 1 | 2 | 3 | 4 | 5;
export type Hand = 'L' | 'R';

export interface Fingering {
  finger: Finger;
  hand: Hand;
  /** Suggested by automatic fingering (shown with a dotted outline and an italic number). */
  suggested?: boolean;
}

export const FINGERS: readonly Finger[] = [1, 2, 3, 4, 5];

export const FINGER_NAMES: Record<Finger, string> = {
  1: 'thumb',
  2: 'index',
  3: 'middle',
  4: 'ring',
  5: 'little',
};

export function fingerColorVar(finger: Finger): string {
  return `var(--finger-${finger})`;
}

export function fingeringLabel({ finger, hand }: Fingering): string {
  return `${hand === 'L' ? 'Left' : 'Right'} hand, finger ${finger} (${FINGER_NAMES[finger]})`;
}
