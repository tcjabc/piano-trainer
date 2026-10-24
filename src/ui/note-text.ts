/**
 * Note names in UI text with real accidental glyphs. Chillax has no ♯/♭, so
 * accidentals are drawn with the SMuFL music font (Bravura) that VexFlow
 * already loads, sized and raised to sit with the text (see `.acc` in CSS).
 *
 * Use formatNoteName for any text that can contain note names or chord
 * symbols: "C#4", "Bb7/F", "Bbm7b5", "C7(#9)", "E♭ major", "That was not
 * it — play F#3".
 */

/** SMuFL code points (Standard Music Font Layout, "Standard accidentals"). */
const GLYPHS = {
  sharp: '\uE262',
  flat: '\uE260',
  natural: '\uE261',
  doubleSharp: '\uE263',
  doubleFlat: '\uE264',
} as const;

export type Accidental = keyof typeof GLYPHS;

const SPOKEN: Record<Accidental, string> = {
  sharp: 'sharp',
  flat: 'flat',
  natural: 'natural',
  doubleSharp: 'double sharp',
  doubleFlat: 'double flat',
};

const ACCIDENTALS: Record<string, Accidental> = {
  '##': 'doubleSharp',
  '\u{1D12A}': 'doubleSharp', // 𝄪
  bb: 'doubleFlat',
  '\u{1D12B}': 'doubleFlat', // 𝄫
  '#': 'sharp',
  '♯': 'sharp',
  b: 'flat',
  '♭': 'flat',
  '♮': 'natural',
};

/**
 * Either a note letter (at the start or after a non-letter, so words like
 * "Bob" are left alone) followed by an accidental, written in ASCII or
 * Unicode; or an altered extension in a chord symbol: ♭5 ♯5 ♭9 ♯9 ♯11 ♭13
 * after a digit or a bracket ("m7b5", "7#9", "7(b13)").
 */
const NOTE_ACCIDENTAL =
  /(^|[^A-Za-z])([A-G])(##|bb|\u{1D12A}|\u{1D12B}|#|♯|b|♭|♮)|([0-9(])(#|♯|b|♭)(?=(?:5|9|11|13)(?![0-9]))/gu;

/** Split text into plain runs and accidentals: "Bb7/F#" → ["B", flat, "7/F", sharp]. */
export function splitNoteText(text: string): (string | { accidental: Accidental })[] {
  const parts: (string | { accidental: Accidental })[] = [];
  let last = 0;
  for (const match of text.matchAll(NOTE_ACCIDENTAL)) {
    const [, before, letter, written, extBefore, extWritten] = match;
    // Kept before the glyph: the note letter, or the digit/bracket before an extension.
    const kept = letter ?? extBefore!;
    const start = match.index! + (letter ? before!.length : 0);
    const accidental = written ?? extWritten!;
    parts.push(text.slice(last, start) + kept, { accidental: ACCIDENTALS[accidental]! });
    last = start + kept.length + accidental.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** Text with every accidental after a note letter turned into a music-font glyph. */
export function formatNoteName(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const part of splitNoteText(text)) {
    fragment.append(typeof part === 'string' ? part : accidentalGlyph(part.accidental));
  }
  return fragment;
}

/** Scale degrees with glyph accidentals, joined by en dashes: ["1", "b3", "5"] → 1–♭3–5. */
export function formatDegrees(degrees: string[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  degrees.forEach((degree, i) => {
    if (i > 0) fragment.append('\u2013');
    const m = /^(bb|##|b|#)?(\d+)$/.exec(degree);
    const acc = m?.[1];
    if (acc) fragment.append(accidentalGlyph(ACCIDENTALS[acc]!));
    fragment.append(m ? m[2]! : degree);
  });
  return fragment;
}

/** One accidental as a glyph element, e.g. for building labels by hand. */
export function accidentalGlyph(accidental: Accidental): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = `acc acc-${accidental}`;
  span.textContent = GLYPHS[accidental];
  span.setAttribute('role', 'img');
  span.setAttribute('aria-label', SPOKEN[accidental]);
  return span;
}

/** Replace an element's content with formatted note text. */
export function setNoteText(el: HTMLElement, text: string): void {
  el.replaceChildren(formatNoteName(text));
}
