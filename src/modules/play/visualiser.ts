/**
 * Play-area visualiser (Neothesia/Pianothesia-style performance view).
 *
 * On note-on a pill-shaped bar is born at the keyboard's top edge and grows
 * upward while the key (or the sustain pedal) holds it; on release it
 * detaches and rises at a constant speed off the top of the stage, fading
 * only in the top part. Each bar is a sharp near-white core inside a wider,
 * soft glow in the note's colour. A glowing horizon line runs along the
 * keyboard edge and flashes in each new note's colour. Optional embers burst
 * from the key on note-on and trickle up while it is held.
 *
 * Performance: no per-frame shadowBlur. Glow, cores, embers and horizon
 * flashes are pre-rendered once per colour to small offscreen canvases and
 * drawn with additive blending on the dark stage. Everything is pooled,
 * particles are capped, the canvas matches devicePixelRatio up to a limit,
 * and the loop runs only while something is on screen and the tab is
 * visible. With prefers-reduced-motion, bars fade in place and there are no
 * embers. Colours and motion values come from the --viz-* tokens.
 */
import type { VisualiserColors } from '../../core/settings';
import { h } from '../../ui/dom';
import {
  drawPill,
  presetColor,
  readVisualiserTokens,
  renderSprites,
  rgba,
  type Sprites,
  type Tokens,
} from './glow';
import type { Keyboard } from '../../ui/keyboard';


interface Bar {
  note: number;
  /** 0–1 */
  velocity: number;
  start: number;
  /** Release time; NaN while held. */
  end: number;
  sprites: Sprites;
  /** Fractional embers owed to the held-note trickle. */
  trickle: number;
}

interface Ember {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  size: number;
  phase: number;
  sprites: Sprites;
}

interface Flash {
  note: number;
  born: number;
  sprites: Sprites;
}


export interface FrameStats {
  frames: number;
  fps: number;
  drawP50: number;
  drawP95: number;
  drawMax: number;
  intervalP95: number;
  bars: number;
  embers: number;
  dpr: number;
}

const REDUCED_BAR_HEIGHT = 0.3; // of the stage, when bars don't travel
const STATS_WINDOW = 240;

export class Visualiser {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private width = 0;
  private height = 0;
  private canvasLeft = 0;

  private bars: Bar[] = [];
  private barPool: Bar[] = [];
  private embers: Ember[] = [];
  private emberPool: Ember[] = [];
  private flashes: Flash[] = [];
  private flashPool: Flash[] = [];
  /** Bars still attached to their key (held, or kept by the pedal). */
  private attached = new Map<number, Bar>();
  private physicallyHeld = new Set<number>();
  private sustain = false;

  private raf = 0;
  private lastFrame = 0;
  private active = false;
  private mode: VisualiserColors = 'rainbow';
  private embersOn = true;
  private tokens!: Tokens;
  private sprites = new Map<string, Sprites>();
  private horizonGradient: CanvasGradient | null = null;
  private fadeGradient: CanvasGradient | null = null;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  /** Metronome pulse on the horizon: when it started (ms, rAF clock) and how strong (0–1). */
  private pulseBorn = -Infinity;
  private pulseStrength = 0;
  private drawTimes: number[] = [];
  private intervals: number[] = [];

