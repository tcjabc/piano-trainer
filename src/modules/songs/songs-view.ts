/**
 * The Songs tab of the Library: import (file picker or drag and drop), the
 * list with title, artist, length, key, tempo and progress per section,
 * renaming and deleting. A MIDI file without exactly two tracks is split
 * into hands at a key chosen with a preview.
 */
import { LEARNED } from '../../core/song-learning';
import { MIDDLE_C, midiToSong, splitCounts, type ParsedMidi } from '../../core/song-midi';
import { songSeconds, tempoAt, type SongData } from '../../core/song';
import { storage } from '../../core/storage';
import { midiToName } from '../../core/pitch';
import { h, icon } from '../../ui/dom';
import { formatNoteName } from '../../ui/note-text';
import { midiRecord, readSongFile, SONG_FILE_TYPES } from './import';
import { loadSongs, progressOf, saveSong, type SongEntry } from './song-store';

export interface SongsActions {
  open: (songId: string) => void;
  /** Whether imports get suggested fingering, and changing that setting. */
  autoFingering: () => boolean;
  setAutoFingering: (on: boolean) => void;
}

/** Lowest and highest split points offered (C2…C6). */
const SPLIT_MIN = 36;
const SPLIT_MAX = 84;

export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class SongsView {
  readonly el: HTMLElement;
  private listEl: HTMLElement;
  private messageEl: HTMLElement;
  private importEl: HTMLElement;
  private entries: SongEntry[] = [];
  /** Song being renamed, or deleted (asking to confirm). */
  private editing: { id: string; kind: 'rename' | 'delete' } | null = null;
  private fileInput: HTMLInputElement;
  private autoFingerInput!: HTMLInputElement;

  constructor(private actions: SongsActions) {
    this.fileInput = h('input', { type: 'file', accept: SONG_FILE_TYPES, multiple: true, hidden: true });
    this.fileInput.addEventListener('change', () => {
      void this.importFiles([...(this.fileInput.files ?? [])]);
      this.fileInput.value = '';
    });
    this.listEl = h('div.song-list', { role: 'list' });
    this.messageEl = h('p.songs-message', { role: 'status' });
    this.importEl = h('div.song-import-slot');
    this.el = h(
      'section.songs',
      { 'aria-label': 'Songs' },
      h(
        'div.songs-toolbar',
        null,
        h('h1.heading', null, 'Songs'),
        this.autoFingerBox(),
        h('p.muted.songs-drop-hint', null, 'Drop .mid, .musicxml or .mxl files here, or'),
        h('button.button-primary', { type: 'button', onclick: () => this.fileInput.click() }, icon('upload'), h('span', null, 'Import song')),
        this.fileInput,
      ),
      this.messageEl,
      this.importEl,
      this.listEl,
    );
    this.el.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      this.el.classList.add('is-dropping');
    });
    this.el.addEventListener('dragleave', (e) => {
      if (e.target === this.el) this.el.classList.remove('is-dropping');
    });
    this.el.addEventListener('drop', (e) => {
      e.preventDefault();
      this.el.classList.remove('is-dropping');
      void this.importFiles([...(e.dataTransfer?.files ?? [])]);
    });
  }

  /** The setting is read on refresh: this view is built before the app's settings are in place. */
  private autoFingerBox(): HTMLElement {
    const input = (this.autoFingerInput = h('input.checkbox', { type: 'checkbox', id: 'songs-auto-finger' }));
    input.addEventListener('change', () => this.actions.setAutoFingering(input.checked));
    return h(
      'span.checkbox-row.songs-auto-finger',
      { title: 'Fingering from the file is never changed; suggestions are shown fainter' },
      input,
      h('label.muted', { htmlFor: input.id }, 'Suggest fingering where a song has none'),
    );
  }

  async refresh(): Promise<void> {
    this.autoFingerInput.checked = this.actions.autoFingering();
    this.entries = await loadSongs();
    this.render();
  }

  openPicker(): void {
    this.fileInput.click();
  }

  private say(text: string, warn = false): void {
    this.messageEl.textContent = text;
    this.messageEl.classList.toggle('is-warning', warn);
  }

  private async importFiles(files: File[]): Promise<void> {
    const added: string[] = [];
    for (const file of files) {
      try {
        const options = { autoFinger: this.actions.autoFingering() };
        const pending = await readSongFile(file, options);
        if (pending.kind === 'ready') {
          await storage.putSong(pending.record);
          added.push(pending.record.title);
        } else if (!pending.needsSplit) {
          const record = midiRecord(pending.parsed, pending.fileName, undefined, undefined, options);
          await storage.putSong(record);
          added.push(record.title);
        } else {
          // One file at a time needs the split preview; ask about it now.
          const record = await this.askSplit(pending.parsed, pending.fileName);
          if (record) added.push(record);
        }
      } catch (err) {
        this.say(err instanceof Error ? err.message : String(err), true);
        await this.refresh();
        return;
      }
    }
    if (added.length) this.say(`Imported ${added.map((t) => `“${t}”`).join(', ')}.`);
    await this.refresh();
  }

  /** Choose where to split a MIDI file's notes into hands, with a preview; resolves with the title, or null if cancelled. */
  private askSplit(parsed: ParsedMidi, fileName: string): Promise<string | null> {
    return new Promise((resolve) => {
      let split = MIDDLE_C;
      const canvas = h('canvas.split-preview', { width: 720, height: 180, 'aria-label': 'Preview of the notes, split into hands' });
      const counts = h('p.split-counts.num');
      const keyLabel = h('span.split-key.num');
      const slider = h('input.split-slider', { type: 'range', min: SPLIT_MIN, max: SPLIT_MAX, step: 1, value: String(split), 'aria-label': 'Split point' });
      const draw = () => {
        const data = midiToSong(parsed, split);
        drawSplitPreview(canvas, data, split);
        const c = splitCounts(parsed, split);
        counts.textContent = `Left hand ${c.left} notes · right hand ${c.right} notes`;
        keyLabel.replaceChildren(formatNoteName(`${midiToName(split)}${split === MIDDLE_C ? ' (middle C)' : ''}`));
      };
      slider.addEventListener('input', () => {
        split = Number(slider.value);
        draw();
      });
      const finish = async (ok: boolean) => {
        this.importEl.replaceChildren();
        if (!ok) return resolve(null);
        const record = midiRecord(parsed, fileName, split, undefined, { autoFinger: this.actions.autoFingering() });
        await saveSong(record);
        resolve(record.title);
      };
      const tracks = parsed.tracks.length === 1 ? 'one track' : `${parsed.tracks.length} tracks`;
      this.importEl.replaceChildren(
        h(
          'section.panel.song-import',
          { 'aria-label': 'Split hands' },
          h('h2.subheading', null, `Split hands · ${fileName}`),
          h('p.muted', null, `This file has ${tracks}, so the hands are split at a key: notes below it go to the left hand.`),
          canvas,
          h('label.split-row', null, h('span', null, 'Split at '), keyLabel, slider),
          counts,
          h(
            'div.button-row',
            null,
            h('button.button-primary', { type: 'button', onclick: () => void finish(true) }, 'Import'),
            h('button.button-outline', { type: 'button', onclick: () => void finish(false) }, 'Cancel'),
          ),
        ),
      );
      draw();
      slider.focus();
    });
  }

  private render(): void {
    if (this.entries.length === 0) {
      this.listEl.replaceChildren(h('p.muted.songs-empty', null, 'No songs yet. Import a MIDI or MusicXML file to start.'));
      return;
    }
    this.listEl.replaceChildren(...this.entries.map((e) => this.row(e)));
  }

  private row(entry: SongEntry): HTMLElement {
    const { song } = entry;
    const editing = this.editing?.id === song.id ? this.editing.kind : null;
    const learned = song.sections.filter((s) => progressOf(entry, s.id).step >= LEARNED).length;
    const last = Math.max(0, ...[...entry.progress.values()].map((p) => p.lastPractised ?? 0));
    const meta = [
      formatDuration(songSeconds(song.data)),
      song.data.key,
      `♩ = ${Math.round(tempoAt(song.data, 0))}`,
      `${song.sections.length} section${song.sections.length === 1 ? '' : 's'}`,
      song.format === 'midi' ? 'MIDI' : 'MusicXML',
    ].filter(Boolean).join(' · ');

    const title =
      editing === 'rename'
        ? this.renameFields(entry)
        : h(
            'div.song-title-block',
            null,
            h('button.song-title', { type: 'button', title: 'Practise this song', onclick: () => this.actions.open(song.id) }, song.title),
            h('span.song-artist.muted', null, song.artist || 'Unknown artist'),
          );

    return h(
      'div.song-row',
      { role: 'listitem' },
      title,
      h('p.song-meta.muted.num', null, formatNoteName(meta)),
      h(
        'div.song-progress',
        { title: 'Learning path per section' },
        h(
          'span.section-pips',
          { 'aria-hidden': 'true' },
          ...song.sections.map((s) => h('span.section-pip', { dataset: { step: String(progressOf(entry, s.id).step) }, title: s.name })),
        ),
        h('span.muted', null, `${learned} of ${song.sections.length} learned${last ? ` · last practised ${new Date(last).toLocaleDateString()}` : ''}`),
      ),
      editing === 'delete'
        ? h(
            'div.song-actions',
            null,
            h('span', null, `Delete “${song.title}” and its progress?`),
            h('button.button-outline', { type: 'button', onclick: () => void this.remove(song.id) }, 'Delete'),
            h('button.button-outline', { type: 'button', onclick: () => this.edit(null) }, 'Keep'),
          )
        : editing === 'rename'
          ? null
          : h(
              'div.song-actions',
              null,
              h('button.button-outline', { type: 'button', onclick: () => this.actions.open(song.id) }, icon('play'), h('span', null, 'Practise')),
              h('button.button-outline', { type: 'button', onclick: () => this.edit({ id: song.id, kind: 'rename' }) }, 'Rename'),
              h('button.button-outline', { type: 'button', onclick: () => this.edit({ id: song.id, kind: 'delete' }) }, 'Delete'),
            ),
    );
  }

  private renameFields(entry: SongEntry): HTMLElement {
    const title = h('input.control', { type: 'text', value: entry.song.title, 'aria-label': 'Title', maxLength: 120 });
    const artist = h('input.control', { type: 'text', value: entry.song.artist, placeholder: 'Artist', 'aria-label': 'Artist', maxLength: 120 });
    const save = async () => {
      const t = title.value.trim();
      if (!t) return;
      await saveSong({ ...entry.song, title: t, artist: artist.value.trim() });
      this.editing = null;
      await this.refresh();
    };
    for (const input of [title, artist]) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') void save();
        if (e.key === 'Escape') {
          e.stopPropagation();
          this.edit(null);
        }
      });
    }
    queueMicrotask(() => title.focus());
    return h(
      'div.song-rename',
      null,
      title,
      artist,
      h('button.button-outline', { type: 'button', onclick: () => void save() }, 'Save'),
      h('button.button-outline', { type: 'button', onclick: () => this.edit(null) }, 'Cancel'),
    );
  }

  private edit(editing: SongsView['editing']): void {
    this.editing = editing;
    this.render();
  }

  private async remove(id: string): Promise<void> {
    const title = this.entries.find((e) => e.song.id === id)?.song.title ?? 'The song';
    await storage.deleteSong(id);
    this.editing = null;
    this.say(`Deleted “${title}”.`);
    await this.refresh();
  }
}

