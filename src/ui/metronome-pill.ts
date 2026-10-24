/**
 * The metronome in the header, on every screen: start/stop, the tempo and
 * beat dots that pulse in time. Clicking the tempo opens a small popover
 * with every option (no modal); it closes on Esc or a click outside.
 */
import {
  CLICK_SOUNDS,
  MAX_BPM,
  MIN_BPM,
  SUBDIVISIONS,
  TIME_SIGNATURES,
  type BeatEvent,
  type ClickSound,
  type Metronome,
  type MetronomeSettings,
  type Subdivision,
  type TimeSignature,
} from '../core/metronome';
import { h, icon } from './dom';
import { FormBuilder } from './form';

const SUBDIVISION_LABELS: Record<Subdivision, string> = { none: 'None', '8ths': '8ths', triplets: 'Triplets', '16ths': '16ths' };
const SOUND_LABELS: Record<ClickSound, string> = { click: 'Click', woodblock: 'Woodblock' };
/** How long a dot stays lit after its beat (ms). */
const DOT_MS = 140;

export class MetronomePill {
  readonly el: HTMLElement;
  private toggleButton: HTMLButtonElement;
  private openButton: HTMLButtonElement;
  private bpmEl: HTMLElement;
  private dotsEl: HTMLElement;
  private popover: HTMLElement;
  private form = new FormBuilder('metronome');
  private dotTimer = 0;

