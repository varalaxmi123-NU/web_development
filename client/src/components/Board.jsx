import { useEffect, useMemo, useRef, useState } from 'react';
import { STATUSES, PRIORITY_LABEL, dueInfo, positionBetween, cx } from '../utils.js';
import { Avatar, Icon } from './ui.jsx';

export default function Board({ tasks, members, viewersByTask, flash, onOpen, onMove, onCreate, addSignal }) {
  const [drag, setDrag] = useState(null); // { id, over: status, index }
  const columns = useMemo(() => {
    const by = Object.fromEntries(STATUSES.map((s) => [s.id, []]));
    for (const t of tasks) by[t.status]?.push(t);
    for (const k of Object.keys(by)) by[k].sort((a, b) => a.position - b.position);
    return by;
  }, [tasks]);

  const drop = (status) => {
    if (!drag) return;
    const col = columns[status].filter((t) => t.id !== drag.id);
    const index = Math.min(drag.index ?? col.length, col.length);
    const position = positionBetween(col[index - 1]?.position, col[index]?.position);
    const task = tasks.find((t) => t.id === drag.id);
    setDrag(null);
    if (!task || (task.status === status && Math.abs(task.position - position) < 1e-9)) return;
    const changes = task.status === status ? { position } : { status, position };
    onMove(task.id, changes);
  };

  return (
    <div className="board">
      {STATUSES.map((s) => (
        <Column
          key={s.id}
          status={s}
          tasks={columns[s.id]}
          members={members}
          viewersByTask={viewersByTask}
          flash={flash}
          drag={drag}
          setDrag={setDrag}
          onDrop={() => drop(s.id)}
          onOpen={onOpen}
          onCreate={onCreate}
          addSignal={s.id === 'todo' ? addSignal : 0}
        />
      ))}
    </div>
  );
}

function Column({ status, tasks, members, viewersByTask, flash, drag, setDrag, onDrop, onOpen, onCreate, addSignal }) {
  const [adding, setAdding] = useState(false);
  useEffect(() => { if (addSignal) setAdding(true); }, [addSignal]);
  const [title, setTitle] = useState('');
  const listRef = useRef(null);
  const over = drag?.over === status.id;

  // Work out the insertion index from the pointer position over the card list.
  const onDragOver = (e) => {
    if (!drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const els = [...(listRef.current?.querySelectorAll('[data-card]') || [])].filter((el) => el.dataset.card !== drag.id);
    let index = els.length;
    for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { index = i; break; }
    }
    if (drag.over !== status.id || drag.index !== index) setDrag({ ...drag, over: status.id, index });
  };

  const submit = async (e) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    setTitle('');
    await onCreate({ title: t, status: status.id });
  };

  const cards = drag ? tasks.filter((t) => t.id !== drag.id) : tasks;
  const placeholderAt = over ? drag.index : -1;

  return (
    <section
      className={cx('column', over && 'drop-over')}
      onDragOver={onDragOver}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget) && drag?.over === status.id) setDrag({ ...drag, over: null }); }}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
      aria-label={status.label}
    >
      <header className="col-head">
        <span className="col-dot" style={{ background: status.color }} />
        <h3>{status.label}</h3>
        <span className="col-count">{tasks.length}</span>
        <button className="icon-btn sm" onClick={() => setAdding(true)} aria-label={`Add task to ${status.label}`}><Icon name="plus" size={14} /></button>
      </header>

      <div className="col-list" ref={listRef}>
        {adding && (
          <form className="quick-add" onSubmit={submit}>
            <input autoFocus placeholder="Task title, then Enter" value={title} onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && (setAdding(false), setTitle(''))}
              onBlur={() => !title.trim() && setAdding(false)} maxLength={200} />
          </form>
        )}
        {cards.map((t, i) => (
          <div key={t.id}>
            {placeholderAt === i && <div className="drop-slot" />}
            <TaskCard
              task={t}
              members={members}
              viewers={viewersByTask[t.id]}
              flashing={!!flash[t.id]}
              onOpen={() => onOpen(t.id)}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', t.id);
                // Delay so the browser snapshots the card before we hide it.
                setTimeout(() => setDrag({ id: t.id, over: status.id, index: i }), 0);
              }}
              onDragEnd={() => setDrag(null)}
            />
          </div>
        ))}
        {over && placeholderAt >= cards.length && <div className="drop-slot" />}
        {tasks.length === 0 && !adding && !over && (
          <button className="col-empty" onClick={() => setAdding(true)}>+ Add a task</button>
        )}
      </div>
    </section>
  );
}

export function TaskCard({ task, members, viewers = [], flashing, onOpen, onDragStart, onDragEnd }) {
  const assignee = members.find((m) => m.id === task.assignee_id);
  const due = dueInfo(task);
  const editing = viewers.find((v) => v.field);
  return (
    <article
      className={cx('card', flashing && 'flash', viewers.length > 0 && 'has-viewers', task.status === 'done' && 'is-done')}
      data-card={task.id}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      tabIndex={0}
    >
      <div className="card-top">
        <span className={`prio prio-${task.priority}`}>{PRIORITY_LABEL[task.priority]}</span>
        {viewers.length > 0 && (
          <span className="card-viewers" title={viewers.map((v) => `${v.user.name}${v.field ? ' (editing)' : ' (viewing)'}`).join(', ')}>
            {viewers.slice(0, 3).map((v) => <Avatar key={v.user.id} user={v.user} size={18} ring />)}
          </span>
        )}
      </div>
      <h4>{task.title}</h4>
      {editing && <div className="card-editing"><Icon name="edit" size={11} /> {editing.user.name.split(' ')[0]} is editing</div>}
      <div className="card-meta">
        {due && <span className={`due due-${due.tone}`} title={due.full}><Icon name="calendar" size={12} />{due.label}</span>}
        {task.comment_count > 0 && <span className="meta-ic"><Icon name="comment" size={12} />{task.comment_count}</span>}
        {task.attachment_count > 0 && <span className="meta-ic"><Icon name="clip" size={12} />{task.attachment_count}</span>}
        {task.checklist_total > 0 && (
          <span className={cx('meta-ic', 'cl-chip', task.checklist_done === task.checklist_total && 'complete')} title="Checklist">
            <Icon name="checklist" size={12} />{task.checklist_done}/{task.checklist_total}
          </span>
        )}
        <span className="spacer" />
        <Avatar user={assignee} size={22} />
      </div>
    </article>
  );
}
