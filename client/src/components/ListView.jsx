import { useMemo, useState } from 'react';
import { STATUSES, PRIORITIES, PRIORITY_RANK, STATUS_LABEL, dueInfo, cx } from '../utils.js';
import { Avatar, Empty } from './ui.jsx';

const STATUS_RANK = { todo: 0, in_progress: 1, review: 2, done: 3 };

export default function ListView({ tasks, members, viewersByTask, flash, onOpen, onChange, onCreate }) {
  const [sort, setSort] = useState({ key: 'due_date', dir: 1 });
  const [title, setTitle] = useState('');

  const rows = useMemo(() => {
    const val = (t) => {
      switch (sort.key) {
        case 'status': return STATUS_RANK[t.status];
        case 'priority': return PRIORITY_RANK[t.priority];
        case 'assignee': return members.find((m) => m.id === t.assignee_id)?.name || '~';
        case 'due_date': return t.due_date || '9999';
        default: return t.title.toLowerCase();
      }
    };
    return [...tasks].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sort.dir);
  }, [tasks, sort, members]);

  const th = (key, label) => (
    <th onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }))} className={sort.key === key ? 'sorted' : ''}
      aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      {label}{sort.key === key && <span className="sort-ind">{sort.dir === 1 ? '↑' : '↓'}</span>}
    </th>
  );

  return (
    <div className="panel list-panel">
      <form className="list-add" onSubmit={async (e) => { e.preventDefault(); if (!title.trim()) return; const t = title; setTitle(''); await onCreate({ title: t.trim() }); }}>
        <input placeholder="+ Add a task and press Enter" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      </form>
      {rows.length === 0 ? <Empty title="No tasks match" /> : (
        <div className="table-wrap">
          <table className="tasks-table">
            <thead>
              <tr>{th('title', 'Task')}{th('status', 'Status')}{th('priority', 'Priority')}{th('assignee', 'Assignee')}{th('due_date', 'Due')}</tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const due = dueInfo(t);
                const viewers = viewersByTask[t.id] || [];
                return (
                  <tr key={t.id} className={cx(flash[t.id] && 'flash', t.status === 'done' && 'is-done')}>
                    <td className="tt-title" onClick={() => onOpen(t.id)}>
                      <span>{t.title}</span>
                      {viewers.map((v) => <Avatar key={v.user.id} user={v.user} size={16} ring />)}
                    </td>
                    <td>
                      <select className={`pill-select st-${t.status}`} value={t.status} aria-label="Status"
                        onChange={(e) => onChange(t.id, { status: e.target.value })}>
                        {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select>
                    </td>
                    <td>
                      <select className={`pill-select prio-sel prio-${t.priority}`} value={t.priority} aria-label="Priority"
                        onChange={(e) => onChange(t.id, { priority: e.target.value })}>
                        {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                      </select>
                    </td>
                    <td>
                      <select className="pill-select" value={t.assignee_id || ''} aria-label="Assignee"
                        onChange={(e) => onChange(t.id, { assignee_id: e.target.value || null })}>
                        <option value="">Unassigned</option>
                        {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    </td>
                    <td>{due ? <span className={`due due-${due.tone}`}>{due.label}</span> : <span className="muted">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="list-foot muted">{rows.length} task{rows.length === 1 ? '' : 's'} · {rows.filter((t) => t.status === 'done').length} {STATUS_LABEL.done.toLowerCase()}</p>
    </div>
  );
}
