/**
 * Glowing pills, shared by the Play visualiser (bars rising from the keys)
 * and the song view (notes falling onto them): colour presets from the
 * --viz-* tokens, sprites pre-rendered once per colour, and the pill drawn
 * from them with additive blending.
 */
import type { VisualiserColors } from '../../core/settings';

/** Pre-rendered sprites for one colour. */
export interface Sprites {
  color: string;
  glowBody: HTMLCanvasElement;
  glowCapTop: HTMLCanvasElement;
  glowCapBottom: HTMLCanvasElement;
  coreBody: HTMLCanvasElement;
  coreCapTop: HTMLCanvasElement;
  coreCapBottom: HTMLCanvasElement;
  ember: HTMLCanvasElement;
  flash: HTMLCanvasElement;
}

export interface Tokens {
  pcs: string[];
  neon: string;
  ice: string;
  accent: string;
  coreTint: number;
  speed: number;
  barWidth: number;
  coreWidth: number;
  glowSpread: number;
  fadeZone: number;
  repressGap: number;
  flashMs: number;
  pulseMs: number;
  pulseAlpha: number;
  reducedFadeMs: number;
  emberMax: number;
  emberBurst: number;
  emberTrickle: number;
  emberLifeMs: number;
  maxDpr: number;
  horizon: string;
}

/** Bar width the sprites are drawn at (device px); they are scaled to each bar. */
export const SPRITE_BAR = 32;
export const EMBER_SPRITE = 24;
export const FLASH_SPRITE = 64;

/** Colours and motion values for glowing bars, from the --viz-* tokens. */
export function readVisualiserTokens(): Tokens {
  const css = getComputedStyle(document.documentElement);
  const get = (name: string) => css.getPropertyValue(name).trim();
  const num = (name: string, fallback: number) => {
    const v = Number.parseFloat(get(name));
    return Number.isFinite(v) ? v : fallback;
  };
  return {
    pcs: Array.from({ length: 12 }, (_, i) => get(`--viz-pc-${i}`)),
    neon: get('--viz-neon'),
    ice: get('--viz-ice'),
    accent: get('--viz-accent'),
    coreTint: num('--viz-core-tint', 0.18),
    speed: num('--viz-rise-speed', 190),
    barWidth: num('--viz-bar-width', 0.8),
    coreWidth: num('--viz-core-width', 0.42),
    glowSpread: num('--viz-glow-spread', 0.9),
    fadeZone: num('--viz-fade-zone', 0.15),
    repressGap: num('--viz-repress-gap', 6),
    flashMs: num('--viz-horizon-flash-ms', 450),
    pulseMs: num('--viz-horizon-pulse-ms', 220),
    pulseAlpha: num('--viz-horizon-pulse-alpha', 0.9),
    reducedFadeMs: num('--viz-reduced-fade-ms', 500),
    emberMax: num('--viz-ember-max', 600),
    emberBurst: num('--viz-ember-burst', 22),
    emberTrickle: num('--viz-ember-trickle', 7),
    emberLifeMs: num('--viz-ember-life-ms', 1500),
    maxDpr: num('--viz-max-dpr', 2),
    horizon: get('--stage-text') || '#f1f2f3',
  };
}

/** A note's colour in a preset: by pitch class, hot pink/red, cyan/blue, or one accent colour. */
export function presetColor(t: Tokens, mode: VisualiserColors, note: number): string {
  if (mode === 'neon') return t.neon;
  if (mode === 'ice') return t.ice;
  if (mode === 'accent') return t.accent;
  return t.pcs[note % 12]!;
}

/** Glow layer, then the near-white core, each as cap + stretched body + cap. */
export function drawPill(ctx: CanvasRenderingContext2D, t: Tokens, s: Sprites, x: number, top: number, bottom: number, barW: number): void {
  drawGlow(ctx, t, s, x, top, bottom, barW);
  drawCore(ctx, s, x, top, bottom, barW, t.coreWidth);
}

/**
 * The core alone, `width` of the bar wide. The song view draws every glow
 * first, then the cores over them unblended, so a finger-coloured core keeps
 * its hue inside a glow in the hand's colour.
 */
export function drawCore(ctx: CanvasRenderingContext2D, s: Sprites, x: number, top: number, bottom: number, barW: number, width: number): void {
  const capTop = top + barW / 2;
  const capBottom = bottom - barW / 2;
  const body = Math.max(0, capBottom - capTop);
  const cw = barW * width;
  ctx.drawImage(s.coreCapTop, x - cw / 2, capTop - cw / 2, cw, cw / 2);
  if (body > 0) ctx.drawImage(s.coreBody, x - cw / 2, capTop, cw, body);
  ctx.drawImage(s.coreCapBottom, x - cw / 2, capBottom, cw, cw / 2);
}

