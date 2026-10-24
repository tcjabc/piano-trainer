/**
 * Which part of the keyboard is in view. Positions are in white-key units
 * (0 = left edge of A0); `first` is the left edge of the view.
 */

export interface Viewport {
  /** Left edge of the view. */
  first: number;
  /** Number of white keys in view. */
  visible: number;
  /** Scroll bounds: left edge of the lowest key and right edge of the highest. */
  lo: number;
  hi: number;
}

/** Fully zoomed in shows about two octaves. */
export const MIN_VISIBLE_WHITE = 15;

/**
 * White keys in view for a zoom level: 0 fits the full range, 1 shows about
 * two octaves. Interpolated geometrically so each zoom step feels the same.
 */
export function visibleForZoom(full: number, zoom: number): number {
  const min = Math.min(MIN_VISIBLE_WHITE, full);
  const z = Math.min(1, Math.max(0, zoom));
  return full * (min / full) ** z;
}

export function clampFirst(first: number, visible: number, lo: number, hi: number): number {
  return Math.min(Math.max(first, lo), Math.max(lo, hi - visible));
}

/** Keep this much room between a revealed key and the edge of the view. */
function margin(visible: number): number {
  return Math.min(2, visible * 0.12);
}

function inComfortZone(view: Viewport, at: number): boolean {
  const m = margin(view.visible);
  return at >= view.first + m && at <= view.first + view.visible - m;
}

/**
 * Where to scroll so `at` (a key centre) is comfortably in view. Returns the
 * current `first` when no scroll is needed, so nearby notes don't make the
 * view jump. Otherwise the key is centred, which leaves room for the notes
 * that usually follow. If `keep` is given (the current card's note), the
 * result keeps it in view as well, and `keep` wins if both can't fit.
 */
export function revealFirst(view: Viewport, at: number, keep: number | null = null): number {
  if (inComfortZone(view, at)) return view.first;
  const m = margin(view.visible);
  let first = at - view.visible / 2;
  if (keep !== null) {
    const lowest = keep - view.visible + m;
    const highest = keep - m;
    first = Math.min(Math.max(first, lowest), highest);
  }
  return clampFirst(first, view.visible, view.lo, view.hi);
}
