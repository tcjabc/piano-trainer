/**
 * Small form builders shared by Settings and Free practice. Each form gets
 * its own id prefix; ids are deterministic per render (call reset() first),
 * so focus can be restored after a re-render.
 */
import { h, icon } from './dom';
import type { IconName } from './icon-list';

export interface Choice<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  /** Shown but not selectable (e.g. "coming later"). */
  disabled?: boolean;
  title?: string;
}

export class FormBuilder {
  private count = 0;

  constructor(private readonly prefix: string) {}

  /** Start numbering ids again; call at the start of each render. */
  reset(): void {
    this.count = 0;
  }

  nextId(): string {
    return `${this.prefix}-${++this.count}`;
  }

  section(title: string, ...children: (HTMLElement | null)[]): HTMLElement {
    return h('div.settings-section', null, h('h2.subheading', null, title), ...children);
  }

  field(label: string, control: HTMLElement): HTMLElement {
    const target = control.matches('select, input') ? control : control.querySelector('select, input');
    const id = target?.id;
    return h(
      'div.field',
      null,
      control.matches('.segmented')
        ? h('span.field-label', { id: `${control.id}-label` }, label)
        : h('label.field-label', { htmlFor: id }, label),
      control,
    );
  }

  select(
    options: { value: string; label: string }[],
    value: string,
    onChange: (value: string) => void,
    ariaLabel?: string,
  ): HTMLSelectElement {
    const el = h(
      'select.control',
      { id: this.nextId(), 'aria-label': ariaLabel },
      ...options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)),
    );
    el.addEventListener('change', () => onChange(el.value));
    return el;
  }

  checkbox(checked: boolean, onChange: (v: boolean) => void, text: string): HTMLElement {
    const input = h('input.checkbox', { type: 'checkbox', id: this.nextId(), checked });
    input.addEventListener('change', () => onChange(input.checked));
    return h('span.checkbox-row', null, input, h('label.muted', { htmlFor: input.id }, text));
  }

  numberInput(value: number, min: number, max: number, onChange: (v: number) => void): HTMLInputElement {
    const el = h('input.control.control-number.num', { type: 'number', id: this.nextId(), min, max, value: String(value) });
    el.addEventListener('change', () => {
      const v = Math.round(Number(el.value));
      onChange(Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : value);
    });
    return el;
  }

  segmented<T extends string>(name: string, options: Choice<T>[], value: T, onChange: (v: T) => void): HTMLElement {
    const id = this.nextId();
    return h(
      'div.segmented',
      { id, role: 'radiogroup', 'aria-labelledby': `${id}-label` },
      ...options.map((o) => {
        const input = h('input.visually-hidden', {
          type: 'radio',
          name: `${this.prefix}-${name}`,
          value: o.value,
          id: `${id}-${o.value}`,
          checked: o.value === value,
          disabled: o.disabled,
        });
        input.addEventListener('change', () => input.checked && onChange(o.value));
        return h(
          o.disabled ? 'label.segment.is-disabled' : 'label.segment',
          { htmlFor: input.id, title: o.title },
          input,
          o.icon ? icon(o.icon) : null,
          h('span', null, o.label),
        );
      }),
    );
  }
}
