/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Build timestamp (ISO), set in vite.config.ts. */
declare const __APP_BUILD__: string;

declare module 'virtual:vadivam-icons' {
  const icons: Record<import('./ui/icon-list').IconName, string>;
  export default icons;
}
