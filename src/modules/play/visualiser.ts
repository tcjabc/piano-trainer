/**
 * Play-area visualiser (Neothesia-style): on note-on a glowing bar rises from
 * the key and grows while held; on release it detaches and drifts upward,
 * fading out. The sustain pedal keeps bars held. Optional spark bursts.
 *
 * Performance: one requestAnimationFrame loop that runs only while something
 * is on screen and stops while the tab is hidden; bars and sparks are pooled;
 * each frame reads key positions once and never writes to the DOM.
 * With prefers-reduced-motion, bars don't travel and there are no sparks.
 * Colours and motion values come from the --viz-* tokens.
 */
import type { Finger } from '../../core/fingering';
import type { VisualiserColors } from '../../core/settings';
import { h } from '../../ui/dom';
import type { Keyboard } from '../../ui/keyboard';

interface Bar {
  note: number;
  /** 0–1 */
  velocity: number;
  start: number;
  /** Release time; NaN while held. */
  end: number;
  color: string;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  color: string;
}

interface Tokens {
  pcs: string[];
  accent: string;
  fingers: string[];
  blend: GlobalCompositeOperation;
  /** px per second */
  speed: number;
  fadeMs: number;
  reducedFadeMs: number;
  glow: number;
  sparkCount: number;
}

const GRAVITY = 900; // px/s², sparks only
const REDUCED_BAR_HEIGHT = 0.35; // of the canvas, when bars don't travel
const MIN_BAR_LENGTH = 4;

export class Visualiser {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private canvasLeft = 0;

  private bars: Bar[] = [];
  private barPool: Bar[] = [];
  private sparks: Spark[] = [];
  private sparkPool: Spark[] = [];
  /** Bars still attached to their key (held, or kept by the pedal). */
  private attached = new Map<number, Bar>();
  private physicallyHeld = new Set<number>();
  private sustain = false;

