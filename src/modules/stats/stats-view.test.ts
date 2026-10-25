// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ACTIONS } from '../../core/controls';
import { newItemStats } from '../../core/stats';
import type { StatsData } from '../../core/stats-summary';
import { calendarChart, sparkline } from './charts';
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
    const view = new StatsView({ practiseBar: () => undefined });
    view.update(empty, NOW);
    expect(text(view.el)).toContain('Nothing recorded yet');
  });

  it('shows rankings, days and confusions, and says where there is too little', () => {
    const view = new StatsView({ practiseBar: () => undefined });
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

  it('shows a song’s trouble bars with buttons to practise them, its tempo and hands, and key heat', () => {
    const asked: [string, number, boolean][] = [];
    const view = new StatsView({ practiseBar: (songId, measure, own) => void asked.push([songId, measure, own]) });
    const counts = new Array<number>(88).fill(0);
    counts[60 - 21] = 40;
    counts[64 - 21] = 4;
    view.update(
      {
        ...empty,
        songs: [{
          id: 'a', title: 'Ode', sections: [{ id: 's0', name: 'Bars 1–4', start: 0, end: 4 }],
          data: { notes: [], measures: [0, 1, 2, 3].map((i) => ({ label: String(i + 1), beat: i * 4, length: 4 })), tempos: [], timeSignature: [4, 4], key: 'C major' },
        }],
        itemStats: [{ ...newItemStats('song:a', 'song', 'a', NOW), plays: 2, practiceMs: 60_000, hands: { L: { hits: 3, misses: 1 }, R: { hits: 0, misses: 0 } } }],
        songMeasureMisses: [{ id: 'a:2', songId: 'a', measure: 2, misses: 6, updatedAt: NOW }],
        songTempoBests: [{ id: 't', songId: 'a', sectionId: 's0', bestCleanTempo: 0.7, at: NOW, updatedAt: NOW }],
        keyHits: { id: 'lifetime', low: 21, counts, updatedAt: NOW },
        dailyStats: [{ id: '2026-10-26', practiceMs: 60_000, notesPlayed: 44, updatedAt: NOW }],
      },
      NOW,
    );
    const all = text(view.el);
    expect(all).toContain('Bar 3');
    expect(all).toContain('6 misses');
    expect(all).toContain('70%'); // clean tempo of Bars 1–4
    expect(all).toContain('75%'); // left hand
    const [loop, own] = [...view.el.querySelectorAll<HTMLButtonElement>('.stats-actions button')];
    loop!.click();
    own!.click();
    expect(asked).toEqual([['a', 2, false], ['a', 2, true]]);
    const heated = [...view.el.querySelectorAll<HTMLElement>('.stats-keyboard .has-heat')].map((k) => [k.dataset.note, k.style.getPropertyValue('--heat')]);
    expect(heated.map(([note]) => note)).toEqual(['60', '64']);
    expect(heated[0]![1]).toBe('1');
  });
});

describe('Stats charts', () => {
  it('draws a calendar of whole weeks with a heat level per day', () => {
    const days = Array.from({ length: 14 }, (_, i) => ({ date: `2026-10-${String(12 + i).padStart(2, '0')}`, practiceMs: i * 1000, level: (i % 5) as 0 | 1 | 2 | 3 | 4 }));
    const chart = calendarChart(days, (d) => d.date);
    const cells = [...chart.querySelectorAll('rect')];
    expect(cells).toHaveLength(14);
    expect(cells[3]!.getAttribute('class')).toBe('stats-heat-3');
    expect(cells[7]!.getAttribute('x')).not.toBe(cells[6]!.getAttribute('x')); // a new week, a new column
    expect(cells[0]!.querySelector('title')?.textContent).toBe('2026-10-12');
  });

  it('draws a sparkline up to at least 100%', () => {
    const line = sparkline([0.5, 0.6, 0.8], 1, 100, 20);
    const points = line.querySelector('polyline')!.getAttribute('points')!.split(' ').map((p) => p.split(',').map(Number));
    expect(points).toHaveLength(3);
    expect(points[2]![1]!).toBeLessThan(points[0]![1]!); // faster is higher
    expect(line.querySelector('circle')).not.toBeNull();
    expect(sparkline([0.7]).querySelector('polyline')).toBeNull();
  });
});
