/**
 * The song player: falling notes or the score, the transport (play/pause,
 * restart, mode, tempo, loop), the sections with their step on the learning
 * path, stats and review status, and fingering edits (click a falling note
 * while stopped). The keyboard always shows the next keys to play, with
 * finger numbers where they're known.
 *
 * The hands played here are the player's own choice (it starts from the
 * hand legend's), so practising a left-hand step never changes Study.
 *
 * Also used, stripped down, for a section's review card in Study.
 * Every judged note and pass goes to the stats (see song-stats.ts); while
 * it plays the song to you (listen mode), the time isn't practice.
 */
import type { Finger } from '../../core/fingering';
import type { ItemRef } from '../../core/stats';
import { stats } from '../../core/stats-recorder';
import type { HandChoice, SongSettings, VisualiserColors } from '../../core/settings';
import { notesIn, sectionBeats, songEndBeat, measureAt, type Section, type SongNote } from '../../core/song';
import { applyPass, describeStep, LEARNED, requirement, type SongMode } from '../../core/song-learning';
import { isolateMeasure, mergeWithNext, splitSection } from '../../core/song-sections';
import { setXmlFingering, withXmlFingeringText } from '../../core/song-musicxml';
import { withoutSuggestedFingering, withSuggestedFingering } from '../../core/autofinger';
import { h, icon } from '../../ui/dom';
import { FormBuilder } from '../../ui/form';
import type { Keyboard } from '../../ui/keyboard';
import { formatNoteName } from '../../ui/note-text';
import { FallingNotes } from './falling-notes';
import { NotationView } from './notation-view';
import { MAX_TEMPO, MIN_TEMPO, SongPlayer, type PassReport, type PlayerConfig } from './song-player';
import { recordMark, recordPass, songStatsRefs } from './song-stats';
import { progressOf, saveProgress, saveSong, type SongEntry } from './song-store';

export interface PlayerActions {
  back: () => void;
  /** Played in (a key pressed, or play started): the song and section (null: the whole song), for Continue. */
  played: (songId: string, sectionId: string | null) => void;
  /** Settings changed here (view, mode, tempo, …), to be saved. */
  settingsChanged: (settings: SongSettings) => void;
  /** The player's hand changed: show it on the hand legend (nothing is saved). */
  handShown: (hand: HandChoice) => void;
  /** Whether a section is in review, and add/remove it. */
  reviewState: (songId: string, sectionId: string) => Promise<{ inReview: boolean; due: string | null }>;
  toggleReview: (songId: string, sectionId: string) => Promise<void>;
}

/** Tempo change per press of , and . */
const TEMPO_STEP = 0.05;
const HAND_NAMES: Record<HandChoice, string> = { left: 'Left hand', right: 'Right hand', both: 'Hands together' };
const MODE_NAMES: Record<SongMode, string> = { wait: 'Wait', 'play-along': 'Play-along', listen: 'Listen' };

const pct = (t: number) => `${Math.round(t * 100)}%`;

export class PlayerView {
  readonly el: HTMLElement;
  private head: HTMLElement;
  private transport: HTMLElement;
  private sectionsEl: HTMLElement;
  private infoEl: HTMLElement;
  private resultEl: HTMLElement;
  private statusEl: HTMLElement;
  private fingeringNote: HTMLElement;
  private viewEl: HTMLElement;
  private fingerMenu: HTMLElement;
  private falling: FallingNotes;
  private notation = new NotationView();
  private form = new FormBuilder('song');

  private entry: SongEntry | null = null;
  private settings!: SongSettings;
  private hand: HandChoice = 'right';
  /** Hands chosen in the player this session; until then it starts from the hand legend's. */
  private chosenHand: HandChoice | null = null;
  /** Review card: the mode to go back to after hearing the section first (H). */
  private previewing: SongMode | null = null;
  private preset: VisualiserColors = 'rainbow';
  private player: SongPlayer | null = null;
  /** Selected section id, or null for the whole song. */
  private section: string | null = null;
  private loopAB: { a: number | null; b: number | null } = { a: null, b: null };
  private raf = 0;
  private active = false;
  private keysShown = '';
  private litShown = new Set<number>();
  private review: { sectionId: string; done: (pass: PassReport) => void } | null = null;
  private renaming = false;

