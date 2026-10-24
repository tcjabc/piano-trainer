import type { ThemePreference } from '../core/settings';

/** Light/dark follow the OS unless the user picked one. */
export function applyTheme(theme: ThemePreference): void {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
}
