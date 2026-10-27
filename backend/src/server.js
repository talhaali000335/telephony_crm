import 'dotenv/config'; // must be first so env vars exist for the other imports
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

// The Telnyx signature is computed over the RAW request body, so this route must be mounted
// BEFORE express.json(), which would otherwise parse the body and throw the raw bytes away.
app.use('/webhooks/telnyx', express.raw({ type: '*/*' }), webhooks);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Everything below needs the API key header from the website.
app.use((req, res, next) =>
  req.get('x-api-key') === process.env.API_KEY ? next() : res.status(401).json({ error: 'unauthorized' }));
app.use('/contacts', contacts);
app.use('/rag', ragRoutes);
app.use('/', calls);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'server error' });
});

await connectDb();
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log('API running on port', port);
  // LATENCY: load the embedding model now, so the first user search is not the slow one.
  const t0 = Date.now();
  embed('warm up')
    .then(() => console.log(`[latency] embedding model ready in ${Date.now() - t0} ms`))
    .catch((e) => console.error('model warm-up failed:', e.message));
});
