import { describe, expect, it } from 'vitest';
import { clampFirst, MIN_VISIBLE_WHITE, revealFirst, visibleForZoom, type Viewport } from './keyboard-viewport';

describe('visibleForZoom', () => {
  it('fits the full range at 0 and about two octaves at 1', () => {
    expect(visibleForZoom(36, 0)).toBe(36);
    expect(visibleForZoom(36, 1)).toBeCloseTo(MIN_VISIBLE_WHITE);
    const mid = visibleForZoom(36, 0.5);
    expect(mid).toBeGreaterThan(MIN_VISIBLE_WHITE);
    expect(mid).toBeLessThan(36);
  });

  it('never zooms past a range smaller than two octaves', () => {
    expect(visibleForZoom(10, 1)).toBe(10);
  });
});

describe('clampFirst', () => {
  it('keeps the view inside the range', () => {
    expect(clampFirst(-3, 15, 0, 36)).toBe(0);
    expect(clampFirst(30, 15, 0, 36)).toBe(21);
    expect(clampFirst(5, 40, 0, 36)).toBe(0);
  });
});

describe('revealFirst', () => {
  const view: Viewport = { first: 10, visible: 15, lo: 0, hi: 36 };

  it('does not scroll for a key already comfortably in view', () => {
    expect(revealFirst(view, 12.5)).toBe(10);
    expect(revealFirst(view, 22.5)).toBe(10);
  });

  it('centres a key that is out of view', () => {
    expect(revealFirst(view, 25.5)).toBeCloseTo(18);
    // Near the ends the view stops at the range bounds.
    expect(revealFirst(view, 33.5)).toBe(21);
    expect(revealFirst(view, 1.5)).toBe(0);
  });

  it('keeps the card note in view when revealing a played key', () => {
    const first = revealFirst(view, 35.5, 12.5);
    expect(12.5).toBeGreaterThanOrEqual(first);
    expect(12.5).toBeLessThanOrEqual(first + view.visible);
  });
});
