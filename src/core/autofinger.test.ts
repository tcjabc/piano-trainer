// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import minuetXml from '../data/songs/minuet-in-g.musicxml?raw';
import odeXml from '../data/songs/ode-to-joy.musicxml?raw';
import twinkleXml from '../data/songs/twinkle-twinkle.musicxml?raw';
import { spanCost, suggestFingering, withSuggestedFingering } from './autofinger';
import type { Finger } from './fingering';
import { scaleFingering } from './fingerings';
import { scaleNotes } from './scales';
import { stepsOf, type SongHand, type SongNote } from './song';
import { parseMusicXml } from './song-musicxml';

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const chroma = (pc: string) => (PC[pc[0]!]! + (pc.includes('#') ? 1 : 0) - (pc.slice(1).includes('b') ? 1 : 0) + 12) % 12;

function line(midis: number[], hand: SongHand, fingers: (Finger | null)[] = []): SongNote[] {
  return midis.map((midi, i) => ({ id: `n${i}`, midi, beat: i, duration: 1, hand, finger: fingers[i] ?? null, velocity: 0.7 }));
}

/** A major scale, one octave up from the octave starting at `from`. */
function majorScale(tonic: string, from: number): number[] {
  const out: number[] = [];
  let prev = from - 1;
  for (const pc of [...scaleNotes(tonic, 'major'), tonic]) {
    let m = prev + 1;
    while (m % 12 !== chroma(pc)) m++;
    out.push(m);
    prev = m;
  }
  return out;
}

const fingersOf = (notes: SongNote[]) => {
  const got = suggestFingering(notes);
  return notes.map((n) => n.finger ?? got.get(n.id) ?? null);
};

describe('automatic fingering: scales', () => {
  for (const tonic of ['C', 'G', 'F', 'Bb']) {
    for (const [hand, from] of [['R', 60], ['L', 48]] as const) {
      it(`${tonic} major, ${hand === 'R' ? 'right' : 'left'} hand, matches the standard fingering (within one note)`, () => {
        const midis = majorScale(tonic, from);
        const standard = scaleFingering(tonic, 'major', hand, 1, midis)!;
        const auto = fingersOf(line(midis, hand));
        const differ = auto.filter((f, i) => f !== standard[i]).length;
        expect(differ, `auto ${auto.join('')} vs standard ${standard.join('')}`).toBeLessThanOrEqual(1);
      });
    }
  }
});

describe('automatic fingering: positions, spans and chords', () => {
  it('keeps a five-finger melody in one position', () => {
    expect(fingersOf(line([60, 62, 64, 65, 67, 65, 64, 62, 60], 'R'))).toEqual([1, 2, 3, 4, 5, 4, 3, 2, 1]);
    expect(fingersOf(line([48, 50, 52, 53, 55, 53, 52, 50, 48], 'L'))).toEqual([5, 4, 3, 2, 1, 2, 3, 4, 5]);
    expect(fingersOf(line([67, 69, 71, 72, 74], 'R'))).toEqual([1, 2, 3, 4, 5]);
  });

  it('never chooses an impossible span between neighbouring notes it could reach', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const hand of ['R', 'L'] as const) {
      const midis = Array.from({ length: 200 }, () => 0);
      midis[0] = hand === 'R' ? 67 : 50;
      for (let i = 1; i < midis.length; i++) midis[i] = midis[i - 1]! + Math.round((rand() - 0.5) * 14);
      const notes = line(midis, hand);
      const fingers = fingersOf(notes);
      const sign = hand === 'L' ? -1 : 1;
      for (let i = 1; i < notes.length; i++) {
        const [a, b] = [fingers[i - 1]!, fingers[i]!];
        if (a === b) continue;
        // Reachable leaps (within the widest practical span, 1–5) are always fingered within the limits.
        if (Math.abs(midis[i]! - midis[i - 1]!) <= 15) expect(spanCost(a, sign * midis[i - 1]!, b, sign * midis[i]!)).not.toBe(Infinity);
      }
    }
  });

  it('gives chords distinct fingers in pitch order, within reach', () => {
    const chord = (midis: number[], hand: SongHand, beat: number): SongNote[] =>
      midis.map((midi, i) => ({ id: `${hand}${beat}-${i}`, midi, beat, duration: 1, hand, finger: null, velocity: 0.7 }));
    const rh = [...chord([60, 64, 67], 'R', 0), ...chord([62, 65, 69], 'R', 1), ...chord([60, 64, 67, 72], 'R', 2)];
    const lh = [...chord([48, 52, 55], 'L', 0), ...chord([43, 47, 50, 53], 'L', 1)];
    const got = suggestFingering([...rh, ...lh]);
    expect([60, 64, 67].map((_, i) => got.get(`R0-${i}`))).toEqual([1, 3, 5]);
    expect([48, 52, 55].map((_, i) => got.get(`L0-${i}`))).toEqual([5, 3, 1]);
    for (const step of [...stepsOf(rh), ...stepsOf(lh)]) {
      const sorted = [...step.notes].sort((a, b) => a.midi - b.midi);
      const f = sorted.map((n) => got.get(n.id)!);
      expect(new Set(f).size).toBe(f.length);
      const rising = sorted[0]!.hand === 'R';
      for (let i = 1; i < f.length; i++) expect(rising ? f[i]! > f[i - 1]! : f[i]! < f[i - 1]!).toBe(true);
      const sign = rising ? 1 : -1;
      for (let i = 1; i < f.length; i++) expect(spanCost(f[i - 1]!, sign * sorted[i - 1]!.midi, f[i]!, sign * sorted[i]!.midi, false)).not.toBe(Infinity);
    }
    // A chord no hand can span (two octaves) is left alone.
    expect(suggestFingering(chord([48, 72], 'R', 0)).size).toBe(0);
  });

  it("doesn't touch notes that have fingering, and works around them", () => {
    const notes = line([60, 62, 64, 65, 67, 69, 71, 72], 'R', [null, null, null, 1, null, null, null, null]);
    const got = suggestFingering(notes);
    expect(got.has('n3')).toBe(false);
    expect(fingersOf(notes)).toEqual([1, 2, 3, 1, 2, 3, 4, 5]);
    const marked = withSuggestedFingering(notes);
    expect(marked[3]).toMatchObject({ finger: 1 });
    expect(marked[3]!.suggested).toBeUndefined();
    expect(marked[0]).toMatchObject({ finger: 1, suggested: true });
  });

  it('runs on a long piece in well under a second', () => {
    const midis = Array.from({ length: 4000 }, (_, i) => 60 + ((i * 7) % 15));
    const t0 = performance.now();
    suggestFingering([...line(midis, 'R'), ...line(midis.map((m) => m - 24), 'L')]);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe('automatic fingering: the bundled songs', () => {
  it('mostly agrees with their written fingering', () => {
    const report: string[] = [];
    let same = 0;
    let total = 0;
    for (const [name, xml] of [['Twinkle', twinkleXml], ['Ode to Joy', odeXml], ['Minuet in G', minuetXml]] as const) {
      const notes = parseMusicXml(xml).data.notes;
      const got = suggestFingering(notes.map((n) => ({ ...n, finger: null })));
      for (const hand of ['R', 'L'] as const) {
        const own = notes.filter((n) => n.hand === hand);
        const agree = own.filter((n) => got.get(n.id) === n.finger).length;
        report.push(`${name} ${hand}: ${agree}/${own.length}`);
        same += agree;
        total += own.length;
      }
    }
    expect(same / total, report.join(', ')).toBeGreaterThanOrEqual(0.85);
  });
});
