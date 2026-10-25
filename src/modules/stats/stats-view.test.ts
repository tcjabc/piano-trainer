// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ACTIONS } from '../../core/controls';
import { newItemStats } from '../../core/stats';
import type { StatsData } from '../../core/stats-summary';
import { formatPracticeTime, StatsView } from './stats-view';

const NOW = new Date(2026, 9, 26, 12).getTime();

const empty: StatsData = {
  itemStats: [],
  dailyStats: [],
  chordPlayCounts: [],
  confusions: [],
  keyHits: null,
  songMeasureMisses: [],
  songTempoBests: [],
  songs: [],
};

const text = (el: HTMLElement) => el.textContent?.replace(/\s+/g, ' ') ?? '';

describe('Stats tab', () => {
  it('says so when nothing has been recorded', () => {
    const view = new StatsView();
    view.update(empty, NOW);
    expect(text(view.el)).toContain('Nothing recorded yet');
  });

  it('shows rankings, days and confusions, and says where there is too little', () => {
    const view = new StatsView();
    view.update(
      {
        ...empty,
        dailyStats: [{ id: '2026-10-26', practiceMs: 25 * 60_000, notesPlayed: 1234, updatedAt: NOW }],
        itemStats: [{ ...newItemStats('chord:C:maj7', 'chord', null, NOW), plays: 3, practiceMs: 90_000, hits: 4, misses: 9 }],
        confusions: [{ id: 'chord:C:maj7>C7', targetId: 'chord:C:maj7', playedSymbol: 'C7', count: 9, updatedAt: NOW }],
      },
      NOW,
    );
    const all = text(view.el);
    const tiles = [...view.el.querySelectorAll('.stats-tile')].map((t) => [t.children[0]!.textContent, t.children[1]!.textContent]);
    expect(tiles).toEqual([['1', 'day streak'], ['1', 'longest streak'], ['25 min', 'practised'], [(1234).toLocaleString(), 'notes played']]);
    expect(all).toContain('3 plays');
    expect(all).toContain('Needs 5 plays or 200 notes.'); // C maj7 has neither
    expect(all).toContain('9 misses');
    expect(all).toContain('×9');
    expect(all).toContain('Hold a chord in Play.');
    expect(all).toContain('Nothing chosen to practise lately.');
  });

  it('formats practice time', () => {
    expect(formatPracticeTime(45_000)).toBe('45 s');
    expect(formatPracticeTime(12 * 60_000)).toBe('12 min');
    expect(formatPracticeTime(120 * 60_000)).toBe('2 h');
    expect(formatPracticeTime(200 * 60_000)).toBe('3 h 20 min');
  });

  it('opens with S, with Settings moved to Q', () => {
    expect(ACTIONS.find((a) => a.id === 'area-stats')?.hotkey).toBe('S');
    expect(ACTIONS.find((a) => a.id === 'settings')?.hotkey).toBe('Q');
    expect(ACTIONS.filter((a) => a.hotkey === 'S' || a.hotkey === 'Q')).toHaveLength(2);
  });
});
