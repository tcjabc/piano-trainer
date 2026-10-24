/**
 * Falling notes: the song's notes come down onto the keys they belong to,
 * reaching the keyboard's top edge as they are due — the Play visualiser's
 * glowing pills, reversed, with its colour presets. Notes are coloured by
 * hand, by finger (where fingering is known) or by the visualiser preset;
 * the hand you aren't playing is dimmed or hidden. Bar lines, finger numbers,
 * optional note names and how each note was played are drawn too.
 *
 * Colouring by finger, a note is filled with its finger's colour (red,
 * orange, yellow, green, blue for 1–5) inside a rim and glow in its hand's
 * colour (cyan left, magenta right), so finger and hand read at a glance; a
 * note without a finger is all hand colour. The cores are mostly colour, not
 * the visualiser's near-white, so hues stay saturated.
 */
import type { SongColors, VisualiserColors } from '../../core/settings';
import type { SongNote } from '../../core/song';
import { midiToName } from '../../core/pitch';
import { h } from '../../ui/dom';
import type { Keyboard } from '../../ui/keyboard';
import { drawCore, drawGlow, drawPill, presetColor, readVisualiserTokens, renderSprites, rgba, type Sprites, type Tokens } from '../play/glow';
import type { SongPlayer } from './song-player';

export interface FallingStyle {
  colors: SongColors;
  preset: VisualiserColors;
  noteNames: boolean;
}

/** Beats from the keyboard edge to the top of the view. */
const VISIBLE_BEATS = 8;
/** How much of a note's core keeps its colour (the visualiser's is mostly white). */
const CORE_TINT = 0.92;
/** The fill's width (of the bar), inside a rim of the hand's colour. */
const FILL_WIDTH = 0.74;
/** How long a judgement label stays under the note (ms). */
const LABEL_MS = 700;

interface Hit {
  note: SongNote;
  x: number;
  top: number;
  bottom: number;
  w: number;
}

export class FallingNotes {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tokens: Tokens;
  private sprites = new Map<string, Sprites>();
  private colorsCss = { left: '', right: '', text: '', muted: '', fingers: [] as string[] };
  private dpr = 1;
  private hits: Hit[] = [];

