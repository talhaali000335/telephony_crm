import { Router } from 'express';
import { ingest, search } from '../rag.js';
import { answer } from '../ai.js';
import { searchCache, embedCache } from '../cache.js';
import { wrap, HttpError } from '../util.js';

const r = Router();

r.post('/docs', wrap(async (req, res) => {
  const { title, text } = req.body;
  if (!title?.trim() || !text?.trim()) throw new HttpError(400, 'title and text are required');
  res.status(201).json(await ingest({ title: title.trim(), text }));
}));

r.get('/search', wrap(async (req, res) => {
  if (!req.query.q) throw new HttpError(400, 'q is required');
  res.json(await search(String(req.query.q)));
}));

r.post('/ask', wrap(async (req, res) => {
  if (!req.body.question) throw new HttpError(400, 'question is required');
  const { results } = await search(req.body.question, 4);
  const text = results.length
    ? await answer(req.body.question, results.map((x) => x.text))
    : "I don't have any documents yet.";
  res.json({ answer: text, sources: results });
}));

r.get('/cache-stats', (req, res) => res.json({ search: searchCache.stats(), embeddings: embedCache.stats() }));

export default r;
