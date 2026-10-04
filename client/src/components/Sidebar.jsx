import { useState } from 'react';
import { api } from '../api.js';
import { PROJECT_COLORS, cx } from '../utils.js';
import { Avatar, Icon, Modal, Spinner, useToast } from './ui.jsx';

export default function Sidebar({ user, projects, route, onSignOut, onCreated }) {
  const [creating, setCreating] = useState(false);

  return (
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark" />TeamFlow</div>

      <nav className="nav">
        <a href="#/" className={cx('nav-item', route.view === 'dashboard' && 'active')}>
          <Icon name="grid" /> Dashboard
        </a>
      </nav>

      <div className="nav-section">
        <span>Projects</span>
        <button className="icon-btn sm" onClick={() => setCreating(true)} title="New project" aria-label="New project">
          <Icon name="plus" size={14} />
        </button>
      </div>

      <nav className="nav nav-projects">
        {!projects && <div className="nav-loading"><Spinner size={14} /></div>}
        {projects?.length === 0 && (
          <button className="nav-empty" onClick={() => setCreating(true)}>Create your first project</button>
        )}
        {projects?.map((p) => {
          const pct = p.task_count ? Math.round((p.done_count / p.task_count) * 100) : 0;
          return (
            <a key={p.id} href={`#/p/${p.id}`} className={cx('nav-item', route.projectId === p.id && 'active')}>
              <span className="proj-dot" style={{ background: p.color }} />
              <span className="nav-label">{p.name}</span>
              <span className="nav-meta" title={`${p.done_count}/${p.task_count} done`}>{pct}%</span>
            </a>
          );
        })}
      </nav>

      <div className="sidebar-foot">
        <Avatar user={user} size={30} />
        <div className="me">
          <strong>{user.name}</strong>
          <span>{user.email}</span>
        </div>
        <button className="icon-btn" onClick={onSignOut} title="Sign out" aria-label="Sign out">
          <Icon name="logout" />
        </button>
      </div>

      {creating && <NewProjectModal onClose={() => setCreating(false)} onCreated={(p) => { setCreating(false); onCreated(p); }} />}
    </aside>
  );
}

function NewProjectModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(PROJECT_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api('/projects', { method: 'POST', body: { name, description, color } });
      toast(`Project “${r.project.name}” created`, 'success');
      onCreated(r.project);
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  };

  return (
    <Modal title="New project" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>Name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required placeholder="e.g. Q4 Launch" /></label>
        <label>Description<textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this project about?" /></label>
        <div className="field">
          <span className="field-label">Color</span>
          <div className="swatches">
            {PROJECT_COLORS.map((c) => (
              <button type="button" key={c} className={cx('swatch', c === color && 'on')} style={{ background: c }}
                onClick={() => setColor(c)} aria-label={`Color ${c}`} />
            ))}
          </div>
        </div>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !name.trim()}>{busy ? <Spinner size={16} /> : 'Create project'}</button>
        </div>
      </form>
    </Modal>
  );
}
