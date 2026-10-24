/**
 * The score with OpenSheetMusicDisplay (MusicXML songs only), with a cursor
 * that follows the song. OSMD is loaded on first use so it doesn't weigh on
 * the rest of the app.
 */
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { h } from '../../ui/dom';

const EPS = 1e-6;

export class NotationView {
  readonly el: HTMLElement;
  private inner: HTMLElement;
  private status: HTMLElement;
  private osmd: OpenSheetMusicDisplay | null = null;
  private loaded: string | null = null;
  private loading: Promise<void> | null = null;
  private cursorBeat = -1;

  constructor() {
    this.inner = h('div.song-notation-score');
    this.status = h('p.muted.song-notation-status', { role: 'status' });
    this.el = h('div.song-notation', null, this.status, this.inner);
  }

  /** Show a score (re-rendered only when it changed, e.g. after a fingering edit). */
  async show(xml: string): Promise<void> {
    if (this.loaded === xml) return this.loading ?? undefined;
    this.loaded = xml;
    this.loading = this.render(xml);
    return this.loading;
  }

  private async render(xml: string): Promise<void> {
    this.status.textContent = 'Loading the score…';
    try {
      if (!this.osmd) {
        const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
        this.osmd = new OpenSheetMusicDisplay(this.inner, {
          autoResize: true,
          backend: 'svg',
          drawTitle: false,
          drawComposer: false,
          drawCredits: false,
          drawPartNames: false,
          drawFingerings: true,
          followCursor: true,
          cursorsOptions: [{ type: 0, color: '#3ba5f7', alpha: 0.45, follow: true }],
        });
      }
      await this.osmd.load(xml);
      this.osmd.render();
      this.osmd.cursor.show();
      this.cursorBeat = 0;
      this.status.textContent = '';
    } catch (err) {
      this.status.textContent = `The score couldn't be shown: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /** Move the cursor to the first notes at or after a beat (quarter notes from the start). */
  setPosition(beat: number): void {
    const cursor = this.osmd?.cursor;
    if (!cursor || this.loaded === null || Math.abs(beat - this.cursorBeat) < EPS) return;
    const current = () => cursor.Iterator.currentTimeStamp.RealValue * 4;
    if (current() > beat + EPS) cursor.reset();
    while (!cursor.Iterator.EndReached && current() < beat - EPS) cursor.next();
    this.cursorBeat = beat;
  }
}
