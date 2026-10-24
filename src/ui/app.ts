/**
 * App shell: one screen with a header (Play / Study tabs), a stage, a
 * toolbar (hotkey hints and keyboard zoom), the visualiser (Play only) and
 * the keyboard, with the hand legend beside it in Study.
 *
 * Areas: Play (home: free playing, live staff, chord names, visualiser;
 * nothing is recorded), Study (Today's review queue, and free practice
 * whose attempts are logged but never change the schedule) and Library
 * (chords and scales to browse, hear and play along with).
 * Routes MIDI input to sound, the on-screen keyboard, Play and the drill;
 * learned controller buttons and knobs run actions through the same
 * shortcuts as the computer keyboard.
 */
import { audio, metronome } from '../core/audio';
import { actionInfo, controls, describeBinding, shortBinding, type MidiMessage } from '../core/controls';
import { DEFAULT_KEY_RANGE, keyRangeForDevice, midi, type KeyRange } from '../core/midi';
import { notationReady } from '../core/notation';
import { spellingToMidi } from '../core/pitch';
import { noteDrillOptions, type HandChoice, type LibrarySettings, type Settings } from '../core/settings';
import { storage, uuid, type DeckRecord } from '../core/storage';
import { MAX_BPM, MIN_BPM } from '../core/metronome';
import { clefsFor } from '../modules/notes/cards';
import { practiseAheadCards, sessionCards, summariseToday, type TodaySummary } from '../modules/notes/deck';
import { Drill } from '../modules/drill/drill';
import { itemContent, libraryItemFor, newSongCard, noteItem, songCardKey, type DrillItem, type DrillOptions } from '../modules/drill/items';
import { theoryFor } from '../modules/library/theory';
import { FreeSource, ReviewSource } from '../modules/drill/sources';
import { baseTasks, HAND_LABELS } from '../modules/drill/tasks';
import { freeContents, freeRange, staffForHand } from '../modules/notes/free';
import { FreePracticeView } from '../modules/notes/free-view';
import { filterItems, STARTER_DECKS, type ItemKind, type LibraryItem } from '../modules/library/catalog';
import { DecksPanel } from '../modules/library/decks-view';
import { LibraryView } from '../modules/library/library-view';
import { relativeDue, ReviewIndex } from '../modules/library/review-index';
import { PlayView } from '../modules/play/play-view';
import { PlayerView } from '../modules/songs/player-view';
import { SongTask } from '../modules/songs/song-task';
import { addBundledSongs, loadSong } from '../modules/songs/song-store';
import { SongsView } from '../modules/songs/songs-view';
import { Visualiser } from '../modules/play/visualiser';
import { h, icon } from './dom';
import { HandLegend } from './hand-legend';
import { Header, type Area } from './header';
import { Hotkeys, type Hotkey } from './hotkeys';
import { Keyboard } from './keyboard';
import { LibraryNav, type LibraryTab } from './library-nav';
import { MetronomePill } from './metronome-pill';
import { SettingsView } from './settings';
import { StaffView } from './staff';
import { applyTheme } from './theme';
import { StudyNav } from './study-nav';
import { TodayView } from './today';
import { UpdateToast } from './update-toast';
import { ZoomControl } from './zoom-control';

type Screen = 'play' | 'today' | 'free' | 'drill' | 'library' | 'songs' | 'song' | 'settings';

/** Library items that can be added to review and drilled. */
const REVIEWABLE: ReadonlySet<ItemKind> = new Set(['chord', 'scale']);

const SUSTAIN_CC = 64;
/** MIDI channel 10 (drum channel), where controller pads usually send. */
const PAD_CHANNEL = 9;
/** Zoom change per step of a relative knob. */
const KNOB_ZOOM_STEP = 0.02;
const KNOB_SAVE_DELAY_MS = 500;
/** Metronome keys (T is Study and / is Library search, so options open with K). */
const METRONOME_KEYS = { toggle: 'M', tap: 'B', open: 'K' };
/** A tempo knob's absolute range maps onto 30–240 BPM; relative knobs move 1 BPM per step. */
const KNOB_TEMPO_STEP = 1;

export class App {
  private settings: Settings;
  private screen: Screen = 'play';
  /** Area to return to from settings. */
  private lastArea: Area = 'play';
  /** Keys physically held down, for the live staff. */
  private held = new Set<number>();
  private summary: TodaySummary | null = null;
  /** Whether the running drill is practising ahead. */
  private drillAhead = false;
  /** What the running drill is: today's reviews or free practice. */
  private drillKind: 'review' | 'free' = 'review';
  /** Where Esc (and the end of the cards) takes a drill back to. */
  private drillReturn: 'today' | 'free' | 'library' = 'today';
  /** Which chords and scales are in review. */
  private reviews = new ReviewIndex();
  private decks: DeckRecord[] = [];
  private decksPanel: DecksPanel;
  /** The Study screen to return to from settings. */
  private lastStudy: 'today' | 'free' = 'today';
  /** Keys of the connected keyboard (or the 61-key default). */
  private deviceRange: KeyRange = DEFAULT_KEY_RANGE;
  private knobSaveTimer = 0;
  private metronomeSaveTimer = 0;

  private header = new Header(
    () => this.show('settings'),
    (area) => this.showArea(area),
  );
  private keyboard = new Keyboard();
  private play = new PlayView();
  private visualiser = new Visualiser(this.keyboard);
  private hands = new HandLegend();
  private zoom = new ZoomControl();
  private metronomePill = new MetronomePill(metronome, METRONOME_KEYS);
  private hotkeys = new Hotkeys();
  private updateToast = new UpdateToast();
  private stage = h('main.stage');
  private staff = new StaffView();
  private today = new TodayView({ start: () => this.startDrill(false), practiseAhead: () => this.startDrill(true) });
  private settingsView: SettingsView;
  private drill: Drill;
  private studyNav = new StudyNav((view) => this.show(view));
  private library: LibraryView;
  private libraryNav = new LibraryNav((tab) => this.showLibraryTab(tab));
  private songs = new SongsView({
    open: (id) => void this.openSong(id),
    autoFingering: () => this.settings.songs.autoFingering,
    setAutoFingering: (autoFingering) => this.rememberSongSettings({ ...this.settings.songs, autoFingering }),
  });
  private player: PlayerView;
  /** Plays song sections that come up in a Study session. */
  private reviewPlayer: PlayerView;
  private songSaveTimer = 0;
  private librarySaveTimer = 0;
  private free: FreePracticeView;

