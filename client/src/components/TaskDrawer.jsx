import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, uploadFile, downloadAttachment, fetchAttachmentBlob } from '../api.js';
import { useRealtime, useSocketEvents } from '../realtime.jsx';
import { STATUSES, PRIORITIES, FIELD_LABEL, displayValue, formatBytes, timeAgo, dueInfo, cx, splitMentions } from '../utils.js';
import { Avatar, Icon, Spinner, useToast } from './ui.jsx';
import Checklist from './Checklist.jsx';

const norm = (v) => (v === undefined || v === '' ? null : v);

export default function TaskDrawer({ task, project, members, me, viewers, onClose, updateTask, onEditingField, inConflict }) {
  const [details, setDetails] = useState(null);
  const [drafts, setDrafts] = useState({}); // field -> { value, base, baseVersion }
  const [saving, setSaving] = useState(null);
  const [section, setSection] = useState('comments');
  const { resyncTick } = useRealtime();
  const toast = useToast();
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  // ---- Load details (comments, files, history) and keep them live --------------
  const load = useCallback(() => {
    api(`/tasks/${task.id}`)
      .then((r) => setDetails({ comments: r.comments, attachments: r.attachments, history: r.history, checklist: r.checklist || [] }))
      .catch((e) => toast(e.message, 'error'));
  }, [task.id, toast]);
  useEffect(load, [load, resyncTick]);

  useSocketEvents(['comment:created', 'comment:deleted', 'attachment:created', 'attachment:deleted', 'activity:new', 'checklist:changed'], (ev, e) => {
    const tid = e.taskId ?? e.activity?.task_id;
    if (tid !== task.id) return;
    setDetails((d) => {
      if (!d) return d;
      switch (ev) {
        case 'comment:created': return d.comments.some((c) => c.id === e.comment.id) ? d : { ...d, comments: [...d.comments, e.comment] };
        case 'comment:deleted': return { ...d, comments: d.comments.filter((c) => c.id !== e.commentId) };
        case 'attachment:created': return d.attachments.some((a) => a.id === e.attachment.id) ? d : { ...d, attachments: [...d.attachments, e.attachment] };
        case 'attachment:deleted': return { ...d, attachments: d.attachments.filter((a) => a.id !== e.attachmentId) };
        case 'activity:new': return d.history.some((h) => h.id === e.activity.id) ? d : { ...d, history: [e.activity, ...d.history] };
        case 'checklist:changed':
          if (e.deletedId) return { ...d, checklist: d.checklist.filter((i) => i.id !== e.deletedId) };
          return d.checklist.some((i) => i.id === e.item.id)
            ? { ...d, checklist: d.checklist.map((i) => (i.id === e.item.id ? e.item : i)) }
            : { ...d, checklist: [...d.checklist, e.item] };
        default: return d;
      }
    });
  });

  // ---- Close (warn about unsaved drafts) -----------------------------------------
  const requestClose = useCallback(() => {
    const dirty = Object.entries(draftsRef.current).some(([, d]) => norm(d.value) !== norm(d.base));
    if (dirty && !window.confirm('You have unsaved changes. Discard them?')) return;
    onClose();
  }, [onClose]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !inConflict && !document.querySelector('.modal')) requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose, inConflict]);

  // ---- Editing ---------------------------------------------------------------------
  // Text fields are edited as drafts that remember the value + version they started
  // from. That "base" is what lets the server tell a clean merge from a conflict.
  const editDraft = (field, value) => {
    setDrafts((d) => ({
      ...d,
      [field]: { value, base: d[field]?.base ?? task[field], baseVersion: d[field]?.baseVersion ?? task.version },
    }));
  };
  const discard = (field) => setDrafts(({ [field]: _, ...rest }) => rest);

  const commit = async (field) => {
    const d = draftsRef.current[field];
    if (!d) return;
    let value = d.value;
    if (field === 'title') {
      value = value.trim();
      if (!value) { toast('Title can’t be empty', 'error'); discard(field); return; }
    }
    if (norm(value) === norm(d.base)) { discard(field); return; }
    setSaving(field);
    const r = await updateTask(task.id, { [field]: value }, { base: { [field]: d.base }, baseVersion: d.baseVersion });
    setSaving(null);
    // On success the draft is done; on 409 the conflict dialog now holds "yours".
    if (r && !r.error) discard(field);
  };

  const setField = (field, value) => updateTask(task.id, { [field]: norm(value) });

  const fieldValue = (f) => (drafts[f] ? drafts[f].value : task[f] ?? '');
  const editorsOf = (f) => viewers.filter((v) => v.field === f);

  /** Someone else changed a field while I'm drafting it. */
  const remoteChanged = (f) => drafts[f] && norm(task[f]) !== norm(drafts[f].base) && norm(task[f]) !== norm(drafts[f].value);
  const lastEditorOf = (f) => details?.history.find((h) => h.type === 'task_updated' && h.payload?.changes?.[f])?.user?.name;

  const focusProps = (f) => ({ onFocus: () => onEditingField(f), onBlur: () => onEditingField(null) });

  const del = async () => {
    if (!window.confirm(`Delete “${task.title}”? This removes its comments and files too.`)) return;
    try {
      await api(`/tasks/${task.id}`, { method: 'DELETE' });
      toast('Task deleted', 'success');
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const due = dueInfo(task);

  return (
    <div className="drawer-wrap" onMouseDown={(e) => e.target === e.currentTarget && requestClose()}>
      <aside className="drawer" aria-label="Task details">
        <header className="drawer-head">
          <span className="crumb"><span className="proj-dot" style={{ background: project.color }} />{project.name}</span>
          <span className="drawer-version" title="Every saved change bumps the version">v{task.version}</span>
          <span className="spacer" />
          {viewers.length > 0 && (
            <span className="also-here">
              {viewers.map((v) => <Avatar key={v.user.id} user={v.user} size={22} ring title={`${v.user.name} is ${v.field ? `editing ${FIELD_LABEL[v.field]?.toLowerCase()}` : 'viewing'}`} />)}
              <span>also here</span>
            </span>
          )}
          <button className="icon-btn danger" onClick={del} title="Delete task" aria-label="Delete task"><Icon name="trash" /></button>
          <button className="icon-btn" onClick={requestClose} title="Close (Esc)" aria-label="Close"><Icon name="x" /></button>
        </header>

        <div className="drawer-body">
          {/* Title */}
          <div className="field-block">
            <FieldPresence editors={editorsOf('title')} />
            <textarea
              className="title-input"
              rows={1}
              value={fieldValue('title')}
              maxLength={200}
              onChange={(e) => editDraft('title', e.target.value.replace(/\n/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } if (e.key === 'Escape') { e.stopPropagation(); discard('title'); e.currentTarget.blur(); } }}
              {...focusProps('title')}
              onBlur={() => { onEditingField(null); commit('title'); }}
              aria-label="Title"
            />
            {remoteChanged('title') && <RemoteWarning who={lastEditorOf('title')} theirs={task.title} />}
            {saving === 'title' && <span className="saving"><Spinner size={12} /> Saving…</span>}
          </div>

          {/* Properties */}
          <div className="props">
            <Prop label="Status" editors={editorsOf('status')}>
              <select className={`pill-select st-${task.status}`} value={task.status} onChange={(e) => setField('status', e.target.value)} {...focusProps('status')}>
                {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </Prop>
            <Prop label="Priority" editors={editorsOf('priority')}>
              <select className={`pill-select prio-sel prio-${task.priority}`} value={task.priority} onChange={(e) => setField('priority', e.target.value)} {...focusProps('priority')}>
                {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </Prop>
            <Prop label="Assignee" editors={editorsOf('assignee_id')}>
              <div className="assignee-pick">
                <Avatar user={members.find((m) => m.id === task.assignee_id)} size={22} />
                <select className="pill-select" value={task.assignee_id || ''} onChange={(e) => setField('assignee_id', e.target.value)} {...focusProps('assignee_id')}>
                  <option value="">Unassigned</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.id === me.id ? `${m.name} (me)` : m.name}</option>)}
                </select>
              </div>
            </Prop>
            <Prop label="Due date" editors={editorsOf('due_date')}>
              <div className="due-pick">
                <input type="date" value={task.due_date || ''} onChange={(e) => setField('due_date', e.target.value)} {...focusProps('due_date')} />
                {due && due.tone !== 'muted' && <span className={`due due-${due.tone}`}>{due.label}</span>}
                {task.due_date && <button className="link-btn" onClick={() => setField('due_date', null)}>Clear</button>}
              </div>
            </Prop>
          </div>

          {/* Description */}
          <div className="field-block">
            <div className="block-label">
              Description
              <FieldPresence editors={editorsOf('description')} inline />
            </div>
            <textarea
              className="desc-input"
              rows={5}
              placeholder="Add details, acceptance criteria, links…"
              value={fieldValue('description')}
              onChange={(e) => editDraft('description', e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit('description'); } }}
              {...focusProps('description')}
            />
            {remoteChanged('description') && <RemoteWarning who={lastEditorOf('description')} theirs={task.description} />}
            {drafts.description && norm(drafts.description.value) !== norm(drafts.description.base) && (
              <div className="draft-actions">
                <span className="muted">Unsaved changes · Ctrl/⌘+Enter to save</span>
                <button className="btn btn-sm" onClick={() => discard('description')}>Discard</button>
                <button className="btn btn-sm btn-primary" onClick={() => commit('description')} disabled={saving === 'description'}>
                  {saving === 'description' ? <Spinner size={12} /> : 'Save'}
                </button>
              </div>
            )}
          </div>

          {details && (
            <Checklist
              taskId={task.id}
              items={details.checklist}
              setItems={(fn) => setDetails((d) => ({ ...d, checklist: typeof fn === 'function' ? fn(d.checklist) : fn }))}
            />
          )}

          {/* Comments / Files / History */}
          <div className="drawer-tabs" role="tablist">
            <button role="tab" aria-selected={section === 'comments'} className={cx('tab', section === 'comments' && 'on')} onClick={() => setSection('comments')}>
              <Icon name="comment" size={14} /> Comments {details && <span className="count">{details.comments.length}</span>}
            </button>
            <button role="tab" aria-selected={section === 'files'} className={cx('tab', section === 'files' && 'on')} onClick={() => setSection('files')}>
              <Icon name="clip" size={14} /> Files {details && <span className="count">{details.attachments.length}</span>}
            </button>
            <button role="tab" aria-selected={section === 'history'} className={cx('tab', section === 'history' && 'on')} onClick={() => setSection('history')}>
              <Icon name="history" size={14} /> History
            </button>
          </div>

          {!details ? <div className="center-pad"><Spinner /></div> : (
            <>
              {section === 'comments' && <Comments taskId={task.id} projectId={project.id} comments={details.comments} me={me} members={members} />}
              {section === 'files' && <Files taskId={task.id} attachments={details.attachments} me={me} isOwner={project.role === 'owner'} />}
              {section === 'history' && <History history={details.history} members={members} />}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function Prop({ label, editors, children }) {
  return (
    <div className="prop">
      <span className="prop-label">{label}</span>
      <div className="prop-val">{children}<FieldPresence editors={editors} inline /></div>
    </div>
  );
}

function FieldPresence({ editors, inline }) {
  if (!editors?.length) return null;
  return (
    <span className={cx('field-presence', inline && 'inline')}>
      <Icon name="edit" size={11} />
      {editors.map((e) => e.user.name.split(' ')[0]).join(', ')} {editors.length === 1 ? 'is' : 'are'} editing
    </span>
  );
}

function RemoteWarning({ who, theirs }) {
  return (
    <div className="remote-warn" role="status">
      <Icon name="alert" size={14} />
      <div>
        <b>{who || 'A teammate'}</b> changed this while you were editing.
        Saving won’t overwrite it silently: you’ll get to compare both versions.
        {theirs && <span className="remote-theirs">Their version: “{theirs.length > 120 ? `${theirs.slice(0, 120)}…` : theirs}”</span>}
      </div>
    </div>
  );
}

// ---- Comments ------------------------------------------------------------------

function Comments({ taskId, projectId, comments, me, members }) {
  const [body, setBody] = useState('');
  const [mentionIds, setMentionIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(null); // { query, start, index }
  const [typers, setTypers] = useState({}); // userId -> { name, until }
  const { socket } = useRealtime();
  const toast = useToast();
  const endRef = useRef(null);
  const taRef = useRef(null);
  const lastTypingSent = useRef(0);
  const pendingCaret = useRef(null);

  // Place the caret right after an inserted @mention before the next keystroke lands.
  useLayoutEffect(() => {
    if (pendingCaret.current == null || !taRef.current) return;
    taRef.current.focus();
    taRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [body]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [comments.length]);

  // "Priya is typing…" — shown for 3s after their last keystroke.
  useSocketEvents(['typing', 'comment:created'], (ev, e) => {
    if (e.taskId !== taskId) return;
    if (ev === 'comment:created') {
      setTypers((t) => { const { [e.comment.user.id]: _, ...rest } = t; return rest; });
      return;
    }
    setTypers((t) => ({ ...t, [e.userId]: { name: e.name, until: Date.now() + 3000 } }));
  });
  useEffect(() => {
    const id = setInterval(() => {
      setTypers((t) => {
        const now = Date.now();
        const next = Object.fromEntries(Object.entries(t).filter(([, v]) => v.until > now));
        return Object.keys(next).length === Object.keys(t).length ? t : next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const others = members.filter((m) => m.id !== me.id);
  const matches = picker
    ? others.filter((m) => m.name.toLowerCase().includes(picker.query.toLowerCase())).slice(0, 6)
    : [];

  const onChange = (e) => {
    const value = e.target.value;
    setBody(value);
    const now = Date.now();
    if (socket && value && now - lastTypingSent.current > 1500) {
      lastTypingSent.current = now;
      socket.emit('typing', { projectId, taskId });
    }
    // Open the @mention picker when the word under the caret starts with "@".
    const caret = e.target.selectionStart;
    const before = value.slice(0, caret);
    const m = before.match(/(^|\s)@([\p{L}\p{N}._-]{0,30})$/u);
    setPicker(m ? { query: m[2], start: caret - m[2].length - 1, index: 0 } : null);
  };

  const insertMention = (member) => {
    const ta = taRef.current;
    const caret = ta.selectionStart;
    const next = `${body.slice(0, picker.start)}@${member.name} ${body.slice(caret)}`;
    setBody(next);
    setMentionIds((ids) => [...new Set([...ids, member.id])]);
    pendingCaret.current = picker.start + member.name.length + 2;
    setPicker(null);
  };

  const send = async (e) => {
    e?.preventDefault();
    const text = body.trim();
    if (!text) return;
    // Keep only mentions whose @Name is still in the text.
    const mentions = mentionIds.filter((id) => text.includes(`@${members.find((m) => m.id === id)?.name}`));
    setBusy(true);
    try {
      await api(`/tasks/${taskId}/comments`, { method: 'POST', body: { body: text, mentions } });
      setBody('');
      setMentionIds([]);
    } catch (err) {
      toast(`${err.message}. Your comment is still in the box.`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e) => {
    if (picker && matches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setPicker({ ...picker, index: (picker.index + 1) % matches.length }); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setPicker({ ...picker, index: (picker.index - 1 + matches.length) % matches.length }); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(matches[picker.index]); return; }
      if (e.key === 'Escape') { e.stopPropagation(); setPicker(null); return; }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(e);
  };

  const remove = async (id) => {
    try { await api(`/comments/${id}`, { method: 'DELETE' }); } catch (err) { toast(err.message, 'error'); }
  };

  const typingNames = Object.values(typers).map((t) => t.name.split(' ')[0]);

  return (
    <div className="comments">
      {comments.length === 0 && <p className="muted small">No comments yet. Type @ to mention a teammate.</p>}
      <ul>
        {comments.map((c) => (
          <li key={c.id} className="comment">
            <Avatar user={c.user} size={28} />
            <div className="comment-main">
              <div className="comment-head">
                <b>{c.user.name}</b>
                <time title={new Date(c.created_at).toLocaleString()}>{timeAgo(c.created_at)}</time>
                {c.user.id === me.id && <button className="link-btn" onClick={() => remove(c.id)}>Delete</button>}
              </div>
              <p>
                {splitMentions(c.body, members).map((part, i) => (part.mention
                  ? <span key={i} className={cx('mention', part.mention === me.name && 'is-me')}>@{part.mention}</span>
                  : <span key={i}>{part.text}</span>))}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <div ref={endRef} />
      <div className="typing-line" aria-live="polite">
        {typingNames.length > 0 && (
          <><span className="typing-dots"><i /><i /><i /></span>{typingNames.join(', ')} {typingNames.length === 1 ? 'is' : 'are'} typing</>
        )}
      </div>
      <form className="composer" onSubmit={send}>
        <Avatar user={me} size={28} />
        <div className="composer-box">
          <textarea ref={taRef} rows={2} placeholder="Write a comment. Type @ to mention someone."
            value={body} onChange={onChange} onKeyDown={onKeyDown} onBlur={() => setTimeout(() => setPicker(null), 150)} maxLength={5000} />
          {picker && matches.length > 0 && (
            <ul className="mention-pop" role="listbox">
              {matches.map((m, i) => (
                <li key={m.id} role="option" aria-selected={i === picker.index} className={cx(i === picker.index && 'sel')}
                  onMouseDown={(e) => { e.preventDefault(); insertMention(m); }}>
                  <Avatar user={m} size={20} /> {m.name}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button className="btn btn-primary btn-sm" disabled={busy || !body.trim()}>{busy ? <Spinner size={12} /> : 'Send'}</button>
      </form>
    </div>
  );
}

// ---- Files -------------------------------------------------------------------------

function Files({ taskId, attachments, me, isOwner }) {
  const [uploads, setUploads] = useState([]); // { id, name, progress }
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);
  const toast = useToast();

  const upload = async (files) => {
    for (const file of files) {
      const id = `${file.name}-${Date.now()}-${Math.random()}`;
      setUploads((u) => [...u, { id, name: file.name, progress: 0 }]);
      try {
        await uploadFile(taskId, file, (p) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, progress: p } : x))));
      } catch (err) {
        toast(`${file.name}: ${err.message}`, 'error');
      } finally {
        setUploads((u) => u.filter((x) => x.id !== id));
      }
    }
  };

  const remove = async (a) => {
    if (!window.confirm(`Remove ${a.filename}?`)) return;
    try { await api(`/attachments/${a.id}`, { method: 'DELETE' }); } catch (err) { toast(err.message, 'error'); }
  };

  return (
    <div className="files">
      <div
        className={cx('dropzone', dragOver && 'over')}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true); } }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); upload([...e.dataTransfer.files]); }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
      >
        <Icon name="clip" size={18} />
        <span>Drop files here or <u>browse</u> (max 10 MB each)</span>
        <input ref={inputRef} type="file" multiple hidden onChange={(e) => { upload([...e.target.files]); e.target.value = ''; }} />
      </div>
      <ul className="file-list">
        {uploads.map((u) => (
          <li key={u.id} className="file uploading">
            <span className="file-icon">↑</span>
            <div className="file-main"><b>{u.name}</b><div className="meter sm"><span style={{ width: `${Math.round(u.progress * 100)}%` }} /></div></div>
          </li>
        ))}
        {attachments.map((a) => (
          <li key={a.id} className="file">
            {a.mime?.startsWith('image/') ? <Thumb att={a} /> : (
              <span className="file-icon">{(a.filename.split('.').pop() || '').slice(0, 4).toUpperCase() || 'FILE'}</span>
            )}
            <div className="file-main">
              <b title={a.filename}>{a.filename}</b>
              <span className="muted small">{formatBytes(a.size)} · {a.user.name} · {timeAgo(a.created_at)}</span>
            </div>
            <button className="icon-btn" onClick={() => downloadAttachment(a).catch((e) => toast(e.message, 'error'))} title="Download" aria-label="Download"><Icon name="download" /></button>
            {(a.user.id === me.id || isOwner) && (
              <button className="icon-btn danger" onClick={() => remove(a)} title="Remove" aria-label="Remove"><Icon name="trash" /></button>
            )}
          </li>
        ))}
      </ul>
      {attachments.length === 0 && uploads.length === 0 && <p className="muted small">No files attached.</p>}
    </div>
  );
}

/** Image preview: fetched with the auth header, shown from a blob URL. */
function Thumb({ att }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    let objectUrl = null;
    fetchAttachmentBlob(att.id).then((blob) => {
      objectUrl = URL.createObjectURL(blob);
      if (alive) setUrl(objectUrl);
    }).catch(() => {});
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [att.id]);
  return url
    ? <a href={url} target="_blank" rel="noreferrer" className="file-thumb"><img src={url} alt={att.filename} /></a>
    : <span className="file-icon"><Icon name="image" size={16} /></span>;
}

// ---- History (field-level audit trail) ----------------------------------------------

function History({ history, members }) {
  if (!history.length) return <p className="muted small">No history yet.</p>;
  return (
    <ul className="history">
      {history.map((h) => (
        <li key={h.id}>
          <Avatar user={h.user} size={22} />
          <div className="hist-main">
            <div className="hist-head">
              <b>{h.user?.name || 'Someone'}</b>
              <span>{historyVerb(h)}</span>
              {h.payload?.merged && <span className="badge badge-merge" title="Saved on top of a teammate's concurrent edit, with no overwrite"><Icon name="merge" size={11} /> auto-merged</span>}
              <time title={new Date(h.created_at).toLocaleString()}>{timeAgo(h.created_at)}</time>
            </div>
            {h.type === 'task_updated' && (
              <ul className="diff">
                {Object.entries(h.payload.changes || {}).map(([f, c]) => (
                  <li key={f}>
                    <span className="diff-field">{FIELD_LABEL[f] || f}</span>
                    {f === 'description' ? (
                      <span className="diff-text">
                        <del>{c.from || '—'}</del>
                        <ins>{c.to || '—'}</ins>
                      </span>
                    ) : (
                      <span><del>{displayValue(f, c.from, members)}</del> → <ins>{displayValue(f, c.to, members)}</ins></span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {h.type === 'comment_added' && h.payload.excerpt && <p className="hist-quote">{h.payload.excerpt}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function historyVerb(h) {
  switch (h.type) {
    case 'task_created': return 'created this task';
    case 'task_updated': return 'changed';
    case 'comment_added': return 'commented';
    case 'file_attached': return `attached ${h.payload.filename}`;
    case 'checklist_done': return `ticked off “${h.payload.item}”`;
    default: return h.type.replace(/_/g, ' ');
  }
}
