import { describe, expect, it } from 'vitest';
import { deviceOf, keyRangeForDevice } from './midi';

describe('keyRangeForDevice', () => {
  it('reads the key count from the device name', () => {
    expect(keyRangeForDevice('KeyLab Essential 61')).toEqual({ low: 36, high: 96 });
    expect(keyRangeForDevice('MIDIIN2 (KeyLab Essential 49)')).toEqual({ low: 36, high: 84 });
    expect(keyRangeForDevice('Digital Piano 88')).toEqual({ low: 21, high: 108 });
  });

  it('returns null when the name gives no key count', () => {
    expect(keyRangeForDevice('USB MIDI Interface')).toBeNull();
    expect(keyRangeForDevice('Keystation 610')).toBeNull();
    expect(keyRangeForDevice(null)).toBeNull();
  });
});

describe('deviceOf', () => {
  it('groups the ports of one device', () => {
    expect(deviceOf('KeyLab Essential 61')).toBe('keylab essential 61');
    expect(deviceOf('MIDIIN2 (KeyLab Essential 61)')).toBe('keylab essential 61');
    expect(deviceOf('KeyLab Essential 61 DAW')).toBe('keylab essential 61');
    expect(deviceOf('KeyLab Essential 61 MIDI')).toBe('keylab essential 61');
    expect(deviceOf('2- KeyLab Essential 61')).toBe('keylab essential 61');
    expect(deviceOf('Launchkey Mini MIDI')).not.toBe(deviceOf('KeyLab Essential 61'));
  });
});
