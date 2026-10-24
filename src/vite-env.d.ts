/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module 'virtual:vadivam-icons' {
  const icons: Record<import('./ui/icon-list').IconName, string>;
  export default icons;
}
