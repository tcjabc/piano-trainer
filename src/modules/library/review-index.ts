/**
 * Which Library items are in review, kept in memory so the Library can show
 * status on every row. "Remove from review" suspends the card rather than
 * deleting it, so adding it again brings back its history and schedule.
 */
import { isNew } from '../../core/scheduler';
import { storage, type CardRecord } from '../../core/storage';
import { newChordCard, newScaleCard, type DrillItem } from '../drill/items';

export type ReviewState = 'none' | 'new' | 'due' | 'scheduled';

export class ReviewIndex {
  private byKey = new Map<string, CardRecord>();

  async load(): Promise<void> {
    const cards = [...(await storage.getCards('chords')), ...(await storage.getCards('scales'))];
    this.byKey = new Map(cards.map((c) => [c.key, c]));
  }

  card(key: string): CardRecord | undefined {
    return this.byKey.get(key);
  }

  state(key: string, now = Date.now()): ReviewState {
    const card = this.byKey.get(key);
    if (!card || card.suspended) return 'none';
    if (isNew(card)) return 'new';
    return card.fsrs.due <= now ? 'due' : 'scheduled';
  }

  inReview(key: string): boolean {
    return this.state(key) !== 'none';
  }

  /** Add to review: a new card, or the suspended one back. Returns whether anything changed. */
  async add(item: DrillItem, now = Date.now()): Promise<boolean> {
    const existing = this.byKey.get(item.id);
    if (existing && !existing.suspended) return false;
    let card: CardRecord;
    if (existing) card = { ...existing, suspended: false, updatedAt: now };
    else if (item.module === 'chords') card = newChordCard(item.content, now);
    else if (item.module === 'scales') card = newScaleCard(item.content, now);
    else return false;
    await storage.putCard(card);
    this.byKey.set(card.key, card);
    return true;
  }

  async addAll(items: DrillItem[], now = Date.now()): Promise<number> {
    let added = 0;
    for (const item of items) if (await this.add(item, now)) added++;
    return added;
  }

  /** Take out of review (kept, suspended). */
  async remove(key: string, now = Date.now()): Promise<void> {
    const card = this.byKey.get(key);
    if (!card || card.suspended) return;
    const updated = { ...card, suspended: true, updatedAt: now };
    await storage.putCard(updated);
    this.byKey.set(key, updated);
  }
}

/** "in 3 h", "in 2 days", "now". */
export function relativeDue(due: number, now = Date.now()): string {
  const minutes = Math.round((due - now) / 60_000);
  if (minutes <= 0) return 'now';
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `in ${hours} h`;
  return `in ${Math.round(hours / 24)} days`;
}
