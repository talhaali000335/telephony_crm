// Same backend as the phone app. Values come from web/.env (Vite exposes VITE_* variables).
// WARNING: anything in a website's JavaScript is visible to visitors, so this shared key is for
// learning only. A real site needs user login (e.g. JWT) instead.
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const API_KEY = import.meta.env.VITE_API_KEY || '';

async function request(path, options = {}) {
  const isForm = options.body instanceof FormData;
  const res = await fetch(API_URL + path, {
    ...options,
    headers: {
      'x-api-key': API_KEY,
      ...(options.body && !isForm ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) });

export const api = {
  contacts: () => request('/contacts'),
  addContact: (c) => post('/contacts', c),
  startCall: (contactId) => post('/calls/start', { contactId }),
  calls: () => request('/calls'),
  addDoc: (title, text) => post('/rag/docs', { title, text }),
  search: (q) => request(`/rag/search?q=${encodeURIComponent(q)}`),
  ask: (question) => post('/rag/ask', { question }),
  voiceNote: (blob) => {
    const form = new FormData();
    form.append('audio', blob, 'note.webm'); // browsers record webm; Whisper accepts it
    return request('/voice-notes', { method: 'POST', body: form });
  },
};
