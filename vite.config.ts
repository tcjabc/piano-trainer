import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { vadivamIcons } from './build/vadivam.ts';

// GitHub Pages serves the app from /<repo-name>/.
const BASE = '/piano-trainer/';

export default defineConfig({
  base: BASE,
  define: {
    // Shown in Settings, so an update is easy to confirm.
    __APP_BUILD__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    sourcemap: false,
    // VexFlow (with its embedded Bravura font) and smplr make one large chunk; that is expected.
    chunkSizeWarningLimit: 1200,
  },
  plugins: [
    vadivamIcons(),
    VitePWA({
      // A new version waits until the user accepts it (or the app was just opened); see src/main.ts.
      registerType: 'prompt',
      injectRegister: false,
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
        // Hashed JS/CSS and the font (the plugin adds the manifest and its icon itself).
        // index.html is not precached: it is fetched network-first (below) so a new deploy is picked up.
        globPatterns: ['**/*.{js,css,woff2}'],
        globIgnores: ['**/*.map', 'index.html'],
        navigateFallback: null,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        // The waiting worker takes over only when the update is accepted.
        skipWaiting: false,
        // The app bundle includes VexFlow's embedded music font.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            // The page itself: network first (3 s), cached copy when offline.
            // (Serialised into the service worker, so the base path is written out.)
            urlPattern: ({ request, url }) =>
              request.mode === 'navigate' ||
              (url.origin === self.location.origin &&
                (url.pathname === '/piano-trainer/' || url.pathname === '/piano-trainer/index.html')),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'piano-trainer-pages',
              networkTimeoutSeconds: 3,
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Piano samples from smplr's CDN, cached the first time each loads. Its own cache,
            // with no expiry, so app updates never remove it.
            urlPattern: ({ url }) => url.origin === 'https://smpldsnds.github.io',
            handler: 'CacheFirst',
            options: {
              cacheName: 'piano-samples',
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
