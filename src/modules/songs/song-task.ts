/**
 * A song section's review card in a Study session: the section is played
 * once at the step of the learning path it has reached (hands, mode and
 * tempo), in the player's falling-notes view, and graded on accuracy and
 * timing. The pass also counts for the section's progress.
 */
import type { SongCardContent } from '../../core/storage';
import type { SongSettings, VisualiserColors } from '../../core/settings';
import type { Task, TaskHost } from '../drill/tasks';
import type { PlayerView } from './player-view';
import { loadSong } from './song-store';

export interface SongTaskDeps {
  /** The player used for review cards (separate from the Library's). */
  player: PlayerView;
  settings: () => SongSettings;
  preset: () => VisualiserColors;
}

export class SongTask implements Task {
  private shownAt = 0;
  private left = false;

  constructor(
    private content: SongCardContent,
    private host: TaskHost,
    private deps: SongTaskDeps,
  ) {}

  show(): void {
    this.shownAt = performance.now();
    void this.open();
  }

  private async open(): Promise<void> {
    const entry = await loadSong(this.content.songId);
    if (this.left) return;
    const section = entry?.song.sections.find((s) => s.id === this.content.sectionId);
    if (!entry || !section) {
      this.host.staff.showPrompt('Song section not found', 'It may have been deleted or merged; skip it with →.');
      return;
    }
    const { player } = this.deps;
    player.openReview(entry, section.id, this.deps.settings(), this.deps.preset(), (pass) => {
      this.host.outcome({ correct: pass.clean, ms: performance.now() - this.shownAt, song: pass });
      this.host.complete();
    });
    this.host.stage(player.el);
    player.activate();
  }

  noteOn(note: number, time: number): void {
    this.deps.player.noteOn(note, time);
  }

  noteOff(): void {}

  restart(): void {
    this.deps.player.restart();
  }

  /** Nothing to give away: the notes are on screen. */
  hint(): void {}

  pause(paused: boolean): void {
    const { player } = this.deps;
    if (paused === player.playing) player.togglePlay();
  }

  leave(): void {
    this.left = true;
    this.deps.player.deactivate();
  }
}