  constructor(private keyboard: Keyboard) {
    this.canvas = h('canvas.visualiser-canvas', { 'aria-hidden': 'true' });
    this.el = h('div.visualiser', null, this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.refreshTokens();
    new ResizeObserver(() => this.resize()).observe(this.el);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.cancel();
      else this.kick();
    });
  }

  /** Show or hide; hiding clears everything and stops the loop. */
  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    if (!active) {
      this.cancel();
      this.barPool.push(...this.bars);
      this.emberPool.push(...this.embers);
      this.flashPool.push(...this.flashes);
      this.bars.length = 0;
      this.embers.length = 0;
      this.flashes.length = 0;
      this.attached.clear();
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    } else {
      this.resize();
    }
  }

  setMode(mode: VisualiserColors): void {
    this.mode = mode;
  }

  setEmbers(on: boolean): void {
    this.embersOn = on;
  }

  /**
   * Brighten the horizon briefly, on a metronome beat (stronger on the first
   * beat). Nothing happens with reduced motion.
   */
  pulse(strength: number): void {
    if (!this.active || this.reducedMotion.matches) return;
    this.pulseBorn = performance.now();
    this.pulseStrength = strength;
    this.kick();
  }

  private get pulsing(): boolean {
    return performance.now() - this.pulseBorn < this.tokens.pulseMs;
  }

  /** The note's colour in the current preset (also used to light the pressed key). */
  colorFor(note: number): string {
    return presetColor(this.tokens, this.mode, note);
  }

  /** Re-read colours and motion values from the tokens. */
  refreshTokens(): void {
    this.tokens = readVisualiserTokens();
    this.sprites.clear();
    this.resize();
  }

  /** Frame and draw-time statistics since the last call (for performance checks). */
  stats(): FrameStats {
    const pct = (xs: number[], p: number) => {
      if (xs.length === 0) return 0;
      const sorted = [...xs].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
    };
    const meanInterval = this.intervals.reduce((a, b) => a + b, 0) / Math.max(1, this.intervals.length);
    const result: FrameStats = {
      frames: this.drawTimes.length,
      fps: meanInterval ? 1000 / meanInterval : 0,
      drawP50: pct(this.drawTimes, 0.5),
      drawP95: pct(this.drawTimes, 0.95),
      drawMax: Math.max(0, ...this.drawTimes),
      intervalP95: pct(this.intervals, 0.95),
      bars: this.bars.length,
      embers: this.embers.length,
      dpr: this.dpr,
    };
    this.drawTimes.length = 0;
    this.intervals.length = 0;
    return result;
  }

  // ── Input ────────────────────────────────────────────────────────────

  noteOn(note: number, velocity: number, now = performance.now()): void {
    this.physicallyHeld.add(note);
    if (!this.active) return;
    const v = Math.min(1, velocity / 127);
    const sprites = this.spritesFor(this.colorFor(note));
    const previous = this.attached.get(note);
    if (previous) {
      // Struck again while its bar is still attached: let the old bar go a few px early so a gap shows.
      const gapMs = (this.tokens.repressGap / this.tokens.speed) * 1000;
      previous.end = Math.max(previous.start, now - gapMs);
    }
    const bar = this.barPool.pop() ?? ({} as Bar);
    bar.note = note;
    bar.velocity = v;
    bar.start = now;
    bar.end = NaN;
    bar.sprites = sprites;
    bar.trickle = 0;
    this.bars.push(bar);
    this.attached.set(note, bar);

    const flash = this.flashPool.pop() ?? ({} as Flash);
    flash.note = note;
    flash.born = now;
    flash.sprites = sprites;
    this.flashes.push(flash);

    if (this.embersAllowed()) {
      const count = Math.round(this.tokens.emberBurst * (0.25 + 0.75 * v));
      for (let i = 0; i < count; i++) this.spawnEmber(note, sprites, now, true, v);
    }
    this.kick();
  }

  noteOff(note: number, now = performance.now()): void {
    this.physicallyHeld.delete(note);
    if (!this.sustain) this.release(note, now);
  }

  setSustain(down: boolean, now = performance.now()): void {
    this.sustain = down;
    if (down) return;
    for (const note of [...this.attached.keys()]) {
      if (!this.physicallyHeld.has(note)) this.release(note, now);
    }
  }

  private release(note: number, now: number): void {
    const bar = this.attached.get(note);
    if (!bar) return;
    bar.end = now;
    this.attached.delete(note);
    this.kick();
  }

  private embersAllowed(): boolean {
    return this.embersOn && !this.reducedMotion.matches;
  }

  /** Embers start on the horizon line above the key; positions are stored in key units (x) and device px (y). */
  private spawnEmber(note: number, sprites: Sprites, now: number, burst: boolean, velocity: number): void {
    if (this.embers.length >= this.tokens.emberMax) return;
    const e = this.emberPool.pop() ?? ({} as Ember);
    const { centre, black } = this.keyboard.keyPosition(note);
    const spread = (black ? 0.3 : 0.4) * (Math.random() - 0.5);
    e.x = centre + spread; // key units, converted when drawn so embers follow zoom and scroll
    e.y = 0; // px above the horizon (device px)
    const lift = burst ? 70 + 190 * velocity : 40 + 40 * Math.random();
    e.vx = (Math.random() - 0.5) * (burst ? 1.4 : 0.5); // key units per second
    e.vy = -(lift * (0.6 + 0.8 * Math.random())) * this.dpr;
    e.born = now;
    e.life = this.tokens.emberLifeMs * (0.65 + 0.7 * Math.random());
    e.size = (burst ? 2.2 + 2.6 * Math.random() : 1.6 + 1.8 * Math.random()) * this.dpr;
    e.phase = Math.random() * Math.PI * 2;
    e.sprites = sprites;
    this.embers.push(e);
  }

  // ── Loop ─────────────────────────────────────────────────────────────

  private kick(): void {
    if (!this.raf && this.active && !document.hidden) {
      this.lastFrame = 0;
      this.raf = requestAnimationFrame(this.frame);
    }
  }

  private cancel(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private frame = (now: number): void => {
    this.raf = 0;
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0;
    if (this.lastFrame) this.record(this.intervals, now - this.lastFrame);
    this.lastFrame = now;
    const t0 = performance.now();
    this.draw(now, dt);
    this.record(this.drawTimes, performance.now() - t0);
    if (this.bars.length > 0 || this.embers.length > 0 || this.flashes.length > 0 || this.pulsing) {
      this.raf = requestAnimationFrame(this.frame);
    }
  };

  private record(list: number[], value: number): void {
    list.push(value);
    if (list.length > STATS_WINDOW) list.shift();
  }

  private resize(): void {
    if (!this.tokens) return;
    const box = this.el.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, this.tokens.maxDpr);
    this.width = Math.round(box.width * this.dpr);
    this.height = Math.round(box.height * this.dpr);
    this.canvasLeft = box.left;
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    const ctx = this.ctx;
    const hz = 14 * this.dpr;
    this.horizonGradient = ctx.createLinearGradient(0, this.height, 0, this.height - hz);
    this.horizonGradient.addColorStop(0, rgba(this.tokens.horizon, 0.32));
    this.horizonGradient.addColorStop(0.15, rgba(this.tokens.horizon, 0.12));
    this.horizonGradient.addColorStop(1, rgba(this.tokens.horizon, 0));
    const fade = this.height * this.tokens.fadeZone;
    this.fadeGradient = ctx.createLinearGradient(0, 0, 0, fade);
    this.fadeGradient.addColorStop(0, 'rgba(0,0,0,1)');
    this.fadeGradient.addColorStop(1, 'rgba(0,0,0,0)');
    this.kick();
  }

  private draw(now: number, dt: number): void {
    const { ctx, width: W, height: H, tokens: t, dpr } = this;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);
    if (W === 0 || H === 0) return;
    const reduced = this.reducedMotion.matches;
    const geo = this.keyboard.measure();
    const originX = (geo.left - this.canvasLeft + geo.x0) * dpr; // device px of key-unit 0
    const unit = geo.unit * dpr;
    const v = (t.speed * dpr) / 1000; // device px per ms

    ctx.globalCompositeOperation = 'lighter';

    // Horizon: a faint line along the keyboard edge, flashing in each new note's colour.
    ctx.fillStyle = this.horizonGradient!;
    ctx.fillRect(0, H - 14 * dpr, W, 14 * dpr);
    // Metronome pulse: the same glow again, fading out.
    const pulseAge = (now - this.pulseBorn) / t.pulseMs;
    if (pulseAge >= 0 && pulseAge < 1) {
      ctx.globalAlpha = (1 - pulseAge) * (1 - pulseAge) * this.pulseStrength * t.pulseAlpha;
      ctx.fillRect(0, H - 14 * dpr, W, 14 * dpr);
      ctx.globalAlpha = 1;
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]!;
      const age = (now - f.born) / t.flashMs;
      if (age >= 1) {
        this.flashPool.push(f);
        this.flashes[i] = this.flashes[this.flashes.length - 1]!;
        this.flashes.pop();
        continue;
      }
      const x = originX + this.keyboard.keyPosition(f.note).centre * unit;
      const fw = unit * 5;
      const fh = 28 * dpr;
      ctx.globalAlpha = (1 - age) * (1 - age);
      ctx.drawImage(f.sprites.flash, x - fw / 2, H - fh / 2, fw, fh);
    }

    // Bars.
    for (let i = this.bars.length - 1; i >= 0; i--) {
      const bar = this.bars[i]!;
      const held = Number.isNaN(bar.end);
      let top: number;
      let bottom = H;
      let alpha = 0.6 + 0.4 * bar.velocity;
      if (reduced) {
        top = H * (1 - REDUCED_BAR_HEIGHT);
        if (!held) alpha *= 1 - (now - bar.end) / t.reducedFadeMs;
      } else if (held) {
        top = H - (now - bar.start) * v;
      } else {
        const rise = (now - bar.end) * v;
        bottom = H - rise;
        top = H - (bar.end - bar.start) * v - rise;
      }
      if (alpha <= 0 || bottom <= 0) {
        this.barPool.push(bar);
        this.bars[i] = this.bars[this.bars.length - 1]!;
        this.bars.pop();
        continue;
      }
      const { centre, black } = this.keyboard.keyPosition(bar.note);
      const x = originX + centre * unit;
      const barW = unit * (black ? 0.6 : 1) * t.barWidth * (0.9 + 0.1 * bar.velocity);
      // A pill needs at least its own width of length; a quick tap shows as a round dot.
      if (bottom - top < barW) top = bottom - barW;
      ctx.globalAlpha = alpha;
      this.drawPill(bar.sprites, x, top, bottom, barW);

      if (held && dt > 0 && this.embersAllowed()) {
        bar.trickle += t.emberTrickle * dt;
        while (bar.trickle >= 1) {
          bar.trickle -= 1;
          this.spawnEmber(bar.note, bar.sprites, now, false, bar.velocity);
        }
      }
    }

    // Embers: rise with slight drift and flicker, shrinking and fading.
    for (let i = this.embers.length - 1; i >= 0; i--) {
      const e = this.embers[i]!;
      const age = now - e.born;
      const life = age / e.life;
      if (life >= 1) {
        this.emberPool.push(e);
        this.embers[i] = this.embers[this.embers.length - 1]!;
        this.embers.pop();
        continue;
      }
      const s = age / 1000;
      const x = originX + (e.x + e.vx * s) * unit + Math.sin(s * 3 + e.phase) * 4 * dpr;
      const y = H + e.y + e.vy * s * (1 - 0.3 * s);
      const size = e.size * (1 - 0.7 * life) * 4;
      ctx.globalAlpha = (1 - life) * (0.6 + 0.4 * Math.sin(s * 22 + e.phase * 3));
      ctx.drawImage(e.sprites.ember, x - size / 2, y - size / 2, size, size);
    }

    // Fade everything out across the top of the stage.
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = this.fadeGradient!;
    ctx.fillRect(0, 0, W, H * t.fadeZone);
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawPill(s: Sprites, x: number, top: number, bottom: number, barW: number): void {
    drawPill(this.ctx, this.tokens, s, x, top, bottom, barW);
  }

  // ── Sprites ──────────────────────────────────────────────────────────

  private spritesFor(color: string): Sprites {
    let s = this.sprites.get(color);
    if (!s) {
      s = this.renderSprites(color);
      this.sprites.set(color, s);
    }
    return s;
  }

  private renderSprites(color: string): Sprites {
    return renderSprites(color, this.tokens);
  }
}

