import { MongoClient } from 'mongodb';

let db;

export async function connectDb() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  db = client.db(process.env.MONGODB_DB || 'crm_rag');

  // Indexes. The unique ones are what make webhooks safe to receive twice.
  await db.collection('webhook_events').createIndex({ eventKey: 1 }, { unique: true });
  await db.collection('calls').createIndex({ callSid: 1 }, { unique: true });
  await db.collection('chunks').createIndex({ docId: 1 });
  await db.collection('contacts').createIndex({ createdAt: -1 });
  console.log('MongoDB connected');
}

export const col = (name) => db.collection(name);