/** A piano roll of the song: time across, pitch up, coloured by hand, with the split line. */
function drawSplitPreview(canvas: HTMLCanvasElement, data: SongData, split: number): void {
  const ctx = canvas.getContext('2d')!;
  const css = getComputedStyle(canvas);
  const W = canvas.width;
  const H = canvas.height;
  const notes = data.notes;
  const lo = Math.min(SPLIT_MIN, ...notes.map((n) => n.midi)) - 1;
  const hi = Math.max(SPLIT_MAX, ...notes.map((n) => n.midi)) + 1;
  const end = Math.max(1, ...notes.map((n) => n.beat + n.duration));
  const y = (midi: number) => H - ((midi - lo) / (hi - lo)) * H;
  ctx.clearRect(0, 0, W, H);
  const left = css.getPropertyValue('--color-hand-left').trim() || '#56657a';
  const right = css.getPropertyValue('--color-hand-right').trim() || '#7d7466';
  const rowH = Math.max(1.5, H / (hi - lo) - 0.5);
  for (const n of notes) {
    ctx.fillStyle = n.hand === 'L' ? left : right;
    ctx.fillRect((n.beat / end) * W, y(n.midi) - rowH / 2, Math.max(1.5, (n.duration / end) * W - 1), rowH);
  }
  ctx.strokeStyle = css.getPropertyValue('--color-text').trim() || '#000';
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(0, y(split - 0.5));
  ctx.lineTo(W, y(split - 0.5));
  ctx.stroke();
  ctx.setLineDash([]);
}
