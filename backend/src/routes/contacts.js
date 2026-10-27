import { Router } from 'express';
import { col } from '../db.js';
import { ingest } from '../rag.js';
import { wrap, HttpError } from '../util.js';

const r = Router();

r.get('/', wrap(async (req, res) => {
  res.json(await col('contacts').find().sort({ createdAt: -1 }).limit(100).toArray());
}));

r.post('/', wrap(async (req, res) => {
  const { name, phone, company = '', notes = '' } = req.body;
  if (!name?.trim()) throw new HttpError(400, 'name is required');
  if (!/^\+\d{8,15}$/.test(phone ?? '')) throw new HttpError(400, 'phone must look like +923001234567');

  const contact = { name: name.trim(), phone, company, notes, createdAt: new Date() };
  const { insertedId } = await col('contacts').insertOne(contact);

  // CRM + RAG link: notes become searchable knowledge.
  if (notes.trim()) await ingest({ title: `Notes: ${contact.name}`, text: notes, source: 'crm', refId: insertedId });

  res.status(201).json({ _id: insertedId, ...contact });
}));

export default r;
