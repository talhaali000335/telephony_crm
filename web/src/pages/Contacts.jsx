import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Contacts() {
  const [contacts, setContacts] = useState([]);
  const [form, setForm] = useState({ name: '', phone: '', company: '', notes: '' });
  const [msg, setMsg] = useState('');

  const load = async () => {
    try { setContacts(await api.contacts()); }
    catch (e) { setMsg(e.message); }
  };
  useEffect(() => { load(); }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const add = async (e) => {
    e.preventDefault();
    try {
      await api.addContact(form);
      setForm({ name: '', phone: '', company: '', notes: '' });
      setMsg('Contact saved');
      load();
    } catch (err) { setMsg(err.message); }
  };

  const call = async (c) => {
    try {
      await api.startCall(c._id);
      setMsg(`Calling... your phone will ring first. Answer it to be connected to ${c.name}.`);
    } catch (err) { setMsg(err.message); }
  };

  return (
    <>
      {msg && <p className="msg">{msg}</p>}
      <form className="card" onSubmit={add}>
        <h2>New contact</h2>
        <input placeholder="Name" value={form.name} onChange={set('name')} required />
        <input placeholder="+923001234567" value={form.phone} onChange={set('phone')} required />
        <input placeholder="Company (optional)" value={form.company} onChange={set('company')} />
        <textarea placeholder="Notes (these become searchable)" value={form.notes} onChange={set('notes')} />
        <button type="submit">Save contact</button>
      </form>

      {contacts.map((c) => (
        <div key={c._id} className="card row">
          <div className="grow">
            <strong>{c.name}</strong> <span className="muted">{c.phone}{c.company && ` · ${c.company}`}</span>
            {c.notes && <p>{c.notes}</p>}
          </div>
          <button onClick={() => call(c)}>Call</button>
        </div>
      ))}
      {contacts.length === 0 && <p className="muted">No contacts yet.</p>}
    </>
  );
}
