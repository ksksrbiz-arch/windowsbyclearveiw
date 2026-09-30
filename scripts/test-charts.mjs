// Checks the SVG chart builders used by the internal analytics page: output is
// well-formed, escapes hostile labels, never prints NaN, scales sensibly, and
// returns '' for empty data so the page can show its own message.
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const charts = await import(pathToFileURL(`${root}src/lib/charts.ts`).href);
const { barChart, columnChart, lineChart, donutChart, funnelChart, niceScale, formatCompact, escapeXml } = charts;

let groups = 0;
const ok = (fn) => {
  fn();
  groups++;
};

/** Minimal well-formedness check: every tag closes in order. */
function assertWellFormed(svg) {
  const stack = [];
  for (const match of svg.matchAll(/<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g)) {
    const [, closing, name, , selfClosing] = match;
    if (selfClosing) continue;
    if (closing) assert.equal(stack.pop(), name, `mismatched </${name}>`);
    else stack.push(name);
  }
  assert.deepEqual(stack, [], 'unclosed tags');
  assert.ok(svg.startsWith('<svg ') && svg.endsWith('</svg>'));
}
function assertClean(svg) {
  assertWellFormed(svg);
  assert.ok(!/NaN|Infinity|undefined|null/.test(svg), 'output contains NaN/Infinity/undefined/null');
}

