const API_BASE_URL = process.env.REACT_APP_API_URL || '';

function authHeaders(json = false) {
  const token = localStorage.getItem('authToken');
  return json ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { Authorization: `Bearer ${token}` };
}

// Calls /api/modeling; an error carries the server's message.
export async function modelingApi(method, path, body) {
  const res = await fetch(`${API_BASE_URL}/api/modeling${path}`, {
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

// Downloads an export through HeyPhil (the sign-in token can't ride on a
// plain link) and hands it to the browser as a file.
export async function downloadExport(exportId, fileName) {
  const res = await fetch(`${API_BASE_URL}/api/modeling/exports/${exportId}/download`, { headers: authHeaders() });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'The download failed.');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName || 'export.xlsx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export const sheetUrl = (id) => `https://docs.google.com/spreadsheets/d/${id}/edit`;
export const folderUrl = (id) => `https://drive.google.com/drive/folders/${id}`;
export const fileUrl = (id) => `https://drive.google.com/file/d/${id}/view`;

export function when(iso) {
  return iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
}

export const who = (email, name) => name || (email ? email.split('@')[0] : '');
