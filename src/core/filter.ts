/** A filter over the Library (also what a deck saves). An empty list means "any". */
import type { ChordQuality } from './chords';
import type { ScaleType } from './scales';

export type ItemKind = 'chord' | 'scale';

export interface LibraryFilter {
  kinds: ItemKind[];
  qualities: ChordQuality[];
  scaleTypes: ScaleType[];
  /** Spelled roots/tonics, e.g. "F#", "Gb". */
  roots: string[];
  inversions: number[];
}

export const EMPTY_FILTER: LibraryFilter = { kinds: [], qualities: [], scaleTypes: [], roots: [], inversions: [] };

export function isEmptyFilter(f: LibraryFilter): boolean {
  return Object.values(f).every((v) => (v as unknown[]).length === 0);
}