// ── helpers ────────────────────────────────────────────────────────────────
ok(() => {
  assert.ok(niceScale(0).max >= 1 && niceScale(0).ticks[0] === 0, 'an empty series still gets a usable axis');
  for (const max of [1, 3, 7, 10, 23, 99, 480, 1234, 98765]) {
    const scale = niceScale(max);
    assert.ok(scale.max >= max, `scale.max ${scale.max} < ${max}`);
    assert.equal(scale.ticks[0], 0);
    assert.equal(scale.ticks.at(-1), scale.max);
    assert.ok(scale.ticks.length >= 3 && scale.ticks.length <= 8, `ticks for ${max}: ${scale.ticks}`);
  }
  assert.equal(formatCompact(999), '999');
  assert.equal(formatCompact(1500), '1.5k');
  assert.equal(formatCompact(2_400_000), '2.4M');
  assert.equal(escapeXml(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

// ── empty and hostile input ────────────────────────────────────────────────
ok(() => {
  for (const build of [
    () => barChart([], { width: 400, title: 't' }),
    () => barChart(undefined, { width: 400, title: 't' }),
    () => columnChart([], { width: 400, title: 't' }),
    () => lineChart([], [], { width: 400, title: 't' }),
    () => lineChart([{ name: 'a', values: [1] }], ['x'], { width: 400, title: 't' }),
    () => donutChart([], { width: 400, title: 't' }),
    () => donutChart([{ label: 'a', value: 0 }], { width: 400, title: 't' }),
    () => funnelChart([], { width: 400, title: 't' }),
  ]) assert.equal(build(), '');
});
ok(() => {
  const evil = `<script>alert(1)</script>"&`;
  const outputs = [
    barChart([{ label: evil, value: 3 }], { width: 360, title: evil }),
    columnChart([{ label: evil, value: 3 }], { width: 360, title: evil }),
    lineChart([{ name: evil, values: [1, 2, 3] }], [evil, evil, evil], { width: 360, title: evil }),
    donutChart([{ label: evil, value: 3 }], { width: 360, title: evil, centerLabel: evil }),
    funnelChart([{ label: evil, value: 3 }, { label: 'b', value: 1 }], { width: 360, title: evil }),
  ];
  for (const out of outputs) {
    assertClean(out);
    assert.ok(!out.includes('<script'), 'label was not escaped');
  }
});
ok(() => {
  // Junk numbers become zero instead of breaking the drawing.
  const out = barChart([{ label: 'a', value: NaN }, { label: 'b', value: -5 }, { label: 'c', value: '7' }, { label: 'd', value: Infinity }], { width: 300, title: 't' });
  assertClean(out);
});

// ── bars ───────────────────────────────────────────────────────────────────
ok(() => {
  const out = barChart([{ label: 'google', value: 10 }, { label: 'direct', value: 5 }, { label: 'none', value: 0 }], { width: 400, title: 'Sources' });
  assertClean(out);
  const widths = [...out.matchAll(/class="ch-bar" [^>]*width="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.equal(widths.length, 2, 'a zero value draws no bar');
  assert.ok(Math.abs(widths[0] / widths[1] - 2) < 0.05, 'bar lengths are proportional');
  assert.ok(out.includes('aria-label="Sources"') && out.includes('google: 10; direct: 5; none: 0'));
  assert.equal(barChart([{ label: 'a', value: 1 }], { width: 400, title: 't' }), barChart([{ label: 'a', value: 1 }], { width: 400, title: 't' }), 'deterministic');
});
ok(() => {
  const long = 'x'.repeat(80);
  const out = barChart([{ label: long, value: 1 }], { width: 260, title: 't' });
  assert.ok(out.includes('…') && !out.match(new RegExp(`class="ch-label"[^>]*>${long}`)), 'long labels are truncated on screen');
  assert.ok(out.includes(`<title>${long}: 1</title>`), 'full label stays in the tooltip');
  const money = barChart([{ label: 'a', value: 12000 }], { width: 400, title: 't', format: (v) => `$${v / 100}` });
  assert.ok(money.includes('$120'));
});

// ── columns ────────────────────────────────────────────────────────────────
ok(() => {
  const weeks = Array.from({ length: 8 }, (_, i) => ({ label: `Sep ${i + 1}`, value: [0, 2, 5, 3, 0, 1, 4, 6][i] }));
  const out = columnChart(weeks, { width: 520, title: 'Requests per week' });
  assertClean(out);
  assert.equal([...out.matchAll(/class="ch-bar"/g)].length, 6);
  assert.equal([...out.matchAll(/class="ch-zero"/g)].length, 2, 'zero weeks show a baseline tick, not nothing');
  assert.ok(out.includes('class="ch-grid"'));
  // Tall values never draw above the plot.
  for (const m of out.matchAll(/class="ch-bar" x="[\d.]+" y="([\d.]+)"/g)) assert.ok(Number(m[1]) >= 0);
  const narrow = columnChart(Array.from({ length: 28 }, (_, i) => ({ label: `d${i}`, value: i })), { width: 300, title: 't' });
  assertClean(narrow);
  const labelCount = [...narrow.matchAll(/class="ch-axis"[^>]*text-anchor="middle">d/g)].length;
  assert.ok(labelCount < 28 && labelCount >= 2, 'x labels are thinned when crowded');
  assert.ok(![...narrow.matchAll(/class="ch-value"/g)].length, 'value labels are dropped when columns are too thin');
});

// ── lines ──────────────────────────────────────────────────────────────────
ok(() => {
  const days = Array.from({ length: 28 }, (_, i) => `Sep ${i + 1}`);
  const out = lineChart(
    [{ name: 'Sessions', values: days.map((_, i) => i % 7) }, { name: 'Visitors', values: days.map((_, i) => (i % 7) / 2) }],
    days,
    { width: 480, title: 'Daily traffic' },
  );
  assertClean(out);
  assert.equal([...out.matchAll(/<polyline /g)].length, 2);
  assert.equal([...out.matchAll(/<polygon /g)].length, 1, 'only the first series is filled');
  assert.equal([...out.matchAll(/class="ch-hit"/g)].length, 28, 'every day has a hover target');
  assert.ok(out.includes('Sep 1') && out.includes('Sep 28'));
  // A flat zero series still draws.
  assertClean(lineChart([{ name: 'a', values: [0, 0, 0] }], ['a', 'b', 'c'], { width: 300, title: 't' }));
});

// ── donut ──────────────────────────────────────────────────────────────────
ok(() => {
  const out = donutChart([{ label: 'google', value: 6 }, { label: 'direct', value: 3 }, { label: 'facebook', value: 1 }], { width: 480, title: 'Sources', centerLabel: 'requests' });
  assertClean(out);
  const circ = 2 * Math.PI * Number(/class="ch-arc[^"]*" cx="[\d.]+" cy="[\d.]+" r="([\d.]+)"/.exec(out)[1]);
  const dashes = [...out.matchAll(/stroke-dasharray="([\d.]+) /g)].map((m) => Number(m[1]));
  assert.equal(dashes.length, 3);
  assert.ok(Math.abs(dashes.reduce((a, b) => a + b, 0) + 3 * 1.5 - circ) < 0.5, 'slices add up to the full ring');
  assert.ok(out.includes('60%') && out.includes('30%') && out.includes('10%'));
  const single = donutChart([{ label: 'only', value: 4 }], { width: 480, title: 't' });
  assertClean(single);
  assert.ok(single.includes('100%'));
  const stacked = donutChart([{ label: 'a', value: 1 }, { label: 'b', value: 1 }], { width: 300, title: 't' });
  assertClean(stacked);
  const many = donutChart(Array.from({ length: 9 }, (_, i) => ({ label: `s${i}`, value: i + 1 })), { width: 480, title: 't' });
  assertClean(many);
  assert.ok(many.includes('ch-s5') && !many.includes('ch-s6'), 'colors wrap after the palette size');
});

// ── funnel ─────────────────────────────────────────────────────────────────
ok(() => {
  const out = funnelChart([{ label: 'Requests', value: 20 }, { label: 'Quotes', value: 10 }, { label: 'Signed', value: 4 }, { label: 'Jobs', value: 0 }], { width: 400, title: 'Funnel' });
  assertClean(out);
  assert.ok(out.includes('50% of requests') && out.includes('40% of quotes'));
  assert.ok(out.includes('0% of signed'), 'a stage that falls to zero reads as 0%, not as missing');
  const bars = [...out.matchAll(/class="ch-bar ch-f\d" x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.equal(bars.length, 3, 'a zero stage draws no bar');
  for (const [x, w] of bars) assert.ok(Math.abs(x * 2 + w - 400) < 0.2, 'bars are centered');
  assert.ok(bars[0][1] > bars[1][1] && bars[1][1] > bars[2][1], 'bars narrow down the funnel');
});

console.log(`charts: ok (${groups} groups)`);
