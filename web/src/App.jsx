import { useState } from 'react';
import Contacts from './pages/Contacts.jsx';
import Knowledge from './pages/Knowledge.jsx';
import Calls from './pages/Calls.jsx';

const PAGES = { Contacts, Knowledge, Calls };

export default function App() {
  const [page, setPage] = useState('Contacts');
  const Page = PAGES[page];

  return (
    <div className="app">
      <header>
        <h1>CRM · Voice · RAG</h1>
        <nav>
          {Object.keys(PAGES).map((name) => (
            <button key={name} className={name === page ? 'tab active' : 'tab'} onClick={() => setPage(name)}>
              {name}
            </button>
          ))}
        </nav>
      </header>
      <main>
        <Page />
      </main>
    </div>
  );
}
