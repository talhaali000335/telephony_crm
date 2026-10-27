import { Router } from 'express';
import { ObjectId } from 'mongodb';
import multer from 'multer';
import { col } from '../db.js';
import { transcribe } from '../ai.js';
import { ingest } from '../rag.js';
import { telnyx, encodeState, dialBase } from '../telnyx.js';
import { wrap, HttpError } from '../util.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// CALL_MODE=single : Telnyx calls the contact directly and records. (Use this on a trial account.)
// CALL_MODE=bridge : Telnyx rings YOUR phone first, then calls the contact and connects you.
const MODE = process.env.CALL_MODE === 'bridge' ? 'bridge' : 'single';

r.post('/calls/start', wrap(async (req, res) => {
  if (!ObjectId.isValid(req.body.contactId)) throw new HttpError(400, 'bad contactId');
  const contact = await col('contacts').findOne({ _id: new ObjectId(req.body.contactId) });
  if (!contact) throw new HttpError(404, 'contact not found');

  const callId = new ObjectId();
  await col('calls').insertOne({
    _id: callId,
    callSid: String(callId), // the database has a unique index on this field
    contactId: contact._id, contactName: contact.name,
    status: 'dialing', mode: MODE, createdAt: new Date(),
  });

  try {
    const body = MODE === 'single'
      ? {
          ...dialBase(), to: contact.phone,
          record: 'record-from-answer', record_channels: 'single', record_format: 'mp3',
          client_state: encodeState({ step: 'contact', callId }),
        }
      : {
          ...dialBase(), to: process.env.AGENT_PHONE,
          // The contact's number travels inside client_state, so the webhook can dial it immediately.
          client_state: encodeState({ step: 'agent', callId, to: contact.phone }),
        };
    await telnyx(MODE === 'single' ? 'dial contact' : 'dial agent', '/calls', body);
  } catch (err) {
    await col('calls').updateOne({ _id: callId }, { $set: { status: 'failed', error: err.message } });
    throw new HttpError(502, `Telnyx: ${err.message}`);
  }
  res.status(201).json({ callId, mode: MODE });
}));

r.get('/calls', wrap(async (req, res) => {
  res.json(await col('calls').find().sort({ createdAt: -1 }).limit(50).toArray());
}));

// Voice note from the website: audio file -> Whisper -> searchable knowledge.
r.post('/voice-notes', upload.single('audio'), wrap(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'audio file is required');
  const text = await transcribe(req.file.buffer, req.file.originalname || 'note.webm');
  if (!text.trim()) throw new HttpError(422, 'nothing was heard');
  await ingest({ title: `Voice note ${new Date().toLocaleString()}`, text, source: 'voice-note' });
  res.status(201).json({ text });
}));

export default r;
