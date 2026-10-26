// @vitest-environment happy-dom
/**
 * Song time reaches the day's practice time (and the song's and section's)
 * the way the app drives it: a stats session for the song, then each key
 * press goes to the recorder and the player. Listening doesn't count.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type SongSettings } from '../../core/settings';
import type { SongData, SongNote } from '../../core/song';
import { localDate, sectionStatsId, songStatsId } from '../../core/stats';
import { IDLE_MS, stats } from '../../core/stats-recorder';
import type { Keyboard } from '../../ui/keyboard';
import { FallingNotes } from './falling-notes';
import { PlayerView } from './player-view';
import type { SongEntry } from './song-store';

// No sound or metronome clicks in tests.
vi.mock('../../core/audio', () => {
  const quiet = () => new Proxy({}, { get: (_, key) => (key === 'settings' ? DEFAULT_SETTINGS.metronome : key === 'running' ? false : () => null) });
  return { audio: quiet(), metronome: quiet() };
});

const note = (midi: number, beat: number): SongNote => ({ id: `n${beat}`, midi, beat, duration: 1, hand: 'R', finger: null, velocity: 0.7 });
const data: SongData = {
  notes: [60, 62, 64, 65, 67, 65, 64, 62].map((m, i) => note(m, i)),
  measures: [{ label: '1', beat: 0, length: 4 }, { label: '2', beat: 4, length: 4 }],
  tempos: [{ beat: 0, bpm: 60 }],
  timeSignature: [4, 4],
  key: 'C major',
};
const T0 = new Date(2026, 9, 26, 10).getTime();

let n = 0;
let songId = '';
let view: PlayerView;

/** A fresh song each time, so its stats start from nothing. */
function entry(): SongEntry {
  songId = `test-${++n}`;
  const now = Date.now();
  return {
    song: {
      id: songId,
      title: 'Test',
      artist: '',
      format: 'midi',
      fileName: 'test.mid',
      musicXml: null,
      data,
      sections: [{ id: 'a', name: 'Bar 1', start: 0, end: 1 }, { id: 'b', name: 'Bar 2', start: 1, end: 2 }],
      bundled: null,
      createdAt: now,
      updatedAt: now,
    },
    progress: new Map(),
  };
}

const keyboard = new Proxy({}, { get: () => () => undefined }) as unknown as Keyboard;
const actions = {
  back: () => undefined,
  played: () => undefined,
  settingsChanged: () => undefined,
  handShown: () => undefined,
  reviewState: async () => ({ inReview: false, due: null }),
  toggleReview: async () => undefined,
};

const at = (seconds: number) => vi.setSystemTime(T0 + seconds * 1000);
/** A key pressed, as the app routes it: to the recorder, then the player. */
const press = (seconds: number, midi = 60) => {
  at(seconds);
  stats.notePlayed(midi);
  view.noteOn(midi, performance.now());
};
const day = () => stats.unsaved.daily.get(localDate(T0))?.practiceMs ?? 0;
const item = (id: string) => stats.unsaved.items.get(id)?.practiceMs ?? 0;

/** Open a song in the player as the app does: the stats session starts, then the player is shown. */
function open(mode: SongSettings['mode']): void {
  view = new PlayerView(keyboard, actions);
  view.open(entry(), { ...DEFAULT_SETTINGS.songs, mode, countIn: false }, 'right', 'rainbow');
  stats.start({ voluntary: true }, view.statsFocus());
  view.activate();
}

/** Leave the player, then measure: the day's time, and the song's and section's. */
function leave(seconds: number): { day: number; song: number; section: number } {
  at(seconds);
  view.deactivate();
  stats.end();
  return { day: day(), song: item(songStatsId(songId)), section: item(sectionStatsId(songId, 'a')) };
}

let dayBefore = 0;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at(0);
  vi.spyOn(FallingNotes.prototype, 'draw').mockImplementation(() => undefined);
  dayBefore = day();
});

afterEach(() => {
  view.deactivate();
  stats.end();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('song time in the stats', () => {
  it('counts wait mode towards the day, the song and the section', () => {
    open('wait');
    view.togglePlay();
    press(2, 60);
    press(5, 62);
    press(9, 64);
    const t = leave(12);
    expect(t.day - dayBefore).toBe(12_000);
    expect(t.song).toBe(12_000);
    expect(t.section).toBe(12_000);
  });

  it('counts play-along towards the day, the song and the section', () => {
    open('play-along');
    view.togglePlay();
    press(1, 60);
    press(2, 62);
    press(3, 64);
    const t = leave(4);
    expect(t.day - dayBefore).toBe(4_000);
    expect(t.song).toBe(4_000);
    expect(t.section).toBe(4_000);
  });

  it("doesn't count listen mode while the app plays, even with keys pressed along", () => {
    open('listen');
    view.togglePlay();
    press(2, 60);
    press(5, 62);
    press(9, 64);
    const t = leave(12);
    expect(t.day - dayBefore).toBe(0);
    expect(t.song).toBe(0);
  });

  it('counts again once listening stops, and switching to listen mid-song stops it', () => {
    open('wait');
    view.togglePlay();
    press(2);
    press(4); // 4 s in wait mode
    at(6);
    view.toggleWait(); // play-along: 2 more
    press(7); // 1 more
    at(8);
    (view as unknown as { setSetting(p: Partial<SongSettings>): void }).setSetting({ mode: 'listen' }); // 1 more, then none
    press(15);
    at(20);
    view.togglePlay(); // paused: you're playing again
    press(23); // 3 s from the pause
    const t = leave(24); // 1 more
    expect(t.day - dayBefore).toBe((4 + 2 + 1 + 1 + 3 + 1) * 1000);
  });

  it('pauses after 30 s without a key, and while the tab is hidden', () => {
    open('wait');
    view.togglePlay();
    press(2);
    press(10); // 10 s
    press(10 + IDLE_MS / 1000 + 5); // idle: none of these 35 s
    press(50); // 5 s
    at(53);
    stats.setHidden(true); // 3 s
    at(200);
    stats.setHidden(false);
    press(204); // 4 s
    const t = leave(205); // 1 s
    expect(t.day - dayBefore).toBe((10 + 5 + 3 + 4 + 1) * 1000);
    expect(t.song).toBe(23_000);
  });
});
