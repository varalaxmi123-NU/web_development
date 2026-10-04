import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { STATUS_LABEL, cx } from '../utils.js';
import { Icon, Spinner } from './ui.jsx';

/** Ctrl/⌘+K: jump to any project or task across your workspace. */
export default function CommandPalette({ projects = [], onClose }) {
  const [q, setQ] = useState('');
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setTasks([]); return undefined; }
    setLoading(true);
    const t = setTimeout(() => {
      api(`/search?q=${encodeURIComponent(term)}`)
        .then((r) => setTasks(r.tasks))
        .catch(() => setTasks([]))
        .finally(() => setLoading(false));
    }, 160);
    return () => clearTimeout(t);
  }, [q]);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    const pages = [{ kind: 'page', id: 'dash', label: 'Dashboard', go: '/' }];
    const projs = projects
      .filter((p) => !term || p.name.toLowerCase().includes(term))
      .map((p) => ({ kind: 'project', id: p.id, label: p.name, color: p.color, go: `/p/${p.id}` }));
    const ts = tasks.map((t) => ({
      kind: 'task', id: t.id, label: t.title, color: t.project_color,
      sub: `${t.project_name} · ${STATUS_LABEL[t.status]}`, go: `/p/${t.project_id}/t/${t.id}`,
    }));
    return [...(term ? [] : pages), ...projs, ...ts];
  }, [q, projects, tasks]);

  useEffect(() => setSel(0), [q, tasks]);

  const pick = (r) => { if (!r) return; onClose(); navigate(r.go); };

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(results[sel]); }
    else if (e.key === 'Escape') onClose();
  };

  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Search">
        <div className="palette-input">
          <Icon name="search" size={18} />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
            placeholder="Search tasks and projects" aria-label="Search tasks and projects" />
          {loading ? <Spinner size={14} /> : <kbd>Esc</kbd>}
        </div>
        <ul className="palette-list" role="listbox">
          {results.length === 0 && q.trim().length >= 2 && !loading && (
            <li className="palette-empty">No tasks or projects match “{q.trim()}”.</li>
          )}
          {results.map((r, i) => (
            <li key={`${r.kind}-${r.id}`} role="option" aria-selected={i === sel}
              className={cx('palette-item', i === sel && 'sel')} onMouseEnter={() => setSel(i)} onClick={() => pick(r)}>
              <span className="pi-icon">
                {r.kind === 'page' && <Icon name="grid" size={15} />}
                {r.kind === 'project' && <span className="proj-dot lg" style={{ background: r.color }} />}
                {r.kind === 'task' && <Icon name="checklist" size={15} />}
              </span>
              <span className="pi-label">{r.label}</span>
              {r.sub && <span className="pi-sub">{r.sub}</span>}
              <span className="pi-kind">{r.kind === 'task' ? 'Task' : r.kind === 'project' ? 'Project' : 'Page'}</span>
            </li>
          ))}
        </ul>
        <div className="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> to move</span><span><kbd>Enter</kbd> to open</span></div>
      </div>
    </div>
  );
}