  constructor(
    private keyboard: Keyboard,
    private actions: PlayerActions,
  ) {
    this.falling = new FallingNotes(keyboard);
    this.head = h('div.song-head');
    this.transport = h('div.song-transport');
    this.sectionsEl = h('div.song-sections', { role: 'tablist', 'aria-label': 'Sections' });
    this.infoEl = h('div.song-section-info');
    this.resultEl = h('p.song-result', { role: 'status', 'aria-live': 'polite' });
    this.statusEl = h('p.song-status.num');
    this.fingeringNote = h('p.song-fingering-note.muted');
    this.fingerMenu = h('div.finger-menu', { hidden: true, role: 'menu', 'aria-label': 'Finger' });
    this.viewEl = h('div.song-view');
    this.el = h(
      'section.song-player',
      { 'aria-label': 'Song' },
      h('div.song-controls', null, this.head, this.transport, this.sectionsEl, this.infoEl, h('div.song-lines', null, this.statusEl, this.fingeringNote, this.resultEl)),
      this.viewEl,
    );
    this.falling.el.addEventListener('click', (e) => this.editFinger(e));
    document.addEventListener('pointerdown', (e) => {
      if (!this.fingerMenu.hidden && !this.fingerMenu.contains(e.target as Node)) this.fingerMenu.hidden = true;
    });
  }

  get songId(): string | null {
    return this.entry?.song.id ?? null;
  }

  /** The hands being practised here. */
  get currentHand(): HandChoice {
    return this.hand;
  }

  get playing(): boolean {
    return this.player?.phase === 'playing' || this.player?.phase === 'counting-in';
  }

  // ── Opening ──────────────────────────────────────────────────────────

  /** Open a song for practice, at a section (null: the whole song; by default, or when it's gone, the first section). */
  open(entry: SongEntry, settings: SongSettings, hand: HandChoice, preset: VisualiserColors, section?: string | null): void {
    this.review = null;
    this.load(entry, settings, this.chosenHand ?? hand, preset);
    const sections = entry.song.sections;
    this.section = section === null || sections.some((s) => s.id === section) ? (section ?? null) : (sections[0]?.id ?? null);
    this.loopAB = { a: null, b: null };
    this.applyRange();
    this.renderAll();
  }

  /**
   * A section's review card: played once at the step it has reached (hands,
   * mode and tempo), then `done` gets the result.
   */
  openReview(entry: SongEntry, sectionId: string, settings: SongSettings, preset: VisualiserColors, done: (pass: PassReport) => void): void {
    const req = requirement(progressOf(entry, sectionId));
    this.load(entry, { ...settings, mode: req.mode, tempo: req.tempo, progressiveTempo: false, view: 'falling' }, req.hands, preset);
    this.review = { sectionId, done };
    this.section = sectionId;
    this.loopAB = { a: null, b: null };
    this.player!.configure({ loop: false, countIn: true });
    this.applyRange();
    this.renderAll();
  }

  private load(entry: SongEntry, settings: SongSettings, hand: HandChoice, preset: VisualiserColors): void {
    this.player?.stop();
    this.previewing = null;
    this.entry = entry;
    this.settings = { ...settings };
    if (!entry.song.musicXml && this.settings.view === 'notation') this.settings.view = 'falling';
    this.hand = hand;
    this.preset = preset;
    const config: PlayerConfig = {
      hands: hand,
      otherHand: settings.otherHand,
      mode: settings.mode,
      tempo: settings.tempo,
      loop: true,
      countIn: settings.countIn,
      progressiveTempo: settings.progressiveTempo,
    };
    this.player = new SongPlayer(entry.song.data, config);
    this.player.on('phase', (phase) => {
      // Heard the section first (H on a review card): now it's your turn.
      if (phase === 'finished' && this.previewing) {
        const mode = this.previewing;
        this.previewing = null;
        this.player?.configure({ mode });
        this.player?.start();
      }
      if (phase === 'playing' || phase === 'counting-in') this.markPlayed();
      this.syncListening();
      this.renderTransport();
    });
    this.player.on('pass', (r) => void this.onPass(r));
    this.player.on('tempo', (t) => this.setSetting({ tempo: t }, false));
    this.player.on('mark', (m) => {
      if (m.kind === 'wrong') this.keyboard.flash(m.midi, 'wrong');
      else if (m.kind !== 'missed') this.keyboard.flash(m.midi, 'correct', 250);
      recordMark(stats, entry.song.data, entry.song.id, this.statsFocus(), m, this.player?.position ?? 0);
    });
  }

  /** The stats items being practised: the song, and the section unless it is the whole song. */
  statsFocus(): ItemRef[] {
    if (!this.entry) return [];
    return songStatsRefs(this.entry.song.id, this.review?.sectionId ?? this.section);
  }

  /** The section changed while practising: its time goes to the new one. */
  private refocusStats(): void {
    if (this.active && !this.review) stats.focus(this.statsFocus());
  }

