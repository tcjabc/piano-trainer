import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import { registerSW } from 'virtual:pwa-register';
import { storage } from './core/storage';
import { App } from './ui/app';

/** An update found this soon after opening is applied straight away (unless a drill is running). */
const JUST_OPENED_MS = 10_000;
/** How often an open app checks for a new version. */
const UPDATE_CHECK_MS = 60 * 60 * 1000;

async function boot(): Promise<void> {
  const root = document.getElementById('app')!;
  const settings = await storage.getSettings();
  void storage.requestPersistence();
  const app = new App(root, settings);
  const started = app.start();
  watchForUpdates(app);
  await started;
}

/**
 * Service-worker updates. A new version installs in the background and waits;
 * the user accepts it from the toast (U), which activates it and reloads.
 * Only the precache and the page cache change: IndexedDB (cards, reviews,
 * settings) and the piano-sample cache are never touched by an update.
 */
function watchForUpdates(app: App): void {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      const apply = () => void updateSW(true);
      if (performance.now() < JUST_OPENED_MS && !app.busy) apply();
      else app.offerUpdate(apply);
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      window.setInterval(() => void registration.update(), UPDATE_CHECK_MS);
      // An installed app is often resumed rather than reopened: check then too.
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) void registration.update();
      });
      warmPageCache();
    },
  });
}

/**
 * The page is cached network-first as it is fetched through the service
 * worker. The very first load happens before the worker is in control, so
 * fetch it once more when it takes over; the app then opens offline too.
 */
function warmPageCache(): void {
  const sw = navigator.serviceWorker;
  const fetchPage = () => void fetch(import.meta.env.BASE_URL, { cache: 'no-cache' }).catch(() => undefined);
  if (sw.controller) fetchPage();
  else sw.addEventListener('controllerchange', fetchPage, { once: true });
}

void boot();
