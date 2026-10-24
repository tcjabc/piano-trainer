/**
 * What a drill shows: a note, a chord or a scale, for a given hand. Card
 * keys, new cards, and the link between Library items and drill contents.
 */
import type { ScaleDirection } from '../../core/scales';
import { newFsrsState } from '../../core/scheduler';
import type { HandChoice } from '../../core/settings';
import {
  uuid,
  type CardRecord,
  type ChordCard,
  type ChordCardContent,
  type NoteCardContent,
  type ScaleCard,
  type ScaleCardContent,
  type SongCard,
  type SongCardContent,
} from '../../core/storage';
import { cardKey as noteCardKey } from '../notes/cards';
import { chordItemId, itemById, scaleItemId, type ChordItem, type LibraryItem, type ScaleItem } from '../library/catalog';

export type DrillItem =
  | { id: string; module: 'notes'; content: NoteCardContent }
  | { id: string; module: 'chords'; content: ChordCardContent }
  | { id: string; module: 'scales'; content: ScaleCardContent }
  | { id: string; module: 'songs'; content: SongCardContent };

export function chordCardKey(c: ChordCardContent): string {
  return `chords:${c.root}:${c.quality}:${c.inversion}:${c.hand}`;
}

export function scaleCardKey(c: ScaleCardContent): string {
  return `scales:${c.tonic}:${c.type}:${c.hand}:${c.octaves}`;
}

export function chordContent(item: ChordItem, hand: HandChoice): ChordCardContent {
  return { ...item.spec, hand };
}

export function scaleContent(item: ScaleItem, hand: HandChoice, octaves: 1 | 2): ScaleCardContent {
  return { tonic: item.tonic, type: item.type, hand, octaves };
}

/** The drill contents for a Library item (scales also need octaves). */
export function itemContent(item: LibraryItem, hand: HandChoice, octaves: 1 | 2): DrillItem {
  if (item.kind === 'chord') {
    const content = chordContent(item, hand);
    return { id: chordCardKey(content), module: 'chords', content };
  }
  const content = scaleContent(item, hand, octaves);
  return { id: scaleCardKey(content), module: 'scales', content };
}

export function noteItem(content: NoteCardContent): DrillItem {
  return { id: noteCardKey(content.clef, content.spelling), module: 'notes', content };
}

/** The Library item behind chord/scale contents. */
export function libraryItemFor(item: DrillItem): LibraryItem | undefined {
  if (item.module === 'chords') return itemById(chordItemId(item.content));
  if (item.module === 'scales') return itemById(scaleItemId(item.content.tonic, item.content.type));
  return undefined;
}

export function newChordCard(content: ChordCardContent, now: number): ChordCard {
  return { id: uuid(), key: chordCardKey(content), module: 'chords', content, fsrs: newFsrsState(now), createdAt: now, updatedAt: now };
}

export function newScaleCard(content: ScaleCardContent, now: number): ScaleCard {
  return { id: uuid(), key: scaleCardKey(content), module: 'scales', content, fsrs: newFsrsState(now), createdAt: now, updatedAt: now };
}

export function songCardKey(c: SongCardContent): string {
  return `songs:${c.songId}:${c.sectionId}`;
}

export function newSongCard(content: SongCardContent, now: number): SongCard {
  return { id: uuid(), key: songCardKey(content), module: 'songs', content, fsrs: newFsrsState(now), createdAt: now, updatedAt: now };
}

/** A card as a drill item (cards already carry their id, module and content). */
export function cardItem(card: CardRecord): DrillItem {
  return card as DrillItem;
}

/** Scale direction and staff options a drill needs, from settings. */
export interface DrillOptions {
  scaleDirection: ScaleDirection;
  /** Show the chord on the staff as well as its name. */
  chordStaff: boolean;
  fingering: boolean;
}
