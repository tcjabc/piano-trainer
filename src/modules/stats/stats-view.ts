/**
 * The Stats tab: practice history worked out from the stored counters when
 * the tab opens. Days (streak, time, notes), the rankings for songs, chords
 * and scales, what has been chosen lately, and the keys and chords played.
 * Lists say plainly when there isn't enough yet. Achromatic: no colour here
 * except heat, which comes with the charts.
 */
import {
  ACCURACY_MIN_NOTES,
  ACCURACY_MIN_PLAYS,
  basics,
  favouriteChords,
  mostMistakenChords,
  preferredKeys,
  streaks,
  topAffinity,
  topConfusions,
  type RankedItem,
  type StatsData,
} from '../../core/stats-summary';
import { localDate } from '../../core/stats';
import type { StatsKind } from '../../core/storage';
import { h } from '../../ui/dom';
import { formatNoteName } from '../../ui/note-text';

/** "45 s", "12 min", "3 h 20 min". */
export function formatPracticeTime(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return `${Math.round(ms / 1000)} s`;
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} h ${rest} min` : `${minutes / 60} h`;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

const KIND_LABELS: Record<StatsKind, string> = { song: 'Song', chord: 'Chord', scale: 'Scale', section: 'Section' };

/** A name that may hold note names (chords, scales, keys) or not (song titles). */
function nameOf(item: RankedItem): Node | string {
  return item.record.kind === 'song' || item.record.kind === 'section' ? item.name : formatNoteName(item.name);
}

export class StatsView {
  readonly el: HTMLElement;
  private body: HTMLElement;

  constructor() {
    this.body = h('div.stats-body', null, h('p.muted', null, 'Loading…'));
    this.el = h('section.panel.stats-panel', { 'aria-labelledby': 'stats-title' }, h('h1.heading', { id: 'stats-title' }, 'Stats'), this.body);
  }

  update(data: StatsData, now: number): void {
    if (data.itemStats.length === 0 && data.dailyStats.length === 0) {
      this.body.replaceChildren(h('p.stats-empty.muted', null, 'Nothing recorded yet. Play, study or open a song, and your practice shows up here.'));
      return;
    }
    this.body.replaceChildren(
      this.days(data, localDate(now)),
      this.rankings(data, 'song', 'Songs'),
      this.rankings(data, 'chord', 'Chords'),
      this.rankings(data, 'scale', 'Scales'),
      this.lately(data, now),
      this.keysAndChords(data),
    );
  }

  private section(title: string, ...children: (HTMLElement | null)[]): HTMLElement {
    return h('div.stats-section', null, h('h2.subheading', null, title), ...children);
  }

  private days(data: StatsData, today: string): HTMLElement {
    const { current, longest } = streaks(data.dailyStats, today);
    const time = data.dailyStats.reduce((sum, d) => sum + d.practiceMs, 0);
    const notes = data.dailyStats.reduce((sum, d) => sum + d.notesPlayed, 0);
    const tile = (value: string, label: string) => h('div.stats-tile', null, h('span.stats-tile-value.num', null, value), h('span.stats-tile-label.muted', null, label));
    return h(
      'div.stats-tiles',
      null,
      tile(String(current), current === 1 ? 'day streak' : 'days streak'),
      tile(String(longest), 'longest streak'),
      tile(formatPracticeTime(time), 'practised'),
      tile(notes.toLocaleString(), 'notes played'),
    );
  }

  private rankings(data: StatsData, kind: 'song' | 'chord' | 'scale', title: string): HTMLElement {
    const b = basics(data, kind);
    return this.section(
      title,
      h(
        'div.stats-columns',
        null,
        ranking('Most played', b.mostPlayed, (v) => count(v, 'play'), 'Nothing yet.'),
        ranking('Most practised', b.mostPractised, formatPracticeTime, 'Nothing yet.'),
        ranking('Most accurate', b.mostAccurate, pct, `Needs ${ACCURACY_MIN_PLAYS} plays or ${ACCURACY_MIN_NOTES} notes.`),
      ),
    );
  }

  /** Affinity: what has been chosen lately, as bars against the top one. */
  private lately(data: StatsData, now: number): HTMLElement {
    const items = topAffinity(data, now);
    if (items.length === 0) return this.section('Lately', h('p.stats-empty.muted', null, 'Nothing chosen to practise lately.'));
    const top = items[0]!.value;
    return this.section(
      'Lately',
      h('p.stats-note.muted', null, 'What you choose to practise, recent time counting most.'),
      h(
        'ol.stats-list',
        null,
        ...items.map((item) =>
          h(
            'li.stats-row',
            null,
            h('span.stats-name', null, nameOf(item), h('span.stats-kind.muted', null, KIND_LABELS[item.record.kind])),
            h('span.stats-bar', { 'aria-hidden': 'true' }, h('span.stats-bar-fill', { style: `inline-size: ${Math.max(4, (100 * item.value) / top)}%` })),
          ),
        ),
      ),
    );
  }

  private keysAndChords(data: StatsData): HTMLElement {
    const keys = preferredKeys(data);
    const favourite = favouriteChords(data, 1)[0];
    const mistaken = mostMistakenChords(data, 1)[0];
    const confusions = topConfusions(data);
    const fact = (label: string, value: Node | string | null, detail: Node | string, empty: string) =>
      h(
        'div.stats-fact',
        null,
        h('h3.stats-ranking-title', null, label),
        value === null ? h('p.stats-empty.muted', null, empty) : h('p.stats-fact-value', null, value),
        value === null ? null : h('p.stats-fact-detail.muted', null, detail),
      );
    return this.section(
      'Keys and chords',
      h(
        'div.stats-columns',
        null,
        fact(
          'Preferred key',
          keys[0] ? formatNoteName(keys[0].key) : null,
          keys.length > 1 ? formatNoteName(`then ${keys.slice(1, 3).map((k) => k.key).join(', ')}`) : formatPracticeTime(keys[0]?.ms ?? 0),
          'Practise a song, or a major or minor scale.',
        ),
        fact('Favourite chord', favourite ? formatNoteName(favourite.symbol) : null, `held ${count(favourite?.count ?? 0, 'time')} in Play`, 'Hold a chord in Play.'),
        fact('Most missed chord', mistaken ? formatNoteName(mistaken.name) : null, count(mistaken?.value ?? 0, 'miss', 'misses'), 'No missed chords.'),
      ),
      h('h3.stats-ranking-title', null, 'Played instead'),
      confusions.length === 0
        ? h('p.stats-empty.muted', null, 'Nothing played instead of a chord yet.')
        : h(
            'ol.stats-list',
            null,
            ...confusions.map((c) =>
              h(
                'li.stats-row',
                null,
                h('span.stats-name', null, formatNoteName(c.target), h('span.muted', null, ' → '), formatNoteName(c.played)),
                h('span.stats-value.num', null, `×${c.count}`),
              ),
            ),
          ),
    );
  }
}

function ranking(title: string, items: RankedItem[], value: (v: number) => string, empty: string): HTMLElement {
  return h(
    'div.stats-ranking',
    null,
    h('h3.stats-ranking-title', null, title),
    items.length === 0
      ? h('p.stats-empty.muted', null, empty)
      : h('ol.stats-list', null, ...items.map((item) => h('li.stats-row', null, h('span.stats-name', null, nameOf(item)), h('span.stats-value.num', null, value(item.value))))),
  );
}
