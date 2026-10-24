/**
 * App shell: one screen with a header (Play / Study tabs), a stage, a
 * toolbar (hotkey hints and keyboard zoom), the visualiser (Play only) and
 * the keyboard, with the hand legend beside it in Study.
 *
 * Areas: Play (home: free playing, live staff, chord names, visualiser;
 * nothing is recorded) and Study (Today queue and drills).
 * Routes MIDI input to sound, the on-screen keyboard, Play and the drill;
 * learned controller buttons and knobs run actions through the same
 * shortcuts as the computer keyboard.
 */
import { audio } from '../core/audio';
import { actionInfo, controls, describeBinding, shortBinding, type MidiMessage } from '../core/controls';
import { DEFAULT_KEY_RANGE, keyRangeForDevice, midi, type KeyRange } from '../core/midi';
import { notationReady } from '../core/notation';
import { spellingToMidi } from '../core/pitch';
import { noteDrillOptions, type HandChoice, type Settings } from '../core/settings';
import { storage } from '../core/storage';
import { clefsFor } from '../modules/notes/cards';
import { practiseAheadCards, sessionCards, summariseToday, type TodaySummary } from '../modules/notes/deck';
import { NoteDrill } from '../modules/notes/drill';
import { PlayView } from '../modules/play/play-view';
import { Visualiser } from '../modules/play/visualiser';
import { h } from './dom';
import { HandLegend } from './hand-legend';
import { Header, type Area } from './header';
import { Hotkeys, type Hotkey } from './hotkeys';
import { Keyboard } from './keyboard';
import { SettingsView } from './settings';
import { StaffView } from './staff';
import { applyTheme } from './theme';
import { TodayView } from './today';
import { ZoomControl } from './zoom-control';

type Screen = 'play' | 'today' | 'drill' | 'settings';

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
  private stage = h('main.stage');
  private staff = new StaffView();
  private today = new TodayView({ start: () => this.startDrill(false), practiseAhead: () => this.startDrill(true) });
  private settingsView: SettingsView;
  private drill: NoteDrill;

  constructor(private root: HTMLElement, settings: Settings) {
    this.settings = settings;
    this.settingsView = new SettingsView(settings, {
      change: (s) => void this.updateSettings(s),
      exportData: () => this.exportData(),
      importData: (file) => this.importData(file),
      learnControl: (action) => controls.learn(action),
      cancelLearn: () => controls.cancelLearn(),
    });
    this.drill = new NoteDrill(this.staff, this.keyboard, {
      reviewed: () => void this.refreshSummary(),
      finished: () => this.show('today'),
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
      ),
    );
    this.applySettings();
    this.zoom.on('input', (z) => this.keyboard.setZoom(z));
    this.zoom.on('commit', (z) => void this.patchSettings({ keyboardZoom: z }));
    this.hands.on('change', (hand) => void this.setHand(hand));
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
    ]);
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
    this.hands.set(s.hand);
    this.hands.setNumbersVisible(s.showFingerNumbers);
    this.zoom.set(s.keyboardZoom);
    this.keyboard.setZoom(s.keyboardZoom);
    this.keyboard.setShowNames(s.showKeyNames);
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
      if (this.screen === 'drill') this.drill.noteOn(note, time);
    };
    const midiNoteOn = (note: number, velocity: number, time: number) => {
      // Scroll to keys played on the MIDI keyboard (on-screen presses are already in view).
      this.keyboard.reveal(note);
      noteOn(note, velocity, time);
    };
    const noteOff = (note: number) => {
      audio.noteOff(note);
      this.keyboard.setPressed(note, false);
      this.held.delete(note);
      this.visualiser.noteOff(note);
      this.keyboard.setLit(note, null);
      if (this.screen === 'play') this.play.setHeld(this.held);
    };

    midi.on('noteOn', (e) => midiNoteOn(e.note, e.velocity, e.time));
    midi.on('noteOff', (e) => noteOff(e.note));
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

  /** Go to an area's home screen: Play, or Today for Study. */
  private showArea(area: Area): void {
    if (area === 'play' && this.screen !== 'play') this.show('play');
    if (area === 'study' && this.screen !== 'today' && this.screen !== 'drill') this.show('today');
  }

  private show(screen: Screen): void {
    if (this.screen === 'drill' && screen !== 'drill') this.drill.stop();
    if (this.screen === 'settings' && screen !== 'settings') this.settingsView.stopLearning(null);
    this.screen = screen;
    if (screen !== 'settings') this.lastArea = screen === 'play' ? 'play' : 'study';
    this.root.querySelector('.app')?.setAttribute('data-screen', screen);
    this.header.setArea(screen === 'settings' ? null : this.lastArea);
    this.updateVisualiser();

    if (screen === 'play') {
      this.stage.replaceChildren(this.play.el);
      this.play.setHeld(this.held);
      this.setPlayHotkeys();
    } else if (screen === 'today') {
      this.stage.replaceChildren(this.today.el);
      this.setTodayHotkeys();
      void this.refreshSummary();
    } else if (screen === 'drill') {
      this.stage.replaceChildren(this.staff.el);
      this.hotkeys.set([
        { keys: [' '], label: 'Space', hint: 'Pause', action: 'start-pause', run: () => this.drill.togglePause() },
        { keys: ['r'], label: 'R', hint: 'Restart card', action: 'restart', run: () => this.drill.restart() },
        { keys: ['ArrowRight'], label: '→', hint: 'Skip', action: 'next', run: () => this.drill.skip() },
        { keys: ['ArrowLeft'], label: '←', hint: 'Previous', action: 'previous', hidden: true, run: () => this.drill.previous() },
        { keys: ['h'], label: 'H', hint: 'Hear note', action: 'hear', run: () => this.drill.hint() },
        { keys: ['Escape'], label: 'Esc', hint: 'Today', action: 'back', run: () => this.show('today') },
        ...this.handHotkeys(),
        ...this.commonHotkeys(),
      ]);
    } else {
      const back: Screen = this.lastArea === 'play' ? 'play' : 'today';
      this.stage.replaceChildren(this.settingsView.el);
      this.hotkeys.set([
        { keys: ['Escape'], label: 'Esc', hint: back === 'play' ? 'Play' : 'Today', action: 'back', run: () => this.show(back) },
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
    this.show('drill');
    this.drill.start(cards, noteDrillOptions(this.settings), { ahead });
    return true;
  }

  private async refreshSummary(): Promise<TodaySummary> {
    const summary = await summariseToday(noteDrillOptions(this.settings));
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
    if (this.screen === 'drill' && !(await this.startDrill(this.drillAhead))) this.show('today');
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
    const low = Math.min(device.low, ...clefs.map((c) => spellingToMidi(d[c].low)));
    const high = Math.max(device.high, ...clefs.map((c) => spellingToMidi(d[c].high)));
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
