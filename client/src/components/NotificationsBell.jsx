import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { useRealtime, useSocketEvent } from '../realtime.jsx';
import { timeAgo, cx } from '../utils.js';
import { Avatar, Icon, useToast } from './ui.jsx';

function describe(n) {
  const who = n.actor?.name || 'Someone';
  const t = n.payload?.title ? `“${n.payload.title}”` : 'a task';
  switch (n.type) {
    case 'mentioned': return { text: <><b>{who}</b> mentioned you on {t}</>, plain: `${who} mentioned you on ${t}` };
    case 'commented': return { text: <><b>{who}</b> commented on {t}</>, plain: `${who} commented on ${t}` };
    case 'assigned': return { text: <><b>{who}</b> assigned you {t}</>, plain: `${who} assigned you ${t}` };
    case 'completed': return { text: <><b>{who}</b> completed {t}</>, plain: `${who} completed ${t}` };
    default: return { text: <><b>{who}</b> updated {t}</>, plain: `${who} updated ${t}` };
  }
}

export default function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [ring, setRing] = useState(false);
  const { resyncTick } = useRealtime();
  const toast = useToast();
  const wrapRef = useRef(null);

  const load = useCallback(() => {
    api('/notifications').then((r) => { setItems(r.notifications); setUnread(r.unread); }).catch(() => {});
  }, []);
  useEffect(load, [load, resyncTick]);

  useSocketEvent('notification:new', ({ notification: n }) => {
    setItems((xs) => (xs.some((x) => x.id === n.id) ? xs : [n, ...xs].slice(0, 40)));
    setUnread((u) => u + 1);
    setRing(true);
    setTimeout(() => setRing(false), 1200);
    toast(describe(n).plain);
  });
  useSocketEvent('notification:read', ({ ids, unread: u }) => {
    setUnread(u);
    setItems((xs) => xs.map((x) => (!ids || ids.map(String).includes(String(x.id)) ? { ...x, read_at: x.read_at || new Date().toISOString() } : x)));
  });

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const markRead = (ids) => api('/notifications/read', { method: 'POST', body: ids ? { ids } : {} }).catch(() => {});

  const openItem = (n) => {
    if (!n.read_at) markRead([n.id]);
    setOpen(false);
    if (n.task_id && n.project_id) navigate(`/p/${n.project_id}/t/${n.task_id}`);
    else if (n.project_id) navigate(`/p/${n.project_id}`);
  };

  return (
    <div className="bell-wrap" ref={wrapRef}>
      <button className={cx('icon-btn bell', ring && 'ring')} onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open}>
        <Icon name="bell" size={18} />
        {unread > 0 && <span className="bell-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="popover notif-pop" role="dialog" aria-label="Notifications">
          <div className="pop-head">
            <b>Notifications</b>
            {unread > 0 && <button className="link-btn accent" onClick={() => markRead(null)}>Mark all as read</button>}
          </div>
          {items.length === 0 ? (
            <p className="pop-empty">You’re all caught up. Mentions, assignments and comments on your tasks will show up here.</p>
          ) : (
            <ul className="notif-list">
              {items.map((n) => (
                <li key={n.id} className={cx(!n.read_at && 'unread')} onClick={() => openItem(n)}>
                  <Avatar user={n.actor} size={30} />
                  <div className="notif-main">
                    <span>{describe(n).text}</span>
                    {n.payload?.excerpt && <span className="notif-quote">{n.payload.excerpt}</span>}
                    <span className="notif-meta"><span className="proj-dot" style={{ background: n.project_color }} />{n.project_name} · {timeAgo(n.created_at)}</span>
                  </div>
                  {!n.read_at && <span className="unread-dot" aria-label="Unread" />}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
