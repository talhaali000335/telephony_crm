# CRM + Voice + RAG: a small app for learning

A small backend plus **two interchangeable frontends**: a **website** (`web/`, React + Vite) and a **phone app** (`mobile/`, React Native). Both have the same 3 pages and use the same backend.

This is the original intro: 3 screens, one small backend. Every file is short and commented. Read the code in the order of "Part 2".

```
 Phone (React Native / Expo)                 Backend (Node + Express)                    Outside world
 ┌──────────────────────────┐   REST + key   ┌────────────────────────────┐
 │ 1 Contacts  (CRM)        │ ─────────────► │ /contacts   /rag   /calls  │ ◄─► MongoDB
 │ 2 Knowledge (RAG, voice) │                │ /voice-notes               │ ◄─► OpenAI (embeddings, Whisper, chat)
 │ 3 Calls     (history)    │ ◄───────────── │                            │ ─► Twilio: "ring me, then dial X"
 └──────────────────────────┘    polling     │ /webhooks/twilio/*         │ ◄─ Twilio: status + recording events
                                              └────────────────────────────┘
```

## Part 1: Setup (about 30 minutes)

**Need:** Node 18+, a phone with the Expo Go app, accounts for MongoDB (local or Atlas free), OpenAI, Twilio (free trial), ngrok.

1. **Backend**
   ```bash
   cd backend
   npm install
   cp .env.example .env      # then fill in the values
   ```
2. **MongoDB.** Simplest: free Atlas cluster at mongodb.com/atlas, copy the connection string into `MONGODB_URI`. A local MongoDB also works (keep `USE_ATLAS_VECTOR=false`).
3. **OpenAI.** Create a key, put it in `OPENAI_API_KEY`. It powers embeddings, Whisper and the "Ask AI" answer.
4. **ngrok.** Twilio must reach your laptop, so run `ngrok http 3000` and copy the `https://...` URL into `BASE_URL`.
5. **Twilio (free trial gives credit).**
   - Sign up, copy Account SID and Auth Token into `.env`.
   - Get a trial phone number, put it in `TWILIO_NUMBER`.
   - Trial accounts can only call **verified** numbers: add your phone and the contacts you test with under *Verified Caller IDs*.
   - Put your own phone in `AGENT_PHONE` (format `+92300...`).
   - Webhook URLs are sent per call by the code, so you do not configure them in the Twilio console.
6. **Start the server:** `npm start`. Open `BASE_URL/health` in a browser. It should show `{"ok":true}`.
7. **Mobile**
   ```bash
   npx create-expo-app@latest mobile-app --template blank
   cd mobile-app
   npx expo install @react-navigation/native @react-navigation/bottom-tabs react-native-screens react-native-safe-area-context expo-audio
   ```
   Copy `mobile/App.js` over `mobile-app/App.js` and copy `mobile/src` into `mobile-app/src`. Edit `src/api.js`: set `API_URL` to your computer's local IP (`http://192.168.x.x:3000`, same Wi-Fi) and `API_KEY` to the same value as in `.env`.
   Then `npx expo start` and scan the QR code with Expo Go.
   If a package API has changed in your Expo version, the Expo docs for `expo-audio` are the place to check. Only `KnowledgeScreen.js` uses it.


## Part 1b: Run the WEBSITE (easiest way to start, about 5 minutes)

You do not need a phone, Expo, or the mobile folder for this.

1. Finish Part 1 steps 1-6 (the backend must be running on port 3000).
2. In a second terminal:
   ```bash
   cd web
   npm install
   cp .env.example .env     # VITE_API_KEY must equal API_KEY in backend/.env
   npm run dev
   ```
3. Open **http://localhost:5173** in Chrome. You get 3 pages: **Contacts**, **Knowledge**, **Calls**.

How the website works:
- `web/src/api.js` is the only file that talks to the backend (same endpoints as the phone app).
- `web/src/App.jsx` switches between the 3 pages with simple tabs. Each page is one file in `web/src/pages/`.
- **Voice notes** use the browser's `MediaRecorder`. The browser asks for microphone permission. It works on `localhost` and on https sites only.
- **Calls page** polls every 5 seconds, because the webhooks update MongoDB in the background.
- **Publishing the site:** run `npm run build`; the `web/dist` folder is static and can be hosted on Netlify, Vercel or any static host. Then set `VITE_API_URL` to your deployed backend URL before building.
- **Security warning:** a website's JavaScript is public, so the shared `VITE_API_KEY` can be read by any visitor. That is fine for learning on your own computer. Before putting it online, add real user login to the backend (sign-in plus a JWT token) and remove the shared key.
- Extra exercise: replace the tab switch with `react-router-dom` so each page gets its own URL.

## Part 2: How each thing works (read the code in this order)

### A. MongoDB: `backend/src/db.js`
Collections: `contacts`, `documents` (one per text), `chunks` (small pieces + embedding), `calls`, `webhook_events`. Unique indexes protect against duplicates (used by webhooks).

### B. CRM: `routes/contacts.js` + Contacts screen
Plain create/list. The one interesting line: a contact's notes are also sent to the RAG pipeline, so CRM data becomes searchable.

### C. RAG: `src/rag.js` (the most important file)
1. **Ingest:** split text into 200-word chunks (40 overlap), turn each chunk into a vector with OpenAI embeddings, store in `chunks`.
2. **Retrieve:** turn the question into a vector and ask MongoDB for the 30 closest chunks.
3. **Rank / de-rank (`rerank`):**
   - Rank up: vector similarity (70%), keyword match (25%), small recency bonus.
   - De-rank down: very short chunks (×0.7), chunks older than a year (×0.85), and repeated chunks from the same document (×0.75 each time) so results stay varied.
   - Each result shows a `why` list in the app so you can see the scoring.
