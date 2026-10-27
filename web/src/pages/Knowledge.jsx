import { useRef, useState } from 'react';
import { api } from '../api.js';

export default function Knowledge() {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [answer, setAnswer] = useState('');
  const [cached, setCached] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);

  // Show "busy" and catch errors for any async action.
  const run = async (fn) => {
    setBusy(true); setMsg('');
    try { await fn(); } catch (e) { setMsg(e.message); }
    setBusy(false);
  };

  const saveDoc = (e) => { e.preventDefault(); run(async () => {
    const r = await api.addDoc(title, text);
    setTitle(''); setText('');
    setMsg(`Saved: ${r.chunks} chunk(s) indexed`);
  }); };

  const search = (e) => { e.preventDefault(); run(async () => {
    const r = await api.search(query);
    setResults(r.results); setCached(r.cached); setAnswer('');
  }); };

  const ask = () => run(async () => {
    const r = await api.ask(query);
    setAnswer(r.answer); setResults(r.sources);
  });

  // Browser recording: MediaRecorder collects audio pieces; on stop we join them and upload.
  const toggleRecord = () => run(async () => {
    if (!recording) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); // needs https or localhost
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (ev) => chunksRef.current.push(ev.data);
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } else {
      const rec = recorderRef.current;
      const stopped = new Promise((resolve) => { rec.onstop = resolve; });
      rec.stop();
      rec.stream.getTracks().forEach((t) => t.stop()); // release the microphone
      await stopped;
      setRecording(false);
      const blob = new Blob(chunksRef.current, { type: rec.mimeType });
      const r = await api.voiceNote(blob); // upload -> Whisper -> indexed
      setMsg(`Voice note saved: "${r.text}"`);
    }
  });

  return (
    <>
      {msg && <p className="msg">{msg}</p>}

      <form className="card" onSubmit={saveDoc}>
        <h2>Add knowledge</h2>
        <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <textarea placeholder="Text..." value={text} onChange={(e) => setText(e.target.value)} required />
        <div className="row">
          <button type="submit" disabled={busy}>Save</button>
          <button type="button" className={recording ? 'danger' : 'green'} onClick={toggleRecord}>
            {recording ? 'Stop & save voice note' : 'Record voice note'}
          </button>
        </div>
      </form>

      <form className="card" onSubmit={search}>
        <h2>Search</h2>
        <input placeholder="Ask something..." value={query} onChange={(e) => setQuery(e.target.value)} required />
        <div className="row">
          <button type="submit" disabled={busy}>Search</button>
          <button type="button" onClick={ask} disabled={busy || !query}>Ask AI</button>
          {busy && <span className="muted">working...</span>}
        </div>
      </form>

      {answer && <div className="card"><h2>Answer</h2><p>{answer}</p></div>}

      {results.length > 0 && <p className="muted">{cached ? 'Served from cache' : 'Fresh search'}</p>}
      {results.map((r) => (
        <div key={r.id} className="card">
          <strong>{r.title}</strong> <span className="muted">score {r.finalScore}</span>
          <p>{r.text}</p>
          <div>
            <span className="chip">{r.source}</span>
            {r.why.map((w) => <span key={w} className="chip">{w}</span>)}
          </div>
        </div>
      ))}
    </>
  );
}