  constructor(private root: HTMLElement, settings: Settings) {
    this.settings = settings;
    this.settingsView = new SettingsView(settings, {
      change: (s) => void this.updateSettings(s),
      exportData: () => this.exportData(),
      importData: (file) => this.importData(file),
      learnControl: (action) => controls.learn(action),
      cancelLearn: () => controls.cancelLearn(),
    });
    this.drill = new Drill(this.staff, this.keyboard, {
      finished: () => this.show(this.drillReturn),
      answered: (item) => this.theoryReminder(item),
      stage: (el) => this.drillStage(el),
    });
    this.library = new LibraryView(
      settings.library,
      settings.hand,
      {
        // The tab is the app's to change; keep it out of the Library view's saves.
        change: (library) => this.rememberLibrary({ ...library, tab: this.settings.library.tab }),
        setHand: (hand) => void this.setHand(hand),
      },
      this.keyboard,
    );
    this.library.detailExtras = (item) => this.libraryExtras(item);
    this.library.rowBadge = (item) => this.libraryBadge(item);
    this.decksPanel = new DecksPanel({
      apply: (deck) => this.library.applyFilter(deck.filter, deck.octaves),
      create: (name) => void this.saveDeck({ name }),
      rename: (deck, name) => void this.saveDeck({ ...deck, name }),
      useCurrentFilters: (deck) => void this.saveDeck({ ...deck, filter: this.library.filter, octaves: this.library.octaves }),
      remove: (deck) => void this.removeDeck(deck),
      addAll: (deck) => void this.addDeckToReview(deck),
      practise: (deck) => this.startFreeItems(this.deckItems(deck), staffForHand(this.settings.hand), 'library'),
      progress: (deck) => this.deckProgress(deck),
    });
    this.library.setSidebarExtras(this.decksPanel.el);
    this.player = new PlayerView(this.keyboard, {
      back: () => this.showLibraryTab('songs'),
      // Only the player's own settings; the rest (auto-fingering, daily limits) may have changed elsewhere.
      settingsChanged: ({ view, colors, noteNames, otherHand, mode, tempo, progressiveTempo, countIn }) =>
        this.rememberSongSettings({ ...this.settings.songs, view, colors, noteNames, otherHand, mode, tempo, progressiveTempo, countIn }),
      handShown: (hand) => this.hands.set(hand),
      reviewState: (songId, sectionId) => this.songReviewState(songId, sectionId),
      toggleReview: (songId, sectionId) => this.toggleSongReview(songId, sectionId),
    });
    this.reviewPlayer = new PlayerView(this.keyboard, {
      back: () => undefined,
      settingsChanged: () => undefined,
      handShown: () => undefined,
      reviewState: (songId, sectionId) => this.songReviewState(songId, sectionId),
      toggleReview: (songId, sectionId) => this.toggleSongReview(songId, sectionId),
    });
    const songTask = { player: this.reviewPlayer, settings: () => this.settings.songs, preset: () => this.settings.visualiser.colors };
    this.drill.tasks = (item, host, noteStaff) => (item.module === 'songs' ? new SongTask(item.content, host, songTask) : baseTasks(item, host, noteStaff));
    this.free = new FreePracticeView(settings.freePractice, {
      change: (freePractice) => void this.patchSettings({ freePractice }),
      start: () => this.startFree(),
    });
  }

