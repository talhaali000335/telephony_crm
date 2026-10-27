// Small helper for the Telnyx REST API (no SDK needed: it is just an HTTPS POST).
const API = 'https://api.telnyx.com/v2';

// label is only used for the timing log, so you can SEE how long each Telnyx call takes.
export async function telnyx(label, path, body = {}) {
  const t0 = Date.now();
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  console.log(`[latency] Telnyx ${label}: HTTP ${res.status} in ${Date.now() - t0} ms`);
  if (!res.ok) {
    const e = json.errors?.[0];
    throw new Error(e?.detail || e?.title || `Telnyx error ${res.status}`);
  }
  return json.data;
}

// client_state is a note we attach to a call. Telnyx sends it back, unchanged, in every webhook
// for that call. We use it to carry the data we need, so the webhook does not have to wait for a DB read.
export const encodeState = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64');
export const decodeState = (s) => {
  try { return JSON.parse(Buffer.from(s ?? '', 'base64').toString('utf8')); } catch { return {}; }
};

// Settings shared by every dial request.
export const dialBase = () => ({
  connection_id: process.env.TELNYX_CONNECTION_ID,
  from: process.env.TELNYX_NUMBER,
  // Per-call webhook URL. With ngrok the URL changes on every restart, so we send it
  // with each call instead of editing the Telnyx portal each time.
  ...(process.env.BASE_URL ? { webhook_url: `${process.env.BASE_URL}/webhooks/telnyx` } : {}),
});
