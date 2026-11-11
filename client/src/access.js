import React, { createContext, useContext, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ALL_APPS, firstAllowedPath } from './appCatalog';
import { ACCESS_CHANGED } from './accessEvents';

// Which apps the signed-in person can use: { loading, isAdmin, apps }.
// Loaded once from /api/my-access; the sidebar and page guards read it.
// The server enforces access on apps with their own data (Design,
// Modeling, Site Planner, Cashflow) - this decides what's shown.
const API_BASE_URL = process.env.REACT_APP_API_URL || '';
const AccessContext = createContext({ loading: true, failed: false, isAdmin: false, apps: [] });


export function AccessProvider({ children }) {
  const [state, setState] = useState({ loading: true, failed: false, isAdmin: false, apps: [] });
  useEffect(() => {
    let stop = false;
    let timer;
    const load = (attempt = 0) => {
      const token = localStorage.getItem('authToken');
      fetch(`${API_BASE_URL}/api/my-access`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d) => { if (!stop) setState({ loading: false, failed: false, isAdmin: !!d.isAdmin, apps: d.apps || [] }); })
        .catch(() => {
          if (stop) return;
          // a hiccup isn't "no access": retry, and only then say we couldn't check
          if (attempt < 3) timer = setTimeout(() => load(attempt + 1), 1500 * (attempt + 1));
          else setState((s) => ({ ...s, loading: false, failed: true }));
        });
    };
    load();
    const refresh = () => load();
    window.addEventListener('focus', refresh);
    window.addEventListener(ACCESS_CHANGED, refresh);
    return () => { stop = true; clearTimeout(timer); window.removeEventListener('focus', refresh); window.removeEventListener(ACCESS_CHANGED, refresh); };
  }, []);
  return <AccessContext.Provider value={state}>{children}</AccessContext.Provider>;
}

export const useAccess = () => useContext(AccessContext);

// Renders the page only for people with that app; otherwise a clear note.
export function Gate({ app, children }) {
  const { loading, failed, apps } = useAccess();
  if (loading) return <div className="loading">Loading...</div>;
  if (apps.includes(app)) return children;
  if (failed) {
    return (
      <div className="no-access">
        <h2>Couldn't check your access</h2>
        <p>HeyPhil didn't answer just now. <button type="button" className="btn-secondary" onClick={() => window.location.reload()}>Try again</button></p>
      </div>
    );
  }
  const label = ALL_APPS.find((a) => a.key === app)?.label || 'this page';
  return (
    <div className="no-access">
      <h2>No access to {label}</h2>
      <p>Ask an admin to turn it on for you in Settings → App access.</p>
    </div>
  );
}

// "/" and unknown paths: the first app this person has, else Settings.
export function HomeRedirect() {
  const { loading, failed, apps } = useAccess();
  if (loading) return <div className="loading">Loading...</div>;
  if (failed && !apps.length) return <Gate app="board" />;
  return <Navigate to={firstAllowedPath(apps) || '/settings'} replace />;
}
