// Minimal hash router: #/  ·  #/p/<projectId>  ·  #/p/<projectId>/t/<taskId>
export function parseHash() {
  const parts = window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'p' && parts[1]) {
    return { view: 'project', projectId: parts[1], taskId: parts[2] === 't' ? parts[3] || null : null };
  }
  return { view: 'dashboard', projectId: null, taskId: null };
}

export function navigate(path) {
  if (window.location.hash !== `#${path}`) window.location.hash = path;
}
