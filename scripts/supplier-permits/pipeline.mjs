// Orchestration for the supplier-permits loader, separated from the file handling in scripts/build-supplier-permits.mjs
// so the whole join can be tested with a fake `fetchImpl`: parsed report -> county permit record -> parcel (by the permit's
// own property id, else by street) -> latest sale -> L&I license -> fit signals -> rows ready for D1.
import { indexLicenses, latestSales } from '../permit-leads/lib.mjs';
import { fetchCasePermits, fetchParcelCandidates, fetchSales, fetchSupplierLicenses, fetchSupplierParcels } from './fetch.mjs';
import { enrichRow, indexMailPilot, indexProspects, lookupStreet, normalizeEntries, parcelChoice } from './lib.mjs';

export async function buildSupplierRows({ input, fetchImpl, prospects = [], builders = [], mailPilotRows = [], now, county = 'Clark County', log = () => {} }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(now ?? ''))) throw new Error('buildSupplierRows needs now as YYYY-MM-DD.');
  const { edition, rows, skipped, ranking, report } = normalizeEntries(input, { county });
  log(`${county} permits in the report: ${rows.length} (other counties skipped: ${skipped})`);

  const casePermits = await fetchCasePermits(fetchImpl, rows.map((r) => r.id));
  log(`found as county permit records: ${casePermits.size}`);

  const propertyIds = [...new Set([...casePermits.values()].map((p) => Number(p.sn)).filter((n) => Number.isInteger(n) && n > 0))];
  const parcelsBySn = await fetchSupplierParcels(fetchImpl, propertyIds);
  const hasParcelViaCase = (row) => parcelsBySn.has(Number(casePermits.get(row.id.toUpperCase())?.sn));
  const needStreet = rows.filter((row) => !hasParcelViaCase(row));
  const candidatesByStreet = await fetchParcelCandidates(fetchImpl, needStreet.map((row) => lookupStreet(row.street)));
  log(`parcels by permit case: ${parcelsBySn.size}; streets looked up: ${candidatesByStreet.size}`);

  const sales = new Set(parcelsBySn.keys());
  for (const row of needStreet) {
    const { parcel } = parcelChoice(candidatesByStreet.get(lookupStreet(row.street)), { street: row.street, zip: row.zip });
    if (parcel && Number.isInteger(Number(parcel.serial_num))) sales.add(Number(parcel.serial_num));
  }
  const latestSale = latestSales(await fetchSales(fetchImpl, [...sales]));
  const licenses = await fetchSupplierLicenses(fetchImpl);
  log(`recorded sales found: ${latestSale.size}; active L&I licenses loaded: ${licenses.length}`);

  const ctx = {
    now,
    edition: edition.label,
    casePermits,
    parcelsBySn,
    candidatesByStreet,
    latestSale,
    licenseIndex: indexLicenses(licenses),
    prospects: indexProspects(prospects),
    mailPilot: indexMailPilot(mailPilotRows),
    trackedBuilders: builders,
  };
  return { edition, ranking, report, skipped, rows: rows.map((row) => enrichRow(row, ctx)) };
}
