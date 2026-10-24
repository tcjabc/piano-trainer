/**
 * Every Vadivam icon the app uses. The build inlines only these SVGs
 * (see build/vadivam.ts), so adding an icon means adding its name here.
 */
export const ICON_NAMES = [
  'piano',
  'midi-port',
  'unplug',
  'play',
  'pause',
  'rotate-ccw',
  'skip-forward',
  'volume-2',
  'arrow-left',
  'settings',
  'sun',
  'moon',
  'monitor',
  'download',
  'upload',
  'chevron-right',
  'calendar-clock',
  'check',
  'zoom-in',
  'zoom-out',
] as const;

export type IconName = (typeof ICON_NAMES)[number];
