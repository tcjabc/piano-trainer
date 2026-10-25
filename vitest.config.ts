import { defineConfig } from 'vitest/config';
import { vadivamIcons } from './build/vadivam.ts';

export default defineConfig({
  // UI modules import the icon set (src/ui/dom.ts).
  plugins: [vadivamIcons()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
