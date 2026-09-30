/**
 * Small, dependency-free SVG chart builders for the internal analytics page.
 *
 * Every function is pure: data and a pixel width in, an SVG string out. Charts
 * are drawn at the width the page actually has (so text stays readable on a
 * phone) and are styled by the `ch-*` classes in `internal/analytics.astro`,
 * which keeps colors in the site's CSS variables. All text is escaped, all
 * numbers are sanitized, and empty data returns '' so the caller can show its
 * own "nothing yet" message.
 *
 * Only erasable TypeScript is used so `scripts/test-charts.mjs` can import this
 * file directly under Node.
 */

export type Point = { label: string; value: number };
export type Slice = Point;
export type LineSeries = { name: string; values: number[] };
export type ValueFormat = (value: number) => string;

const CHAR_W = 6.4; // average glyph width at 12px, for truncating labels
const PALETTE_SIZE = 6;

export const formatCount: ValueFormat = (n) => Math.round(n).toLocaleString('en-US');

export function formatCompact(n: number): string {
  const v = Math.abs(n);
  if (v >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (v >= 1_000) return `${trim(n / 1_000)}k`;
  return String(Math.round(n));
}

function trim(n: number): string {
  return String(Math.round(n * 10) / 10);
}

export function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const px = (n: number): string => String(Math.round(n * 10) / 10);

function clip(label: string, maxChars: number): string {
  const text = String(label ?? '');
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function cleanPoints(points: ReadonlyArray<Point> | undefined): Point[] {
  return (points ?? []).map((p) => ({ label: String(p?.label ?? ''), value: num(p?.value) }));
}

/** Round the top of a value axis up to a friendly number and list its ticks. */
export function niceScale(max: number, target = 4): { max: number; step: number; ticks: number[] } {
  const top = num(max) || 1;
  const rough = top / Math.max(1, target);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / magnitude;
  const factor = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10;
  const step = factor * magnitude;
  const niceMax = Math.ceil(top / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= niceMax + step / 1000; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { max: niceMax, step, ticks };
}

function svg(width: number, height: number, title: string, description: string, body: string): string {
  const w = Math.max(200, Math.round(width));
  const h = Math.round(height);
  return (
    `<svg class="ch" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${escapeXml(title)}">` +
    `<title>${escapeXml(title)}</title><desc>${escapeXml(description)}</desc>${body}</svg>`
  );
}

function describe(points: ReadonlyArray<Point>, format: ValueFormat): string {
  return points.map((p) => `${p.label}: ${format(p.value)}`).join('; ');
}

// ── Horizontal bars ─────────────────────────────────────────────────────────

export function barChart(
  rows: ReadonlyArray<Point> | undefined,
  options: { width: number; title: string; format?: ValueFormat; rowHeight?: number },
): string {
  const data = cleanPoints(rows);
  if (!data.length) return '';
  const format = options.format ?? formatCount;
  const rowH = options.rowHeight ?? 30;
  const width = Math.max(200, options.width);
  const labelW = Math.min(Math.round(width * 0.4), 170);
  const valueW = Math.max(...data.map((d) => format(d.value).length)) * CHAR_W + 8;
  const trackW = Math.max(20, width - labelW - valueW - 8);
  const max = Math.max(...data.map((d) => d.value), 1);
  const maxChars = Math.max(6, Math.floor(labelW / CHAR_W));

  const body = data
    .map((d, i) => {
      const y = i * rowH;
      const barW = d.value > 0 ? Math.max(3, (d.value / max) * trackW) : 0;
      const mid = y + rowH / 2;
      return (
        `<g><title>${escapeXml(d.label)}: ${escapeXml(format(d.value))}</title>` +
        `<text class="ch-label" x="0" y="${px(mid + 4)}">${escapeXml(clip(d.label, maxChars))}</text>` +
        `<rect class="ch-track" x="${labelW}" y="${px(y + 6)}" width="${px(trackW)}" height="${rowH - 12}" rx="3"/>` +
        (barW ? `<rect class="ch-bar" x="${labelW}" y="${px(y + 6)}" width="${px(barW)}" height="${rowH - 12}" rx="3"/>` : '') +
        `<text class="ch-value" x="${px(width)}" y="${px(mid + 4)}" text-anchor="end">${escapeXml(format(d.value))}</text></g>`
      );
    })
    .join('');
  return svg(width, data.length * rowH, options.title, describe(data, format), body);
}

// ── Columns (time buckets) ──────────────────────────────────────────────────

export function columnChart(
  points: ReadonlyArray<Point> | undefined,
  options: { width: number; height?: number; title: string; format?: ValueFormat },
): string {
  const data = cleanPoints(points);
  if (!data.length) return '';
  const format = options.format ?? formatCount;
  const width = Math.max(200, options.width);
  const height = options.height ?? 200;
  const scale = niceScale(Math.max(...data.map((d) => d.value)));
  const axisW = Math.max(...scale.ticks.map((t) => formatCompact(t).length)) * CHAR_W + 10;
  const top = 18;
  const bottom = 26;
  const plotW = width - axisW;
  const plotH = height - top - bottom;
  const slot = plotW / data.length;
  const barW = Math.max(4, Math.min(44, slot * 0.6));
  const every = Math.max(1, Math.ceil((data.length * 52) / plotW)); // keep x labels from colliding

  const grid = scale.ticks
    .map((t) => {
      const y = top + plotH - (t / scale.max) * plotH;
      return (
        `<line class="ch-grid" x1="${px(axisW)}" x2="${px(width)}" y1="${px(y)}" y2="${px(y)}"/>` +
        `<text class="ch-axis" x="${px(axisW - 6)}" y="${px(y + 4)}" text-anchor="end">${escapeXml(formatCompact(t))}</text>`
      );
    })
    .join('');

  const columns = data
    .map((d, i) => {
      const h = (d.value / scale.max) * plotH;
      const x = axisW + slot * i + (slot - barW) / 2;
      const y = top + plotH - h;
      const showValue = d.value > 0 && slot >= 26;
      return (
        `<g><title>${escapeXml(d.label)}: ${escapeXml(format(d.value))}</title>` +
        (d.value > 0 ? `<rect class="ch-bar" x="${px(x)}" y="${px(y)}" width="${px(barW)}" height="${px(h)}" rx="3"/>` : `<rect class="ch-zero" x="${px(x)}" y="${px(top + plotH - 2)}" width="${px(barW)}" height="2"/>`) +
        (showValue ? `<text class="ch-value" x="${px(x + barW / 2)}" y="${px(y - 5)}" text-anchor="middle">${escapeXml(format(d.value))}</text>` : '') +
        (i % every === 0 ? `<text class="ch-axis" x="${px(x + barW / 2)}" y="${px(height - 8)}" text-anchor="middle">${escapeXml(d.label)}</text>` : '') +
        '</g>'
      );
    })
    .join('');

  return svg(width, height, options.title, describe(data, format), grid + columns);
}

// ── Lines (daily series) ────────────────────────────────────────────────────

export function lineChart(
  series: ReadonlyArray<LineSeries> | undefined,
  xLabels: ReadonlyArray<string> | undefined,
  options: { width: number; height?: number; title: string; format?: ValueFormat },
): string {
  const lines = (series ?? []).map((s) => ({ name: String(s?.name ?? ''), values: (s?.values ?? []).map(num) }));
  const n = Math.max(0, ...lines.map((s) => s.values.length));
  if (!lines.length || n < 2) return '';
  const format = options.format ?? formatCount;
  const width = Math.max(200, options.width);
  const height = options.height ?? 220;
  const labels = Array.from({ length: n }, (_, i) => String(xLabels?.[i] ?? ''));
  const scale = niceScale(Math.max(1, ...lines.flatMap((s) => s.values)));
  const axisW = Math.max(...scale.ticks.map((t) => formatCompact(t).length)) * CHAR_W + 10;
  const top = 26;
  const bottom = 24;
  const plotW = width - axisW - 8;
  const plotH = height - top - bottom;
  const xAt = (i: number) => axisW + (plotW * i) / (n - 1);
  const yAt = (v: number) => top + plotH - (v / scale.max) * plotH;

  const grid = scale.ticks
    .map((t) => {
      const y = yAt(t);
      return (
        `<line class="ch-grid" x1="${px(axisW)}" x2="${px(width - 8)}" y1="${px(y)}" y2="${px(y)}"/>` +
        `<text class="ch-axis" x="${px(axisW - 6)}" y="${px(y + 4)}" text-anchor="end">${escapeXml(formatCompact(t))}</text>`
      );
    })
    .join('');

  const tickIdx = [0, Math.round((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i);
  const xAxis = tickIdx
    .map((i) => `<text class="ch-axis" x="${px(xAt(i))}" y="${px(height - 6)}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${escapeXml(labels[i])}</text>`)
    .join('');

  const paths = lines
    .map((s, si) => {
      const cls = `ch-line ch-s${si % PALETTE_SIZE}`;
      const pts = s.values.map((v, i) => `${px(xAt(i))},${px(yAt(v))}`);
      const area =
        si === 0
          ? `<polygon class="ch-area ch-s${si}" points="${px(xAt(0))},${px(yAt(0))} ${pts.join(' ')} ${px(xAt(s.values.length - 1))},${px(yAt(0))}"/>`
          : '';
      const last = s.values.length - 1;
      return (
        area +
        `<polyline class="${cls}" fill="none" points="${pts.join(' ')}"/>` +
        `<circle class="ch-dot ch-s${si % PALETTE_SIZE}" cx="${px(xAt(last))}" cy="${px(yAt(s.values[last]))}" r="3.5"/>`
      );
    })
    .join('');

  const legend = lines
    .map((s, si) => {
      const x = axisW + si * 120;
      return `<rect class="ch-swatch ch-s${si % PALETTE_SIZE}" x="${px(x)}" y="6" width="10" height="10" rx="2"/><text class="ch-label" x="${px(x + 15)}" y="15">${escapeXml(clip(s.name, 14))}</text>`;
    })
    .join('');

  // Hover targets: one transparent column per x position with every series' value.
  const hover = labels
    .map((label, i) => {
      const text = lines.map((s) => `${s.name} ${format(s.values[i] ?? 0)}`).join(', ');
      const w = plotW / (n - 1);
      return `<rect class="ch-hit" x="${px(xAt(i) - w / 2)}" y="${top}" width="${px(w)}" height="${px(plotH)}"><title>${escapeXml(label)}: ${escapeXml(text)}</title></rect>`;
    })
    .join('');

  const description = lines.map((s) => `${s.name}: ${s.values.map((v) => format(v)).join(', ')}`).join('. ');
  return svg(width, height, options.title, `${labels[0]} to ${labels[n - 1]}. ${description}`, grid + xAxis + paths + legend + hover);
}

// ── Donut ───────────────────────────────────────────────────────────────────

export function donutChart(
  slices: ReadonlyArray<Slice> | undefined,
  options: { width: number; title: string; format?: ValueFormat; centerLabel?: string },
): string {
  const data = cleanPoints(slices).filter((s) => s.value > 0);
  if (!data.length) return '';
  const format = options.format ?? formatCount;
  const width = Math.max(200, options.width);
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const stacked = width < 420;
  const size = stacked ? Math.min(150, width - 20) : Math.min(170, width * 0.4);
  const r = size / 2 - 14;
  const circ = 2 * Math.PI * r;
  const cx = stacked ? width / 2 : size / 2 + 4;
  const cy = size / 2 + 2;

  let offset = 0;
  const arcs = data
    .map((d, i) => {
      const len = (d.value / total) * circ;
      const dash = `${px(Math.max(0, len - (data.length > 1 ? 1.5 : 0)))} ${px(circ)}`;
      const arc =
        `<circle class="ch-arc ch-s${i % PALETTE_SIZE}" cx="${px(cx)}" cy="${px(cy)}" r="${px(r)}" fill="none" stroke-width="20" ` +
        `stroke-dasharray="${dash}" stroke-dashoffset="${px(-offset)}" transform="rotate(-90 ${px(cx)} ${px(cy)})">` +
        `<title>${escapeXml(d.label)}: ${escapeXml(format(d.value))} (${Math.round((d.value / total) * 100)}%)</title></circle>`;
      offset += len;
      return arc;
    })
    .join('');

  const center =
    `<text class="ch-center" x="${px(cx)}" y="${px(cy + 2)}" text-anchor="middle">${escapeXml(format(total))}</text>` +
    (options.centerLabel ? `<text class="ch-axis" x="${px(cx)}" y="${px(cy + 18)}" text-anchor="middle">${escapeXml(options.centerLabel)}</text>` : '');

  const legendX = stacked ? 4 : size + 24;
  const legendY = stacked ? size + 14 : Math.max(8, cy - (data.length * 22) / 2);
  const maxChars = Math.max(6, Math.floor((width - legendX - 90) / CHAR_W));
  const legend = data
    .map((d, i) => {
      const y = legendY + i * 22;
      return (
        `<rect class="ch-swatch ch-s${i % PALETTE_SIZE}" x="${px(legendX)}" y="${px(y)}" width="10" height="10" rx="2"/>` +
        `<text class="ch-label" x="${px(legendX + 16)}" y="${px(y + 9)}">${escapeXml(clip(d.label, maxChars))}</text>` +
        `<text class="ch-value" x="${px(width)}" y="${px(y + 9)}" text-anchor="end">${escapeXml(format(d.value))} · ${Math.round((d.value / total) * 100)}%</text>`
      );
    })
    .join('');

  const height = stacked ? size + 14 + data.length * 22 + 4 : Math.max(size + 4, legendY + data.length * 22 + 4);
  return svg(width, height, options.title, describe(data, format), arcs + center + legend);
}

// ── Funnel ──────────────────────────────────────────────────────────────────

export function funnelChart(
  stages: ReadonlyArray<Point> | undefined,
  options: { width: number; title: string; format?: ValueFormat },
): string {
  const data = cleanPoints(stages);
  if (!data.length) return '';
  const format = options.format ?? formatCount;
  const width = Math.max(200, options.width);
  const rowH = 46;
  const first = Math.max(...data.map((d) => d.value), 1);

  const body = data
    .map((d, i) => {
      const y = i * rowH;
      const barW = d.value > 0 ? Math.max(8, (d.value / first) * width) : 0;
      const x = (width - barW) / 2;
      const prev = i > 0 ? data[i - 1].value : 0;
      const step = i > 0 && prev > 0 ? `${Math.round((d.value / prev) * 100)}% of ${escapeXml(data[i - 1].label.toLowerCase())}` : '';
      return (
        `<g><title>${escapeXml(d.label)}: ${escapeXml(format(d.value))}${step ? ` (${step})` : ''}</title>` +
        `<text class="ch-label" x="0" y="${px(y + 12)}">${escapeXml(d.label)}</text>` +
        (step ? `<text class="ch-axis" x="${px(width)}" y="${px(y + 12)}" text-anchor="end">${step}</text>` : '') +
        `<rect class="ch-track" x="0" y="${px(y + 18)}" width="${px(width)}" height="22" rx="4"/>` +
        (barW ? `<rect class="ch-bar ch-f${Math.min(i, 3)}" x="${px(x)}" y="${px(y + 18)}" width="${px(barW)}" height="22" rx="4"/>` : '') +
        `<text class="ch-barvalue" x="${px(width / 2)}" y="${px(y + 34)}" text-anchor="middle">${escapeXml(format(d.value))}</text></g>`
      );
    })
    .join('');
  return svg(width, data.length * rowH, options.title, describe(data, format), body);
}
