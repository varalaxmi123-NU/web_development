import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { useRealtime, useSocketEvents } from '../realtime.jsx';
import { PRIORITIES, STATUS_LABEL, cx, todayStr, isTypingTarget } from '../utils.js';
import { AvatarStack, Empty, Icon, Spinner, useToast } from './ui.jsx';
import Board from './Board.jsx';
import ListView from './ListView.jsx';
import ActivityFeed from './ActivityFeed.jsx';
import TaskDrawer from './TaskDrawer.jsx';
import ConflictModal from './ConflictModal.jsx';
import MembersModal from './MembersModal.jsx';
import CalendarView from './CalendarView.jsx';
import ProjectSettingsModal from './ProjectSettingsModal.jsx';

export default function ProjectView({ projectId, taskId, user }) {
  const [project, setProject] = useState(null);
  const [members, setMembers] = useState([]);
  const [tasks, setTasks] = useState({});
  const [online, setOnline] = useState(() => new Set());
  const [presence, setPresence] = useState([]);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('board');
  const [filters, setFilters] = useState({ q: '', assignee: 'all', priority: 'all' });
  const [flash, setFlash] = useState({});
  const [conflict, setConflict] = useState(null);
  const [editingField, setEditingField] = useState(null);
  const [showMembers, setShowMembers] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [addSignal, setAddSignal] = useState(0);
  const [pending, setPending] = useState(0);
  const outboxRef = useRef([]);
  const searchRef = useRef(null);

  const { socket, status, resyncTick } = useRealtime();
  const toast = useToast();
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const membersRef = useRef(members);
  membersRef.current = members;

  // ---- Load / resync ------------------------------------------------------------
  const load = useCallback(async () => {
    try {
      const r = await api(`/projects/${projectId}`);
      setProject(r.project);
      setMembers(r.members);
      setTasks(Object.fromEntries(r.tasks.map((t) => [t.id, t])));
      setOnline(new Set(r.onlineUserIds));
      setPresence(r.presence);
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [projectId]);

  // On (re)connect: first replay edits made while offline, then reload fresh state.
  const flushRef = useRef(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      if (outboxRef.current.length && flushRef.current) await flushRef.current();
      if (alive) load();
    })();
    return () => { alive = false; };
  }, [load, resyncTick]);

  // ---- Local state helpers --------------------------------------------------------
  /** Accept a task only if it is not older than what we hold (events can arrive out of order). */
  const upsertTask = useCallback((t) => {
    setTasks((prev) => {
      const cur = prev[t.id];
      if (cur && t.version < cur.version) return prev;
      return { ...prev, [t.id]: { ...cur, ...t } };
    });
  }, []);

  const flashTask = (id) => {
    setFlash((f) => ({ ...f, [id]: Date.now() }));
    setTimeout(() => setFlash((f) => { const { [id]: _, ...rest } = f; return rest; }), 1400);
  };

  const bumpCount = (taskId, key, delta) => {
    setTasks((prev) => (prev[taskId] ? { ...prev, [taskId]: { ...prev[taskId], [key]: Math.max(0, (prev[taskId][key] || 0) + delta) } } : prev));
  };

  // ---- Live events ------------------------------------------------------------------
  useSocketEvents(
    ['task:created', 'task:updated', 'task:deleted', 'comment:created', 'comment:deleted',
      'attachment:created', 'attachment:deleted', 'member:added', 'member:removed',
      'user:online', 'presence:update', 'project:updated', 'checklist:changed'],
    (event, e) => {
      if (event === 'user:online') {
        setOnline((s) => { const n = new Set(s); if (e.online) n.add(e.userId); else n.delete(e.userId); return n; });
        return;
      }
      if (e.projectId !== projectId) return;
      const mine = e.by?.id === user.id;
      switch (event) {
        case 'task:created':
          upsertTask(e.task);
          if (!mine) { flashTask(e.task.id); toast(`${e.by.name} added “${e.task.title}”`); }
          break;
        case 'task:updated': {
          const before = tasksRef.current[e.task.id];
          upsertTask(e.task);
          if (!mine) {
            flashTask(e.task.id);
            if (e.fields.includes('status') && before?.status !== e.task.status) {
              toast(`${e.by.name} moved “${e.task.title}” to ${STATUS_LABEL[e.task.status]}`);
            }
          }
          break;
        }
        case 'task:deleted':
          setTasks((prev) => { const { [e.taskId]: _, ...rest } = prev; return rest; });
          if (!mine && taskId === e.taskId) {
            toast(`${e.by.name} deleted this task`, 'warn');
            navigate(`/p/${projectId}`);
          }
          break;
        case 'comment:created': bumpCount(e.taskId, 'comment_count', 1); break;
        case 'comment:deleted': bumpCount(e.taskId, 'comment_count', -1); break;
        case 'attachment:created': bumpCount(e.taskId, 'attachment_count', 1); break;
        case 'attachment:deleted': bumpCount(e.taskId, 'attachment_count', -1); break;
        case 'member:added':
          setMembers((ms) => (ms.some((m) => m.id === e.member.id) ? ms : [...ms, e.member]));
          break;
        case 'member:removed':
          setMembers((ms) => ms.filter((m) => m.id !== e.userId));
          break;
        case 'presence:update':
          setPresence(e.entries);
          if (e.onlineUserIds) setOnline(new Set(e.onlineUserIds));
          break;
        case 'project:updated':
          setProject((p) => ({ ...p, ...e.project, role: p?.role }));
          break;
        case 'checklist:changed':
          setTasks((prev) => (prev[e.taskId]
            ? { ...prev, [e.taskId]: { ...prev[e.taskId], checklist_total: e.counts.total, checklist_done: e.counts.done } }
            : prev));
          break;
        default:
      }
    },
  );

  // ---- Presence: tell teammates which task (and field) I'm on -----------------
  useEffect(() => {
    if (!socket || status !== 'live') return;
    socket.emit('presence:set', { projectId, taskId: taskId || null, field: taskId ? editingField : null });
  }, [socket, status, projectId, taskId, editingField, resyncTick]);
  useEffect(() => () => socket?.emit('presence:set', { projectId: null }), [socket]);

  // ---- The single write path for task edits ---------------------------------------
  /**
   * Sends { baseVersion, changes, base } so the server can three-way merge.
   * Returns the server response; on 409 opens the conflict resolver.
   */
  const updateTask = useCallback(async (id, changes, opts = {}) => {
    const cur = tasksRef.current[id];
    if (!cur) return null;
    const base = opts.base ?? Object.fromEntries(Object.keys(changes).map((k) => [k, cur[k]]));
    const baseVersion = opts.baseVersion ?? cur.version;
    if (opts.optimistic) setTasks((p) => ({ ...p, [id]: { ...p[id], ...changes } }));
    try {
      const r = await api(`/tasks/${id}`, { method: 'PATCH', body: { baseVersion, changes, base } });
      upsertTask(r.task);
      if (r.status === 409) {
        setConflict({ taskId: id, conflicts: r.conflicts, applied: r.applied });
      } else if (r.merged) {
        toast('Saved, and merged with a teammate’s simultaneous change', 'success');
      }
      return r;
    } catch (err) {
      if (err.status === 0) {
        // Offline / server unreachable: keep the change locally and queue it.
        // It is replayed with the same base values on reconnect, so the server's
        // three-way merge still protects teammates' edits made meanwhile.
        setTasks((p) => (p[id] ? { ...p, [id]: { ...p[id], ...changes } } : p));
        if (!opts.fromOutbox) {
          outboxRef.current.push({ id, changes, base, baseVersion });
          setPending(outboxRef.current.length);
          toast('You’re offline. The change is saved here and will sync when you reconnect.', 'warn');
        }
        return { queued: true };
      }
      if (opts.optimistic) {
        // Roll back only if nothing newer has arrived meanwhile.
        setTasks((p) => (p[id] && p[id].version === cur.version ? { ...p, [id]: cur } : p));
      }
      if (err.status === 404) setTasks((p) => { const { [id]: _, ...rest } = p; return rest; });
      toast(err.message, 'error');
      return { error: err };
    }
  }, [upsertTask, toast]);

  const flushOutbox = useCallback(async () => {
    let synced = 0;
    while (outboxRef.current.length) {
      const item = outboxRef.current[0];
      if (!tasksRef.current[item.id]) { outboxRef.current.shift(); continue; }
      const r = await updateTask(item.id, item.changes, { base: item.base, baseVersion: item.baseVersion, fromOutbox: true });
      if (r?.queued) break; // still offline; try again later
      outboxRef.current.shift();
      synced += 1;
    }
    setPending(outboxRef.current.length);
    if (synced && !outboxRef.current.length) toast(`Back online. ${synced} offline change${synced === 1 ? '' : 's'} synced.`, 'success');
  }, [updateTask, toast]);
  flushRef.current = flushOutbox;

  // Retry queued edits every few seconds while any are pending.
  useEffect(() => {
    if (!pending) return undefined;
    const id = setInterval(() => flushRef.current?.(), 5000);
    return () => clearInterval(id);
  }, [pending]);

  // ---- Keyboard shortcuts ---------------------------------------------------------
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (document.querySelector('.modal-backdrop, .drawer-wrap')) return;
      if (e.key === 'n') { e.preventDefault(); setTab('board'); setAddSignal((x) => x + 1); }
      else if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
      else if (['1', '2', '3', '4'].includes(e.key)) setTab(['board', 'list', 'calendar', 'activity'][Number(e.key) - 1]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const createTask = useCallback(async (fields) => {
    try {
      const r = await api(`/projects/${projectId}/tasks`, { method: 'POST', body: fields });
      upsertTask(r.task);
      return r.task;
    } catch (err) {
      toast(err.message, 'error');
      return null;
    }
  }, [projectId, upsertTask, toast]);

  // ---- Derived ----------------------------------------------------------------------
  const allTasks = useMemo(() => Object.values(tasks), [tasks]);
  const visible = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return allTasks.filter((t) => {
      if (q && !t.title.toLowerCase().includes(q) && !t.description?.toLowerCase().includes(q)) return false;
      if (filters.priority !== 'all' && t.priority !== filters.priority) return false;
      if (filters.assignee === 'me' && t.assignee_id !== user.id) return false;
      if (filters.assignee === 'none' && t.assignee_id) return false;
      if (!['all', 'me', 'none'].includes(filters.assignee) && t.assignee_id !== filters.assignee) return false;
      return true;
    });
  }, [allTasks, filters, user.id]);

  const viewersByTask = useMemo(() => {
    const map = {};
    for (const p of presence) {
      if (p.userId === user.id) continue;
      const m = members.find((x) => x.id === p.userId);
      if (!m) continue;
      (map[p.taskId] ||= []);
      if (!map[p.taskId].some((x) => x.user.id === m.id)) map[p.taskId].push({ user: m, field: p.field });
    }
    return map;
  }, [presence, members, user.id]);

  const done = allTasks.filter((t) => t.status === 'done').length;
  const pct = allTasks.length ? Math.round((done / allTasks.length) * 100) : 0;
  const overdue = allTasks.filter((t) => t.status !== 'done' && t.due_date && t.due_date < todayStr()).length;

  const openTask = (id) => navigate(`/p/${projectId}/t/${id}`);
  const closeTask = () => { setEditingField(null); navigate(`/p/${projectId}`); };

  // Deep link to a task that doesn't exist (deleted, or wrong project).
  useEffect(() => {
    if (project && taskId && !tasks[taskId]) {
      toast('That task no longer exists', 'warn');
      navigate(`/p/${projectId}`);
    }
  }, [project, taskId, tasks, projectId, toast]);

  // ---- Render -------------------------------------------------------------------------
  if (error) {
    return (
      <Empty title={error.status === 403 ? 'You don’t have access to this project' : 'Project not found'}>
        <a href="#/">Back to dashboard</a>
      </Empty>
    );
  }
  if (!project) return <div className="center-pad"><Spinner size={24} /></div>;

  const conflictTask = conflict && tasks[conflict.taskId];

  return (
    <div className="project">
      <div className="proj-head">
        <div className="ph-main">
          <div className="ph-title">
            <span className="proj-dot lg" style={{ background: project.color }} />
            <h1>{project.name}</h1>
            <button className="icon-btn" onClick={() => setShowSettings(true)} title="Project settings" aria-label="Project settings">
              <Icon name="settings" size={17} />
            </button>
          </div>
          {project.description && <p className="ph-desc">{project.description}</p>}
          {pending > 0 && (
            <span className="pending-pill" role="status"><Icon name="cloudOff" size={14} /> {pending} change{pending === 1 ? '' : 's'} waiting to sync</span>
          )}
          <div className="ph-progress">
            <div className="meter"><span style={{ width: `${pct}%`, background: project.color }} /></div>
            <span><b>{pct}%</b> complete · {done}/{allTasks.length} tasks{overdue > 0 && <span className="text-danger"> · {overdue} overdue</span>}</span>
          </div>
        </div>
        <button className="ph-members" onClick={() => setShowMembers(true)} title="Members">
          <AvatarStack users={members} max={5} size={30} onlineIds={online} />
          <span className="ph-online">{members.filter((m) => online.has(m.id)).length} online</span>
        </button>
      </div>

      <div className="toolbar">
        <div className="tabs" role="tablist">
          {[['board', 'Board', 'board'], ['list', 'List', 'list'], ['calendar', 'Calendar', 'calendar'], ['activity', 'Activity', 'activity']].map(([id, label, icon]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={cx('tab', tab === id && 'on')} onClick={() => setTab(id)}>
              <Icon name={icon} size={15} /> {label}
            </button>
          ))}
        </div>
        {tab !== 'activity' && (
          <div className="filters">
            <label className="search">
              <Icon name="search" size={15} />
              <input ref={searchRef} placeholder="Filter tasks  ( / )" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
            </label>
            <select value={filters.assignee} onChange={(e) => setFilters({ ...filters, assignee: e.target.value })} aria-label="Assignee filter">
              <option value="all">Everyone</option>
              <option value="me">Assigned to me</option>
              <option value="none">Unassigned</option>
              {members.filter((m) => m.id !== user.id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <select value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })} aria-label="Priority filter">
              <option value="all">Any priority</option>
              {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
        )}
      </div>

      {tab === 'board' && (
        <Board
          tasks={visible}
          members={members}
          viewersByTask={viewersByTask}
          flash={flash}
          onOpen={openTask}
          onMove={(id, changes) => updateTask(id, changes, { optimistic: true })}
          onCreate={createTask}
          addSignal={addSignal}
        />
      )}
      {tab === 'calendar' && (
        <CalendarView tasks={visible} members={members} viewersByTask={viewersByTask} flash={flash} onOpen={openTask}
          onChange={(id, changes) => updateTask(id, changes, { optimistic: true })} />
      )}
      {tab === 'list' && (
        <ListView tasks={visible} members={members} viewersByTask={viewersByTask} flash={flash} onOpen={openTask}
          onChange={(id, changes) => updateTask(id, changes, { optimistic: true })} onCreate={createTask} />
      )}
      {tab === 'activity' && <ActivityFeed projectId={projectId} members={members} onOpenTask={openTask} />}

      {taskId && tasks[taskId] && (
        <TaskDrawer
          key={taskId}
          task={tasks[taskId]}
          project={project}
          members={members}
          me={user}
          online={online}
          viewers={viewersByTask[taskId] || []}
          onClose={closeTask}
          updateTask={updateTask}
          onEditingField={setEditingField}
          inConflict={conflict?.taskId === taskId}
        />
      )}

      {conflict && conflictTask && (
        <ConflictModal
          conflict={conflict}
          task={conflictTask}
          members={members}
          onClose={() => setConflict(null)}
          onResolve={async (changes) => {
            const fields = Object.keys(changes);
            if (!fields.length) { setConflict(null); return; }
            const latest = tasksRef.current[conflict.taskId];
            setConflict(null);
            const r = await updateTask(conflict.taskId, changes, {
              baseVersion: latest.version,
              base: Object.fromEntries(fields.map((f) => [f, latest[f]])),
            });
            if (r && r.status === 200) toast('Conflict resolved', 'success');
          }}
        />
      )}

      {showSettings && (
        <ProjectSettingsModal project={project} onClose={() => setShowSettings(false)}
          onSaved={(p) => setProject((cur) => ({ ...cur, ...p, role: cur.role }))} />
      )}

      {showMembers && (
        <MembersModal
          project={project}
          members={members}
          online={online}
          me={user}
          onClose={() => setShowMembers(false)}
        />
      )}
    </div>
  );
}
