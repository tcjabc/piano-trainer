import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, noteDrillOptions, withDefaults } from './settings';

describe('settings', () => {
  it('maps the practised hand to a clef', () => {
    expect(noteDrillOptions({ ...DEFAULT_SETTINGS, hand: 'left' }).clef).toBe('bass');
    expect(noteDrillOptions({ ...DEFAULT_SETTINGS, hand: 'right' }).clef).toBe('treble');
    expect(noteDrillOptions({ ...DEFAULT_SETTINGS, hand: 'both' }).clef).toBe('both');
  });

  it('migrates the old stored clef to a hand', () => {
    const migrated = withDefaults({ noteDrill: { clef: 'bass', newPerDay: 4 } });
    expect(migrated.hand).toBe('left');
    expect(migrated.noteDrill.newPerDay).toBe(4);
    expect(migrated.noteDrill).not.toHaveProperty('clef');
    expect(migrated.showFingerNumbers).toBe(true);
  });

  it('prefers a stored hand over a legacy clef', () => {
    expect(withDefaults({ hand: 'both', noteDrill: { clef: 'treble' } }).hand).toBe('both');
  });

  it('replaces the retired "fingers" visualiser colours and adds the overlay setting', () => {
    const legacy = { visualiser: { enabled: true, colors: 'fingers', sparks: false } } as unknown as Parameters<typeof withDefaults>[0];
    expect(withDefaults(legacy).visualiser).toEqual({ enabled: true, colors: 'rainbow', sparks: false, overlay: true });
  });
});
