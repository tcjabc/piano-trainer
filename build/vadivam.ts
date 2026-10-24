import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Plugin } from 'vite';
import { getIconData, iconToHTML, iconToSVG } from '@iconify/utils';
import { ICON_NAMES } from '../src/ui/icon-list.ts';

const VIRTUAL_ID = 'virtual:vadivam-icons';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

/**
 * Vite plugin: exposes `virtual:vadivam-icons`, a map of icon name → inline
 * SVG markup, built from @iconify-json/vadivam at build time so icons work
 * offline and only the listed icons are shipped.
 */
export function vadivamIcons(): Plugin {
  return {
    name: 'vadivam-icons',
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_ID) return undefined;
      const require = createRequire(import.meta.url);
      const path = require.resolve('@iconify-json/vadivam/icons.json');
      const set = JSON.parse(readFileSync(path, 'utf8')) as Parameters<typeof getIconData>[0];
      const icons: Record<string, string> = {};
      for (const name of ICON_NAMES) {
        const data = getIconData(set, name);
        if (!data) throw new Error(`Vadivam has no icon named "${name}"`);
        const { attributes, body } = iconToSVG(data, { height: '1em', width: '1em' });
        icons[name] = iconToHTML(body, { ...attributes, 'aria-hidden': 'true', class: 'icon-svg' });
      }
      return `export default ${JSON.stringify(icons)};`;
    },
  };
}
