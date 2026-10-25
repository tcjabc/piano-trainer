/**
 * The Stats tab: practice history worked out from the stored counters when
 * the tab opens. Days (streak, time, notes, a calendar), the rankings for
 * songs, chords and scales, what has been chosen lately, the keys and chords
 * played, a heatmap of keys pressed, and a song's trouble bars, clean-tempo
 * progress and accuracy by hand. Lists say plainly when there isn't enough
 * yet. Achromatic, except heat (keys, days, missed bars).
 */
import {
  ACCURACY_MIN_NOTES,
  ACCURACY_MIN_PLAYS,
  basics,
  calendar,
  favouriteChords,
  keyHeat,
  mostMistakenChords,
  preferredKeys,
  songDetail,
  streaks,
  topAffinity,
  topConfusions,
  type RankedItem,
  type StatsData,
} from '../../core/stats-summary';
import { midiToName, PIANO_HIGH, PIANO_LOW } from '../../core/pitch';
import { localDate } from '../../core/stats';
import type { StatsKind } from '../../core/storage';
import { h } from '../../ui/dom';
import { Keyboard } from '../../ui/keyboard';
import { formatNoteName } from '../../ui/note-text';
import { calendarChart, sparkline } from './charts';

export interface StatsActions {
  /** Practise a song's measure: looped within its section, or as a section of its own. */
  practiseBar: (songId: string, measure: number, ownSection: boolean) => void;
}

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

const empty = (text: string) => h('p.stats-empty.muted', null, text);