  /** While the app plays the song to you (listen mode), the time isn't practice. */
  private syncListening(): void {
    if (this.active) stats.setListening(this.playing && this.player?.config.mode === 'listen');
  }

  /** Shown on screen: start drawing (and, for a review card, playing). */
  activate(): void {
    this.active = true;
    this.keysShown = '';
    this.loop();
    if (this.review) this.player?.start();
    this.syncListening();
  }

  deactivate(): void {
    if (this.active) stats.setListening(false);
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.player?.stop();
    this.fingerMenu.hidden = true;
    this.keyboard.setUpcoming([]);
    this.keyboard.clearFingers();
    for (const n of this.litShown) this.keyboard.setLit(n, null);
    this.litShown.clear();
    this.keysShown = '';
  }

  // ── Range, sections, loop ────────────────────────────────────────────

  private get sections(): Section[] {
    return this.entry?.song.sections ?? [];
  }

  private sectionRange(): [number, number] {
    const data = this.entry!.song.data;
    const s = this.sections.find((x) => x.id === this.section);
    return s ? sectionBeats(data, s) : [0, songEndBeat(data)];
  }

  private applyRange(): void {
    if (!this.player) return;
    const [start, end] = this.sectionRange();
    const a = this.loopAB.a ?? start;
    const b = this.loopAB.b ?? end;
    this.player.setRange(Math.min(a, b), Math.max(a, b));
  }

  selectSection(id: string | null): void {
    if (this.review) return;
    this.section = id;
    this.loopAB = { a: null, b: null };
    this.applyRange();
    this.refocusStats();
    this.renderAll();
  }

  /**
   * Practise one measure (from a trouble bar in Stats): loop it within its
   * section, or (ownSection) split it into a section of its own and select it.
   */
  async practiseMeasure(measure: number, ownSection: boolean): Promise<void> {
    const entry = this.entry;
    const m = entry?.song.data.measures[measure];
    if (!entry || !m || this.review || !this.player) return;
    if (ownSection) {
      const { sections, id } = isolateMeasure(this.sections, entry.song.data.measures, measure);
      if (sections !== this.sections) await this.saveSections(sections, id);
      else this.selectSection(id);
      return;
    }
    this.selectSection(this.sections.find((s) => measure >= s.start && measure < s.end)?.id ?? null);
    this.loopAB = { a: m.beat, b: m.beat + m.length };
    this.player.configure({ loop: true });
    this.applyRange();
    this.renderAll();
  }

  /** Next (1) or previous (−1) section, wrapping through "whole song". */
  stepSection(delta: number): void {
    const ids: (string | null)[] = [null, ...this.sections.map((s) => s.id)];
    const i = ids.indexOf(this.section);
    this.selectSection(ids[(i + delta + ids.length) % ids.length] ?? null);
  }

  /** Set loop point A or B at the current position (snapped to the beat). */
  setLoopPoint(which: 'a' | 'b'): void {
    if (!this.player || this.review) return;
    const beat = Math.round(this.player.position);
    const [start, end] = this.sectionRange();
    this.loopAB = { ...this.loopAB, [which]: Math.min(end, Math.max(start, beat)) };
    if (this.loopAB.a !== null && this.loopAB.b !== null && this.loopAB.a === this.loopAB.b) this.loopAB = { ...this.loopAB, [which]: null };
    this.player.configure({ loop: true });
    this.applyRange();
    this.renderAll();
  }

  clearLoop(): void {
    this.loopAB = { a: null, b: null };
    this.applyRange();
    this.renderAll();
  }

  // ── Transport ────────────────────────────────────────────────────────

  togglePlay(): void {
    this.fingerMenu.hidden = true;
    this.player?.toggle();
  }

  restart(): void {
    this.player?.start();
  }

  /** Change the tempo by steps of 5% (or set it). */
  nudgeTempo(delta: number): void {
    this.setTempo((this.player?.config.tempo ?? 1) + delta * TEMPO_STEP);
  }

