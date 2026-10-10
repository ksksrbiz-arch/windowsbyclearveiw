// Network layer for the supplier-permits loader. Every call is a read of a public, official endpoint; nothing is
// written to a source. It reuses the paging, retry and politeness of scripts/permit-leads/fetch.mjs and adds the two
// lookups a licensed permit report needs: a permit by its case number (the county's own id), and parcels by street.
// `fetchImpl` is injectable so the query building can be tested without a network.
import { PARCELS, PERMITS, POLITE_MS, arcgisAll, chunk, fetchActiveLicenses, fetchParcels, fetchSales, sleep } from '../permit-leads/fetch.mjs';

export { fetchSales };

/** County case numbers look like "NHC-2026-00873", "RES-391023" or the older "RES2005-00197". Anything else is never sent. */
export const CASE_NUMBER = /^[A-Z]{2,6}(?:-\d{4}-\d{3,6}|-\d{5,7}|\d{4}-\d{3,6})$/;

export const SUPPLIER_PARCEL_FIELDS = 'serial_num,Owner,OwnAddrs,SitAddrs,Yrblt,PT1Desc,Juris,bldgsqft,LotSqFt,Legal,LandVal,BldVl,TaxTotVal,zn_abrev';
export const SUPPLIER_LICENSE_FIELDS = 'businessname,contractorlicensenumber,address1,city,state,zip,phonenumber,primaryprincipalname,contractorlicensestatus,licenseexpirationdate,ubi,contractorlicensetypecodedesc,specialtycode1desc,businesstypecodedesc,licenseeffectivedate';

/** Escape a value for an ArcGIS `LIKE 'x%'` clause: quotes doubled, wildcards removed (an address never needs them). */
export const likeLiteral = (value) => String(value ?? '').replace(/[%_]/g, '').replace(/'/g, "''").trim();

/**
 * County permit rows (layer 4 history and layer 2 active) for the given report permit numbers, keyed by case number.
 * Only numbers that look like county case numbers are queried: the report also holds city permits and other counties.
 */
export async function fetchCasePermits(fetchImpl, permitNumbers) {
  const wanted = [...new Set(permitNumbers.map((n) => String(n ?? '').trim().toUpperCase()).filter((n) => CASE_NUMBER.test(n)))];
  const out = new Map();
  for (const ids of chunk(wanted, 40)) {
    const where = `caseno IN (${ids.map((n) => `'${n}'`).join(',')})`;
    const [history, active] = await Promise.all([
      arcgisAll(fetchImpl, `${PERMITS}/4/query`, { where }),
      arcgisAll(fetchImpl, `${PERMITS}/2/query`, { where }),
    ]);
    for (const row of [...history, ...active]) {
      const key = String(row.caseno ?? '').toUpperCase();
      if (!key) continue;
      out.set(key, { ...(out.get(key) || {}), ...Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== undefined)) });
    }
    await sleep(POLITE_MS);
  }
  return out;
}

/** Assessor parcels by property id, with the extra value and zoning columns this list shows. */
export function fetchSupplierParcels(fetchImpl, propertyIds) {
  return fetchParcels(fetchImpl, propertyIds, { fields: SUPPLIER_PARCEL_FIELDS });
}

/** Every active L&I contractor license, with the license type and specialty. */
export function fetchSupplierLicenses(fetchImpl) {
  return fetchActiveLicenses(fetchImpl, { select: SUPPLIER_LICENSE_FIELDS });
}

/**
 * Candidate assessor parcels for each street ("1234 NE 56TH ST"), keyed by the street as given. A street is queried
 * by its text up to the unit, as a prefix, so "1234 NE 56TH ST" also finds "1234 NE 56TH ST #5". Choosing between
 * several candidates is the caller's job (parcelChoice); this only fetches.
 */
export async function fetchParcelCandidates(fetchImpl, streets) {
  const out = new Map();
  for (const street of [...new Set(streets.filter(Boolean))]) {
    const literal = likeLiteral(street);
    if (!/^\d/.test(literal)) continue;
    const rows = await arcgisAll(fetchImpl, PARCELS, {
      where: `SitAddrs LIKE '${literal}%'`,
      outFields: SUPPLIER_PARCEL_FIELDS,
    });
    out.set(street, rows);
    await sleep(POLITE_MS);
  }
  return out;
}
