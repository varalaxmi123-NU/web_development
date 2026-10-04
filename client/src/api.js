// Tokens live in sessionStorage so each browser tab can be a different user,
// which makes it easy to demo real-time collaboration side by side.
const TOKEN_KEY = 'teamflow_token';

// Where the backend lives. Empty = same origin (local dev via the Vite proxy, or
// when Express serves the built app). On Vercel, set VITE_API_URL to the backend
// URL, e.g. https://teamflow-api.onrender.com (no trailing slash).
export const API_BASE = (import.meta.env?.VITE_API_URL || '').replace(/\/+$/, '');

export const session = {
  get token() {
    try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set(token) {
    try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* ignore */ }
  },
  clear() {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  },
};

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error || (status === 0 ? 'Network error: check your connection' : `Request failed (${status})`));
    this.status = status;
    this.data = data;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, null);
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401 && session.token) {
    session.clear();
    window.dispatchEvent(new Event('teamflow:signed-out'));
  }
  // 409 carries a meaningful body (conflicts + latest task), callers handle it.
  if (!res.ok && res.status !== 409) throw new ApiError(res.status, data);
  return { status: res.status, ...data };
}

function xhrSend({ method, url, body, headers = {}, onProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data && (data.error ? data : { error: data.message || data.error })));
    };
    xhr.onerror = () => reject(new ApiError(0, null));
    xhr.send(body);
  });
}

/**
 * Upload with progress. With Supabase Storage the file goes straight from the
 * browser to Storage via a signed URL (serverless functions have small body
 * limits); otherwise it's posted to the API.
 */
export async function uploadFile(taskId, file, onProgress) {
  const init = await api(`/tasks/${taskId}/attachments/init`, {
    method: 'POST', body: { filename: file.name, size: file.size, mime: file.type },
  });
  if (init.mode === 'supabase') {
    const form = new FormData();
    form.append('cacheControl', '3600');
    form.append('', file);
    await xhrSend({ method: 'PUT', url: init.signedUrl, body: form, headers: { 'x-upsert': 'false' }, onProgress });
    return api(`/tasks/${taskId}/attachments/complete`, {
      method: 'POST', body: { path: init.path, filename: file.name, size: file.size, mime: file.type },
    });
  }
  return uploadMultipart(taskId, file, onProgress);
}

function uploadMultipart(taskId, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/api/tasks/${taskId}/attachments`);
    if (session.token) xhr.setRequestHeader('Authorization', `Bearer ${session.token}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data));
    };
    xhr.onerror = () => reject(new ApiError(0, null));
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
}

export async function fetchAttachmentBlob(id) {
  let res = await fetch(`${API_BASE}/api/attachments/${id}/download`, {
    headers: { Authorization: `Bearer ${session.token}` },
  }).catch(() => { throw new ApiError(0, null); });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data);
  }
  // Supabase Storage: the API answers with a short-lived signed link.
  if ((res.headers.get('content-type') || '').includes('application/json')) {
    const { url } = await res.json();
    res = await fetch(url).catch(() => { throw new ApiError(0, null); });
    if (!res.ok) throw new ApiError(res.status, { error: 'Could not download the file' });
  }
  return res.blob();
}

export async function downloadAttachment(att) {
  const blob = await fetchAttachmentBlob(att.id);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = att.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
