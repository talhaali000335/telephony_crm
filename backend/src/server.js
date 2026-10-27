import 'dotenv/config'; // must be first so env vars exist for the other imports
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDb } from './db.js';
import { embed } from './ai.js';
import contacts from './routes/contacts.js';
import ragRoutes from './routes/rag.js';
import calls from './routes/calls.js';
import webhooks from './routes/webhooks.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());

// Health check (no auth, so you can ping it from anywhere)
app.get('/health', (req, res) => res.json({ ok: true }));

// Telnyx webhook: raw body needed for Ed25519 signature verification.
// MUST be before express.json() or the raw bytes are lost.
app.use('/webhooks/telnyx', express.raw({ type: '*/*' }), webhooks);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// API-key check — applies ONLY to API paths, never to static files or SPA routes.
const API_PREFIXES = ['/contacts', '/rag', '/calls'];
app.use((req, res, next) => {
  const isApi = API_PREFIXES.some(
    (p) => req.path === p || req.path.startsWith(p + '/'),
  );
  if (!isApi) return next();
  if (req.get('x-api-key') === process.env.API_KEY) return next();
  return res.status(401).json({ error: 'unauthorized' });
});

app.use('/contacts', contacts);
app.use('/rag', ragRoutes);
app.use('/', calls);

// Serve the Vite build. Vercel serves these directly via static-build;
// this branch is the fallback when you run `node server.js` in production mode locally.
const isVercel = !!process.env.VERCEL;
if (isVercel || process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '../../web/dist');
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'server error' });
});

// ---- Startup ------------------------------------------------------------

// Lazy, cached DB connection — runs once per warm serverless instance.
let dbPromise = null;
const ensureDb = () => (dbPromise ??= connectDb());

// Warm up DB + embedding model on first request (cached after that).
let warmedUp = false;
async function warmUp() {
  if (warmedUp) return;
  warmedUp = true;
  await ensureDb();
  const t0 = Date.now();
  try {
    await embed('warm up');
    console.log(`[latency] embedding model ready in ${Date.now() - t0} ms`);
  } catch (e) {
    console.error('model warm-up failed:', e.message);
  }
}

// Local dev: start a real HTTP server
if (!isVercel) {
  await ensureDb();
  const port = process.env.PORT || 3000;
  app.listen(port, async () => {
    console.log('API running on port', port);
    await warmUp();
  });
}

// Vercel: export a handler that Vercel invokes per request
export default async function handler(req, res) {
  await warmUp();
  return app(req, res);
}