  constructor(private keyboard: Keyboard) {
    this.canvas = h('canvas.falling-canvas', { 'aria-hidden': 'true' });
    this.el = h('div.falling-notes', null, this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.tokens = readVisualiserTokens();
    this.refreshTokens();
  }

  /** Re-read colours (theme change). */
  refreshTokens(): void {
    this.tokens = readVisualiserTokens();
    const css = getComputedStyle(document.documentElement);
    const get = (name: string) => css.getPropertyValue(name).trim();
    this.colorsCss = {
      left: get('--stage-hand-left'),
      right: get('--stage-hand-right'),
      text: get('--stage-text') || '#f1f2f3',
      muted: get('--stage-text-muted') || '#888',
      fingers: [1, 2, 3, 4, 5].map((f) => get(`--finger-${f}`)),
    };
    this.sprites.clear();
  }

  /** The glow and rim: the note's hand. */
  private handColor(note: SongNote): string {
    return note.hand === 'L' ? this.colorsCss.left : this.colorsCss.right;
  }

  /** The fill: the note's finger when colouring by finger and it has one, else its hand. */
  private fillColor(note: SongNote, style: FallingStyle): string {
    return style.colors === 'finger' && note.finger ? this.colorsCss.fingers[note.finger - 1]! : this.handColor(note);
  }

  /** Sprites per colour, with a mostly coloured core. */
  private spritesFor(color: string): Sprites {
    let s = this.sprites.get(color);
    if (!s) this.sprites.set(color, (s = renderSprites(color, { ...this.tokens, coreTint: CORE_TINT })));
    return s;
  }

  /** Sprites per colour as the visualiser draws them (near-white core). */
  private presetSprites(color: string): Sprites {
    const key = `preset:${color}`;
    let s = this.sprites.get(key);
    if (!s) this.sprites.set(key, (s = renderSprites(color, this.tokens)));
    return s;
  }

  /** The note drawn at a point (CSS px relative to the canvas), for editing its finger. */
  noteAt(x: number, y: number): SongNote | null {
    const px = x * this.dpr;
    const py = y * this.dpr;
    const found = this.hits.find((hit) => px >= hit.x - hit.w / 2 && px <= hit.x + hit.w / 2 && py >= hit.top && py <= hit.bottom);
    return found?.note ?? null;
  }

  draw(player: SongPlayer, style: FallingStyle, now: number): void {
    const box = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, this.tokens.maxDpr);
    const W = Math.round(box.width * this.dpr);
    const H = Math.round(box.height * this.dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    const ctx = this.ctx;
    const dpr = this.dpr;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);
    if (W === 0 || H === 0) return;

    const data = player.songData;
    const pos = player.position;
    const ppb = H / VISIBLE_BEATS;
    const yOf = (beat: number) => H - (beat - pos) * ppb;
    const geo = this.keyboard.measure();
    const originX = (geo.left - box.left + geo.x0) * dpr;
    const unit = geo.unit * dpr;
    const [rangeStart, rangeEnd] = player.currentRange;

    // Bar lines, with numbers; the end of the range a little stronger.
    ctx.font = `${11 * dpr}px var(--font-mono, monospace)`;
    ctx.textBaseline = 'bottom';
    for (const m of data.measures) {
      const y = yOf(m.beat);
      if (y < 0 || y > H) continue;
      ctx.fillStyle = rgba(this.colorsCss.text, 0.1);
      ctx.fillRect(0, y, W, Math.max(1, dpr));
      ctx.fillStyle = rgba(this.colorsCss.text, 0.35);
      ctx.fillText(m.label, 6 * dpr, y - 2 * dpr);
    }
    for (const beat of [rangeStart, rangeEnd]) {
      const y = yOf(beat);
      if (y < 0 || y > H) continue;
      ctx.fillStyle = rgba(this.colorsCss.text, 0.45);
      ctx.fillRect(0, y - dpr, W, 2 * dpr);
    }

    // Notes.
    const shown = player.shownHands;
    const active = player.activeHands;
    const other = player.config.otherHand;
    this.hits = [];
    const alphas: number[] = [];
    ctx.globalCompositeOperation = 'lighter';
    for (const n of data.notes) {
      if (!shown.includes(n.hand)) continue;
      if (n.beat > pos + VISIBLE_BEATS || n.beat + n.duration < pos) continue;
      const bottom = Math.min(H, yOf(n.beat));
      const top = yOf(n.beat + n.duration);
      const { centre, black } = this.keyboard.keyPosition(n.midi);
      const x = originX + centre * unit;
      const w = unit * (black ? 0.6 : 0.9) * this.tokens.barWidth;
      const mark = player.marks.get(n.id);
      let alpha = active.includes(n.hand) ? 1 : other === 'play' ? 0.55 : 0.3;
      if (mark?.kind === 'missed') alpha *= 0.35;
      ctx.globalAlpha = alpha;
      const hit = { note: n, x, top: Math.min(top, bottom - w), bottom, w };
      // The visualiser's colours are drawn just as it draws them; otherwise only the glow, for now.
      if (style.colors === 'preset') drawPill(ctx, this.tokens, this.presetSprites(presetColor(this.tokens, style.preset, n.midi)), x, hit.top, bottom, w);
      else drawGlow(ctx, this.tokens, this.spritesFor(this.handColor(n)), x, hit.top, bottom, w);
      this.hits.push(hit);
      alphas.push(alpha);
    }

    // The fills, over every glow and unblended, so a finger's colour keeps its hue.
    if (style.colors !== 'preset') {
      ctx.globalCompositeOperation = 'source-over';
      this.hits.forEach(({ note, x, top, bottom, w }, i) => {
        ctx.globalAlpha = alphas[i]!;
        drawCore(ctx, this.spritesFor(this.fillColor(note, style)), x, top, bottom, w, FILL_WIDTH);
      });
    }

    // Labels on the notes: finger number, and the note name if asked for.
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const hit of this.hits) {
      const n = hit.note;
      const room = hit.bottom - hit.top;
      if (hit.bottom <= 0 || room < 14 * dpr || hit.w < 10 * dpr) continue;
      const size = Math.min(13 * dpr, hit.w * 0.9);
      ctx.font = `700 ${size}px Chillax, sans-serif`;
      ctx.fillStyle = '#111';
      let y = hit.bottom - 3 * dpr;
      if (n.finger) {
        // A suggested finger: in italics, so it reads as a suggestion.
        if (n.suggested) ctx.font = `italic 600 ${size}px Chillax, sans-serif`;
        ctx.fillText(String(n.finger), hit.x, y);
        y -= size + 2 * dpr;
      }
      if (style.noteNames && room > (n.finger ? 32 : 16) * dpr) {
        ctx.font = `600 ${size * 0.85}px Chillax, sans-serif`;
        ctx.fillText((n.spelling ?? midiToName(n.midi)).replace(/-?\d+$/, '').replace('#', '♯').replace(/(?<=[A-G])b/, '♭'), hit.x, y);
      }
    }

    // How recent presses went, just above the keys.
    ctx.font = `700 ${11 * dpr}px Chillax, sans-serif`;
    for (const m of player.recentMarks) {
      const age = now - m.at;
      if (age < 0 || age > LABEL_MS || m.kind === 'hit') continue;
      const { centre } = this.keyboard.keyPosition(m.midi);
      const x = originX + centre * unit;
      ctx.globalAlpha = 1 - age / LABEL_MS;
      // Neutral, told by shape: ✓ on time, ✕ a wrong note, words for early, late and missed.
      ctx.fillStyle = m.kind === 'missed' ? this.colorsCss.muted : this.colorsCss.text;
      const label = m.kind === 'on-time' ? '✓' : m.kind === 'wrong' ? '✕' : m.kind;
      ctx.fillText(label, x, H - 6 * dpr - (age / LABEL_MS) * 14 * dpr);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'start';
  }
}