  async start(): Promise<void> {
    this.root.replaceChildren(
      h(
        'div.app',
        null,
        this.header.el,
        this.stage,
        h('div.keyboard-toolbar', null, this.hotkeys.el, this.zoom.el),
        this.visualiser.el,
        h('div.keyboard-dock', null, this.keyboard.el, this.hands.el),
        this.updateToast.el,
      ),
    );
    this.header.setMetronome(this.metronomePill.el);
    this.applySettings();
    this.wireMetronome();
    this.zoom.on('input', (z) => this.keyboard.setZoom(z));
    this.zoom.on('commit', (z) => void this.patchSettings({ keyboardZoom: z }));
    this.hands.on('change', (hand) => {
      if (this.screen === 'song') this.player.setHand(hand);
      else if (this.inFreePractice) this.setFreeHand(hand);
      else void this.setHand(hand);
    });
    this.wireControls();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      this.visualiser.refreshTokens();
      this.player.refreshTokens();
    });
    this.wireInput();
    this.show('play');

    audio.init();
    this.header.setAudio(audio.load);
    audio.on('load', (load) => this.header.setAudio(load));

    await Promise.all([
      midi.init(this.settings.midiInputId),
      notationReady().then(() => this.play.render()),
      this.refreshSummary(),
      this.reviews.load().then(() => {
        this.library.refreshDetail();
        this.decksPanel.refresh();
      }),
      this.loadDecks(),
      this.loadSongs(),
    ]);
  }

  // ── Songs ────────────────────────────────────────────────────────────

  /** On first run, add the bundled songs; then show the list. */
  private async loadSongs(): Promise<void> {
    if (!this.settings.songs.bundledAdded) {
      await addBundledSongs();
      await this.patchSettings({ songs: { ...this.settings.songs, bundledAdded: true } });
    }
    await this.songs.refresh();
  }

  /** The Library screen for the remembered tab. */
  private get libraryScreen(): Screen {
    return this.settings.library.tab === 'songs' ? 'songs' : 'library';
  }

  private showLibraryTab(tab: LibraryTab): void {
    if (tab !== this.settings.library.tab) this.rememberLibrary({ ...this.settings.library, tab });
    this.show(tab === 'songs' ? 'songs' : 'library');
  }

  private async openSong(id: string): Promise<void> {
    const entry = await loadSong(id);
    if (!entry) return;
    const s = this.settings;
    this.player.open(entry, s.songs, s.hand, s.visualiser.colors);
    this.show('song');
  }

  /** A song section in a Study session takes the stage, laid out so its notes fall onto the keys. */
  private drillStage(el: HTMLElement | null): void {
    const app = this.root.querySelector('.app');
    app?.toggleAttribute('data-song-stage', el !== null);
    if (el) this.stage.replaceChildren(el);
    else if (this.screen === 'drill') this.stage.replaceChildren(this.staff.el);
  }

  /** Song player settings change often (tempo slider, progressive tempo); save them once they settle. */
  private rememberSongSettings(songs: Settings['songs']): void {
    this.settings = { ...this.settings, songs };
    this.settingsView.setSettings(this.settings, false);
    window.clearTimeout(this.songSaveTimer);
    this.songSaveTimer = window.setTimeout(() => void storage.saveSettings(this.settings), KNOB_SAVE_DELAY_MS);
  }

  private async songReviewState(songId: string, sectionId: string): Promise<{ inReview: boolean; due: string | null }> {
    const card = await storage.getCardByKey(songCardKey({ songId, sectionId }));
    if (!card || card.suspended) return { inReview: false, due: null };
    return { inReview: true, due: card.fsrs.state === 0 ? 'as a new card' : relativeDue(card.fsrs.due) };
  }

  /** Add a song section to review (a new card, or its old one back), or take it out (kept, suspended). */
  private async toggleSongReview(songId: string, sectionId: string): Promise<void> {
    const now = Date.now();
    const card = await storage.getCardByKey(songCardKey({ songId, sectionId }));
    if (!card) await storage.putCard(newSongCard({ songId, sectionId }, now));
    else await storage.putCard({ ...card, suspended: !card.suspended, updatedAt: now });
    void this.refreshSummary();
  }

  // ── Decks ────────────────────────────────────────────────────────────

  /** Load decks; on first run, add the starter decks (nothing goes into review). */
  private async loadDecks(): Promise<void> {
    if (!this.settings.starterDecksAdded) {
      const now = Date.now();
      for (const [i, d] of STARTER_DECKS.entries()) {
        await storage.putDeck({
          id: uuid(),
          name: d.name,
          filter: d.filter,
          octaves: d.octaves ?? 1,
          starter: true,
          createdAt: now + i,
          updatedAt: now,
        });
      }
      await this.patchSettings({ starterDecksAdded: true });
    }
    this.decks = await storage.getDecks();
    this.decksPanel.setDecks(this.decks);
  }

  private async saveDeck(patch: Partial<DeckRecord> & { name: string }): Promise<void> {
    const now = Date.now();
    const deck: DeckRecord = {
      id: patch.id ?? uuid(),
      name: patch.name,
      filter: patch.filter ?? this.library.filter,
      octaves: patch.octaves ?? this.library.octaves,
      starter: patch.starter ?? false,
      createdAt: patch.createdAt ?? now,
      updatedAt: now,
    };
    await storage.putDeck(deck);
    await this.loadDecks();
  }

  private async removeDeck(deck: DeckRecord): Promise<void> {
    await storage.deleteDeck(deck.id);
    await this.loadDecks();
  }

  /** A deck's items as cards for the current hand (scales at the deck's octaves). */
  private deckItems(deck: DeckRecord): DrillItem[] {
    return filterItems(deck.filter)
      .filter((i) => REVIEWABLE.has(i.kind))
      .map((i) => itemContent(i, this.settings.hand, deck.octaves));
  }

  private deckProgress(deck: DeckRecord): { total: number; inReview: number; due: number } {
    const items = this.deckItems(deck);
    const states = items.map((i) => this.reviews.state(i.id));
    return { total: items.length, inReview: states.filter((s) => s !== 'none').length, due: states.filter((s) => s === 'due').length };
  }

  private async addDeckToReview(deck: DeckRecord): Promise<void> {
    await this.reviews.addAll(this.deckItems(deck));
    this.decksPanel.refresh();
    this.library.refreshDetail();
    void this.refreshSummary();
  }

  /** True while a drill is running (an update then waits for the user). */
  get busy(): boolean {
    return this.screen === 'drill';
  }

  /** A new version is ready: offer it quietly. */
  offerUpdate(apply: () => void): void {
    this.updateToast.show(apply);
  }

  /** Learned controller buttons and knobs. */
  private wireControls(): void {
    midi.filter = (msg) => controls.handle(msg);
    controls.isPianoKey = (msg) => this.isPianoKey(msg);
    controls.on('action', (action) => this.hotkeys.trigger(action));
    controls.on('continuous', ({ action, absolute, delta }) => {
      if (action === 'zoom') this.knobZoom(absolute ?? this.settings.keyboardZoom + (delta ?? 0) * KNOB_ZOOM_STEP);
      if (action === 'tempo' && this.screen === 'song') {
        // In a song the knob sets the song's tempo (25–150%; a relative knob moves 5% per step).
        if (absolute !== undefined) this.player.setTempo(0.25 + absolute * 1.25);
        else this.player.nudgeTempo(delta ?? 0);
      } else if (action === 'tempo') {
        if (absolute !== undefined) metronome.setBpm(MIN_BPM + absolute * (MAX_BPM - MIN_BPM));
        else metronome.nudge((delta ?? 0) * KNOB_TEMPO_STEP);
      }
    });
    controls.on('learned', ({ action, binding, replaced }) => {
      const name = describeBinding(binding, midi.ports[0] ?? null);
      const moved = replaced ? ` It was mapped to “${actionInfo(replaced).label}”; that mapping was removed.` : '';
      this.settingsView.stopLearning({ text: `${actionInfo(action).label}: ${name}.${moved}`, warn: !!replaced });
      void this.patchSettings({ controls: controls.map });
    });
    controls.on('rejected', ({ reason }) => this.settingsView.learningNote(reason));
    this.hotkeys.controlLabel = (action) => {
      const binding = this.settings.controls[action];
      return binding ? shortBinding(binding, midi.ports[0] ?? null) : null;
    };
  }

  /**
   * Piano keys can't be mapped: notes from the keys port within the
   * keyboard's range, except on the pad channel (10).
   */
  private isPianoKey(msg: MidiMessage): boolean {
    return (
      msg.main &&
      (msg.type === 'noteon' || msg.type === 'noteoff') &&
      msg.channel !== PAD_CHANNEL &&
      msg.data1 >= this.deviceRange.low &&
      msg.data1 <= this.deviceRange.high
    );
  }

  /** A knob mapped to zoom: apply now, save once it stops moving. */
  private knobZoom(zoom: number): void {
    const z = Math.min(1, Math.max(0, zoom));
    this.settings = { ...this.settings, keyboardZoom: z };
    this.zoom.set(z);
    this.keyboard.setZoom(z);
    window.clearTimeout(this.knobSaveTimer);
    this.knobSaveTimer = window.setTimeout(() => void this.patchSettings({ keyboardZoom: z }), KNOB_SAVE_DELAY_MS);
  }

  /**
   * The metronome keeps its own copy of its settings (changed from the pill,
   * hotkeys and knobs); they are saved shortly after they settle. Its beats
   * can pulse the visualiser's horizon. It never touches MIDI input or grading.
   */
  private wireMetronome(): void {
    metronome.on('settings', (m) => {
      this.settings = { ...this.settings, metronome: m };
      // Keep the settings screen's copy current so its next save doesn't undo this.
      this.settingsView.setSettings(this.settings, false);
      window.clearTimeout(this.metronomeSaveTimer);
      this.metronomeSaveTimer = window.setTimeout(() => void this.patchSettings({ metronome: metronome.settings }), KNOB_SAVE_DELAY_MS);
    });
    metronome.onBeat((beat) => {
      if (beat.sub === 0 && metronome.settings.pulseVisualiser && this.visualiserOn) {
        this.visualiser.pulse(beat.level === 'accent' ? 1 : 0.5);
      }
    });
  }

  /** After a chord or scale card (when switched on): one line on what it is, kept while the next card shows. */
  private theoryReminder(item: DrillItem): void {
    if (!this.settings.theoryReminders) return;
    const lib = libraryItemFor(item);
    if (lib) this.staff.setReminder(`${lib.name} — ${theoryFor(lib).short}`);
  }

  /** Push the current settings to every part of the UI. */
  private applySettings(): void {
    const s = this.settings;
    applyTheme(s.theme);
    this.visualiser.refreshTokens();
    this.player.refreshTokens();
    this.player.setPreset(s.visualiser.colors);
    this.visualiser.setMode(s.visualiser.colors);
    this.visualiser.setEmbers(s.visualiser.sparks);
    this.hands.set(this.legendHand);
    this.hands.setNumbersVisible(s.showFingerNumbers);
    this.zoom.set(s.keyboardZoom);
    this.keyboard.setZoom(s.keyboardZoom);
    this.keyboard.setShowNames(s.showKeyNames);
    this.free.setSettings(s.freePractice);
    this.library.setSettings(s.library);
    this.library.setFingering(s.showFingerNumbers);
    controls.setBindings(s.controls);
    metronome.setSettings(s.metronome);
    this.hotkeys.render();
    this.updateKeyboardRange();
    this.updateVisualiser();
  }

  /** The visualiser runs only in Play, when switched on; it then takes over the stage. */
  private updateVisualiser(): void {
    const on = this.screen === 'play' && this.settings.visualiser.enabled;
    const app = this.root.querySelector('.app');
    app?.toggleAttribute('data-visualiser', on);
    app?.toggleAttribute('data-overlay-off', !this.settings.visualiser.overlay);
    this.visualiser.setActive(on);
    // Re-colour lit keys for the current preset, or clear them.
    this.keyboard.clearLit();
    if (on) for (const note of this.held) this.keyboard.setLit(note, this.visualiser.colorFor(note));
  }

  private get visualiserOn(): boolean {
    return this.screen === 'play' && this.settings.visualiser.enabled;
  }

  private wireInput(): void {
    const noteOn = (note: number, velocity: number, time: number) => {
      audio.noteOn(note, velocity);
      this.keyboard.setPressed(note, true);
      this.held.add(note);
      this.visualiser.noteOn(note, velocity);
      if (this.visualiserOn) this.keyboard.setLit(note, this.visualiser.colorFor(note));
      if (this.screen === 'play') this.play.setHeld(this.held);
      if (this.screen === 'drill') this.drill.noteOn(note, time, this.held);
      if (this.screen === 'free' && this.free.picking) this.free.toggleKey(note);
      if (this.screen === 'library') this.library.notePressed(note, this.held);
      if (this.screen === 'song') this.player.noteOn(note, time);
    };
    const midiNoteOn = (note: number, velocity: number, time: number) => {
      // Scroll to keys played on the MIDI keyboard (on-screen presses are already in view).
      this.keyboard.reveal(note);
      noteOn(note, velocity, time);
    };
    const noteOff = (note: number, time = performance.now()) => {
      audio.noteOff(note);
      this.keyboard.setPressed(note, false);
      this.held.delete(note);
      this.visualiser.noteOff(note);
      this.keyboard.setLit(note, null);
      if (this.screen === 'play') this.play.setHeld(this.held);
      if (this.screen === 'drill') this.drill.noteOff(note, time, this.held);
    };

    midi.on('noteOn', (e) => midiNoteOn(e.note, e.velocity, e.time));
    midi.on('noteOff', (e) => noteOff(e.note, e.time));
    midi.on('cc', (e) => {
      audio.handleCC(e.controller, e.value);
      if (e.controller === SUSTAIN_CC) this.visualiser.setSustain(e.value >= 64);
    });
    midi.on('status', (status) => {
      this.header.setMidi(status);
      this.updateKeyboardRange();
      this.settingsView.setDevices(midi.devices, status.kind === 'connected' ? status.name : null, midi.ports);
    });
    midi.on('devices', (devices) => {
      const status = midi.status;
      this.settingsView.setDevices(devices, status.kind === 'connected' ? status.name : null, midi.ports);
    });

    this.keyboard.on('press', (e) => noteOn(e.note, e.velocity, performance.now()));
    this.keyboard.on('release', (e) => noteOff(e.note));
  }

  /** Go to an area's home screen: Play, or Today for Study (a running review session stays). */
  private showArea(area: Area): void {
    if (area === 'play' && this.screen !== 'play') this.show('play');
    if (area === 'library' && this.screen !== 'library' && this.screen !== 'songs' && this.screen !== 'song') this.show(this.libraryScreen);
    const inReviews = this.screen === 'today' || (this.screen === 'drill' && this.drillKind === 'review');
    if (area === 'study' && !inReviews) this.show('today');
  }

  /** The song player's keys: transport, sections, loop, tempo, view and mode. */
  private setSongHotkeys(): void {
    const p = this.player;
    this.hotkeys.set([
      { keys: [' '], label: 'Space', hint: 'Play / pause', action: 'start-pause', run: () => p.togglePlay() },
      { keys: ['r'], label: 'R', hint: 'Restart', action: 'restart', run: () => p.restart() },
      { keys: ['ArrowRight'], label: '← →', hint: 'Section', action: 'next', run: () => p.stepSection(1) },
      { keys: ['ArrowLeft'], label: '←', hint: '', hidden: true, action: 'previous', run: () => p.stepSection(-1) },
      { keys: ['['], label: '[ ]', hint: 'Loop A / B', action: 'loop-a', run: () => p.setLoopPoint('a') },
      { keys: [']'], label: ']', hint: '', hidden: true, action: 'loop-b', run: () => p.setLoopPoint('b') },
      { keys: ['\\'], label: '\\', hint: '', hidden: true, run: () => p.clearLoop() },
      { keys: [','], label: ', .', hint: 'Tempo', action: 'tempo-down', run: () => p.nudgeTempo(-1) },
      { keys: ['.'], label: '.', hint: '', hidden: true, action: 'tempo-up', run: () => p.nudgeTempo(1) },
      { keys: ['w'], label: 'W', hint: 'Wait / play-along', action: 'song-wait', optional: true, run: () => p.toggleWait() },
      { keys: ['v'], label: 'V', hint: 'View', action: 'song-view', optional: true, run: () => p.toggleView() },
      { keys: ['Escape'], label: 'Esc', hint: 'Songs', action: 'back', run: () => this.showLibraryTab('songs') },
      // The player's own hands; Study's hand setting is left alone.
      { keys: ['1'], label: '1 2 3', hint: 'Left · right · both', action: 'hand-left', optional: true, run: () => p.setHand('left') },
      { keys: ['2'], label: '2', hint: '', hidden: true, action: 'hand-right', run: () => p.setHand('right') },
      { keys: ['3'], label: '3', hint: '', hidden: true, action: 'hand-both', run: () => p.setHand('both') },
      ...this.commonHotkeys(),
    ]);
  }

  /** Library screens show the Chords & scales / Songs switch above their content. */
  private libraryStage(tab: LibraryTab, content: HTMLElement): HTMLElement {
    this.libraryNav.set(tab);
    return h('div.library-area', null, this.libraryNav.el, content);
  }

  /** Study screens show the Today / Free practice switch above their panel. */
  private studyStage(view: 'today' | 'free', panel: HTMLElement): HTMLElement {
    this.studyNav.set(view);
    return h('div.study', null, this.studyNav.el, panel);
  }

  private show(screen: Screen): void {
    if (this.screen === 'drill' && screen !== 'drill') this.drill.stop();
    if (this.screen === 'settings' && screen !== 'settings') this.settingsView.stopLearning(null);
    if (this.screen === 'library' && screen !== 'library') this.library.deactivate();
    if (this.screen === 'song' && screen !== 'song') this.player.deactivate();
    this.screen = screen;
    if (screen !== 'settings') {
      const fromLibrary = screen === 'library' || screen === 'songs' || screen === 'song' || (screen === 'drill' && this.drillReturn === 'library');
      this.lastArea = screen === 'play' ? 'play' : fromLibrary ? 'library' : 'study';
    }
    if (screen === 'today' || screen === 'free') this.lastStudy = screen;
    this.root.querySelector('.app')?.setAttribute('data-screen', screen);
    this.header.setArea(screen === 'settings' ? null : this.lastArea);
    this.hands.set(this.legendHand);
    this.updateVisualiser();

    if (screen === 'play') {
      this.stage.replaceChildren(this.play.el);
      this.play.setHeld(this.held);
      this.setPlayHotkeys();
    } else if (screen === 'today') {
      this.stage.replaceChildren(this.studyStage('today', this.today.el));
      this.setTodayHotkeys();
      void this.refreshSummary();
    } else if (screen === 'library') {
      this.stage.replaceChildren(this.libraryStage('items', this.library.el));
      this.library.activate();
      this.setLibraryHotkeys();
    } else if (screen === 'song') {
      this.stage.replaceChildren(this.player.el);
      this.player.activate();
      this.setSongHotkeys();
    } else if (screen === 'songs') {
      this.stage.replaceChildren(this.libraryStage('songs', this.songs.el));
      void this.songs.refresh();
      this.hotkeys.set([
        { keys: ['i'], label: 'I', hint: 'Import song', run: () => this.songs.openPicker() },
        { keys: ['c'], label: 'C', hint: 'Chords & scales', optional: true, run: () => this.showLibraryTab('items') },
        { keys: ['s'], label: 'S', hint: 'Settings', action: 'settings', optional: true, run: () => this.show('settings') },
        ...this.commonHotkeys(),
      ]);
    } else if (screen === 'free') {
      this.stage.replaceChildren(this.studyStage('free', this.free.el));
      this.hotkeys.set([
        { keys: [' ', 'Enter'], label: 'Space', hint: 'Start', action: 'start-pause', run: () => this.startFree() },
        { keys: ['1'], label: '1 2 3', hint: 'Left · right · both', action: 'hand-left', optional: true, run: () => this.setFreeHand('left') },
        { keys: ['2'], label: '2', hint: '', hidden: true, action: 'hand-right', run: () => this.setFreeHand('right') },
        { keys: ['3'], label: '3', hint: '', hidden: true, action: 'hand-both', run: () => this.setFreeHand('both') },
        { keys: ['Escape'], label: 'Esc', hint: 'Today', action: 'back', run: () => this.show('today') },
        { keys: ['s'], label: 'S', hint: 'Settings', action: 'settings', optional: true, run: () => this.show('settings') },
        ...this.commonHotkeys(),
      ]);
    } else if (screen === 'drill') {
      this.stage.replaceChildren(this.staff.el);
      this.hotkeys.set([
        { keys: [' '], label: 'Space', hint: 'Pause', action: 'start-pause', run: () => this.drill.togglePause() },
        { keys: ['r'], label: 'R', hint: 'Restart card', action: 'restart', run: () => this.drill.restart() },
        { keys: ['ArrowRight'], label: '→', hint: 'Skip', action: 'next', run: () => this.drill.skip() },
        { keys: ['ArrowLeft'], label: '←', hint: 'Previous', action: 'previous', hidden: true, run: () => this.drill.previous() },
        { keys: ['h'], label: 'H', hint: 'Hear answer', action: 'hear', run: () => this.drill.hint() },
        {
          keys: ['Escape'],
          label: 'Esc',
          hint: { today: 'Today', free: 'Free practice', library: 'Library' }[this.drillReturn],
          action: 'back',
          run: () => this.show(this.drillReturn),
        },
        ...(this.drillKind === 'review' ? this.handHotkeys() : this.freeHandHotkeys()),
        ...this.commonHotkeys(),
      ]);
    } else {
      const back: Screen = this.lastArea === 'study' ? this.lastStudy : this.lastArea === 'library' ? this.libraryScreen : this.lastArea;
      this.stage.replaceChildren(this.settingsView.el);
      const backLabel = { play: 'Play', today: 'Today', free: 'Free practice', library: 'Library', songs: 'Songs', song: 'Song' } as Record<string, string>;
      this.hotkeys.set([
        { keys: ['Escape'], label: 'Esc', hint: backLabel[back] ?? 'Back', action: 'back', run: () => this.show(back) },
        ...this.commonHotkeys(),
      ]);
      this.settingsView.focusFirst();
    }
  }

  private setPlayHotkeys(): void {
    const s = this.settings;
    this.hotkeys.set([
      {
        keys: ['v'],
        label: 'V',
        action: 'toggle-visualiser',
        hint: s.visualiser.enabled ? 'Visualiser off' : 'Visualiser',
        run: () => void this.patchSettings({ visualiser: { ...this.settings.visualiser, enabled: !this.settings.visualiser.enabled } }),
      },
      {
        keys: ['n'],
        label: 'N',
        hint: s.showKeyNames ? 'Hide key names' : 'Key names',
        run: () => void this.patchSettings({ showKeyNames: !this.settings.showKeyNames }),
      },
      {
        keys: ['o'],
        label: 'O',
        hint: s.visualiser.overlay ? 'Hide staff' : 'Show staff',
        hidden: !s.visualiser.enabled,
        run: () => void this.patchSettings({ visualiser: { ...this.settings.visualiser, overlay: !this.settings.visualiser.overlay } }),
      },
      { keys: ['s'], label: 'S', hint: 'Settings', action: 'settings', optional: true, run: () => this.show('settings') },
      ...this.commonHotkeys(),
    ]);
  }

  /** Start a session; returns false when there is nothing to practise. */
  private async startDrill(ahead: boolean): Promise<boolean> {
    const summary = this.summary ?? (await this.refreshSummary());
    const cards = ahead ? practiseAheadCards(summary) : sessionCards(summary);
    if (cards.length === 0) return false;
    (document.activeElement as HTMLElement | null)?.blur();
    this.drill.stop();
    this.drillAhead = ahead;
    this.drillKind = 'review';
    this.drillReturn = 'today';
    this.show('drill');
    const clef = noteDrillOptions(this.settings).clef;
    this.staff.setReminder('');
    this.drill.start(
      new ReviewSource(cards, clef === 'both' ? 'grand' : clef, { ahead }, () => void this.refreshSummary()),
      this.drillOptions(),
    );
    return true;
  }

  private drillOptions(): DrillOptions {
    return {
      scaleDirection: this.settings.scaleDrill.direction,
      chordStaff: this.settings.chordDrill.showStaff,
      fingering: this.settings.showFingerNumbers,
    };
  }

  /** Free practice has its own hand; the legend and 1/2/3 follow it on its screens. */
  /** What the hand legend shows: the song player's own hands, free practice's, or Study's. */
  private get legendHand(): HandChoice {
    if (this.screen === 'song') return this.player.currentHand;
    return this.inFreePractice ? this.settings.freePractice.notes.hand : this.settings.hand;
  }

  private get inFreePractice(): boolean {
    return this.screen === 'free' || (this.screen === 'drill' && this.drillKind === 'free');
  }

  /** Change the free-practice hand; a running free drill restarts with the new set. */
  private setFreeHand(hand: HandChoice): void {
    this.free.setHand(hand); // saves through the view's change callback
    this.hands.set(hand);
    if (this.screen === 'drill') this.startFree();
  }

  private freeHandHotkeys(): Hotkey[] {
    return [
      { keys: ['1'], label: '1 2 3', hint: 'Left · right · both', action: 'hand-left', optional: true, run: () => this.setFreeHand('left') },
      { keys: ['2'], label: '2', hint: '', hidden: true, action: 'hand-right', run: () => this.setFreeHand('right') },
      { keys: ['3'], label: '3', hint: '', hidden: true, action: 'hand-both', run: () => this.setFreeHand('both') },
    ];
  }

  /** Free practice: random cards from the chosen set, no limit, schedule untouched. */
  private startFree(): void {
    const fp = this.settings.freePractice;
    const hand = fp.notes.hand;
    let items: DrillItem[];
    if (fp.kind === 'chords') items = filterItems({ ...fp.chords, kinds: ['chord'] }).map((i) => itemContent(i, hand, 1));
    else if (fp.kind === 'scales') items = filterItems({ ...fp.scales, kinds: ['scale'] }).map((i) => itemContent(i, hand, fp.octaves));
    else items = freeContents(fp.notes).map(noteItem);
    this.startFreeItems(items, staffForHand(hand), 'free');
  }

  /** Free practice with these cards; Esc returns to `from`. */
  private startFreeItems(items: DrillItem[], noteStaff: ReturnType<typeof staffForHand>, from: 'free' | 'library'): void {
    if (items.length === 0) return;
    (document.activeElement as HTMLElement | null)?.blur();
    this.drill.stop();
    this.drillKind = 'free';
    this.drillReturn = from;
    this.show('drill');
    this.staff.setReminder('');
    this.drill.start(new FreeSource(items, noteStaff), this.drillOptions());
  }

  // ── Library: review status and actions ───────────────────────────────

  /** A Library item as a card for the current hand (scales at the Library's octaves). */
  private libraryContent(item: LibraryItem): DrillItem {
    return itemContent(item, this.settings.hand, this.library.octaves);
  }

  private libraryBadge(item: LibraryItem): string | null {
    if (!REVIEWABLE.has(item.kind)) return null;
    const state = this.reviews.state(this.libraryContent(item).id);
    return state === 'due' ? 'due' : state === 'none' ? null : 'in review';
  }

  private libraryExtras(item: LibraryItem): HTMLElement[] {
    if (!REVIEWABLE.has(item.kind)) return [];
    const content = this.libraryContent(item);
    const state = this.reviews.state(content.id);
    const card = this.reviews.card(content.id);
    const hand = HAND_LABELS[this.settings.hand].toLowerCase();
    const status =
      state === 'none'
        ? `Not in review (${hand}).`
        : state === 'new'
          ? `In review (${hand}): new, it comes up within your daily new-card limit.`
          : `In review (${hand}): next due ${relativeDue(card!.fsrs.due)}.`;
    return [
      h(
        'div.button-row',
        null,
        h(
          'button.button-outline',
          { type: 'button', onclick: () => void this.toggleReview(item) },
          h('span', null, state === 'none' ? 'Add to review' : 'Remove from review'),
          h('kbd', null, 'R'),
        ),
        h(
          'button.button-outline',
          { type: 'button', onclick: () => this.practiseNow(item) },
          icon('play'),
          h('span', null, 'Practise now'),
          h('kbd', null, 'Space'),
        ),
      ),
      h('p.library-status.muted', null, status),
    ];
  }

  private async toggleReview(item: LibraryItem | null): Promise<void> {
    if (!item || !REVIEWABLE.has(item.kind)) return;
    const content = this.libraryContent(item);
    if (this.reviews.inReview(content.id)) await this.reviews.remove(content.id);
    else await this.reviews.add(content);
    this.library.refreshDetail();
    this.decksPanel.refresh();
    void this.refreshSummary();
  }

  private practiseNow(item: LibraryItem | null): void {
    if (!item || !REVIEWABLE.has(item.kind)) return;
    this.startFreeItems([this.libraryContent(item)], staffForHand(this.settings.hand), 'library');
  }

  private async refreshSummary(): Promise<TodaySummary> {
    const s = this.settings;
    const summary = await summariseToday(noteDrillOptions(s), s.hand, {
      notes: s.noteDrill.newPerDay,
      chords: s.chordDrill.newPerDay,
      scales: s.scaleDrill.newPerDay,
      songs: s.songs.newPerDay,
    });
    this.summary = summary;
    this.today.update(summary);
    this.header.setDue(summary.reviews.length + summary.newCards.length);
    // The Space hint depends on whether anything is due.
    if (this.screen === 'today') this.setTodayHotkeys();
    return summary;
  }

  private setTodayHotkeys(): void {
    this.hotkeys.set([
      {
        keys: [' ', 'Enter'],
        label: 'Space',
        hint: this.today.hasDue ? 'Start' : 'Practise ahead',
        action: 'start-pause',
        run: () => this.today.primaryAction(),
      },
      { keys: ['e'], label: 'E', hint: 'Free practice', run: () => this.show('free') },
      { keys: ['s'], label: 'S', hint: 'Settings', action: 'settings', optional: true, run: () => this.show('settings') },
      ...this.handHotkeys(),
      ...this.commonHotkeys(),
    ]);
  }

  /** Hand keys, for Study. */
  private handHotkeys(): Hotkey[] {
    return [
      { keys: ['1'], label: '1 2 3', hint: 'Left · right · both', action: 'hand-left', optional: true, run: () => void this.setHand('left') },
      { keys: ['2'], label: '2', hint: '', hidden: true, action: 'hand-right', run: () => void this.setHand('right') },
      { keys: ['3'], label: '3', hint: '', hidden: true, action: 'hand-both', run: () => void this.setHand('both') },
    ];
  }

  /** Metronome, zoom, area and fingering keys, on every screen. P and T are shown on the header tabs instead. */
  private commonHotkeys(): Hotkey[] {
    const k = METRONOME_KEYS;
    return [
      { keys: [k.toggle.toLowerCase()], label: k.toggle, hint: 'Metronome', action: 'metronome', optional: true, run: () => metronome.toggle() },
      { keys: [k.tap.toLowerCase()], label: k.tap, hint: 'Tap tempo', action: 'tap-tempo', optional: true, run: () => void metronome.tap() },
      { keys: [k.open.toLowerCase()], label: k.open, hint: '', hidden: true, run: () => this.metronomePill.toggleOptions() },
      { keys: [','], label: ',', hint: '', hidden: true, action: 'tempo-down', run: () => metronome.nudge(-1) },
      { keys: ['.'], label: '.', hint: '', hidden: true, action: 'tempo-up', run: () => metronome.nudge(1) },
      { keys: ['<'], label: '<', hint: '', hidden: true, run: () => metronome.nudge(-5) },
      { keys: ['>'], label: '>', hint: '', hidden: true, run: () => metronome.nudge(5) },
      { keys: ['-'], label: '- = 0', hint: 'Zoom', action: 'zoom-out', optional: true, run: () => this.zoom.step(-1) },
      { keys: ['=', '+'], label: '=', hint: '', hidden: true, action: 'zoom-in', run: () => this.zoom.step(1) },
      { keys: ['0'], label: '0', hint: '', hidden: true, run: () => this.zoom.fit() },
      { keys: ['p'], label: 'P', hint: '', hidden: true, action: 'area-play', run: () => this.showArea('play') },
      { keys: ['t'], label: 'T', hint: '', hidden: true, action: 'area-study', run: () => this.showArea('study') },
      { keys: ['l'], label: 'L', hint: '', hidden: true, action: 'area-library', run: () => this.showArea('library') },
      { keys: ['e'], label: 'E', hint: '', hidden: true, run: () => this.show('free') },
      {
        keys: ['f'],
        label: 'F',
        hint: '',
        hidden: true,
        action: 'toggle-fingering',
        run: () => void this.patchSettings({ showFingerNumbers: !this.settings.showFingerNumbers }),
      },
    ];
  }

  private setLibraryHotkeys(): void {
    this.hotkeys.set([
      { keys: ['/'], label: '/', hint: 'Search', run: () => this.library.focusSearch() },
      { keys: ['g'], label: 'G', hint: 'Songs', optional: true, run: () => this.showLibraryTab('songs') },
      { keys: ['ArrowDown'], label: '↑ ↓', hint: 'Select', action: 'next', run: () => this.library.move(1) },
      { keys: ['ArrowUp'], label: '↑', hint: '', hidden: true, action: 'previous', run: () => this.library.move(-1) },
      { keys: ['h'], label: 'H', hint: 'Hear', action: 'hear', run: () => this.library.hear(false) },
      { keys: ['a'], label: 'A', hint: 'Arpeggio', optional: true, run: () => this.library.hear(true) },
      { keys: [' '], label: 'Space', hint: 'Practise', action: 'start-pause', run: () => this.practiseNow(this.library.current) },
      { keys: ['r'], label: 'R', hint: 'Review', run: () => void this.toggleReview(this.library.current) },
      { keys: ['Escape'], label: 'Esc', hint: '', hidden: true, action: 'back', run: () => this.library.clearSearch() },
      ...this.handHotkeys(),
      { keys: ['s'], label: 'S', hint: 'Settings', action: 'settings', optional: true, run: () => this.show('settings') },
      ...this.commonHotkeys(),
    ]);
  }

  /**
   * The Library's filter and selection change often (every arrow key), so
   * they are kept without the full settings round trip and saved shortly after.
   */
  private rememberLibrary(library: LibrarySettings): void {
    this.settings = { ...this.settings, library };
    this.settingsView.setSettings(this.settings, false);
    window.clearTimeout(this.librarySaveTimer);
    this.librarySaveTimer = window.setTimeout(() => void storage.saveSettings(this.settings), 400);
  }

  /** Change and save a few settings without going through the settings screen. */
  private async patchSettings(patch: Partial<Settings>): Promise<void> {
    const next = { ...this.settings, ...patch };
    // Keep the settings screen's copy current so its next save doesn't undo this.
    this.settingsView.setSettings(next);
    await this.updateSettings(next);
    if (this.screen === 'play') this.setPlayHotkeys();
  }

  /** Change the practised hand. During a drill, the session restarts with that hand's cards. */
  private async setHand(hand: HandChoice): Promise<void> {
    if (hand === this.settings.hand) return;
    const next = { ...this.settings, hand };
    this.settingsView.setSettings(next);
    await this.updateSettings(next);
    this.library.setHand(hand);
    this.library.refreshDetail();
    this.decksPanel.refresh();
    if (this.screen === 'drill' && this.drillKind === 'review' && !(await this.startDrill(this.drillAhead))) this.show('today');
  }

  private async updateSettings(next: Settings): Promise<void> {
    const midiChanged = next.midiInputId !== this.settings.midiInputId;
    this.settings = next;
    this.applySettings();
    if (midiChanged) midi.select(next.midiInputId);
    await storage.saveSettings(next);
    await this.refreshSummary();
  }

  /**
   * The keyboard shows the connected keyboard's keys (61 keys, C2–C7, when
   * unknown), widened if the drill range goes beyond them.
   */
  private updateKeyboardRange(): void {
    const status = midi.status;
    const device = (status.kind === 'connected' && keyRangeForDevice(status.name)) || DEFAULT_KEY_RANGE;
    this.deviceRange = device;
    const d = noteDrillOptions(this.settings);
    const clefs = clefsFor(d);
    const free = freeRange(this.settings.freePractice.notes) ?? [device.low, device.high];
    const low = Math.min(device.low, free[0], ...clefs.map((c) => spellingToMidi(d[c].low)));
    const high = Math.max(device.high, free[1], ...clefs.map((c) => spellingToMidi(d[c].high)));
    this.keyboard.setRange(low, high);
  }

  private async exportData(): Promise<void> {
    const data = await storage.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `piano-trainer-${data.exportedAt.slice(0, 10)}.json` });
    a.click();
    URL.revokeObjectURL(url);
  }

  private async importData(file: File): Promise<string> {
    try {
      const result = await storage.importAll(JSON.parse(await file.text()));
      this.settings = await storage.getSettings();
      this.settingsView.setSettings(this.settings);
      this.applySettings();
      midi.select(this.settings.midiInputId);
      await this.refreshSummary();
      await this.reviews.load();
      await this.loadDecks();
      this.library.refreshDetail();
      await this.loadSongs();
      return `Imported ${result.cards} cards, ${result.reviews} reviews, ${result.decks} decks, ${result.songs} songs, ${result.songProgress} section progress records and ${result.settings} settings records.`;
    } catch (err) {
      return err instanceof SyntaxError ? 'That file is not valid JSON.' : (err as Error).message;
    }
  }
}
