import { useState } from 'react';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { PROJECT_COLORS, cx } from '../utils.js';
import { Modal, Spinner, useToast } from './ui.jsx';

export default function ProjectSettingsModal({ project, onClose, onSaved }) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description || '');
  const [color, setColor] = useState(project.color);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const isOwner = project.role === 'owner';

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api(`/projects/${project.id}`, { method: 'PATCH', body: { name, description, color } });
      onSaved(r.project);
      toast('Project settings saved', 'success');
      onClose();
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  };

  const del = async () => {
    if (window.prompt(`This permanently deletes the project, its tasks, comments and files.\nType the project name to confirm:\n${project.name}`) !== project.name) return;
    try {
      await api(`/projects/${project.id}`, { method: 'DELETE' });
      onClose();
      navigate('/');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <Modal title="Project settings" onClose={onClose} width={480}
      footer={isOwner ? <button className="btn btn-danger-ghost" onClick={del}>Delete project</button> : null}>
      <form className="form" onSubmit={save}>
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required /></label>
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
          <button className="btn btn-primary" disabled={busy || !name.trim()}>{busy ? <Spinner size={16} /> : 'Save changes'}</button>
        </div>
      </form>
    </Modal>
  );
}
