// Speed-to-lead push alert. A phone notification the moment an estimate
// request arrives, so Mark can call back inside the first few minutes instead
// of whenever he next opens email.
//
// Delivered through ntfy (https://ntfy.sh): free, no account, iOS/Android app.
// Deliberately carries NO customer data. The privacy policy names exactly
// three companies that see submitted fields (Cloudflare, Resend, Google
// Workspace); the push only says a request arrived and links to the
// authenticated Command Center, where the details live.
//
//   LEAD_ALERT_NTFY_TOPIC   required to enable; 20-64 chars [A-Za-z0-9_-].
//                           Anyone who knows a public ntfy topic can read it,
//                           so it must be long and random. Treat as a secret.
//   LEAD_ALERT_NTFY_SERVER  optional; defaults to https://ntfy.sh
//   LEAD_ALERT_NTFY_TOKEN   optional; bearer token for a protected server/topic

const TOPIC_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;
const DEFAULT_SERVER = 'https://ntfy.sh';
const LEADS_URL = 'https://windowsbyclearview.com/internal/leads';

export function leadAlertConfig(env) {
  const topic = String(env?.LEAD_ALERT_NTFY_TOPIC || '').trim();
  if (!TOPIC_PATTERN.test(topic)) return null;
  let server = String(env?.LEAD_ALERT_NTFY_SERVER || DEFAULT_SERVER).trim().replace(/\/+$/, '');
  try {
    if (new URL(server).protocol !== 'https:') return null;
  } catch {
    return null;
  }
  return { url: `${server}/${topic}`, token: String(env?.LEAD_ALERT_NTFY_TOKEN || '').trim() };
}

export async function sendLeadAlert(env, fetchImpl = fetch) {
  const config = leadAlertConfig(env);
  if (!config) return { status: 'unconfigured' };
  const headers = {
    Title: 'New estimate request',
    Priority: 'high',
    Tags: 'house,telephone_receiver',
    Click: LEADS_URL,
    'content-type': 'text/plain; charset=utf-8',
  };
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  try {
    const response = await fetchImpl(config.url, {
      method: 'POST',
      headers,
      body: 'Someone just asked for an estimate. Tap to open the lead and call back.',
    });
    if (!response.ok) {
      console.error('lead-alert-failed', response.status);
      return { status: 'failed' };
    }
    return { status: 'sent' };
  } catch (error) {
    console.error('lead-alert-failed', error?.message || error);
    return { status: 'failed' };
  }
}

// Same channel, for other owner-only events (e.g. a customer signed a quote).
// Callers must keep customer data out of title/body, as above.
export async function sendOpsAlert(env, { title, body, click, tags = 'house' }, fetchImpl = fetch) {
  const config = leadAlertConfig(env);
  if (!config) return { status: 'unconfigured' };
  const headers = { Title: title, Priority: 'high', Tags: tags, Click: click, 'content-type': 'text/plain; charset=utf-8' };
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  try {
    const response = await fetchImpl(config.url, { method: 'POST', headers, body });
    if (!response.ok) {
      console.error('ops-alert-failed', response.status);
      return { status: 'failed' };
    }
    return { status: 'sent' };
  } catch (error) {
    console.error('ops-alert-failed', error?.message || error);
    return { status: 'failed' };
  }
}