  private raf = 0;
  private active = false;
  private mode: VisualiserColors = 'rainbow';
  private sparksOn = true;
  private tokens!: Tokens;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  /** Finger for a note, when fingering is known (used by the "fingers" colour mode). */
  fingerFor: (note: number) => Finger | null = () => null;

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
      this.sparkPool.push(...this.sparks);
      this.bars.length = 0;
      this.sparks.length = 0;
      this.attached.clear();
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    } else {
      this.resize();
    }
  }

  setMode(mode: VisualiserColors): void {
    this.mode = mode;
  }

  setSparks(on: boolean): void {
    this.sparksOn = on;
  }

  /** Re-read colours and motion values (after a theme change). */
  refreshTokens(): void {
    const css = getComputedStyle(document.documentElement);
    const get = (name: string) => css.getPropertyValue(name).trim();
    const num = (name: string, fallback: number) => Number(get(name)) || fallback;
    this.tokens = {
      pcs: Array.from({ length: 12 }, (_, i) => get(`--viz-pc-${i}`)),
      accent: get('--viz-accent'),
      fingers: [1, 2, 3, 4, 5].map((f) => get(`--finger-${f}`)),
      blend: (get('--viz-blend') || 'source-over') as GlobalCompositeOperation,
      speed: num('--viz-rise-speed', 150),
      fadeMs: num('--viz-fade-ms', 1800),
      reducedFadeMs: num('--viz-reduced-fade-ms', 500),
      glow: num('--viz-glow', 16),
      sparkCount: num('--viz-spark-count', 10),
    };
  }

  // ── Input ────────────────────────────────────────────────────────────

  noteOn(note: number, velocity: number, now = performance.now()): void {
    this.physicallyHeld.add(note);
    if (!this.active) return;
    const previous = this.attached.get(note);
    if (previous) previous.end = now; // re-struck under the pedal: let the old bar go
    const bar = this.barPool.pop() ?? ({} as Bar);
    bar.note = note;
    bar.velocity = Math.min(1, velocity / 127);
    bar.start = now;
    bar.end = NaN;
    bar.color = this.colorFor(note);
    this.bars.push(bar);
    this.attached.set(note, bar);
    if (this.sparksOn && !this.reducedMotion.matches) this.burst(note, bar, now);
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

  private colorFor(note: number): string {
    const t = this.tokens;
    if (this.mode === 'rainbow') return t.pcs[note % 12]!;
    const finger = this.mode === 'fingers' ? this.fingerFor(note) : null;
    return finger ? t.fingers[finger - 1]! : t.accent;
  }

  private burst(note: number, bar: Bar, now: number): void {
    const geo = this.keyboard.measure();
    const x = geo.left - this.canvasLeft + geo.x0 + this.keyboard.keyPosition(note).centre * geo.unit;
    const count = Math.round(this.tokens.sparkCount * (0.5 + bar.velocity / 2));
    for (let i = 0; i < count; i++) {
      const s = this.sparkPool.pop() ?? ({} as Spark);
      s.x = x;
      s.y = this.height;
      s.vx = (Math.random() - 0.5) * 160;
      s.vy = -(120 + Math.random() * 220) * (0.6 + bar.velocity * 0.4);
      s.born = now;
      s.life = 380 + Math.random() * 320;
      s.color = bar.color;
      this.sparks.push(s);
    }
  }

  // ── Loop ─────────────────────────────────────────────────────────────

  private kick(): void {
    if (!this.raf && this.active && !document.hidden) this.raf = requestAnimationFrame(this.frame);
  }

  private cancel(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private frame = (now: number): void => {
    this.raf = 0;
    this.draw(now);
    if (this.bars.length > 0 || this.sparks.length > 0) this.kick();
  };

  private resize(): void {
    const box = this.el.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = box.width;
    this.height = box.height;
    this.canvasLeft = box.left;
    this.canvas.width = Math.round(box.width * dpr);
    this.canvas.height = Math.round(box.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.kick();
  }

  private draw(now: number): void {
    const { ctx, height: hgt, tokens: t } = this;
    ctx.clearRect(0, 0, this.width, hgt);
    if (this.bars.length === 0 && this.sparks.length === 0) return;
    const reduced = this.reducedMotion.matches;
    const geo = this.keyboard.measure();
    const offset = geo.left - this.canvasLeft + geo.x0;
    const pxPerMs = t.speed / 1000;

    ctx.globalCompositeOperation = t.blend;
    ctx.shadowBlur = t.glow;
    for (let i = this.bars.length - 1; i >= 0; i--) {
      const bar = this.bars[i]!;
      const held = Number.isNaN(bar.end);
      const strength = 0.55 + 0.45 * bar.velocity;
      let top: number;
      let bottom = hgt;
      let alpha = strength;
      if (reduced) {
        top = hgt * (1 - REDUCED_BAR_HEIGHT);
        if (!held) alpha *= 1 - (now - bar.end) / t.reducedFadeMs;
      } else if (held) {
        top = hgt - (now - bar.start) * pxPerMs;
      } else {
        const rise = (now - bar.end) * pxPerMs;
        bottom = hgt - rise;
        top = hgt - (bar.end - bar.start) * pxPerMs - rise;
        alpha *= 1 - (now - bar.end) / t.fadeMs;
      }
      if (alpha <= 0 || bottom <= 0) {
        this.barPool.push(bar);
        this.bars[i] = this.bars[this.bars.length - 1]!;
        this.bars.pop();
        continue;
      }
      top = Math.max(top, 0);
      if (bottom - top < MIN_BAR_LENGTH) top = bottom - MIN_BAR_LENGTH;

      const { centre, black } = this.keyboard.keyPosition(bar.note);
      const width = geo.unit * (black ? 0.5 : 0.72) * (0.85 + 0.15 * bar.velocity);
      const x = offset + centre * geo.unit - width / 2;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = bar.color;
      ctx.shadowColor = bar.color;
      ctx.beginPath();
      ctx.roundRect(x, top, width, bottom - top, Math.min(width / 2, 6));
      ctx.fill();
    }

    ctx.shadowBlur = 0;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i]!;
      const age = (now - s.born) / 1000;
      const life = (now - s.born) / s.life;
      if (life >= 1) {
        this.sparkPool.push(s);
        this.sparks[i] = this.sparks[this.sparks.length - 1]!;
        this.sparks.pop();
        continue;
      }
      const size = 1 + 2 * (1 - life);
      ctx.globalAlpha = 1 - life;
      ctx.fillStyle = s.color;
      ctx.fillRect(s.x + s.vx * age - size / 2, s.y + s.vy * age + 0.5 * GRAVITY * age * age - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}
