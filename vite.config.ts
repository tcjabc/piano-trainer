import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { vadivamIcons } from './build/vadivam.ts';

// GitHub Pages serves the app from /<repo-name>/.
const BASE = '/piano-trainer/';

export default defineConfig({
  base: BASE,
  // VexFlow (with its embedded Bravura font) and smplr make one large chunk; that is expected.
  build: { chunkSizeWarningLimit: 1200 },
  plugins: [
    vadivamIcons(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['fonts/Chillax-{Medium,Semibold,Bold}.woff2', 'icon.svg'],
      manifest: {
        name: 'Piano Trainer',
        short_name: 'Piano Trainer',
        description: 'Personal piano practice with a MIDI keyboard.',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        background_color: '#f1f2f3',
        theme_color: '#f1f2f3',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Only the 500–700 Chillax weights are used.
        globIgnores: ['**/Chillax-{Extralight,Light,Regular,Variable}.woff2'],
        // The app bundle includes VexFlow's embedded music font.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        // Piano samples come from smplr's CDN; cache each file the first time it loads.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://smpldsnds.github.io',
            handler: 'CacheFirst',
            options: {
              cacheName: 'piano-samples',
              expiration: { maxEntries: 1000 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
