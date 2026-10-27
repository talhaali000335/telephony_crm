import OpenAI, { toFile } from 'openai';
import { pipeline } from '@xenova/transformers';
import crypto from 'crypto';
import { embedCache } from './cache.js';

// Groq speaks the same protocol as OpenAI, so the same SDK works with a different baseURL.
let _groq;
const groq = () => (_groq ??= new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
}));

// Local embedding model (384 numbers per text). Loaded once, on first use.
let _extractor;
const extractor = () => (_extractor ??= pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2'));

const hash = (t) => crypto.createHash('sha1').update(t).digest('hex');

// Turn texts into vectors. Cached, so the same text is never embedded twice.
export async function embedMany(texts) {
  const ex = await extractor();
  const out = [];
  for (const t of texts) {
    let vec = embedCache.get(hash(t));
    if (!vec) {
      const res = await ex(t, { pooling: 'mean', normalize: true });
      vec = Array.from(res.data);
      embedCache.set(hash(t), vec);
    }
    out.push(vec);
  }
  return out;
}
export const embed = async (text) => (await embedMany([text]))[0];

// Whisper on Groq: audio bytes -> text.
export async function transcribe(buffer, filename = 'audio.m4a') {
  const file = await toFile(buffer, filename);
  const r = await groq().audio.transcriptions.create({ file, model: 'whisper-large-v3-turbo' });
  return r.text;
}

// The "G" in RAG: answer using only the retrieved chunks.
export async function answer(question, contexts) {
  const r = await groq().chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: "Answer using only the context. If the answer is not there, say you don't know." },
      { role: 'user', content: `Context:\n${contexts.map((c, i) => `[${i + 1}] ${c}`).join('\n')}\n\nQuestion: ${question}` },
    ],
  });
  return r.choices[0].message.content;
}