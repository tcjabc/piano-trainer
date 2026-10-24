import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type FreeNoteSettings } from '../../core/settings';
import { Storage } from '../../core/storage';
import { newCard } from './cards';
import { freeContents, freeRange, staffForHand } from './free';
import { FreeSource } from '../drill/sources';
import { noteItem } from '../drill/items';

const base = DEFAULT_SETTINGS.freePractice.notes;
const opts = (o: Partial<FreeNoteSettings>): FreeNoteSettings => ({ ...base, ...o });

describe('freeContents', () => {
  it('uses the hand’s clef and range like the drill', () => {
    expect(freeContents(base).map((c) => `${c.clef}:${c.spelling}`)).toEqual([
      'treble:C4', 'treble:D4', 'treble:E4', 'treble:F4', 'treble:G4',
    ]);
    expect(freeContents(opts({ hand: 'left' })).every((c) => c.clef === 'bass')).toBe(true);
    expect(staffForHand('both')).toBe('grand');
  });

  it('spells picked keys: sharps only, or both spellings with accidentals', () => {
    const picked = opts({ selection: 'specific', specific: [61, 48, 61] });
    expect(freeContents(picked).map((c) => c.spelling)).toEqual(['C3', 'C#4']);
    expect(freeContents({ ...picked, accidentals: true }).map((c) => c.spelling)).toEqual(['C3', 'C#4', 'Db4']);
  });

  it('splits picked keys at middle C for both hands', () => {
    const both = freeContents(opts({ selection: 'specific', hand: 'both', specific: [55, 64] }));
    expect(both.map((c) => `${c.clef}:${c.spelling}`)).toEqual(['bass:G3', 'treble:E4']);
    expect(freeRange(opts({ selection: 'specific', specific: [] }))).toBeNull();
  });
});

describe('FreeSource', () => {
  it('serves cards at random without an end and never twice in a row', () => {
    let i = 0;
    const rolls = [0, 0, 0.99, 0.5, 0];
    const source = new FreeSource(freeContents(base).map(noteItem), 'treble', async () => {}, () => rolls[i++ % rolls.length]!);
    const ids = Array.from({ length: 40 }, () => source.next()!.id);
    expect(ids.every((id, k) => k === 0 || id !== ids[k - 1])).toBe(true);
    expect(new Set(ids).size).toBeGreaterThan(1);
  });

  it('serves a stepped-back card next', () => {
    const source = new FreeSource(freeContents(base).map(noteItem), 'treble', async () => {});
    const first = source.next()!;
    source.next();
    source.pushFront(first);
    expect(source.next()!.id).toBe(first.id);
  });

  it('logs attempts but never touches cards or reviews', async () => {
    const db = new Storage('free-test');
    const card = newCard({ clef: 'treble', spelling: 'C4', midi: 60 }, 1);
    await db.putCard(card);
    const source = new FreeSource(freeContents(base).map(noteItem), 'treble', (a) => db.addAttempt(a));
    const item = source.next()!;
    await source.record(item, { correct: true, ms: 850 }, false);
    await source.record(item, { correct: false, ms: 2000 }, true);

    const attempts = await db.getAttemptsSince(0);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({ mode: 'free', key: item.id, content: item.content });
    expect(await db.getReviewsSince(0)).toEqual([]);
    expect(await db.getCard(card.id)).toEqual(card);
    expect(source.corner()).toBe('Free · 2 played · 50%');
    expect((await db.exportAll()).attempts).toHaveLength(2);
    await db.close();
  });
});
