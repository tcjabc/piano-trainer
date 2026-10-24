/**
 * VexFlow helpers: draw single notes or chords on a treble, bass or grand staff.
 * Output is an SVG that scales to its container. Colours come from CSS
 * (see .notation rules), so the drawing follows the theme.
 */
import {
  Accidental,
  Formatter,
  FretHandFinger,
  Modifier,
  Renderer,
  Stave,
  StaveConnector,
  StaveNote,
  Voice,
} from 'vexflow/bravura';
import type { Finger } from './fingering';
import { parseSpelling, spellingToMidi, type Clef } from './pitch';

export type StaffKind = Clef | 'grand';

export interface NotationNote {
  clef: Clef;
  /** One spelling for a single note, several for a chord, e.g. ["C4", "E4", "G4"]. */
  spellings: string[];
  /** Optional finger number per spelling (same order); drawn in the finger colours. */
  fingers?: (Finger | null)[];
}

/** A finger number wrapped in a group tagged with the finger, so CSS can colour it from --finger-N. */
class ColouredFinger extends FretHandFinger {
  constructor(private readonly finger: Finger) {
    super(String(finger));
    this.setFontSize(`${FINGER_FONT_SIZE}px`);
  }

  override draw(): void {
    const ctx = this.checkContext();
    const group = ctx.openGroup('fingering') as SVGGElement | undefined;
    group?.setAttribute('data-finger', String(this.finger));
    super.draw();
    ctx.closeGroup();
  }
}

const STAVE_WIDTH = 200;
const STAVE_X = 10;
const TOP_MARGIN = 30;
const STAVE_GAP = 80;
const SINGLE_HEIGHT = 150;
const GRAND_HEIGHT = 240;
/** Drawing height of a grand staff, for callers that size the stave to a box. */
export const GRAND_STAFF_HEIGHT = GRAND_HEIGHT;
/** Space left of the stave in the drawing (margin and brace). */
export const STAVE_MARGIN = 20;
/** Finger numbers on the staff, in drawing units (VexFlow's 9pt default is too small to read). */
const FINGER_FONT_SIZE = 17;
/** Vertical distance between stacked finger numbers. */
const FINGER_STACK_STEP = FINGER_FONT_SIZE;
/** Larger numbers need more room to clear the notehead (VexFlow spaces them for 9pt). */
const FINGER_ABOVE_SHIFT = -4;
const FINGER_BELOW_SHIFT = 8;

let fontsReady: Promise<unknown> | null = null;

/** Resolves once the Bravura music font is usable (it is bundled, so this works offline). */
export function notationReady(): Promise<unknown> {
  fontsReady ??= document.fonts.load('30px Bravura').catch(() => undefined);
  return fontsReady;
}

function vexKey(spelling: string): { key: string; accidental: string } {
  const s = parseSpelling(spelling);
  return { key: `${s.letter.toLowerCase()}${s.accidental}/${s.octave}`, accidental: s.accidental };
}

function makeNote(note: NotationNote): StaveNote {
  // Work low to high so key indices match VexFlow's pitch order.
  const order = note.spellings.map((_, i) => i).sort((a, b) => spellingToMidi(note.spellings[a]!) - spellingToMidi(note.spellings[b]!));
  const keys = order.map((i) => vexKey(note.spellings[i]!));
  const fingers = order.map((i) => note.fingers?.[i] ?? null);
  const staveNote = new StaveNote({ clef: note.clef, keys: keys.map((k) => k.key), duration: 'w' });
  keys.forEach((k, i) => {
    if (k.accidental) staveNote.addModifier(new Accidental(k.accidental), i);
  });
  addFingering(staveNote, note.clef, fingers);
  return staveNote;
}

/**
 * Finger numbers stacked above the note (treble) or below it (bass), read
 * top to bottom in the same order as the notes.
 */
function addFingering(staveNote: StaveNote, clef: Clef, fingers: (Finger | null)[]): void {
  const fingered = fingers.flatMap((f, i) => (f ? [{ finger: f, index: i }] : []));
  if (fingered.length === 0) return;
  const above = clef === 'treble';
  const anchor = above ? fingers.length - 1 : 0;
  fingered.forEach(({ finger }, rank) => {
    // Above: the lowest note's number sits nearest the chord; below: the highest note's.
    const step = above ? -rank : fingered.length - 1 - rank;
    staveNote.addModifier(
      new ColouredFinger(finger)
        .setPosition(above ? Modifier.Position.ABOVE : Modifier.Position.BELOW)
        .setYShift(step * FINGER_STACK_STEP + (above ? FINGER_ABOVE_SHIFT : FINGER_BELOW_SHIFT)),
      anchor,
    );
  });
}

/** VexFlow left-aligns a lone note just after the clef; move it to the middle of the stave. */
function centreSingleNote(notes: StaveNote[], stave: Stave): void {
  if (notes.length !== 1) return;
  const note = notes[0]!;
  const middle = (stave.getNoteStartX() + stave.getNoteEndX()) / 2;
  // Move the whole tick context so accidentals travel with the notehead.
  const context = note.getTickContext();
  const x = stave.getNoteStartX() + context.getX();
  context.setX(context.getX() + middle - x - note.getGlyphWidth() / 2);
}

/**
 * Render notes into `container`, replacing what was there. Notes on a clef
 * that is not shown are ignored.
 */
export function drawStaff(
  container: HTMLElement,
  staff: StaffKind,
  notes: NotationNote[],
  { staveWidth = STAVE_WIDTH }: { staveWidth?: number } = {},
): void {
  container.replaceChildren();
  const height = staff === 'grand' ? GRAND_HEIGHT : SINGLE_HEIGHT;
  const width = staveWidth + STAVE_X * 2;
  const renderer = new Renderer(container as HTMLDivElement, Renderer.Backends.SVG);
  renderer.resize(width, height);
  const ctx = renderer.getContext();
  ctx.setFillStyle('currentColor');
  ctx.setStrokeStyle('currentColor');

  const staves: Partial<Record<Clef, Stave>> = {};
  if (staff === 'grand') {
    staves.treble = new Stave(STAVE_X + 20, TOP_MARGIN - 10, staveWidth - 20).addClef('treble');
    staves.bass = new Stave(STAVE_X + 20, TOP_MARGIN - 10 + STAVE_GAP, staveWidth - 20).addClef('bass');
  } else {
    staves[staff] = new Stave(STAVE_X, TOP_MARGIN, staveWidth).addClef(staff);
  }
  for (const s of Object.values(staves)) s.setContext(ctx).draw();

  if (staves.treble && staves.bass) {
    new StaveConnector(staves.treble, staves.bass).setType('brace').setContext(ctx).draw();
    new StaveConnector(staves.treble, staves.bass).setType('singleLeft').setContext(ctx).draw();
  }

  for (const clef of ['treble', 'bass'] as const) {
    const stave = staves[clef];
    const forClef = notes.filter((n) => n.clef === clef);
    if (!stave || forClef.length === 0) continue;
    const staveNotes = forClef.map(makeNote);
    const voice = new Voice({ numBeats: 4, beatValue: 4 }).setStrict(false);
    voice.addTickables(staveNotes);
    new Formatter().joinVoices([voice]).formatToStave([voice], stave);
    centreSingleNote(staveNotes, stave);
    voice.draw(ctx, stave);
  }

  const svg = container.querySelector('svg');
  if (svg) {
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.removeAttribute('style');
    svg.setAttribute('role', 'img');
    svg.setAttribute('class', 'notation');
  }
}
