#!/usr/bin/env node
// Builds the permit-leads snapshot for Command Center > Analytics.
//
//   npm run build:permit-leads                       last 183 days -> data/permit-leads/
//   npm run build:permit-leads -- --since=2026-04-02 --out=/some/dir
//
// Reads public records only (Clark County + City of Vancouver permits and assessor
// parcels; WA L&I contractor licenses), joins them, and writes:
//   permit-leads.sql   whole-snapshot replace, ready for D1:
//                      npx wrangler d1 execute clearview-quotes --remote --file data/permit-leads/permit-leads.sql
//   prospects.csv, builders.csv   the same rows for a spreadsheet
//
// The output directory is git-ignored on purpose: it holds owner names and mailing
// addresses, and this repository is public. Nothing is loaded into D1 by this script.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PERMIT_LEAD_DDL } from '../functions/internal/_lib/permit-leads.mjs';
import { fetchActiveLicenses, fetchParcels, fetchPermits, fetchSales } from './permit-leads/fetch.mjs';
import { buildProspect, indexLicenses, latestSales, rollUpBuilders, toSql } from './permit-leads/lib.mjs';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const today = new Date().toISOString().slice(0, 10);
const since = arg('since') || new Date(Date.parse(today) - 183 * 86400000).toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) { console.error('--since must be YYYY-MM-DD'); process.exit(2); }
const out = arg('out') || 'data/permit-leads';

const csvCell = (v) => { const s = Array.isArray(v) ? v.join('; ') : String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCsv = (rows) => (rows.length ? [Object.keys(rows[0]).join(','), ...rows.map((r) => Object.values(r).map(csvCell).join(','))].join('\n') + '\n' : '');

console.log(`Window: ${since} to ${today}`);
const permits = await fetchPermits(fetch, since);
console.log(`permits fetched: ${permits.length}`);
const kinds = permits.filter((p) => p.sn && (p.case_type === 'NHC' || p.case_type === 'SFR' || p.WorkType === 'REMODEL' || p.WorkType === 'ADDITION' || p.CaseType === 'Residential Addition/Alteration'));
const ids = kinds.map((p) => Number(p.sn));
const [parcels, sales, licenses] = await Promise.all([fetchParcels(fetch, ids), fetchSales(fetch, ids), fetchActiveLicenses(fetch)]);
console.log(`parcels matched: ${parcels.size}, recorded sales: ${sales.length}, active L&I licenses: ${licenses.length}`);

const latest = latestSales(sales);
const now = today;
const prospects = kinds
  .map((permit) => buildProspect(permit, parcels.get(Number(permit.sn)), latest.get(Number(permit.sn)), { now }))
  .filter(Boolean);
const builders = rollUpBuilders(prospects, indexLicenses(licenses), { now });

mkdirSync(out, { recursive: true });
const importedAt = new Date().toISOString();
const meta = {
  imported_at: importedAt,
  window_start: since,
  window_end: today,
  permits_fetched: String(permits.length),
  sources: 'Clark County + City of Vancouver permits and assessor parcels (gis.clark.wa.gov); WA L&I contractor licenses (data.wa.gov m8qx-ubtq)',
};
writeFileSync(join(out, 'permit-leads.sql'), toSql({ prospects, builders, meta, ddl: PERMIT_LEAD_DDL, importedAt }));
writeFileSync(join(out, 'prospects.csv'), toCsv(prospects.map(({ signals, ...rest }) => ({ ...rest, signals }))));
writeFileSync(join(out, 'builders.csv'), toCsv(builders));

const homeowners = prospects.filter((p) => p.kind === 'homeowner');
const newHomes = prospects.filter((p) => p.kind === 'new_home');
console.log(`homeowner remodel/addition: ${homeowners.length} (single-family ${homeowners.filter((p) => p.signals.includes('single_family')).length})`);
console.log(`new-home permits: ${newHomes.length}; builder entities: ${builders.length}; with an L&I license: ${builders.filter((b) => b.li_license).length}`);
console.log(`wrote ${join(out, 'permit-leads.sql')}`);
