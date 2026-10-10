// Network layer for the permit-leads pipeline. Every call is a read of a public,
// official endpoint; nothing is scraped and nothing is written to the sources.
// `fetchImpl` is injectable so the paging logic can be tested without a network.

export const PERMITS = 'https://gis.clark.wa.gov/arcgisfed2/rest/services/MapCatalog/Permitting/MapServer';
export const PARCELS = 'https://gis.clark.wa.gov/arcgisfed2/rest/services/MapCatalog/Addressing/MapServer/10/query';
const SALES = 'https://gis.clark.wa.gov/arcgisfed2/rest/services/MapCatalog/LandRecords/MapServer/0/query';
const LICENSES = 'https://data.wa.gov/resource/m8qx-ubtq.json';

const PAGE = 2000;
export const POLITE_MS = 200;
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(fetchImpl, url, { body, tries = 5 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      const response = await fetchImpl(url, body ? { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() } : undefined);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data?.error) throw new Error(JSON.stringify(data.error));
      return data;
    } catch (error) {
      lastError = error;
      await sleep(500 * 2 ** attempt);
    }
  }
  throw new Error(`Request failed after ${tries} tries: ${url} (${lastError?.message})`);
}

/** Page through an ArcGIS layer query. Attributes only (no geometry). */
export async function arcgisAll(fetchImpl, url, params) {
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const data = await getJson(fetchImpl, url, {
      body: { ...params, outFields: params.outFields || '*', returnGeometry: 'false', orderByFields: 'OBJECTID', resultOffset: String(offset), resultRecordCount: String(PAGE), f: 'json' },
    });
    const features = data.features || [];
    for (const feature of features) out.push(feature.attributes);
    if (features.length < PAGE) break;
    await sleep(POLITE_MS);
  }
  return out;
}

/** ArcGIS date literal for a YYYY-MM-DD string. */
const stamp = (isoDay) => `timestamp '${isoDay} 00:00:00'`;

/** Building permits issued (layer 4, all history) or received/issued (layer 2, active) on or after `since`. */
export async function fetchPermits(fetchImpl, since) {
  const [history, active] = await Promise.all([
    arcgisAll(fetchImpl, `${PERMITS}/4/query`, { where: `issued >= ${stamp(since)}` }),
    arcgisAll(fetchImpl, `${PERMITS}/2/query`, { where: `issued >= ${stamp(since)} OR RecdDate >= ${stamp(since)}` }),
  ]);
  const byCase = new Map();
  for (const row of [...history, ...active]) {
    byCase.set(row.caseno, { ...(byCase.get(row.caseno) || {}), ...Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== undefined)) });
  }
  return [...byCase.values()];
}

export const chunk = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));

const PARCEL_FIELDS = 'serial_num,Owner,OwnAddrs,SitAddrs,Yrblt,PT1Desc,Juris,bldgsqft,LotSqFt,Legal';

/** Assessor parcel attributes keyed by property id (`sn` on a permit = `serial_num`). `fields` widens the columns asked for. */
export async function fetchParcels(fetchImpl, propertyIds, { fields = PARCEL_FIELDS } = {}) {
  const out = new Map();
  for (const ids of chunk([...new Set(propertyIds)].filter(Number.isInteger), 400)) {
    const rows = await arcgisAll(fetchImpl, PARCELS, {
      where: `serial_num IN (${ids.join(',')})`,
      outFields: fields,
    });
    for (const row of rows) if (!out.has(row.serial_num)) out.set(row.serial_num, row);
    await sleep(POLITE_MS);
  }
  return out;
}

/** Recorded sales for the given property ids (caller picks the latest priced one). */
export async function fetchSales(fetchImpl, propertyIds) {
  const out = [];
  for (const ids of chunk([...new Set(propertyIds)].filter(Number.isInteger), 400)) {
    out.push(...await arcgisAll(fetchImpl, SALES, { where: `prop_id IN (${ids.join(',')})`, outFields: 'prop_id,SalePrice,SaleDate' }));
    await sleep(POLITE_MS);
  }
  return out;
}

const LICENSE_FIELDS = 'businessname,contractorlicensenumber,address1,city,state,zip,phonenumber,primaryprincipalname,contractorlicensestatus,licenseexpirationdate,ubi';

/** Every ACTIVE contractor license in Washington (about 76,000 rows). `select` widens the columns asked for. */
export async function fetchActiveLicenses(fetchImpl, { select = LICENSE_FIELDS } = {}) {
  const out = [];
  for (let offset = 0; ; offset += 50000) {
    const query = new URLSearchParams({ $select: select, $where: "statuscode='A'", $order: 'contractorlicensenumber', $limit: '50000', $offset: String(offset) });
    const rows = await getJson(fetchImpl, `${LICENSES}?${query}`);
    out.push(...rows);
    if (rows.length < 50000) break;
  }
  return out;
}
