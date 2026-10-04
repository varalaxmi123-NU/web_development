import { useMemo, useState } from 'react';
import { todayStr, cx } from '../utils.js';
import { Avatar, Icon } from './ui.jsx';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Month calendar of deadlines. Drag a task to another day to reschedule it. */
export default function CalendarView({ tasks, members, viewersByTask, flash, onOpen, onChange }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [dragId, setDragId] = useState(null);
  const [overDay, setOverDay] = useState(null);
  const today = todayStr();

  const days = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7; // Monday-first
    const start = new Date(first);
    start.setDate(first.getDate() - offset);
    const weeks = Math.ceil((offset + new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()) / 7);
    return Array.from({ length: weeks * 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cursor]);

  const byDay = useMemo(() => {
    const map = {};
    for (const t of tasks) if (t.due_date) (map[t.due_date] ||= []).push(t);
    for (const k of Object.keys(map)) map[k].sort((a, b) => (a.status === 'done') - (b.status === 'done'));
    return map;
  }, [tasks]);

  const undated = tasks.filter((t) => !t.due_date && t.status !== 'done');
  const shift = (n) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + n, 1));

  const drop = (day) => {
    const t = tasks.find((x) => x.id === dragId);
    setDragId(null);
    setOverDay(null);
    if (t && t.due_date !== day) onChange(t.id, { due_date: day });
  };

  const chip = (t) => {
    const assignee = members.find((m) => m.id === t.assignee_id);
    const overdue = t.status !== 'done' && t.due_date && t.due_date < today;
    return (
      <button key={t.id} type="button" draggable
        className={cx('cal-chip', `st-${t.status}`, overdue && 'overdue', flash[t.id] && 'flash', viewersByTask[t.id] && 'has-viewers')}
        onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.id); setDragId(t.id); }}
        onDragEnd={() => { setDragId(null); setOverDay(null); }}
        onClick={() => onOpen(t.id)} title={t.title}>
        <span className="cal-chip-title">{t.title}</span>
        {assignee && <Avatar user={assignee} size={16} />}
      </button>
    );
  };

  return (
    <div className="calendar">
      <div className="cal-head">
        <div className="cal-nav">
          <button className="icon-btn" onClick={() => shift(-1)} aria-label="Previous month"><Icon name="chevL" /></button>
          <h2>{cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
          <button className="icon-btn" onClick={() => shift(1)} aria-label="Next month"><Icon name="chevR" /></button>
        </div>
        <button className="btn btn-sm" onClick={() => { const d = new Date(); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Today</button>
        <span className="muted small cal-hint">Drag a task to another day to change its due date.</span>
      </div>

      <div className="cal-grid" role="grid">
        {WEEKDAYS.map((w) => <div key={w} className="cal-wd" role="columnheader">{w}</div>)}
        {days.map((d) => {
          const key = ymd(d);
          const list = byDay[key] || [];
          const inMonth = d.getMonth() === cursor.getMonth();
          return (
            <div key={key} role="gridcell"
              className={cx('cal-day', !inMonth && 'out', key === today && 'today', key < today && 'past', overDay === key && 'drop-over')}
              onDragOver={(e) => { if (dragId) { e.preventDefault(); if (overDay !== key) setOverDay(key); } }}
              onDrop={(e) => { e.preventDefault(); drop(key); }}>
              <span className="cal-num">{d.getDate()}</span>
              <div className="cal-chips">
                {list.slice(0, 3).map(chip)}
                {list.length > 3 && <span className="cal-more">+{list.length - 3} more</span>}
              </div>
            </div>
          );
        })}
      </div>

      {undated.length > 0 && (
        <div className="cal-undated">
          <span className="muted small">No due date ({undated.length}). Drag onto a day to schedule:</span>
          <div className="cal-undated-list">{undated.map(chip)}</div>
        </div>
      )}
    </div>
  );
}
