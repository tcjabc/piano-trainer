/** Tiny DOM builder: h('div.card', { onclick }, child, 'text'). */
import icons from 'virtual:vadivam-icons';
import type { IconName } from './icon-list';

type Child = Node | string | null | undefined | false;
type Props = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tagAndClasses: K | `${K}.${string}`,
  props: Props | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const [tag, ...classes] = tagAndClasses.split('.') as [K, ...string[]];
  const el = document.createElement(tag);
  if (classes.length) el.className = classes.join(' ');
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2), value as EventListener);
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value);
    } else if (key in el && key !== 'list' && key !== 'type') {
      (el as unknown as Props)[key] = value;
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  el.append(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false));
  return el;
}

/** An inline Vadivam icon. */
export function icon(name: IconName, extraClass = ''): HTMLSpanElement {
  const span = h('span.icon', { 'aria-hidden': 'true' });
  if (extraClass) span.classList.add(extraClass);
  span.innerHTML = icons[name];
  return span;
}

/** Read a CSS custom property holding a time ("320ms" or "0.3s") as milliseconds. */
export function cssTimeMs(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const value = parseFloat(raw);
  if (Number.isNaN(value)) return fallback;
  return raw.endsWith('ms') ? value : value * 1000;
}