  setTempo(tempo: number): void {
    const t = Math.round(Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, tempo)) * 100) / 100;
    this.setSetting({ tempo: t });
  }

  toggleView(): void {
    if (!this.entry?.song.musicXml) return;
    this.setSetting({ view: this.settings.view === 'falling' ? 'notation' : 'falling' });
  }

  /** Switch between wait mode and play-along. */
  toggleWait(): void {
    this.setSetting({ mode: this.settings.mode === 'wait' ? 'play-along' : 'wait' });
  }

  /** Choose the hands to practise here (the app's hand setting is left alone). */
  setHand(hand: HandChoice): void {
    if (this.review) return;
    this.hand = hand;
    this.chosenHand = hand;
    this.player?.configure({ hands: hand });
    this.actions.handShown(hand);
    this.renderAll();
  }

  /**
   * Review card: hear the section first (listen mode at the card's tempo and
   * hands), then the card starts again for you to play.
   */
  listenFirst(): void {
    const player = this.player;
    if (!this.review || !player || this.previewing) return;
    this.previewing = player.config.mode;
    player.configure({ mode: 'listen' });
    player.start();
    this.syncListening();
    this.renderTransport();
  }

  setPreset(preset: VisualiserColors): void {
    this.preset = preset;
  }

  refreshTokens(): void {
    this.falling.refreshTokens();
  }

  private setSetting(patch: Partial<SongSettings>, apply = true): void {
    this.settings = { ...this.settings, ...patch };
    if (apply && this.player) {
      const p: Partial<PlayerConfig> = {};
      if (patch.mode) p.mode = patch.mode;
      if (patch.tempo !== undefined) p.tempo = patch.tempo;
      if (patch.otherHand) p.otherHand = patch.otherHand;
      if (patch.countIn !== undefined) p.countIn = patch.countIn;
      if (patch.progressiveTempo !== undefined) p.progressiveTempo = patch.progressiveTempo;
      this.player.configure(p);
      // A mode change while playing restarts without a phase change.
      this.syncListening();
    }
    if (!this.review) this.actions.settingsChanged(this.settings);
    this.renderAll();
  }

  /** Set up the current section's next learning step and start it. */
  private practiseStep(): void {
    const id = this.section;
    if (!id || !this.entry) return;
    const req = requirement(progressOf(this.entry, id));
    this.loopAB = { a: null, b: null };
    this.applyRange();
    if (req.hands !== this.hand) this.setHand(req.hands);
    this.setSetting({ mode: req.mode, tempo: req.tempo });
    this.player?.configure({ loop: true });
    this.player?.start();
  }

  // ── Input ────────────────────────────────────────────────────────────

  noteOn(note: number, time: number): void {
    this.player?.noteOn(note, time);
    this.markPlayed();
  }

  /** Continue (in the song list) comes back here; review cards don't count. */
  private markPlayed(): void {
    if (this.entry && !this.review) this.actions.played(this.entry.song.id, this.section);
  }

  // ── Passes ───────────────────────────────────────────────────────────

  private async onPass(r: PassReport): Promise<void> {
    const entry = this.entry;
    if (!entry) return;
    const detail = r.timing
      ? `${pct(r.accuracy)} right · ${pct(r.onTime ?? 0)} on time (${r.timing.early} early, ${r.timing.late} late, ${r.timing.missed} missed, ${r.wrong} wrong)`
      : `${pct(r.accuracy)} right · ${r.wrong} wrong note${r.wrong === 1 ? '' : 's'}`;
    let message = `${r.clean ? 'Clean pass' : 'Pass'} at ${pct(r.tempo)}: ${detail}.`;
    // A pass over a whole section counts for that section's progress.
    const loop = this.loopAB.a !== null || this.loopAB.b !== null;
    recordPass(stats, entry.song.id, this.section, loop, r);
    const sectionId = loop ? null : this.section;
    if (sectionId) {
      const before = progressOf(entry, sectionId);
      const after = applyPass(before, r);
      await saveProgress(entry, sectionId, after);
      if (after.step > before.step) message += after.step >= LEARNED ? ' Section learned!' : ` Step done. Next: ${describeStep(after)}.`;
      else if (after.speedTempo > before.speedTempo) message += ` Next time: ${pct(after.speedTempo)}.`;
    }
    this.resultEl.textContent = message;
    this.resultEl.classList.toggle('is-clean', r.clean);
    this.renderSections();
    this.renderInfo();
    this.review?.done(r);
  }

  // ── Fingering edits ──────────────────────────────────────────────────

  private editFinger(e: MouseEvent): void {
    if (this.playing || this.review || !this.entry) return;
    const box = this.falling.el.getBoundingClientRect();
    const note = this.falling.noteAt(e.clientX - box.left, e.clientY - box.top);
    if (!note) return;
    const button = (label: string, finger: Finger | null) =>
      h('button.finger-choice', { type: 'button', role: 'menuitem', dataset: { finger: String(finger ?? '') }, onclick: () => void this.setFinger(note, finger) }, label);
    this.fingerMenu.replaceChildren(
      h('span.finger-menu-title', null, formatNoteName(`${note.spelling ?? ''} finger`.trim())),
      ...([1, 2, 3, 4, 5] as Finger[]).map((f) => button(String(f), f)),
      button('×', null),
    );
    this.fingerMenu.style.left = `${e.clientX - box.left}px`;
    this.fingerMenu.style.top = `${e.clientY - box.top}px`;
    this.fingerMenu.hidden = false;
  }

  /** Set (or clear) a note's finger and save it with the song (and into its score). */
  private async setFinger(note: SongNote, finger: Finger | null): Promise<void> {
    const entry = this.entry!;
    this.fingerMenu.hidden = true;
    // A finger you set is yours, even where one was suggested.
    const notes = entry.song.data.notes.map((n) => {
      if (n.id !== note.id) return n;
      const { suggested: _, ...own } = n;
      return { ...own, finger };
    });
    const musicXml = entry.song.musicXml && note.xmlIndex !== undefined ? setXmlFingering(entry.song.musicXml, note.xmlIndex, finger) : entry.song.musicXml;
    entry.song = await saveSong({ ...entry.song, data: { ...entry.song.data, notes }, musicXml });
    this.player?.setData(entry.song.data);
    this.renderFingeringNote();
    this.resultEl.textContent = finger ? `Finger ${finger} saved.` : 'Finger cleared.';
    this.renderView();
  }

  /** Fill in suggested fingering where notes have none, or take every suggestion off. */
  private async suggestFingering(on: boolean): Promise<void> {
    const entry = this.entry!;
    const before = entry.song.data.notes.filter((n) => n.suggested).length;
    const notes = on ? withSuggestedFingering(entry.song.data.notes) : withoutSuggestedFingering(entry.song.data.notes);
    entry.song = await saveSong({ ...entry.song, data: { ...entry.song.data, notes } });
    this.player?.setData(entry.song.data);
    const after = notes.filter((n) => n.suggested).length;
    this.resultEl.textContent = on ? `Suggested fingers for ${after - before} notes.` : `Cleared ${before} suggested fingers.`;
    this.keysShown = '';
    this.renderAll();
  }

  /** The score as shown: suggested fingers added in brackets, like editorial fingering. */
  private displayXml(): string | null {
    const song = this.entry?.song;
    if (!song?.musicXml) return null;
    const texts = new Map<number, string>();
    for (const n of song.data.notes) if (n.suggested && n.finger && n.xmlIndex !== undefined) texts.set(n.xmlIndex, `(${n.finger})`);
    return withXmlFingeringText(song.musicXml, texts);
  }

  // ── Section edits ────────────────────────────────────────────────────

  private async saveSections(sections: Section[], select: string | null): Promise<void> {
    const entry = this.entry!;
    entry.song = await saveSong({ ...entry.song, sections });
    this.section = select;
    this.applyRange();
    this.refocusStats();
    this.renderAll();
  }

  // ── Drawing ──────────────────────────────────────────────────────────

  private loop = (): void => {
    if (!this.active) return;
    this.raf = requestAnimationFrame(this.loop);
    const player = this.player;
    if (!player) return;
    const now = performance.now();
    player.frame(now);
    if (this.settings.view === 'notation' && this.entry?.song.musicXml) this.notation.setPosition(player.position);
    else this.falling.draw(player, { colors: this.settings.colors, preset: this.preset, noteNames: this.settings.noteNames }, now);
    this.showKeys(player);
    this.statusEl.textContent = this.statusText(player);
  };

  private statusText(player: SongPlayer): string {
    const data = player.songData;
    const bar = data.measures[measureAt(data, player.position)]?.label ?? '1';
    const phase = player.phase === 'counting-in' ? 'Count-in…' : player.phase === 'paused' ? 'Paused' : player.phase === 'stopped' ? 'Ready' : player.phase === 'finished' ? 'Finished' : '';
    const waiting = player.waitingKeys.length && player.phase === 'playing' ? 'Waiting for you' : '';
    return [`Bar ${bar}`, phase, waiting].filter(Boolean).join(' · ');
  }

  /** The keyboard shows the next keys to play (with fingers) and lights the app's notes. */
  private showKeys(player: SongPlayer): void {
    const data = player.songData;
    const hands = player.activeHands;
    let upcoming: SongNote[];
    if (player.config.mode === 'wait' && player.waitingKeys.length) {
      const keys = new Set(player.waitingKeys);
      upcoming = data.notes.filter((n) => hands.includes(n.hand) && keys.has(n.midi) && n.beat >= player.position - 0.01 && n.beat < player.position + 4).slice(0, keys.size * 2);
      const firstBeat = Math.min(...upcoming.map((n) => n.beat));
      upcoming = upcoming.filter((n) => n.beat === firstBeat);
    } else {
      const next = data.notes.find((n) => hands.includes(n.hand) && n.beat >= player.position - 0.01 && n.beat < player.currentRange[1]);
      upcoming = next ? data.notes.filter((n) => hands.includes(n.hand) && Math.abs(n.beat - next.beat) < 1e-3) : [];
    }
    const sig = upcoming.map((n) => `${n.midi}:${n.finger ?? ''}:${n.hand}:${n.suggested ? 's' : ''}`).join(',');
    if (sig !== this.keysShown) {
      this.keysShown = sig;
      this.keyboard.setUpcoming(upcoming);
      this.keyboard.clearFingers();
      for (const n of upcoming) if (n.finger) this.keyboard.setFinger(n.midi, { finger: n.finger, hand: n.hand, suggested: n.suggested });
    }
    const lit = new Set(this.playing ? player.appSounding().map((n) => n.midi) : []);
    for (const n of this.litShown) if (!lit.has(n)) this.keyboard.setLit(n, null);
    const color = getComputedStyle(document.documentElement).getPropertyValue('--stage-text-muted').trim() || '#999';
    for (const n of lit) if (!this.litShown.has(n)) this.keyboard.setLit(n, color);
    this.litShown = lit;
  }

  private renderAll(): void {
    this.renderFingeringNote();
    this.renderHead();
    this.renderTransport();
    this.renderSections();
    this.renderInfo();
    this.renderView();
  }

  /** Without any fingering, "colour by finger" falls back to the hands: say so. */
  private renderFingeringNote(): void {
    const entry = this.entry;
    const player = this.player;
    if (!entry || !player || this.settings.colors !== 'finger') {
      this.fingeringNote.textContent = '';
      return;
    }
    const [start, end] = player.currentRange;
    const fingered = (notes: SongNote[]) => notes.some((n) => n.finger !== null);
    this.fingeringNote.textContent = !fingered(entry.song.data.notes)
      ? 'No fingering in this score — colours show hands.'
      : !fingered(notesIn(entry.song.data, start, end, player.activeHands))
        ? 'No fingering in this section — colours show hands.'
        : '';
  }

  private renderView(): void {
    const notation = this.settings.view === 'notation' && !!this.entry?.song.musicXml;
    this.viewEl.replaceChildren(notation ? this.notation.el : this.falling.el, this.fingerMenu);
    this.viewEl.classList.toggle('is-notation', notation);
    if (notation) void this.notation.show(this.displayXml()!);
  }

  private renderHead(): void {
    const song = this.entry?.song;
    if (!song) return;
    const f = this.form;
    f.reset();
    if (this.review) {
      const section = this.sections.find((s) => s.id === this.review!.sectionId);
      this.head.replaceChildren(
        h('div.song-heading', null, h('h1.heading', null, song.title), h('span.muted', null, section?.name ?? '')),
      );
      return;
    }
    const options = h(
      'details.song-options',
      null,
      h('summary.button-outline', null, icon('settings'), h('span', null, 'Options')),
      h(
        'div.song-options-panel',
        null,
        f.field('Colours', f.segmented('colors', [
          { value: 'finger', label: 'Fingers' },
          { value: 'hand', label: 'Hands' },
          { value: 'preset', label: 'Visualiser' },
        ], this.settings.colors, (colors) => this.setSetting({ colors }))),
        f.field('Other hand', f.segmented('other', [
          { value: 'play', label: 'App plays' },
          { value: 'mute', label: 'Muted' },
          { value: 'hide', label: 'Hidden' },
        ], this.settings.otherHand, (otherHand) => this.setSetting({ otherHand }))),
        f.checkbox(this.settings.noteNames, (noteNames) => this.setSetting({ noteNames }), 'Note names on falling notes'),
        f.checkbox(this.settings.countIn, (countIn) => this.setSetting({ countIn }), 'Count in a bar before play-along'),
        h(
          'div.song-options-row',
          null,
          h('button.button-outline', { type: 'button', title: 'Fill in fingering where notes have none', onclick: () => void this.suggestFingering(true) }, 'Suggest fingering'),
          song.data.notes.some((n) => n.suggested)
            ? h('button.button-outline', { type: 'button', onclick: () => void this.suggestFingering(false) }, 'Clear suggested fingering')
            : null,
        ),
        h('p.muted.song-options-note', null, 'Suggested fingers have italic numbers on falling notes, are dotted on the keys and in brackets in the score. Click a falling note while stopped to set its finger.'),
      ),
    );
    this.head.replaceChildren(
      h('button.button-outline.song-back', { type: 'button', title: 'Back to songs (Esc)', onclick: () => this.actions.back() }, icon('arrow-left'), h('span', null, 'Songs')),
      h('div.song-heading', null, h('h1.heading', null, song.title), h('span.muted', null, song.artist)),
      f.segmented('view', [
        { value: 'falling', label: 'Falling notes' },
        { value: 'notation', label: 'Notation', disabled: !song.musicXml, title: song.musicXml ? undefined : 'Only for MusicXML songs' },
      ], this.settings.view, (view) => this.setSetting({ view })),
      options,
    );
  }

  private renderTransport(): void {
    const player = this.player;
    if (!player) return;
    const playing = this.playing;
    const f = this.form;
    if (this.review) {
      const line = this.previewing
        ? `Listening at ${pct(player.config.tempo)} · then it's your turn (${MODE_NAMES[this.previewing].toLowerCase()})`
        : `${HAND_NAMES[player.config.hands]} · ${MODE_NAMES[player.config.mode]} at ${pct(player.config.tempo)}`;
      this.transport.replaceChildren(
        h('span.song-step-line', null, line),
        handColours(),
        h('button.button-outline', { type: 'button', disabled: !!this.previewing, onclick: () => this.listenFirst() }, icon('volume-2'), h('span', null, 'Hear it'), h('kbd', null, 'H')),
        h('button.button-outline', { type: 'button', onclick: () => this.restart() }, icon('rotate-ccw'), h('span', null, 'Restart'), h('kbd', null, 'R')),
      );
      return;
    }
    const tempo = h('input.song-tempo-slider', { type: 'range', min: MIN_TEMPO * 100, max: MAX_TEMPO * 100, step: 5, value: String(Math.round(player.config.tempo * 100)), 'aria-label': 'Tempo' });
    tempo.addEventListener('change', () => this.setTempo(Number(tempo.value) / 100));
    const [a, b] = [this.loopAB.a, this.loopAB.b];
    const bar = (beat: number) => this.entry!.song.data.measures[measureAt(this.entry!.song.data, beat)]?.label ?? '';
    this.transport.replaceChildren(
      h('button.button-primary.song-play', { type: 'button', title: `${playing ? 'Pause' : 'Play'} (Space)`, onclick: () => this.togglePlay() }, icon(playing ? 'pause' : 'play'), h('span', null, playing ? 'Pause' : 'Play')),
      h('button.button-outline', { type: 'button', title: 'Restart (R)', onclick: () => this.restart() }, icon('rotate-ccw')),
      f.segmented<SongMode>('mode', (['wait', 'play-along', 'listen'] as SongMode[]).map((m) => ({ value: m, label: MODE_NAMES[m] })), this.settings.mode, (mode) => this.setSetting({ mode })),
      h('span.song-hands', { title: 'Change with the hand legend or 1 2 3' }, HAND_NAMES[this.hand]),
      handColours(),
      h(
        'span.song-tempo',
        null,
        h('button.icon-button', { type: 'button', title: 'Slower (,)', 'aria-label': 'Slower', onclick: () => this.nudgeTempo(-1) }, icon('minus')),
        tempo,
        h('button.icon-button', { type: 'button', title: 'Faster (.)', 'aria-label': 'Faster', onclick: () => this.nudgeTempo(1) }, icon('plus')),
        h('span.num.song-tempo-value', null, pct(player.config.tempo)),
      ),
      f.checkbox(this.settings.progressiveTempo, (progressiveTempo) => this.setSetting({ progressiveTempo }), '+5% after a clean pass'),
      h(
        'span.song-loop',
        null,
        h('button.button-outline', { type: 'button', title: 'Loop start at the current bar ([)', 'aria-pressed': String(a !== null), onclick: () => this.setLoopPoint('a') }, a === null ? 'A' : `A: bar ${bar(a)}`),
        h('button.button-outline', { type: 'button', title: 'Loop end at the current bar (])', 'aria-pressed': String(b !== null), onclick: () => this.setLoopPoint('b') }, b === null ? 'B' : `B: bar ${bar(b)}`),
        a !== null || b !== null ? h('button.link-button', { type: 'button', onclick: () => this.clearLoop() }, 'Clear loop') : null,
      ),
    );
  }

  private renderSections(): void {
    const entry = this.entry;
    if (!entry) return;
    if (this.review) {
      this.sectionsEl.replaceChildren();
      return;
    }
    const chip = (id: string | null, label: string, step: number | null) =>
      h(
        'button.chip.section-chip',
        { type: 'button', role: 'tab', 'aria-selected': String(this.section === id), onclick: () => this.selectSection(id) },
        step === null ? null : h('span.section-pip', { dataset: { step: String(step) }, 'aria-hidden': 'true' }),
        h('span', null, label),
      );
    this.sectionsEl.replaceChildren(
      chip(null, 'Whole song', null),
      ...this.sections.map((s) => chip(s.id, s.name, progressOf(entry, s.id).step)),
    );
  }

  private renderInfo(): void {
    const entry = this.entry;
    if (!entry) return;
    const id = this.review?.sectionId ?? this.section;
    const s = this.sections.find((x) => x.id === id);
    if (!s) {
      const learned = this.sections.filter((x) => progressOf(entry, x.id).step >= LEARNED).length;
      this.infoEl.replaceChildren(h('p.muted', null, `${learned} of ${this.sections.length} sections learned. Pick a section to follow its learning path.`));
      return;
    }
    const p = progressOf(entry, s.id);
    const stats = [
      p.lastAccuracy === null ? null : `last ${pct(p.lastAccuracy)}`,
      p.bestAccuracy === null ? null : `best ${pct(p.bestAccuracy)}`,
      p.bestTempo ? `best tempo ${pct(p.bestTempo)}` : null,
      `${p.passes} pass${p.passes === 1 ? '' : 'es'}`,
      p.lastPractised ? `last practised ${new Date(p.lastPractised).toLocaleDateString()}` : null,
    ].filter(Boolean).join(' · ');
    const review = h('span.song-review.muted');
    void this.actions.reviewState(entry.song.id, s.id).then(({ inReview, due }) => {
      review.replaceChildren(
        ...present(
          h('span', null, inReview ? `In review${due ? ` · due ${due}` : ''}` : 'Not in review'),
          this.review ? null : h('button.button-outline', { type: 'button', onclick: () => void this.actions.toggleReview(entry.song.id, s.id).then(() => this.renderInfo()) }, inReview ? 'Remove from review' : 'Add to review'),
        ),
      );
    });
    const sectionIndex = this.sections.indexOf(s);
    const splitAt = this.player ? measureAt(entry.song.data, this.player.position) : s.start;
    const name = this.renaming
      ? (() => {
          const input = h('input.control', { type: 'text', value: s.name, 'aria-label': 'Section name', maxLength: 60 });
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && input.value.trim()) {
              this.renaming = false;
              void this.saveSections(this.sections.map((x) => (x.id === s.id ? { ...x, name: input.value.trim() } : x)), s.id);
            }
            if (e.key === 'Escape') {
              e.stopPropagation();
              this.renaming = false;
              this.renderInfo();
            }
          });
          queueMicrotask(() => input.focus());
          return input;
        })()
      : h('strong', null, s.name);
    this.infoEl.replaceChildren(
      ...present(
      h(
        'div.song-step',
        null,
        name,
        h('span', null, describeStep(p)),
        this.review || p.step >= LEARNED ? null : h('button.button-outline', { type: 'button', onclick: () => this.practiseStep() }, icon('play'), h('span', null, 'Practise this step')),
      ),
      h('p.song-stats.muted', null, stats),
      this.review
        ? null
        : h(
            'div.song-section-edit',
            null,
            review,
            h('button.link-button', { type: 'button', onclick: () => ((this.renaming = true), this.renderInfo()) }, 'Rename'),
            splitAt > s.start && splitAt < s.end
              ? h('button.link-button', { type: 'button', onclick: () => void this.saveSections(splitSection(this.sections, entry.song.data.measures, splitAt), s.id) }, `Split at bar ${entry.song.data.measures[splitAt]?.label}`)
              : null,
            sectionIndex < this.sections.length - 1
              ? h('button.link-button', { type: 'button', onclick: () => void this.saveSections(mergeWithNext(this.sections, entry.song.data.measures, s.id), s.id) }, 'Merge with next')
              : null,
          ),
      ),
    );
  }
}

/** The hands' colours in the falling notes and on the keys. */
function handColours(): HTMLElement {
  return h(
    'span.hand-colours',
    { title: 'Each note glows in its hand’s colour; with fingering, it is filled with the finger’s colour' },
    h('span.hand-colour.is-left', { 'aria-hidden': 'true' }),
    h('span', null, 'cyan = left ·'),
    h('span.hand-colour.is-right', { 'aria-hidden': 'true' }),
    h('span', null, 'magenta = right'),
  );
}

function present(...nodes: (Node | null)[]): Node[] {
  return nodes.filter((n): n is Node => n !== null);
}
