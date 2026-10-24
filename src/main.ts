import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import { registerSW } from 'virtual:pwa-register';
import { storage } from './core/storage';
import { App } from './ui/app';

async function boot(): Promise<void> {
  const root = document.getElementById('app')!;
  const settings = await storage.getSettings();
  void storage.requestPersistence();
  await new App(root, settings).start();
}

registerSW({ immediate: true });
void boot();