  constructor(
    private readonly metronome: Metronome,
    private readonly keys: { toggle: string; tap: string; open: string },
  ) {
    this.toggleButton = h('button.icon-button.metronome-toggle', { type: 'button', onclick: () => metronome.toggle() });
    this.bpmEl = h('span.metronome-bpm.num');
    this.dotsEl = h('span.metronome-dots', { 'aria-hidden': 'true' });
    this.openButton = h(
      'button.metronome-open',
      {
        type: 'button',
        title: `Metronome options (${keys.open})`,
        'aria-haspopup': 'dialog',
        'aria-expanded': 'false',
        onclick: () => this.toggleOptions(),
      },
      icon('metronome'),
      this.bpmEl,
      this.dotsEl,
    );
    this.popover = h('div.metronome-popover', { popover: 'auto', role: 'dialog', 'aria-label': 'Metronome', tabIndex: -1 });
    this.popover.addEventListener('toggle', (e) => {
      const open = (e as ToggleEvent).newState === 'open';
      this.openButton.setAttribute('aria-expanded', String(open));
      if (open) this.position();
    });
    this.el = h('div.metronome', { role: 'group', 'aria-label': 'Metronome' }, this.toggleButton, this.openButton, this.popover);

    metronome.on('state', () => this.renderState());
    metronome.on('settings', () => this.render());
    metronome.onBeat((beat) => this.showBeat(beat));
    window.addEventListener('resize', () => this.isOpen && this.position());
    // Esc closes the popover and goes no further (it would otherwise go back a screen).
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape' && this.isOpen) {
          e.stopPropagation();
          e.preventDefault();
          this.popover.hidePopover();
          this.openButton.focus();
        }
      },
      true,
    );
    this.render();
  }

  get isOpen(): boolean {
    return this.popover.matches(':popover-open');
  }

  toggleOptions(): void {
    if (this.isOpen) this.popover.hidePopover();
    else {
      this.popover.showPopover();
      // Focus the popover itself, not a field, so the hotkeys keep working.
      this.popover.focus();
    }
  }

  private position(): void {
    const box = this.el.getBoundingClientRect();
    const width = this.popover.offsetWidth;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, box.right - width));
    this.popover.style.left = `${left}px`;
    this.popover.style.top = `${box.bottom + 6}px`;
  }

  private set(patch: Partial<MetronomeSettings>): void {
    this.metronome.setSettings(patch);
  }

  private render(): void {
    const s = this.metronome.settings;
    this.bpmEl.textContent = String(s.bpm);
    const beats = this.metronome.meter.beats;
    if (this.dotsEl.childElementCount !== beats) {
      this.dotsEl.replaceChildren(...Array.from({ length: beats }, (_, i) => h(i === 0 ? 'span.metronome-dot.is-first' : 'span.metronome-dot')));
    }
    this.renderState();
    this.renderOptions(s);
  }

  private renderState(): void {
    const running = this.metronome.running;
    this.el.classList.toggle('is-running', running);
    this.toggleButton.replaceChildren(icon(running ? 'square' : 'play'));
    const label = `${running ? 'Stop' : 'Start'} metronome (${this.keys.toggle})`;
    this.toggleButton.title = label;
    this.toggleButton.setAttribute('aria-label', label);
    this.toggleButton.setAttribute('aria-pressed', String(running));
    if (!running) this.clearDots();
  }

  private showBeat(beat: BeatEvent): void {
    if (beat.sub !== 0) return;
    const dots = this.dotsEl.children;
    this.clearDots();
    dots[beat.beat]?.classList.add('is-on');
    this.el.classList.toggle('is-count-in', beat.countIn);
    window.clearTimeout(this.dotTimer);
    // The dot changes state on the beat; the pulse is CSS (none with reduced motion).
    this.dotTimer = window.setTimeout(() => dots[beat.beat]?.classList.add('is-fading'), DOT_MS);
  }

  private clearDots(): void {
    for (const dot of this.dotsEl.children) dot.classList.remove('is-on', 'is-fading');
    this.el.classList.remove('is-count-in');
  }

  /**
   * Show the settings in the popover. It is built once and then only its
   * values change, so a slider being dragged or a tempo being typed is
   * never replaced under the pointer.
   */
  private renderOptions(s: MetronomeSettings): void {
    if (!this.popover.firstChild) this.buildOptions(s);
    const value = (selector: string, v: string) => {
      const el = this.popover.querySelector<HTMLInputElement>(selector)!;
      if (el !== document.activeElement || el.type === 'range') el.value = v;
    };
    value('.metronome-tempo-input', String(s.bpm));
    value('.metronome-tempo-slider', String(s.bpm));
    value('.metronome-volume', String(s.volume));
    for (const [name, v] of [['ts', s.timeSignature], ['sub', s.subdivision], ['sound', s.sound]] as const) {
      const radio = this.popover.querySelector<HTMLInputElement>(`input[name="metronome-${name}"][value="${v}"]`);
      if (radio) radio.checked = true;
    }
    const boxes = this.popover.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    boxes[0]!.checked = s.countIn;
    boxes[1]!.checked = s.pulseVisualiser;
  }

  private buildOptions(s: MetronomeSettings): void {
    const f = this.form;
    const tempo = h('input.control.control-number.num.metronome-tempo-input', {
      type: 'number',
      id: f.nextId(),
      min: MIN_BPM,
      max: MAX_BPM,
      value: String(s.bpm),
      'aria-label': 'Tempo (BPM)',
    });
    tempo.addEventListener('change', () => this.set({ bpm: Number(tempo.value) }));
    tempo.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.set({ bpm: Number(tempo.value) });
    });
    const slider = h('input.metronome-tempo-slider', {
      type: 'range',
      id: f.nextId(),
      min: MIN_BPM,
      max: MAX_BPM,
      step: 1,
      value: String(s.bpm),
      'aria-label': 'Tempo',
    });
    slider.addEventListener('input', () => {
      tempo.value = slider.value;
      this.set({ bpm: Number(slider.value) });
    });
    const step = (delta: number, label: string, name: 'minus' | 'plus') =>
      h(
        'button.icon-button',
        { type: 'button', title: `${label} (Shift: ±5)`, 'aria-label': label, onclick: (e: MouseEvent) => this.metronome.nudge(delta * (e.shiftKey ? 5 : 1)) },
        icon(name),
      );
    const volume = h('input.metronome-volume', {
      type: 'range',
      id: f.nextId(),
      min: 0,
      max: 1,
      step: 0.01,
      value: String(s.volume),
      'aria-label': 'Metronome volume',
    });
    volume.addEventListener('input', () => this.set({ volume: Number(volume.value) }));

    this.popover.replaceChildren(
      h('h2.subheading', null, 'Metronome'),
      h(
        'div.metronome-tempo',
        null,
        step(-1, 'Slower (,)', 'minus'),
        tempo,
        h('span.muted', null, 'BPM'),
        step(1, 'Faster (.)', 'plus'),
        h('button.button-outline.metronome-tap', { type: 'button', onclick: () => this.metronome.tap() }, h('span', null, 'Tap'), h('kbd', null, this.keys.tap)),
      ),
      slider,
      f.field(
        'Time signature',
        f.segmented<TimeSignature>('ts', TIME_SIGNATURES.map((t) => ({ value: t, label: t })), s.timeSignature, (timeSignature) => this.set({ timeSignature })),
      ),
      f.field(
        'Subdivision',
        f.segmented<Subdivision>('sub', SUBDIVISIONS.map((v) => ({ value: v, label: SUBDIVISION_LABELS[v] })), s.subdivision, (subdivision) => this.set({ subdivision })),
      ),
      f.field(
        'Sound',
        f.segmented<ClickSound>('sound', CLICK_SOUNDS.map((v) => ({ value: v, label: SOUND_LABELS[v] })), s.sound, (sound) => this.set({ sound })),
      ),
      f.field('Volume', volume),
      f.checkbox(s.countIn, (countIn) => this.set({ countIn }), 'Count in one bar when starting'),
      f.checkbox(s.pulseVisualiser, (pulseVisualiser) => this.set({ pulseVisualiser }), 'Pulse the visualiser’s horizon on each beat'),
      h(
        'p.metronome-keys.muted',
        null,
        h('kbd', null, this.keys.toggle), ' start/stop · ',
        h('kbd', null, ','), h('kbd', null, '.'), ' tempo (Shift ±5) · ',
        h('kbd', null, this.keys.tap), ' tap',
      ),
    );
  }
}
