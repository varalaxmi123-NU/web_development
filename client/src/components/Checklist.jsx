import { useState } from 'react';
import { api } from '../api.js';
import { cx } from '../utils.js';
import { Icon, useToast } from './ui.jsx';

/**
 * Subtasks for a task. Each toggle sends the explicit target state
 * ({ done: true|false }), so two people ticking the same box at once can't
 * cancel each other out. Items update live via the `checklist:changed` event.
 */
export default function Checklist({ taskId, items, setItems }) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const done = items.filter((i) => i.done).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;

  const upsert = (item) => setItems((xs) => (xs.some((x) => x.id === item.id) ? xs.map((x) => (x.id === item.id ? item : x)) : [...xs, item]));

  const add = async (e) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    setBusy(true);
    try {
      const r = await api(`/tasks/${taskId}/checklist`, { method: 'POST', body: { title: t } });
      upsert(r.item);
      setTitle('');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (item) => {
    const next = !item.done;
    upsert({ ...item, done: next }); // optimistic
    try {
      const r = await api(`/checklist/${item.id}`, { method: 'PATCH', body: { done: next } });
      upsert(r.item);
    } catch (err) {
      upsert(item);
      toast(err.message, 'error');
    }
  };

  const remove = async (item) => {
    setItems((xs) => xs.filter((x) => x.id !== item.id));
    try {
      await api(`/checklist/${item.id}`, { method: 'DELETE' });
    } catch (err) {
      upsert(item);
      toast(err.message, 'error');
    }
  };

  return (
    <div className="checklist">
      <div className="block-label">
        Checklist
        {items.length > 0 && <span className="cl-count">{done} of {items.length}</span>}
      </div>
      {items.length > 0 && <div className="meter sm cl-meter"><span style={{ width: `${pct}%` }} /></div>}
      <ul>
        {items.map((it) => (
          <li key={it.id} className={cx('cl-item', it.done && 'done')}>
            <label>
              <input type="checkbox" checked={it.done} onChange={() => toggle(it)} />
              <span>{it.title}</span>
            </label>
            <button className="icon-btn sm danger" onClick={() => remove(it)} aria-label={`Delete ${it.title}`}><Icon name="x" size={13} /></button>
          </li>
        ))}
      </ul>
      <form className="cl-add" onSubmit={add}>
        <Icon name="plus" size={14} />
        <input placeholder="Add an item" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} disabled={busy} />
      </form>
    </div>
  );
}
