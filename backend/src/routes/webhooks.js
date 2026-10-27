import { Router } from 'express';
import crypto from 'crypto';
import { ObjectId } from 'mongodb';
import { col } from '../db.js';
import { transcribe } from '../ai.js';
import { ingest } from '../rag.js';
import { telnyx, encodeState, decodeState, dialBase } from '../telnyx.js';

const r = Router();

/* 1. VERIFY. Anyone can POST to this URL. Telnyx signs each request with Ed25519:
      signature = sign(`${timestamp}|${raw body}`). We check it with your account's PUBLIC key.
      That is why the route needs the RAW body (see server.js), not parsed JSON. */
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex'); // wraps a raw 32-byte Ed25519 key

export function verifyTelnyx(req, res, next) {
  if (process.env.SKIP_WEBHOOK_VERIFY === 'true') return next();
  try {
    const signature = req.get('telnyx-signature-ed25519');
    const timestamp = req.get('telnyx-timestamp');
    if (!signature || !timestamp) throw new Error('missing headers');
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) throw new Error('timestamp too old'); // replay guard
    const key = crypto.createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, Buffer.from(process.env.TELNYX_PUBLIC_KEY, 'base64')]),
      format: 'der', type: 'spki',
    });
    const message = Buffer.from(`${timestamp}|${req.body.toString('utf8')}`);
    if (!crypto.verify(null, message, key, Buffer.from(signature, 'base64'))) throw new Error('bad signature');
    next();
  } catch (err) {
    console.warn('webhook rejected:', err.message);
    res.sendStatus(403);
  }
}

/* 2. IDEMPOTENCY. Every Telnyx event has a unique id. Providers retry, so the same event can
      arrive twice. The unique index on eventKey makes the second insert fail and we skip it. */
async function firstTime(eventKey) {
  try {
    await col('webhook_events').insertOne({ eventKey, receivedAt: new Date() });
    return true;
  } catch (e) {
    if (e.code === 11000) return false;
    throw e;
  }
}

/* 3. ANSWER FAST. Telnyx expects HTTP 200 within about 2 seconds, so we reply first
      and do the real work afterwards. */
r.post('/', verifyTelnyx, (req, res) => {
  let event;
  try { event = JSON.parse(req.body.toString('utf8')).data; } catch { return res.sendStatus(400); }
  res.sendStatus(200);
  handle(event).catch((err) => console.error('webhook handler failed:', err.message));
});

const hangup = (callControlId, label) =>
  telnyx(label, `/calls/${callControlId}/actions/hangup`).catch(() => {}); // already ended is fine

async function handle(ev) {
  const { event_type: type, id, occurred_at: occurredAt, payload = {} } = ev;
  if (!(await firstTime(`telnyx:${id}`))) return;

  // How long did Telnyx take to deliver this event to us? (includes ngrok and your internet)
  console.log(`[latency] ${type} delivered ${Date.now() - Date.parse(occurredAt)} ms after it happened`);

  const state = decodeState(payload.client_state);
  if (!state.callId) return; // not one of our calls
  const callId = new ObjectId(state.callId);
  const calls = col('calls');

  switch (type) {
    case 'call.initiated':
      if (state.step === 'contact' && state.agentCcid) {
        await calls.updateOne({ _id: callId }, { $set: { contactCcid: payload.call_control_id } });
      }
      break;

    case 'call.answered':
      if (state.step === 'agent') {
        // You picked up. Dial the contact NOW (before touching the database) and bridge on answer.
        await telnyx('dial contact', '/calls', {
          ...dialBase(), to: state.to,
          link_to: payload.call_control_id, bridge_on_answer: true,
          record: 'record-from-answer', record_channels: 'dual', record_format: 'mp3',
          client_state: encodeState({ step: 'contact', callId: state.callId, agentCcid: payload.call_control_id }),
        });
        await calls.updateOne({ _id: callId }, { $set: { status: 'connecting', agentCcid: payload.call_control_id } });
      } else {
        await calls.updateOne({ _id: callId }, { $set: { status: 'in-progress', answeredAt: new Date() } });
      }
      break;

    case 'call.hangup': {
      const call = await calls.findOne({ _id: callId });
      if (!call) break;
      const set = { hangupCause: payload.hangup_cause, updatedAt: new Date() };
      if (state.step === 'contact') {
        set.status = call.answeredAt ? 'completed' : 'not-answered';
        if (call.answeredAt) set.durationSec = Math.round((Date.now() - call.answeredAt) / 1000);
        if (state.agentCcid) hangup(state.agentCcid, 'hangup agent'); // contact left: end your leg too
      } else if (!['completed', 'not-answered'].includes(call.status)) {
        set.status = 'agent-no-answer';
        if (call.contactCcid) hangup(call.contactCcid, 'hangup contact');
      }
      await calls.updateOne({ _id: callId }, { $set: set });
      break;
    }

    case 'call.recording.saved': {
      // Recording ready -> download -> Whisper -> save -> make searchable.
      const url = payload.public_recording_urls?.mp3 || payload.recording_urls?.mp3;
      if (!url) break;
      const t0 = Date.now();
      try {
        const audio = await fetch(url);
        if (!audio.ok) throw new Error(`download failed: ${audio.status}`);
        const buffer = Buffer.from(await audio.arrayBuffer());
        const t1 = Date.now();
        const text = await transcribe(buffer, 'call.mp3');
        console.log(`[latency] recording: download ${t1 - t0} ms + Whisper ${Date.now() - t1} ms (${Math.round(buffer.length / 1024)} KB)`);

        const call = await calls.findOneAndUpdate({ _id: callId }, { $set: { transcript: text } });
        if (text.trim()) await ingest({ title: `Call with ${call?.contactName ?? 'unknown'}`, text, source: 'call', refId: callId });
      } catch (err) {
        console.error('recording pipeline failed:', err.message);
        await calls.updateOne({ _id: callId }, { $set: { transcriptError: err.message } });
      }
      break;
    }
  }
}

export default r;
