import { col } from './db.js';
import { embed, embedMany } from './ai.js';
import { searchCache, corpus } from './cache.js';

/* ---------- 1. INGEST: split text into chunks, embed, store ---------- */

export function chunk(text, size = 150, overlap = 30) {
  const words = text.split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < words.length; i += size - overlap) {
    out.push(words.slice(i, i + size).join(' '));
    if (i + size >= words.length) break;
  }
  return out;
}

export async function ingest({ title, text, source = 'manual', refId }) {
  const now = new Date();
  const { insertedId } = await col('documents').insertOne({ title, source, refId, createdAt: now });
  const parts = chunk(text);
  const vectors = await embedMany(parts);
  await col('chunks').insertMany(
    parts.map((p, i) => ({ docId: insertedId, title, source, text: p, embedding: vectors[i], createdAt: now }))
  );
  corpus.version++; // invalidates cached search results
  return { docId: insertedId, chunks: parts.length };
}

/* ---------- 2. RETRIEVE: get ~30 candidates cheaply ---------- */

const cosine = (a, b) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
};

async function getCandidates(queryVector, limit = 30) {
  if (process.env.USE_ATLAS_VECTOR === 'true') {
    // Approximate nearest neighbour search inside MongoDB Atlas.
    // Does NOT scan every chunk, so it stays fast with millions of them.
    return col('chunks').aggregate([
      { $vectorSearch: { index: 'chunk_vector_index', path: 'embedding', queryVector, numCandidates: 200, limit } },
      { $project: { text: 1, docId: 1, title: 1, source: 1, createdAt: 1, score: { $meta: 'vectorSearchScore' } } },
    ]).toArray();
  }
  // Learning mode: brute force over the newest 5000 chunks. NOT for production.
  const rows = await col('chunks').find().sort({ createdAt: -1 }).limit(5000).toArray();
  return rows
    .map(({ embedding, ...r }) => ({ ...r, score: cosine(queryVector, embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/* ---------- 3. RANK + DE-RANK: reorder the 30 candidates ---------- */

const tokens = (s) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);

function baseScore(query, c) {
  const q = tokens(query), t = tokens(c.text);
  const keyword = q.size ? [...q].filter((w) => t.has(w)).length / q.size : 0; // share of query words found
  const ageDays = (Date.now() - new Date(c.createdAt)) / 864e5;
  const recency = 0.05 * Math.pow(0.5, ageDays / 90); // small boost, halves every 90 days

  let score = 0.7 * c.score + 0.25 * keyword + recency;
  const why = [`vector ${c.score.toFixed(2)}`, `keyword ${keyword.toFixed(2)}`];
  if (recency > 0.02) why.push('+recent');
  if (c.text.length < 40) { score *= 0.7; why.push('-too short'); }   // DE-RANK
  if (ageDays > 365) { score *= 0.85; why.push('-stale'); }           // DE-RANK
  return { ...c, base: score, why };
}

export function rerank(query, candidates, k) {
  const pool = candidates.map((c) => baseScore(query, c));
  const picked = [];
  const seen = {}; // how many chunks we already took from each document
  while (picked.length < k && pool.length) {
    // Pick the best remaining chunk, but each extra chunk from the same document
    // is multiplied by 0.75 (DE-RANK duplicates -> more diverse results).
    let best = 0, bestVal = -1;
    pool.forEach((c, i) => {
      const v = c.base * Math.pow(0.75, seen[c.docId] ?? 0);
      if (v > bestVal) { bestVal = v; best = i; }
    });
    const [c] = pool.splice(best, 1);
    const n = seen[c.docId] ?? 0;
    if (n) c.why.push(`-same doc x${n}`);
    seen[c.docId] = n + 1;
    picked.push({ ...c, finalScore: bestVal });
  }
  return picked;
}

/* ---------- 4. SEARCH = cache -> embed -> retrieve -> rerank ---------- */

export async function search(query, k = 5) {
  const key = `${corpus.version}:${k}:${query.trim().toLowerCase()}`;
  const hit = searchCache.get(key);
  if (hit) return { ...hit, cached: true };

  const qv = await embed(query);
  const candidates = await getCandidates(qv);
  const results = rerank(query, candidates, k).map((r) => ({
    id: r._id, docId: r.docId, title: r.title, source: r.source, text: r.text,
    finalScore: +r.finalScore.toFixed(3), why: r.why,
  }));
  const out = { results };
  searchCache.set(key, out);
  return { ...out, cached: false };
}
