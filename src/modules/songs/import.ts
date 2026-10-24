/**
 * Turning files into songs: .mid/.midi (which may need a split point for the
 * hands), .musicxml/.xml and .mxl. Also the bundled public-domain songs.
 */
import { withSuggestedFingering } from '../../core/autofinger';
import type { SongData } from '../../core/song';
import { autoSections } from '../../core/song-sections';
import { midiToSong, MIDDLE_C, needsSplit, readMidi, type ParsedMidi } from '../../core/song-midi';
import { parseMusicXml, unzipMxl } from '../../core/song-musicxml';
import { uuid, type SongRecord } from '../../core/storage';
import minuet from '../../data/songs/minuet-in-g.musicxml?raw';
import ode from '../../data/songs/ode-to-joy.musicxml?raw';
import twinkle from '../../data/songs/twinkle-twinkle.musicxml?raw';

/** Simple arrangements written for this app (public-domain tunes). */
export const BUNDLED_SONGS: readonly { id: string; xml: string }[] = [
  { id: 'twinkle-twinkle', xml: twinkle },
  { id: 'ode-to-joy', xml: ode },
  { id: 'minuet-in-g', xml: minuet },
];

export const SONG_FILE_TYPES = '.mid,.midi,.musicxml,.xml,.mxl';

/** A file read and understood; MIDI files may still need a split point. */
export type PendingImport =
  | { kind: 'ready'; record: SongRecord }
  | { kind: 'midi'; parsed: ParsedMidi; fileName: string; needsSplit: boolean };

const baseName = (fileName: string) => fileName.replace(/\.[^.]+$/, '');

export interface ImportOptions {
  /** Suggest fingering for notes that have none (fingering from the file is never changed). */
  autoFinger?: boolean;
}

function fingered(data: SongData, { autoFinger = false }: ImportOptions): SongData {
  return autoFinger ? { ...data, notes: withSuggestedFingering(data.notes) } : data;
}

export function musicXmlRecord(xml: string, fileName: string, bundled: string | null = null, now = Date.now(), options: ImportOptions = {}): SongRecord {
  const parsed = parseMusicXml(xml);
  return {
    id: uuid(),
    title: parsed.title || baseName(fileName),
    artist: parsed.composer,
    format: 'musicxml',
    fileName,
    musicXml: xml,
    data: fingered(parsed.data, options),
    sections: autoSections(parsed.data.measures),
    bundled,
    createdAt: now,
    updatedAt: now,
  };
}

export function midiRecord(parsed: ParsedMidi, fileName: string, split = MIDDLE_C, now = Date.now(), options: ImportOptions = {}): SongRecord {
  const data = fingered(midiToSong(parsed, split), options);
  return {
    id: uuid(),
    title: parsed.title || baseName(fileName),
    artist: '',
    format: 'midi',
    fileName,
    musicXml: null,
    data,
    sections: autoSections(data.measures),
    bundled: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Read a dropped or picked file. Throws with a readable message when it can't be used. */
export async function readSongFile(file: File, options: ImportOptions = {}): Promise<PendingImport> {
  const name = file.name;
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'mid' || ext === 'midi') {
    const parsed = readMidi(new Uint8Array(await file.arrayBuffer()));
    if (parsed.tracks.length === 0) throw new Error(`“${name}” has no notes.`);
    return { kind: 'midi', parsed, fileName: name, needsSplit: needsSplit(parsed) };
  }
  if (ext === 'mxl') return { kind: 'ready', record: checked(musicXmlRecord(unzipMxl(new Uint8Array(await file.arrayBuffer())), name, null, Date.now(), options), name) };
  if (ext === 'musicxml' || ext === 'xml') return { kind: 'ready', record: checked(musicXmlRecord(await file.text(), name, null, Date.now(), options), name) };
  throw new Error(`“${name}” isn't a MIDI or MusicXML file.`);
}

function checked(record: SongRecord, name: string): SongRecord {
  if (record.data.notes.length === 0) throw new Error(`“${name}” has no notes.`);
  return record;
}
