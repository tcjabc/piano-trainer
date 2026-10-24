/**
 * Songs with their section progress, as the Songs tab and the player use
 * them. A thin layer over storage.
 */
import { newProgress, type SectionProgress } from '../../core/song-learning';
import { storage, type SongProgressRecord, type SongRecord } from '../../core/storage';
import { BUNDLED_SONGS, musicXmlRecord } from './import';

export interface SongEntry {
  song: SongRecord;
  /** By section id. */
  progress: Map<string, SongProgressRecord>;
}

export async function loadSong(id: string): Promise<SongEntry | null> {
  const song = await storage.getSong(id);
  if (!song) return null;
  return { song, progress: new Map((await storage.getSongProgress(id)).map((p) => [p.sectionId, p])) };
}

export async function loadSongs(): Promise<SongEntry[]> {
  const songs = await storage.getSongs();
  return Promise.all(songs.map(async (song) => ({ song, progress: new Map((await storage.getSongProgress(song.id)).map((p) => [p.sectionId, p])) })));
}

export function progressOf(entry: SongEntry, sectionId: string): SectionProgress {
  return entry.progress.get(sectionId) ?? newProgress();
}

export async function saveProgress(entry: SongEntry, sectionId: string, progress: SectionProgress): Promise<SongProgressRecord> {
  const record: SongProgressRecord = { ...progress, id: `${entry.song.id}:${sectionId}`, songId: entry.song.id, sectionId, updatedAt: Date.now() };
  await storage.putSongProgress(record);
  entry.progress.set(sectionId, record);
  return record;
}

export async function saveSong(song: SongRecord): Promise<SongRecord> {
  const saved = { ...song, updatedAt: Date.now() };
  await storage.putSong(saved);
  return saved;
}

/** Add the bundled songs (once, on first run; they can be deleted like any other). */
export async function addBundledSongs(): Promise<void> {
  const now = Date.now();
  for (const [i, b] of BUNDLED_SONGS.entries()) await storage.putSong(musicXmlRecord(b.xml, `${b.id}.musicxml`, b.id, now + i));
}
