/**
 * The key of a song. A key signature from the file wins; when it gives no
 * mode (MusicXML often leaves <mode> out) the notes decide between the major
 * key and its relative minor. Without a signature the key is found with the
 * Krumhansl-Schmuckler algorithm: a pitch-class histogram (weighted by note
 * length) is correlated with the Krumhansl-Kessler probe-tone profiles of all
 * 24 keys, and the best match wins. Runs once, at import. UI-agnostic.
 */
import { keyName, type SongData } from './song';

export type KeyMode = 'major' | 'minor';

/** Where a song's key came from. */
export type KeySource = 'signature' | 'detected';

/** A key signature as written: sharps positive, and the mode when the file states one. */
export interface KeySignature {
  fifths: number;
  mode: KeyMode | null;
}

export interface FoundKey {
  /** Pitch class of the tonic, 0 = C. */
  tonic: number;
  mode: KeyMode;
  /** e.g. "E minor". */
  name: string;
  /** Correlation with the key's profile, −1…1. */
  score: number;
}

/** Krumhansl & Kessler (1982) probe-tone ratings, from the tonic up. */
const PROFILES: Record<KeyMode, readonly number[]> = {
  major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
  minor: [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
};

const pc = (n: number) => ((n % 12) + 12) % 12;

/** Time spent on each pitch class (in beats). */
export function pitchClassHistogram(notes: readonly { midi: number; duration: number }[]): number[] {
  const hist = new Array<number>(12).fill(0);
  for (const n of notes) hist[pc(n.midi)]! += Math.max(0, n.duration);
  return hist;
}

/** Pearson correlation; 0 when either side has no variation. */
function correlation(a: readonly number[], b: readonly number[]): number {
  const mean = (v: readonly number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i]! - ma) * (b[i]! - mb);
    da += (a[i]! - ma) ** 2;
    db += (b[i]! - mb) ** 2;
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}

/** How well a histogram fits a key. */
function fit(hist: readonly number[], tonic: number, mode: KeyMode): number {
  const profile = PROFILES[mode];
  return correlation(hist, hist.map((_, i) => profile[pc(i - tonic)]!));
}

/** Key signature of a key, spelled the usual way (G♭ major rather than F♯, E♭ minor rather than D♯). */
function fifthsOf(tonic: number, mode: KeyMode): number {
  const major = mode === 'major' ? tonic : pc(tonic + 3);
  const fifths = pc(major * 7);
  return fifths > 5 ? fifths - 12 : fifths;
}

const majorTonic = (fifths: number) => pc(fifths * 7);

/** The best-fitting of the 24 keys, or null when there is nothing to go on. */
export function findKey(notes: readonly { midi: number; duration: number }[]): FoundKey | null {
  const hist = pitchClassHistogram(notes);
  if (hist.every((x) => x === hist[0])) return null;
  let best: Omit<FoundKey, 'name'> | null = null;
  for (const mode of ['major', 'minor'] as const) {
    for (let tonic = 0; tonic < 12; tonic++) {
      const score = fit(hist, tonic, mode);
      if (!best || score > best.score) best = { tonic, mode, score };
    }
  }
  return { ...best!, name: keyName(fifthsOf(best!.tonic, best!.mode), best!.mode)! };
}

/** Major or relative minor for a signature without a mode; major when the notes can't tell. */
export function modeForSignature(notes: readonly { midi: number; duration: number }[], fifths: number): KeyMode {
  const hist = pitchClassHistogram(notes);
  const tonic = majorTonic(fifths);
  return fit(hist, pc(tonic + 9), 'minor') > fit(hist, tonic, 'major') ? 'minor' : 'major';
}

/**
 * The first key signature in a MusicXML score, read from the text (no DOM),
 * for songs stored before keys were detected.
 */
export function signatureFromMusicXml(xml: string): KeySignature | null {
  const key = /<key[\s>][\s\S]*?<\/key>/.exec(xml)?.[0];
  const fifths = key && /<fifths>\s*(-?\d+)\s*<\/fifths>/.exec(key)?.[1];
  if (!fifths) return null;
  const mode = /<mode>\s*(\w+)\s*<\/mode>/.exec(key!)?.[1];
  return { fifths: Number(fifths), mode: mode === 'major' || mode === 'minor' ? mode : null };
}

/** A song's key and where it came from (key null when it can't be told). */
export function songKey(
  notes: readonly { midi: number; duration: number }[],
  signature: KeySignature | null,
): Pick<SongData, 'key' | 'keySource'> {
  if (signature) {
    const name = keyName(signature.fifths, signature.mode ?? modeForSignature(notes, signature.fifths));
    if (name) return { key: name, keySource: 'signature' };
  }
  const found = findKey(notes);
  return found ? { key: found.name, keySource: 'detected' } : { key: null };
}
