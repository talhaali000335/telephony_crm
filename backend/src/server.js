import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { connectDb } from './db.js';
import { embed } from './ai.js';
import contacts from './routes/contacts.js';
import ragRoutes from './routes/rag.js';
import calls from './routes/calls.js';
import webhooks from './routes/webhooks.js';

const app = express();
app.use(cors());
app.get('/health', (req, res) => res.json({ ok: true }));

// Telnyx webhook needs raw body — must be before express.json()
app.use('/webhooks/telnyx', express.raw({ type: '*/*' }), webhooks);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// API-key auth (only for API paths — static files are served by Vercel directly)
const API_PREFIXES = ['/contacts', '/rag', '/calls'];
app.use((req, res, next) => {
  const isApi = API_PREFIXES.some(p => req.path === p || req.path.startsWith(p + '/'));
  if (!isApi) return next();
  if (req.get('x-api-key') === process.env.API_KEY) return next();
  return res.status(401).json({ error: 'unauthorized' });
});

app.use('/contacts', contacts);
app.use('/rag', ragRoutes);
app.use('/', calls);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'server error' });
});

// Lazy DB connection for serverless
let dbPromise = null;
const ensureDb = () => (dbPromise ??= connectDb());

// Warm up on first request
let warmedUp = false;
async function warmUp() {
  if (warmedUp) return;
  warmedUp = true;
  await ensureDb();
  try {
    await embed('warm up');
  } catch (e) {
    console.error('warm-up failed:', e.message);
  }
}

// Local dev: start a real server
if (!process.env.VERCEL) {
  await ensureDb();
  const port = process.env.PORT || 3000;
  app.listen(port, async () => {
    console.log('API running on port', port);
    await warmUp();
  });
}

// Vercel: export the Express app directly
export default app;