import { accountConfig, ownerConfig, googleJson, googleToken, ownerToken } from './google-auth.mjs';

const ROOT = 'https://www.googleapis.com/auth/';
const clean = (s, max = 300) => typeof s === 'string' ? s.trim().slice(0, max) : '';
const numeric = v => (typeof v === 'number' || (typeof v === 'string' && v.trim())) && Number.isFinite(Number(v)) ? Number(v) : null;
const uuid = s => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(s);
const date = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s;
const fail = message => { throw new TypeError(message); };
export const OPERATIONS = ['search', 'business', 'reviews', 'address', 'weather', 'route', 'receipt', 'ocr', 'calendar', 'calendar_create'];

export function googleConfig(env = {}) {
  const search = accountConfig(env.GOOGLE_SEARCH_SERVICE_ACCOUNT_JSON || env.GA4_SERVICE_ACCOUNT_JSON);
  const documents = accountConfig(env.GOOGLE_DOCUMENT_SERVICE_ACCOUNT_JSON);
  const owner = ownerConfig(env.GOOGLE_OWNER_OAUTH_JSON);
  const processor = clean(env.GOOGLE_DOCUMENT_PROCESSOR, 200);
  const site = clean(env.GOOGLE_SEARCH_SITE || 'sc-domain:windowsbyclearview.com');
  const location = clean(env.GOOGLE_BUSINESS_LOCATION, 200);
  const reviewLocation = clean(env.GOOGLE_BUSINESS_REVIEW_LOCATION, 200);
  const calendarId = clean(env.GOOGLE_CALENDAR_ID, 300);
  return { search, documents, owner, processor: /^projects\/[^/]+\/locations\/(us|eu)\/processors\/[a-zA-Z0-9_-]+$/.test(processor) ? processor : '', site: site === 'sc-domain:windowsbyclearview.com' || /^https:\/\/(www\.)?windowsbyclearview\.com\/$/.test(site) ? site : '', location: /^locations\/\d+$/.test(location) ? location : '', reviewLocation: /^accounts\/\d+\/locations\/\d+$/.test(reviewLocation) ? reviewLocation : '', calendarId, mapsKey: clean(env.GOOGLE_MAPS_OPERATIONS_KEY, 200) };
}
export function connectionStatus(env) {
  const c = googleConfig(env);
  return { search: !!(c.search && c.site), business: !!(c.owner && c.location), reviews: !!(c.owner && c.reviewLocation), address: !!c.mapsKey, weather: !!c.mapsKey, route: !!c.mapsKey, receipt: !!(c.documents && c.processor), ocr: !!c.documents, calendar: !!(c.owner && c.calendarId), calendar_create: !!(c.owner && c.calendarId) };
}
export function validateOperation(action, value = {}) {
  if (!OPERATIONS.includes(action)) fail('Choose a supported tool.');
  const v = value && typeof value === 'object' ? value : {};
  if (action === 'address') {
    const address = clean(v.address), city = clean(v.city, 100);
    if (address.length < 5 || !city) fail('Enter a street address and city.');
    return { address, city };
  }
  if (action === 'weather') {
    const latitude = numeric(v.latitude), longitude = numeric(v.longitude);
    if (v.latitude === '' || v.longitude === '' || latitude === null || longitude === null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) fail('Enter valid latitude and longitude.');
    return { latitude, longitude };
  }
  if (action === 'route') {
    if (!Array.isArray(v.stops) || v.stops.length < 2 || v.stops.length > 10 || v.stops.some(s => typeof s !== 'string' || s.trim().length < 5 || s.length > 300)) fail('Enter 2 to 10 complete addresses, one per line.');
    return { stops: v.stops.map(s => s.trim()), optimize: v.optimize === true };
  }
  if (action === 'receipt' || action === 'ocr') {
    if (!['image/jpeg','image/png','application/pdf'].includes(v.mimeType) || (action === 'ocr' && v.mimeType === 'application/pdf')) fail('Use a JPEG or PNG image, or a PDF for receipt parsing.');
    if (typeof v.content !== 'string' || !v.content.length || v.content.length > 2800000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(v.content) || v.content.length % 4) fail('Upload a document no larger than 2 MB.');
    if (v.content.length / 4 * 3 - (v.content.endsWith('==') ? 2 : v.content.endsWith('=') ? 1 : 0) > 2*1024*1024) fail('Upload a document no larger than 2 MB.');
    const bytes = Uint8Array.from(atob(v.content.slice(0, 32)), c => c.charCodeAt(0));
    if ((v.mimeType === 'image/jpeg' && !(bytes[0] === 255 && bytes[1] === 216)) || (v.mimeType === 'image/png' && !(bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71)) || (v.mimeType === 'application/pdf' && String.fromCharCode(...bytes.slice(0,5)) !== '%PDF-')) fail('The file contents do not match the file type.');
    return { mimeType: v.mimeType, content: v.content };
  }
  if (action === 'calendar_create') {
    const title = clean(v.title, 120), start = clean(v.start, 50), end = clean(v.end, 50), requestId = clean(v.requestId, 40);
    if (!title || !uuid(requestId) || v.confirmed !== true || !/T.*(Z|[+-]\d{2}:\d{2})$/.test(start) || !/T.*(Z|[+-]\d{2}:\d{2})$/.test(end) || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(end) <= Date.parse(start) || Date.parse(end)-Date.parse(start)>86400000) fail('Review the title and appointment times, then confirm creation.');
    return { title, start, end, requestId };
  }
  return {};
}

