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
import { audio } from '../core/audio';
import { actionInfo, controls, describeBinding, shortBinding, type MidiMessage } from '../core/controls';
import { DEFAULT_KEY_RANGE, keyRangeForDevice, midi, type KeyRange } from '../core/midi';
import { notationReady } from '../core/notation';
import { spellingToMidi } from '../core/pitch';
import { noteDrillOptions, type HandChoice, type LibrarySettings, type Settings } from '../core/settings';
import { storage } from '../core/storage';
import { clefsFor } from '../modules/notes/cards';
import { practiseAheadCards, sessionCards, summariseToday, type TodaySummary } from '../modules/notes/deck';
import { Drill } from '../modules/drill/drill';
import { itemContent, noteItem, type DrillItem, type DrillOptions } from '../modules/drill/items';
import { FreeSource, ReviewSource } from '../modules/drill/sources';
import { HAND_LABELS } from '../modules/drill/tasks';
import { freeContents, freeRange, staffForHand } from '../modules/notes/free';
import { FreePracticeView } from '../modules/notes/free-view';
import { filterItems, type ItemKind, type LibraryItem } from '../modules/library/catalog';
import { LibraryView } from '../modules/library/library-view';
import { relativeDue, ReviewIndex } from '../modules/library/review-index';
import { PlayView } from '../modules/play/play-view';
import { Visualiser } from '../modules/play/visualiser';
import { h, icon } from './dom';
import { HandLegend } from './hand-legend';
import { Header, type Area } from './header';
import { Hotkeys, type Hotkey } from './hotkeys';
import { Keyboard } from './keyboard';
import { SettingsView } from './settings';
import { StaffView } from './staff';
import { applyTheme } from './theme';
import { StudyNav } from './study-nav';
import { TodayView } from './today';
import { UpdateToast } from './update-toast';
import { ZoomControl } from './zoom-control';

type Screen = 'play' | 'today' | 'free' | 'drill' | 'library' | 'settings';

/** Library items that can be added to review and drilled. */
const REVIEWABLE: ReadonlySet<ItemKind> = new Set(['chord', 'scale']);

