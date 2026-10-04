import { useState } from 'react';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { Avatar, Modal, Spinner, useToast } from './ui.jsx';

export default function MembersModal({ project, members, online, me, onClose }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const isOwner = project.role === 'owner';

  const invite = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api(`/projects/${project.id}/members`, { method: 'POST', body: { email } });
      toast(`${r.member.name} added to ${project.name}`, 'success');
      setEmail('');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (m) => {
    const self = m.id === me.id;
    if (!window.confirm(self ? `Leave ${project.name}?` : `Remove ${m.name} from ${project.name}? Their tasks will be unassigned.`)) return;
    try {
      await api(`/projects/${project.id}/members/${m.id}`, { method: 'DELETE' });
      if (self) { onClose(); navigate('/'); }
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <Modal title="Project members" onClose={onClose} width={480}>
      <form className="invite" onSubmit={invite}>
        <input type="email" placeholder="Teammate’s email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <button className="btn btn-primary" disabled={busy}>{busy ? <Spinner size={14} /> : 'Add'}</button>
      </form>
      <p className="muted small">They need a TeamFlow account first. Added members see the project instantly.</p>
      <ul className="member-list">
        {members.map((m) => (
          <li key={m.id}>
            <Avatar user={m} size={32} online={online.has(m.id)} />
            <div className="mm-main">
              <b>{m.name}{m.id === me.id && ' (you)'}</b>
              <span className="muted small">{m.email}</span>
            </div>
            <span className={`role role-${m.role}`}>{m.role}</span>
            {m.role !== 'owner' && (isOwner || m.id === me.id) && (
              <button className="link-btn" onClick={() => remove(m)}>{m.id === me.id ? 'Leave' : 'Remove'}</button>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  );
}
