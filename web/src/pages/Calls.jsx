import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Calls() {
  const [calls, setCalls] = useState([]);
  const [error, setError] = useState('');

  // Webhooks update the database in the background, so poll every 5 seconds.
  useEffect(() => {
    const load = async () => {
      try { setCalls(await api.calls()); setError(''); }
      catch (e) { setError(e.message); }
    };
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id); // stop polling when leaving this page
  }, []);

  return (
    <>
      {error && <p className="msg">{error}</p>}
      {calls.map((c) => (
        <div key={c._id} className="card">
          <strong>{c.contactName}</strong>
          <p className="muted">
            {c.status}{c.durationSec != null && ` · ${c.durationSec}s`} · {new Date(c.createdAt).toLocaleString()}
          </p>
          {c.transcript
            ? <p>{c.transcript}</p>
            : c.transcriptError
              ? <p className="muted">Transcript failed: {c.transcriptError}</p>
              : c.status === 'completed' && <p className="muted">Transcribing...</p>}
        </div>
      ))}
      {calls.length === 0 && <p className="muted">No calls yet. Call a contact from the Contacts page.</p>}
    </>
  );
}