const SUSTAIN_CC = 64;
/** MIDI channel 10 (drum channel), where controller pads usually send. */
const PAD_CHANNEL = 9;
/** Zoom change per step of a relative knob. */
const KNOB_ZOOM_STEP = 0.02;
const KNOB_SAVE_DELAY_MS = 500;

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
  /** The Study screen to return to from settings. */
  private lastStudy: 'today' | 'free' = 'today';
  /** Keys of the connected keyboard (or the 61-key default). */
  private deviceRange: KeyRange = DEFAULT_KEY_RANGE;
  private knobSaveTimer = 0;

  private header = new Header(
    () => this.show('settings'),
    (area) => this.showArea(area),
  );
  private keyboard = new Keyboard();
  private play = new PlayView();
  private visualiser = new Visualiser(this.keyboard);
  private hands = new HandLegend();
  private zoom = new ZoomControl();
  private hotkeys = new Hotkeys();
  private updateToast = new UpdateToast();
  private stage = h('main.stage');
  private staff = new StaffView();
  private today = new TodayView({ start: () => this.startDrill(false), practiseAhead: () => this.startDrill(true) });
  private settingsView: SettingsView;
  private drill: Drill;
  private studyNav = new StudyNav((view) => this.show(view));
  private library: LibraryView;
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
    });
    this.library = new LibraryView(
      settings.library,
      settings.hand,
      { change: (library) => this.rememberLibrary(library), setHand: (hand) => void this.setHand(hand) },
      this.keyboard,
    );
    this.library.detailExtras = (item) => this.libraryExtras(item);
    this.library.rowBadge = (item) => this.libraryBadge(item);
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
    this.applySettings();
    this.zoom.on('input', (z) => this.keyboard.setZoom(z));
    this.zoom.on('commit', (z) => void this.patchSettings({ keyboardZoom: z }));
    this.hands.on('change', (hand) => (this.inFreePractice ? this.setFreeHand(hand) : void this.setHand(hand)));
    this.wireControls();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.visualiser.refreshTokens());
    this.wireInput();
    this.show('play');

    audio.init();
    this.header.setAudio(audio.load);
    audio.on('load', (load) => this.header.setAudio(load));

    await Promise.all([
      midi.init(this.settings.midiInputId),
      notationReady().then(() => this.play.render()),
      this.refreshSummary(),
      this.reviews.load().then(() => this.library.refreshDetail()),
    ]);
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

  /** Push the current settings to every part of the UI. */
  private applySettings(): void {
    const s = this.settings;
    applyTheme(s.theme);
    this.visualiser.refreshTokens();
    this.visualiser.setMode(s.visualiser.colors);
    this.visualiser.setEmbers(s.visualiser.sparks);
    this.hands.set(this.inFreePractice ? s.freePractice.notes.hand : s.hand);
    this.hands.setNumbersVisible(s.showFingerNumbers);
    this.zoom.set(s.keyboardZoom);
    this.keyboard.setZoom(s.keyboardZoom);
    this.keyboard.setShowNames(s.showKeyNames);
    this.free.setSettings(s.freePractice);
    this.library.setSettings(s.library);
    this.library.setFingering(s.showFingerNumbers);
    controls.setBindings(s.controls);
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
    if (area === 'library' && this.screen !== 'library') this.show('library');
    const inReviews = this.screen === 'today' || (this.screen === 'drill' && this.drillKind === 'review');
    if (area === 'study' && !inReviews) this.show('today');
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
    this.screen = screen;
    if (screen !== 'settings') {
      const fromLibrary = screen === 'library' || (screen === 'drill' && this.drillReturn === 'library');
      this.lastArea = screen === 'play' ? 'play' : fromLibrary ? 'library' : 'study';
    }
    if (screen === 'today' || screen === 'free') this.lastStudy = screen;
    this.root.querySelector('.app')?.setAttribute('data-screen', screen);
    this.header.setArea(screen === 'settings' ? null : this.lastArea);
    this.hands.set(this.inFreePractice ? this.settings.freePractice.notes.hand : this.settings.hand);
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
      this.stage.replaceChildren(this.library.el);
      this.library.activate();
      this.setLibraryHotkeys();
    } else if (screen === 'free') {
      this.stage.replaceChildren(this.studyStage('free', this.free.el));
      this.hotkeys.set([
        { keys: [' ', 'Enter'], label: 'Space', hint: 'Start', action: 'start-pause', run: () => this.startFree() },
        { keys: ['1'], label: '1 2 3', hint: 'Left · right · both', action: 'hand-left', run: () => this.setFreeHand('left') },
        { keys: ['2'], label: '2', hint: '', hidden: true, action: 'hand-right', run: () => this.setFreeHand('right') },
        { keys: ['3'], label: '3', hint: '', hidden: true, action: 'hand-both', run: () => this.setFreeHand('both') },
        { keys: ['Escape'], label: 'Esc', hint: 'Today', action: 'back', run: () => this.show('today') },
        { keys: ['s'], label: 'S', hint: 'Settings', action: 'settings', run: () => this.show('settings') },
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
      const back: Screen = this.lastArea === 'study' ? this.lastStudy : this.lastArea;
      this.stage.replaceChildren(this.settingsView.el);
      const backLabel = { play: 'Play', today: 'Today', free: 'Free practice', library: 'Library' } as Record<string, string>;
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
      { keys: ['s'], label: 'S', hint: 'Settings', action: 'settings', run: () => this.show('settings') },
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
      { keys: ['1'], label: '1 2 3', hint: 'Left · right · both', action: 'hand-left', run: () => this.setFreeHand('left') },
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
      { keys: ['s'], label: 'S', hint: 'Settings', action: 'settings', run: () => this.show('settings') },
      ...this.handHotkeys(),
      ...this.commonHotkeys(),
    ]);
  }

  /** Hand keys, for Study. */
  private handHotkeys(): Hotkey[] {
    return [
      { keys: ['1'], label: '1 2 3', hint: 'Left · right · both', action: 'hand-left', run: () => void this.setHand('left') },
      { keys: ['2'], label: '2', hint: '', hidden: true, action: 'hand-right', run: () => void this.setHand('right') },
      { keys: ['3'], label: '3', hint: '', hidden: true, action: 'hand-both', run: () => void this.setHand('both') },
    ];
  }

  /** Zoom, area and fingering keys, on every screen. P and T are shown on the header tabs instead. */
  private commonHotkeys(): Hotkey[] {
    return [
      { keys: ['-'], label: '- = 0', hint: 'Zoom', action: 'zoom-out', run: () => this.zoom.step(-1) },
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
      { keys: ['ArrowDown'], label: '↑ ↓', hint: 'Select', action: 'next', run: () => this.library.move(1) },
      { keys: ['ArrowUp'], label: '↑', hint: '', hidden: true, action: 'previous', run: () => this.library.move(-1) },
      { keys: ['h'], label: 'H', hint: 'Hear', action: 'hear', run: () => this.library.hear(false) },
      { keys: ['a'], label: 'A', hint: 'Arpeggio', run: () => this.library.hear(true) },
      { keys: [' '], label: 'Space', hint: 'Practise', action: 'start-pause', run: () => this.practiseNow(this.library.current) },
      { keys: ['r'], label: 'R', hint: 'Review', run: () => void this.toggleReview(this.library.current) },
      { keys: ['Escape'], label: 'Esc', hint: '', hidden: true, action: 'back', run: () => this.library.clearSearch() },
      ...this.handHotkeys(),
      { keys: ['s'], label: 'S', hint: 'Settings', action: 'settings', run: () => this.show('settings') },
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
      return `Imported ${result.cards} cards, ${result.reviews} reviews and ${result.settings} settings records.`;
    } catch (err) {
      return err instanceof SyntaxError ? 'That file is not valid JSON.' : (err as Error).message;
    }
  }
}
