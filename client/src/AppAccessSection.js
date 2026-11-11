import React, { useEffect, useRef, useState } from 'react';
import './AppAccessSection.css';
import { ACCESS_CHANGED } from './accessEvents';

const API_BASE_URL = process.env.REACT_APP_API_URL || '';
const authHeaders = (json) => {
  const token = localStorage.getItem('authToken');
  return json ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { Authorization: `Bearer ${token}` };
};

// Settings -> App access: which apps each person who can log in sees, by
// heading. Admins have everything. Anyone can look; only admins can change
// it (the server enforces that too). A heading's box ticks/unticks all of
// its apps.
function HeadingBox({ checked, partial, disabled, onChange, title }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = partial; }, [partial]);
  return <input ref={ref} type="checkbox" checked={checked} disabled={disabled} onChange={onChange} title={title} />;
}

export default function AppAccessSection({ currentUser }) {
  const [data, setData] = useState(null);
  const [names, setNames] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const load = () => Promise.all([
    fetch(`${API_BASE_URL}/api/app-access`, { headers: authHeaders() })
      .then((r) => r.json().then((b) => (r.ok ? b : Promise.reject(new Error(b.error || `HTTP ${r.status}`))))),
    fetch(`${API_BASE_URL}/api/people`, { headers: authHeaders() }).then((r) => r.json()).catch(() => ({})),
  ]).then(([access, people]) => {
    setData(access);
    setError(null);
    setNames(Object.fromEntries((people.people || []).filter((p) => p.email).map((p) => [p.email.toLowerCase(), p.name])));
  }).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    // Team changes (someone added, removed, made admin) show up here too
    window.addEventListener(ACCESS_CHANGED, load);
    return () => window.removeEventListener(ACCESS_CHANGED, load);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !data) return <p className="settings-error">Couldn't load app access: {error}</p>;
  if (!data) return <p>Loading…</p>;

  const me = (currentUser?.email || '').toLowerCase();
  const amAdmin = !!data.people.find((p) => p.email === me)?.isAdmin;
  const has = (email, key) => (data.access[email] || []).includes(key);

  async function change(email, appKeys, granted) {
    setBusy(`${email}:${appKeys.join(',')}`);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/app-access`, {
        method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ email, appKeys, granted }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed');
      setData((d) => ({ ...d, access: body.access }));
      window.dispatchEvent(new Event(ACCESS_CHANGED));
    } catch (e) {
      setError(`Couldn't change access for ${email}: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="app-access">
      <p className="app-access-intro">
        Who sees which apps. New people start with nothing until they're given access here. Admins always have everything.
        {!amAdmin && ' Only admins can change this.'}
      </p>
      {error && <p className="settings-error">{error}</p>}
      <div className="app-access-scroll">
        <table className="app-access-table">
          <thead>
            <tr>
              <th rowSpan={2}>Person</th>
              {data.groups.map((g) => <th key={g.id} colSpan={g.apps.length + 1} className="app-access-group">{g.label}</th>)}
            </tr>
            <tr>
              {data.groups.map((g) => (
                <React.Fragment key={g.id}>
                  <th className="app-access-all">All</th>
                  {g.apps.map((a) => <th key={a.key} className="app-access-app">{a.label}</th>)}
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.people.map((p) => (
              <tr key={p.email}>
                <td className="app-access-person">
                  <div>{names[p.email] || p.email}</div>
                  {names[p.email] && <div className="app-access-email">{p.email}</div>}
                  {p.isAdmin && <span className="app-access-admin">Admin - everything</span>}
                </td>
                {data.groups.map((g) => {
                  const keys = g.apps.map((a) => a.key);
                  const count = keys.filter((k) => has(p.email, k)).length;
                  const lock = p.isAdmin || !amAdmin || !!busy;
                  return (
                    <React.Fragment key={g.id}>
                      <td className="app-access-all">
                        <HeadingBox
                          checked={p.isAdmin || count === keys.length}
                          partial={!p.isAdmin && count > 0 && count < keys.length}
                          disabled={lock}
                          title={`All of ${g.label}`}
                          onChange={(e) => change(p.email, keys, e.target.checked)}
                        />
                      </td>
                      {g.apps.map((a) => (
                        <td key={a.key}>
                          <input
                            type="checkbox"
                            checked={p.isAdmin || has(p.email, a.key)}
                            disabled={lock}
                            title={`${a.label} for ${names[p.email] || p.email}`}
                            onChange={(e) => change(p.email, [a.key], e.target.checked)}
                          />
                        </td>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
