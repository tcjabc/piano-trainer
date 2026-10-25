/**
 * What a song pass tells the stats. Each judged note is a hit or a miss for
 * the song (and the section being played), by hand; a missed note also
 * counts against its measure. A wrong key counts against the measure being
 * played and the song's accuracy, but not either hand (it was no hand's
 * note). A pass completes the play; a clean pass with both hands in
 * play-along, over a whole section or the whole song, is a tempo for the
 * clean-tempo record (wait mode doesn't keep time, and A/B loops are parts).
 */
import type { StatsRecorder } from '../../core/stats-recorder';
import { sectionStatsId, songStatsId, type ItemRef } from '../../core/stats';
import { measureAt, type SongData, type SongNote } from '../../core/song';
import type { Mark, PassReport } from './song-player';

export type SongStatsSink = Pick<StatsRecorder, 'result' | 'measureMiss' | 'completed' | 'cleanPass'>;

/** The song, and the section when one is selected. */
export function songStatsRefs(songId: string, sectionId: string | null): ItemRef[] {
  const song: ItemRef = { id: songStatsId(songId), kind: 'song', songId };
  return sectionId === null ? [song] : [song, { id: sectionStatsId(songId, sectionId), kind: 'section', songId }];
}

const notesById = new WeakMap<SongData, Map<string, SongNote>>();

function noteById(data: SongData, id: string): SongNote | undefined {
  let map = notesById.get(data);
  if (!map) notesById.set(data, (map = new Map(data.notes.map((n) => [n.id, n]))));
  return map.get(id);
}

/** A judged note or wrong key; `position` is the player's beat when it happened. */
export function recordMark(sink: SongStatsSink, data: SongData, songId: string, refs: readonly ItemRef[], mark: Mark, position: number): void {
  if (mark.kind === 'wrong') {
    for (const ref of refs) sink.result(ref, false);
    sink.measureMiss(songId, measureAt(data, position));
    return;
  }
  const note = mark.noteId ? noteById(data, mark.noteId) : undefined;
  if (!note) return;
  const correct = mark.kind !== 'missed';
  for (const ref of refs) sink.result(ref, correct, note.hand);
  if (!correct) sink.measureMiss(songId, measureAt(data, note.beat));
}

/**
 * A finished pass. `sectionId` is the section played (null for the whole
 * song); `loop` says an A/B loop narrowed it.
 */
export function recordPass(sink: SongStatsSink, songId: string, sectionId: string | null, loop: boolean, pass: PassReport): void {
  sink.completed();
  if (loop || !pass.clean || pass.hands !== 'both' || pass.mode !== 'play-along') return;
  sink.cleanPass(songId, sectionId, pass.tempo);
}