export async function runGoogleOperation(action, input, env, fetchImpl = fetch) {
  const v = validateOperation(action, input), c = googleConfig(env);
  if (!connectionStatus(env)[action]) return { status: 'unconfigured' };
  const post = (url, body, headers = {}) => googleJson(url, { method:'POST', headers:{'content-type':'application/json', ...headers}, body:JSON.stringify(body) }, fetchImpl);
  const mapsHeaders = { 'x-goog-api-key': c.mapsKey };
  if (action === 'address') {
    const data = await post('https://addressvalidation.googleapis.com/v1:validateAddress', { address:{ regionCode:'US', administrativeArea:'WA', locality:v.city, addressLines:[v.address] } }, mapsHeaders);
    const r = data.result || {};
    return { status:'ok', formattedAddress:clean(r.address?.formattedAddress), complete:r.verdict?.addressComplete === true, needsReview:r.verdict?.addressComplete !== true || !!(r.verdict?.hasUnconfirmedComponents || r.verdict?.hasInferredComponents || r.verdict?.hasReplacedComponents), latitude:numeric(r.geocode?.location?.latitude), longitude:numeric(r.geocode?.location?.longitude) };
  }
  if (action === 'weather') {
    const url = new URL('https://weather.googleapis.com/v1/forecast/days:lookup');
    for (const [k,val] of Object.entries({ 'location.latitude':v.latitude, 'location.longitude':v.longitude, days:5, pageSize:5, unitsSystem:'IMPERIAL' })) url.searchParams.set(k,String(val));
    const data = await googleJson(url.toString(), { headers:mapsHeaders }, fetchImpl);
    const optional = n => n == null ? null : numeric(n);
    return { status:'ok', days:(data.forecastDays || []).slice(0,5).map(d => ({ date:[d.displayDate?.year, String(d.displayDate?.month).padStart(2,'0'), String(d.displayDate?.day).padStart(2,'0')].join('-'), conditions:clean(d.daytimeForecast?.weatherCondition?.description?.text,120), highF:optional(d.maxTemperature?.degrees), lowF:optional(d.minTemperature?.degrees), rainPercent:optional(d.daytimeForecast?.precipitation?.probability?.percent), gustMph:optional(d.daytimeForecast?.wind?.gust?.value) })) };
  }
  if (action === 'route') {
    const intermediates = v.stops.slice(1,-1);
    const data = await post('https://routes.googleapis.com/directions/v2:computeRoutes', { origin:{address:v.stops[0]}, destination:{address:v.stops.at(-1)}, intermediates:intermediates.map(address=>({address})), travelMode:'DRIVE', routingPreference:'TRAFFIC_UNAWARE', optimizeWaypointOrder:v.optimize && intermediates.length>1, units:'IMPERIAL' }, { ...mapsHeaders, 'x-goog-fieldmask':'routes.duration,routes.distanceMeters,routes.optimizedIntermediateWaypointIndex' });
    const r = data.routes?.[0];
    if (!r) throw new Error('Google service unavailable');
    const order = r.optimizedIntermediateWaypointIndex;
    const validOrder = Array.isArray(order) && order.length === intermediates.length && new Set(order).size === order.length && order.every(i=>Number.isInteger(i)&&i>=0&&i<intermediates.length);
    if (v.optimize && intermediates.length > 1 && !validOrder) throw new Error('Google service unavailable');
    return { status:'ok', miles:Number(r.distanceMeters || 0)/1609.344, minutes:parseFloat(r.duration || '0')/60, stops:[v.stops[0], ...(validOrder ? order.map(i=>intermediates[i]) : intermediates), v.stops.at(-1)], respectsAppointmentWindows:false };
  }
  if (action === 'receipt' || action === 'ocr') {
    const token = await googleToken(c.documents,ROOT+'cloud-platform',fetchImpl);
    const headers = { authorization:`Bearer ${token}` };
    if (action === 'ocr') {
      const data = await post('https://vision.googleapis.com/v1/images:annotate', {requests:[{image:{content:v.content},features:[{type:'DOCUMENT_TEXT_DETECTION',maxResults:1}]}]},headers);
      const r = data.responses?.[0];
      if (!r || r.error) throw new Error('Google service unavailable');
      return {status:'ok',text:clean(r.fullTextAnnotation?.text || r.textAnnotations?.[0]?.description,20000),requiresReview:true};
    }
    const region = c.processor.split('/')[3];
    const data = await post(`https://${region}-documentai.googleapis.com/v1/${c.processor}:process`, {rawDocument:v,processOptions:{individualPageSelector:{pages:[1]}}},headers);
    const fields = new Set(['supplier_name','invoice_id','invoice_date','total_amount','currency','receipt_date','supplier_address']);
    return {status:'ok',fields:(data.document?.entities || []).filter(e=>fields.has(e.type)).slice(0,20).map(e=>({field:e.type,value:clean(e.normalizedValue?.text || e.mentionText,300),confidence:numeric(e.confidence)})),requiresReview:true};
  }
  if (action === 'search') {
    const token = await googleToken(c.search,ROOT+'webmasters.readonly',fetchImpl);
    const end = new Date(Date.now()-3*86400000).toISOString().slice(0,10), start = new Date(Date.now()-30*86400000).toISOString().slice(0,10);
    const data = await post(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(c.site)}/searchAnalytics/query`, {startDate:start,endDate:end,dimensions:['query','page'],rowLimit:25,type:'web'}, {authorization:`Bearer ${token}`});
    return {status:'ok',startDate:start,endDate:end,rows:(data.rows || []).slice(0,25).map(r=>({query:clean(r.keys?.[0],120),page:clean(r.keys?.[1],300),clicks:numeric(r.clicks),impressions:numeric(r.impressions),ctr:numeric(r.ctr),position:numeric(r.position)})),limitedToTopRows:true};
  }
  const token = await ownerToken(c.owner,fetchImpl), headers = { authorization:`Bearer ${token}` };
  if (action === 'business') {
    const url = new URL(`https://businessprofileperformance.googleapis.com/v1/${c.location}:fetchMultiDailyMetricsTimeSeries`);
    const metrics = ['BUSINESS_IMPRESSIONS_DESKTOP_MAPS','BUSINESS_IMPRESSIONS_DESKTOP_SEARCH','BUSINESS_IMPRESSIONS_MOBILE_MAPS','BUSINESS_IMPRESSIONS_MOBILE_SEARCH','CALL_CLICKS','WEBSITE_CLICKS','BUSINESS_DIRECTION_REQUESTS'];
    for (const metric of metrics) url.searchParams.append('dailyMetrics',metric);
    for (const [name,offset] of [['startDate',30],['endDate',1]]) {
      const d = new Date(Date.now()-offset*86400000);
      for (const [part,num] of [['year',d.getUTCFullYear()],['month',d.getUTCMonth()+1],['day',d.getUTCDate()]]) url.searchParams.set(`dailyRange.${name}.${part}`,String(num));
    }
    const data = await googleJson(url.toString(),{headers},fetchImpl);
    const rows = (data.multiDailyMetricTimeSeries || []).flatMap(r=>r.dailyMetricTimeSeries || []).filter(r=>metrics.includes(r.dailyMetric)).slice(0,20);
    return {status:'ok',metrics:metrics.map(metric=>({metric,count:rows.filter(r=>r.dailyMetric===metric).reduce((sum,r)=>sum+(r.timeSeries?.datedValues || []).reduce((n,x)=>n+(numeric(x.value)||0),0),0)})),callClicksAreNotCompletedCalls:true};
  }
  if (action === 'reviews') {
    const data = await googleJson(`https://mybusiness.googleapis.com/v4/${c.reviewLocation}/reviews?pageSize=50&orderBy=updateTime%20desc`,{headers},fetchImpl);
    return {status:'ok',averageRating:numeric(data.averageRating),totalReviewCount:numeric(data.totalReviewCount),hasMore:!!data.nextPageToken,reviews:(data.reviews || []).slice(0,50).map(r=>({author:clean(r.reviewer?.displayName,120),rating:clean(r.starRating,20),comment:clean(r.comment,4000),updated:clean(r.updateTime,40),reply:clean(r.reviewReply?.comment,4000)}))};
  }
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.calendarId)}/events`;
  if (action === 'calendar') {
    const url = new URL(base);
    for (const [k,val] of Object.entries({timeMin:new Date().toISOString(),timeMax:new Date(Date.now()+7*86400000).toISOString(),singleEvents:'true',orderBy:'startTime',maxResults:50})) url.searchParams.set(k,val);
    const data = await googleJson(url.toString(),{headers},fetchImpl);
    return {status:'ok',hasMore:!!data.nextPageToken,events:(data.items || []).slice(0,50).map(e=>({title:clean(e.summary,120),start:clean(e.start?.dateTime || e.start?.date,50),end:clean(e.end?.dateTime || e.end?.date,50),status:clean(e.status,30)}))};
  }
  const id = 'cv'+v.requestId.replace(/-/g,'');
  const response = await fetchImpl(`${base}?sendUpdates=none`,{method:'POST',headers:{...headers,'content-type':'application/json'},signal:AbortSignal.timeout(15000),body:JSON.stringify({id,summary:v.title,start:{dateTime:v.start,timeZone:'America/Los_Angeles'},end:{dateTime:v.end,timeZone:'America/Los_Angeles'}})});
  if (response.status === 409) {
    const existing = await googleJson(`${base}/${id}`, {headers}, fetchImpl);
    if (existing.status === 'cancelled' || existing.summary !== v.title || Date.parse(existing.start?.dateTime) !== Date.parse(v.start) || Date.parse(existing.end?.dateTime) !== Date.parse(v.end)) throw new TypeError('This request reference already belongs to a different appointment. Edit the form before retrying.');
    return {status:'ok',created:false,alreadyExists:true};
  }
  if (!response.ok) throw new Error('Google service unavailable');
  return {status:'ok',created:true};
}

export function validateExpense(value) {
  const v = value || {}, vendor = clean(v.vendor,120), amount = String(v.amount || '').trim(), spentDate = clean(v.date,10), jobId = clean(v.jobId,80), requestId = clean(v.requestId,40);
  if (!vendor || !/^\d{1,7}(\.\d{1,2})?$/.test(amount) || Number(amount)<=0 || !date(spentDate) || !uuid(requestId) || v.confirmed !== true) fail('Review the supplier, USD amount and date before saving.');
  const [whole,decimal=''] = amount.split('.');
  return {vendor,cents:Number(whole)*100+Number(decimal.padEnd(2,'0')),date:spentDate,jobId,requestId};
}