/** "Sat 24 Oct". */
const dayLabel = (date: string) => new Date(`${date}T12:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

const KIND_LABELS: Record<StatsKind, string> = { song: 'Song', chord: 'Chord', scale: 'Scale', section: 'Section' };

/** A name that may hold note names (chords, scales, keys) or not (song titles). */
function nameOf(item: RankedItem): Node | string {
  return item.record.kind === 'song' || item.record.kind === 'section' ? item.name : formatNoteName(item.name);
}

export class StatsView {
  readonly el: HTMLElement;
  private body: HTMLElement;
  /** A keyboard of its own for the heatmap (the app's keeps showing what is played). */
  private keyboard = new Keyboard();
  /** The song shown in detail. */
  private songId: string | null = null;

  constructor(private actions: StatsActions) {
    this.body = h('div.stats-body', null, h('p.muted', null, 'Loading…'));
    this.el = h('section.panel.stats-panel', { 'aria-labelledby': 'stats-title' }, h('h1.heading', { id: 'stats-title' }, 'Stats'), this.body);
  }

  update(data: StatsData, now: number): void {
    if (data.itemStats.length === 0 && data.dailyStats.length === 0) {
      this.body.replaceChildren(h('p.stats-empty.muted', null, 'Nothing recorded yet. Play, study or open a song, and your practice shows up here.'));
      return;
    }
    const today = localDate(now);
    this.body.replaceChildren(
      this.days(data, today),
      this.calendar(data, today),
      this.rankings(data, 'song', 'Songs'),
      this.songDetailSection(data),
      this.rankings(data, 'chord', 'Chords'),
      this.rankings(data, 'scale', 'Scales'),
      this.lately(data, now),
      this.keysAndChords(data),
      this.keysPressed(data),
    );
  }

  private calendar(data: StatsData, today: string): HTMLElement {
    const describe = (d: { date: string; practiceMs: number }) => `${dayLabel(d.date)}: ${d.practiceMs > 0 ? formatPracticeTime(d.practiceMs) : 'no practice'}`;
    return this.section('Days', h('div.stats-chart', null, calendarChart(calendar(data.dailyStats, today), describe)));
  }

  /** Every key pressed, anywhere in the app, as heat on a keyboard. */
  private keysPressed(data: StatsData): HTMLElement {
    const heat = keyHeat(data.keyHits);
    if (heat.size === 0) return this.section('Keys pressed', empty('No keys pressed yet.'));
    const notes = [...heat.keys()];
    // The 61 keys of a usual keyboard (C2–C7), wider when keys beyond were pressed.
    this.keyboard.setRange(Math.min(36, ...notes), Math.max(96, ...notes));
    for (let note = PIANO_LOW; note <= PIANO_HIGH; note++) {
      const k = heat.get(note);
      this.keyboard.setHeat(note, k ? k.heat : null, k ? `${midiToName(note)}: ${count(k.count, 'press', 'presses')}` : '');
    }
    return this.section('Keys pressed', h('div.stats-keyboard', null, this.keyboard.el));
  }

  /** One song at a time (most practised first): trouble bars, clean-tempo progress, hands. */
  private songDetailSection(data: StatsData): HTMLElement {
    const practised = (id: string) => data.itemStats.find((r) => r.kind === 'song' && r.songId === id)?.practiceMs ?? 0;
    const songs = data.songs
      .filter((s) => practised(s.id) > 0 || data.songMeasureMisses.some((m) => m.songId === s.id))
      .sort((a, b) => practised(b.id) - practised(a.id));
    if (songs.length === 0) return this.section('Song detail', empty('Play a song to see its trouble bars, tempo and hands.'));
    if (!songs.some((s) => s.id === this.songId)) this.songId = songs[0]!.id;
    const detail = h('div.stats-song-detail');
    const select = h(
      'select.control.stats-song-select',
      {
        'aria-label': 'Song',
        onchange: () => {
          this.songId = select.value;
          detail.replaceChildren(...this.songDetail(data, select.value));
        },
      },
      ...songs.map((s) => h('option', { value: s.id, selected: s.id === this.songId }, s.title)),
    );
    detail.replaceChildren(...this.songDetail(data, this.songId!));
    return this.section('Song detail', select, detail);
  }

  private songDetail(data: StatsData, songId: string): HTMLElement[] {
    const detail = songDetail(data, songId);
    const song = data.songs.find((s) => s.id === songId);
    if (!detail || !song) return [];
    const sectionName = (id: string | null) => (id === null ? 'Whole song' : (song.sections.find((s) => s.id === id)?.name ?? ''));
    const most = Math.max(1, ...detail.trouble.map((t) => t.misses));
    const trouble = h(
      'div.stats-ranking',
      null,
      h('h3.stats-ranking-title', null, 'Trouble bars'),
      detail.trouble.length === 0
        ? empty('No misses yet.')
        : h(
            'ol.stats-list',
            null,
            ...detail.trouble.map((t) =>
              h(
                'li.stats-row.stats-trouble',
                null,
                h('span.stats-name', null, `Bar ${t.label}`),
                h('span.stats-bar', { 'aria-hidden': 'true' }, h('span.stats-bar-fill.is-heat', { style: `inline-size: ${Math.max(4, (100 * t.misses) / most)}%` })),
                h('span.stats-value.num', null, count(t.misses, 'miss', 'misses')),
                h(
                  'span.stats-actions',
                  null,
                  h('button.button-outline', { type: 'button', title: `Loop bar ${t.label} within its section`, onclick: () => this.actions.practiseBar(songId, t.measure, false) }, 'Loop'),
                  h('button.button-outline', { type: 'button', title: `Make bar ${t.label} a section of its own and practise it`, onclick: () => this.actions.practiseBar(songId, t.measure, true) }, 'Own section'),
                ),
              ),
            ),
          ),
    );
    const tempo = h(
      'div.stats-ranking',
      null,
      h('h3.stats-ranking-title', null, 'Clean tempo'),
      detail.tempo.length === 0
        ? empty('No clean pass yet (hands together, play-along).')
        : h(
            'ol.stats-list',
            null,
            ...detail.tempo.map(({ sectionId, points }) =>
              h(
                'li.stats-row',
                null,
                h('span.stats-name', null, sectionName(sectionId)),
                sparkline(points.map((p) => p.tempo)),
                h('span.stats-value.num', null, pct(points[points.length - 1]!.tempo)),
              ),
            ),
          ),
    );
    const handRow = (label: string, value: number | null) =>
      h(
        'li.stats-row',
        null,
        h('span.stats-name', null, label),
        h('span.stats-bar', { 'aria-hidden': 'true' }, value === null ? null : h('span.stats-bar-fill', { style: `inline-size: ${100 * value}%` })),
        h('span.stats-value.num', null, value === null ? '–' : pct(value)),
      );
    const hands = h(
      'div.stats-ranking',
      null,
      h('h3.stats-ranking-title', null, 'Accuracy by hand'),
      detail.hands.L === null && detail.hands.R === null
        ? empty('No notes judged yet.')
        : h('ol.stats-list', null, handRow('Left hand', detail.hands.L), handRow('Right hand', detail.hands.R)),
    );
    return [trouble, h('div.stats-columns', null, tempo, hands)];
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