4. **Generate:** "Ask AI" sends only the top 4 chunks to the chat model, so it answers from your data.

**Why this handles a million documents.** Never compare against every chunk:
- Retrieval is **approximate nearest neighbour** (`$vectorSearch` on Atlas). It looks at about 200 candidates, not millions.
- The slow, smarter reranking runs on only **30** candidates.
- Embeddings are never returned to the app (projection).
- To use it: create an Atlas Vector Search index named `chunk_vector_index` on the `chunks` collection using `atlas-vector-index.json`, then set `USE_ATLAS_VECTOR=true`. With `false` the code scans only 5000 chunks, which is fine for learning and wrong for production.
- For real scale later: ingest through a queue (BullMQ), add scalar quantization to the index, and filter by owner or tenant inside `$vectorSearch`.

### D. Cache management: `src/cache.js`
- A small **LRU + TTL** cache: the oldest entry is evicted when full, and entries expire by time.
- Two caches: **embeddings** (24h, same text never costs a second API call) and **search results** (60s).
- **Invalidation:** the corpus `version` is part of the search cache key. Every ingest increments it, so stale results are never served after new data arrives.
- Check it at `GET /rag/cache-stats` (send the `x-api-key` header). The app also shows "Served from cache" under results.
- Limit: this cache lives in one process's memory. With several servers, move it to Redis (same get/set idea).

### E. Webhooks: `routes/webhooks.js` (read the comments, there are 3 rules)
A webhook is just Twilio calling *your* URL when something happens. Three rules make it production-grade:
1. **Verify the signature.** Anyone can POST to your URL. Twilio signs requests and `validateRequest` checks it.
2. **Be idempotent.** Providers retry. `webhook_events.eventKey` has a unique index, so a duplicate event is ignored.
3. **Answer fast, work later.** The recording webhook replies `200` immediately and then downloads, transcribes and indexes.

The three webhooks:
- `/twilio/voice`: Twilio asks what to do when you answer; we reply with TwiML (XML) telling it to dial the contact and record.
- `/twilio/status`: call state changes (`ringing`, `in-progress`, `completed`) saved to `calls`.
- `/twilio/recording`: recording ready, then Whisper, then saved to the call and added to RAG.

### F. Calling: `routes/calls.js`
Tap **Call** → server asks Twilio to ring **your phone** → you answer → Twilio calls the contact and bridges you → recording starts. This is "click-to-call", the easiest correct design: no VoIP SDK, no native code, works inside Expo Go.
**Telnyx instead of Twilio?** Same idea. You create a call with the REST API and Telnyx posts JSON events (`call.answered`, `call.hangup`, `call.recording.saved`) to a webhook, signed with an Ed25519 key. Only `calls.js` and `webhooks.js` would change.
Real in-app calling (audio inside the app) needs Twilio Voice SDK or Telnyx WebRTC with a custom dev build. Do that after you understand this version.

### G. Voice management: Whisper
- **Voice note:** Knowledge screen → *Voice note* records audio (`expo-audio`) → upload to `/voice-notes` → Whisper → text indexed in RAG.
- **Call recordings:** webhook E above feeds the same Whisper function (`ai.js → transcribe`).
- Whisper accepts files up to 25 MB; very long calls need splitting (a good later exercise).

## Part 3: Test it in this order
1. Add a contact with notes like "Ali prefers invoices on Friday". Then in Knowledge, search "when does Ali want invoices" and see the score chips.
2. Search the same thing twice. The second shows "Served from cache". Add a document, search again: fresh again (invalidation).
3. Record a voice note, then search for something you said.
4. Call a verified contact. Watch the Calls tab change status and later show the transcript. The server console shows webhook activity.
5. No ngrok yet? Test a webhook with `SKIP_WEBHOOK_VERIFY=true` and:
   `curl -X POST $BASE_URL/webhooks/twilio/status -d "CallSid=CA1&CallStatus=completed"`. Send it twice. The second time nothing changes (idempotency). Turn the flag back to `false` afterwards.

## Part 4: Common problems
| Problem | Fix |
|---|---|
| Website shows "Failed to fetch" | Backend is not running, or `VITE_API_URL` is wrong; restart `npm run dev` after editing `.env` |
| App says "Network request failed" | `API_URL` must be your computer's LAN IP, same Wi-Fi, firewall allows port 3000 |
| 401 unauthorized | `API_KEY` differs between app and `.env` |
| Phone rings but contact never does | Trial account: contact number must be verified in Twilio |
| 403 Invalid signature | `BASE_URL` must exactly match the ngrok URL (https, no trailing slash); restart the server after editing `.env` |
| Search returns nothing in Atlas mode | The vector index is still building or its name is not `chunk_vector_index` |
| Transcript never appears | Check server logs; the Calls tab shows `transcriptError` |

## Part 5: Exercises
1. Change the rerank weights and watch the order change.
2. Add a "recency off" option to the search.
3. Add a delete-contact route that also deletes its chunks.
4. Replace the in-memory cache with Redis.
5. Swap Twilio for Telnyx.

## Limits of this starter (on purpose)
One shared API key, no user accounts, polling instead of push updates, no tests. Add those once the flow makes sense.
#   t e l e p h o n y _ c r m  
 