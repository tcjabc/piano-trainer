/**
 * The Stats tab's small charts, as plain inline SVG: a calendar heatmap of
 * days practised and a sparkline. Colours come from CSS classes (heat
 * levels, text colour), so both themes work.
 */
import type { CalendarDay } from '../../core/stats-summary';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, ...children: (Node | string)[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...children);
  return el;
}

const CELL = 11;
const GAP = 3;
const STEP = CELL + GAP;
const LEFT = 28;
const TOP = 16;

/**
 * Days as columns of weeks (Monday at the top), each cell shaded by its heat
 * level, with month names along the top and a tooltip per day.
 */
export function calendarChart(days: readonly CalendarDay[], describe: (day: CalendarDay) => string): SVGSVGElement {
  const weeks = Math.ceil(days.length / 7);
  const width = LEFT + weeks * STEP;
  const height = TOP + 7 * STEP;
  const chart = svg('svg', { class: 'stats-calendar', viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': 'Days practised' });
  ['Mon', 'Wed', 'Fri'].forEach((name, i) => chart.append(svg('text', { x: 0, y: TOP + i * 2 * STEP + CELL - 2, class: 'stats-chart-label' }, name)));
  let lastMonth = '';
  days.forEach((day, i) => {
    const week = Math.floor(i / 7);
    const weekday = i % 7;
    const x = LEFT + week * STEP;
    if (weekday === 0) {
      const month = new Date(`${day.date}T12:00`).toLocaleString(undefined, { month: 'short' });
      // A month name over the first week that starts in it (not squeezed against the left edge).
      if (month !== lastMonth && (lastMonth !== '' || Number(day.date.slice(8)) <= 7)) {
        chart.append(svg('text', { x, y: TOP - 5, class: 'stats-chart-label' }, month));
      }
      lastMonth = month;
    }
    chart.append(svg('rect', { x, y: TOP + weekday * STEP, width: CELL, height: CELL, rx: 1.5, class: `stats-heat-${day.level}` }, svg('title', {}, describe(day))));
  });
  return chart;
}

/** A small line through values (oldest first), y from 0 to at least `floor`, with the last point marked. */
export function sparkline(values: readonly number[], floor = 1, width = 120, height = 28): SVGSVGElement {
  const chart = svg('svg', { class: 'stats-sparkline', viewBox: `0 0 ${width} ${height}`, width, height, 'aria-hidden': 'true' });
  const top = Math.max(floor, ...values);
  const pad = 3;
  const x = (i: number) => (values.length === 1 ? width - pad : pad + (i * (width - 2 * pad)) / (values.length - 1));
  const y = (v: number) => height - pad - (v / top) * (height - 2 * pad);
  // The target (floor, e.g. 100% tempo) as a faint line.
  chart.append(svg('line', { x1: 0, x2: width, y1: y(floor), y2: y(floor), class: 'stats-sparkline-target' }));
  if (values.length > 1) chart.append(svg('polyline', { points: values.map((v, i) => `${x(i)},${y(v)}`).join(' '), class: 'stats-sparkline-line' }));
  const last = values.length - 1;
  if (last >= 0) chart.append(svg('circle', { cx: x(last), cy: y(values[last]!), r: 2.5, class: 'stats-sparkline-dot' }));
  return chart;
}
