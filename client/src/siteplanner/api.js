const API_BASE_URL = process.env.REACT_APP_API_URL || '';

function authHeaders(json = false) {
  const token = localStorage.getItem('authToken');
  return json
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { Authorization: `Bearer ${token}` };
}

// Calls /api/site-plans; an error carries the server's message and status.
export async function sitePlansApi(method, path, body) {
  const res = await fetch(`${API_BASE_URL}/api/site-plans${path}`, {
    method,
    headers: authHeaders(!!body),
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong');
    err.status = res.status;
    throw err;
  }
  return data;
}

// Live projects, sorted by title, for the project pickers.
export async function loadProjects() {
  const res = await fetch(`${API_BASE_URL}/api/projects`, { headers: authHeaders() });
  const data = await res.json();
  const live = (data.projects || []).filter((p) => !p.deleted_at);
  live.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  return live;
}

// Address search (OpenStreetMap Nominatim): at most a handful of results,
// run only when someone presses search, per its usage policy.
export async function searchAddress(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Address search is unavailable right now.');
  const rows = await res.json();
  return rows.map((r) => ({ label: r.display_name, lat: Number(r.lat), lng: Number(r.lon) }));
}
