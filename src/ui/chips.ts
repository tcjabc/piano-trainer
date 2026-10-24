/** A titled group of toggle chips (Library filters, Free practice selections). */
import { h } from './dom';

export function chipGroup<T extends string | number>(
  title: string,
  values: readonly T[],
  selected: readonly T[],
  label: (v: T) => string | Node,
  onToggle: (v: T) => void,
): HTMLElement {
  return h(
    'div.filter-group',
    null,
    h('h2.subheading', null, title),
    h(
      'div.chips',
      null,
      ...values.map((v) =>
        h('button.chip', { type: 'button', 'aria-pressed': String(selected.includes(v)), onclick: () => onToggle(v) }, label(v)),
      ),
    ),
  );
}

/** Add or remove a value from a selection list. */
export function toggled<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}