export function drawGlow(ctx: CanvasRenderingContext2D, t: Tokens, s: Sprites, x: number, top: number, bottom: number, barW: number): void {
  const capTop = top + barW / 2;
  const capBottom = bottom - barW / 2;
  const body = Math.max(0, capBottom - capTop);
  const gw = barW * (1 + 2 * t.glowSpread);
  ctx.drawImage(s.glowCapTop, x - gw / 2, capTop - gw / 2, gw, gw / 2);
  if (body > 0) ctx.drawImage(s.glowBody, x - gw / 2, capTop, gw, body);
  ctx.drawImage(s.glowCapBottom, x - gw / 2, capBottom, gw, gw / 2);
}

/** Glow, core, ember and flash sprites for one colour. */
export function renderSprites(color: string, t: Tokens): Sprites {
  const gw = Math.ceil(SPRITE_BAR * (1 + 2 * t.glowSpread));
  const barEdge = 1 / (1 + 2 * t.glowSpread); // bar radius as a fraction of the glow radius
  // Glow profile: colour across the bar, then a soft falloff to nothing.
  const stops: [number, string][] = [];
  for (let i = 0; i <= 12; i++) {
    const d = i / 12;
    // Solid across the bar itself, so the pill reads at full width; soft beyond it.
    const a = d <= barEdge * 0.8 ? 0.85 : d <= barEdge ? 0.85 - 0.25 * ((d - barEdge * 0.8) / (barEdge * 0.2)) : 0.6 * Math.pow(1 - (d - barEdge) / (1 - barEdge), 2.4);
    stops.push([d, rgba(color, a)]);
  }

  const glowBody = sprite(gw, 2, (c) => {
    const g = c.createLinearGradient(0, 0, gw, 0);
    for (const [d, col] of stops) {
      g.addColorStop(0.5 - d / 2, col);
      g.addColorStop(0.5 + d / 2, col);
    }
    c.fillStyle = g;
    c.fillRect(0, 0, gw, 2);
  });
  const glowCap = (flip: boolean) =>
    sprite(gw, gw / 2, (c) => {
      const cy = flip ? 0 : gw / 2;
      const g = c.createRadialGradient(gw / 2, cy, 0, gw / 2, cy, gw / 2);
      for (const [d, col] of stops) g.addColorStop(d, col);
      c.fillStyle = g;
      c.fillRect(0, 0, gw, gw / 2);
    });

  const core = mix(color, '#ffffff', 1 - t.coreTint);
  const cw = SPRITE_BAR;
  const coreBody = sprite(cw, 2, (c) => {
    c.fillStyle = core;
    c.fillRect(1, 0, cw - 2, 2);
    c.fillStyle = rgba(core, 0.5);
    c.fillRect(0, 0, 1, 2);
    c.fillRect(cw - 1, 0, 1, 2);
  });
  const coreCap = (flip: boolean) =>
    sprite(cw, cw / 2, (c) => {
      c.fillStyle = core;
      c.beginPath();
      c.arc(cw / 2, flip ? 0 : cw / 2, cw / 2 - 0.5, flip ? 0 : Math.PI, flip ? Math.PI : Math.PI * 2);
      c.fill();
    });

  const ember = sprite(EMBER_SPRITE, EMBER_SPRITE, (c) => {
    const r = EMBER_SPRITE / 2;
    const g = c.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, rgba(core, 1));
    g.addColorStop(0.18, rgba(color, 0.9));
    g.addColorStop(0.45, rgba(color, 0.25));
    g.addColorStop(1, rgba(color, 0));
    c.fillStyle = g;
    c.fillRect(0, 0, EMBER_SPRITE, EMBER_SPRITE);
  });

  const flash = sprite(FLASH_SPRITE, FLASH_SPRITE, (c) => {
    const r = FLASH_SPRITE / 2;
    const g = c.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, rgba(core, 0.9));
    g.addColorStop(0.12, rgba(color, 0.8));
    g.addColorStop(0.5, rgba(color, 0.2));
    g.addColorStop(1, rgba(color, 0));
    c.fillStyle = g;
    c.fillRect(0, 0, FLASH_SPRITE, FLASH_SPRITE);
  });

  return {
    color,
    glowBody,
    glowCapTop: glowCap(false),
    glowCapBottom: glowCap(true),
    coreBody,
    coreCapTop: coreCap(false),
    coreCapBottom: coreCap(true),
    ember,
    flash,
  };
}

function sprite(w: number, h: number, paint: (c: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(w));
  canvas.height = Math.max(1, Math.ceil(h));
  paint(canvas.getContext('2d')!);
  return canvas;
}

function parseColor(color: string): [number, number, number] {
  const hex = color.trim().replace('#', '');
  const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex.slice(0, 6);
  const n = Number.parseInt(full, 16);
  return Number.isNaN(n) ? [255, 255, 255] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(color: string, alpha: number): string {
  if (color.startsWith('rgb')) return color;
  const [r, g, b] = parseColor(color);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

/** Mix two hex colours; `amount` is how much of `other`. */
export function mix(color: string, other: string, amount: number): string {
  const a = parseColor(color);
  const b = parseColor(other);
  const c = a.map((v, i) => Math.round(v + (b[i]! - v) * amount));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
