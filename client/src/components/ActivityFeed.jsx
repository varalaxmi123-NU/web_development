import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useRealtime, useSocketEvent } from '../realtime.jsx';
import { FIELD_LABEL, STATUS_LABEL, displayValue, timeAgo } from '../utils.js';
import { Avatar, Empty, Icon, Spinner } from './ui.jsx';

/** One-line, human description of an activity row. */
export function ActivityText({ a, members, showProject }) {
  const p = a.payload || {};
  const t = p.title ? <b>“{p.title}”</b> : null;
  let body;
  switch (a.type) {
    case 'project_created': body = <>created the project</>; break;
    case 'member_added': body = <>added <b>{p.name}</b> to the project</>; break;
    case 'member_removed': body = <>removed <b>{p.name}</b> from the project</>; break;
    case 'task_created': body = <>created {t}</>; break;
    case 'task_deleted': body = <>deleted {t}</>; break;
    case 'comment_added': body = <>commented on {t}{p.excerpt && <span className="act-quote">{p.excerpt}</span>}</>; break;
    case 'file_attached': body = <>attached <b>{p.filename}</b> to {t}</>; break;
    case 'checklist_done': body = <>ticked off <b>{p.item}</b> on {t}</>; break;
    case 'task_updated': {
      const fields = Object.keys(p.changes || {});
      if (fields.length === 1 && fields[0] === 'status') {
        body = <>moved {t} to <b>{STATUS_LABEL[p.changes.status.to]}</b></>;
      } else if (fields.length === 1 && fields[0] === 'assignee_id' && members) {
        body = <>assigned {t} to <b>{displayValue('assignee_id', p.changes.assignee_id.to, members)}</b></>;
      } else {
        body = <>updated {fields.map((f) => FIELD_LABEL[f]?.toLowerCase() || f).join(', ')} on {t}</>;
      }
      break;
    }
    default: body = <>{a.type.replace(/_/g, ' ')}</>;
  }
  return (
    <span>
      <b>{a.user?.name || 'Someone'}</b> {body}
      {p.merged && <span className="badge badge-merge" title="Applied on top of a teammate's concurrent edit"><Icon name="merge" size={11} /> merged</span>}
      {showProject && <span className="act-project"><span className="proj-dot" style={{ background: a.project_color }} />{a.project_name}</span>}
    </span>
  );
}

export function ActivityRow({ a, members, showProject, onClick }) {
  return (
    <li className={onClick ? 'clickable' : undefined} onClick={onClick}>
      <Avatar user={a.user} size={26} />
      <div className="act-main">
        <ActivityText a={a} members={members} showProject={showProject} />
        <time dateTime={a.created_at} title={new Date(a.created_at).toLocaleString()}>{timeAgo(a.created_at)}</time>
      </div>
    </li>
  );
}

export default function ActivityFeed({ projectId, members, onOpenTask }) {
  const [items, setItems] = useState(null);
  const [more, setMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const { resyncTick } = useRealtime();

  const load = useCallback(async () => {
    const r = await api(`/projects/${projectId}/activity?limit=40`);
    setItems(r.activity);
    setMore(r.activity.length === 40);
  }, [projectId]);

  useEffect(() => { load().catch(() => setItems([])); }, [load, resyncTick]);

  useSocketEvent('activity:new', (e) => {
    if (e.projectId !== projectId) return;
    setItems((xs) => (xs && !xs.some((x) => x.id === e.activity.id) ? [e.activity, ...xs] : xs));
  });

  const loadMore = async () => {
    setLoadingMore(true);
    const last = items[items.length - 1];
    const r = await api(`/projects/${projectId}/activity?limit=40&before=${last.id}`).catch(() => ({ activity: [] }));
    setItems((xs) => [...xs, ...r.activity.filter((a) => !xs.some((x) => x.id === a.id))]);
    setMore(r.activity.length === 40);
    setLoadingMore(false);
  };

  if (!items) return <div className="center-pad"><Spinner /></div>;
  if (!items.length) return <Empty title="No activity yet">Changes to tasks, comments and files show up here live.</Empty>;

  return (
    <div className="panel activity-panel">
      <ul className="activity">
        {items.map((a) => (
          <ActivityRow key={a.id} a={a} members={members}
            onClick={a.task_id && a.type !== 'task_deleted' ? () => onOpenTask(a.task_id) : undefined} />
        ))}
      </ul>
      {more && (
        <button className="btn btn-block btn-ghost" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? <Spinner size={14} /> : 'Load older activity'}
        </button>
      )}
    </div>
  );
}
