import { useState } from 'react';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { Avatar, Modal, Spinner, Icon, useToast } from './ui.jsx';

export default function MembersModal({ project, members, online, me, onClose }) {
  const [email, setEmail] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const isOwner = project.role === 'owner' || project.role === 'admin';

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

  const filteredMembers = members.filter(
    (m) =>
      m.name.toLowerCase().includes(query.toLowerCase()) ||
      m.email.toLowerCase().includes(query.toLowerCase())
  );

  const onlineCount = members.filter((m) => online.has(m.id)).length;

  return (
    <Modal title="Team Members & Access" onClose={onClose} width={500}>
      <div className="members-modal-header">
        <div className="mm-stats-row">
          <span className="mm-stat-pill">
            <Icon name="users" size={14} /> {members.length} member{members.length === 1 ? '' : 's'}
          </span>
          <span className="mm-stat-pill online-pill">
            <span className="conn-dot" /> {onlineCount} online now
          </span>
        </div>
      </div>

      <div className="members-invite-box">
        <label className="invite-label">Invite Teammates to Project</label>
        <form className="invite-form" onSubmit={invite}>
          <div className="auth-input-wrapper flex-1">
            <Icon name="mail" size={16} className="auth-input-icon" />
            <input
              type="email"
              placeholder="teammate@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <button className="btn btn-primary invite-btn" disabled={busy || !email.trim()}>
            {busy ? <Spinner size={14} /> : (
              <>
                <Icon name="plus" size={15} />
                <span>Add Member</span>
              </>
            )}
          </button>
        </form>
        <p className="invite-hint">Teammates must have registered a TeamFlow account with this email first.</p>
      </div>

      {members.length > 5 && (
        <div className="mm-search-bar">
          <Icon name="search" size={14} className="mm-search-icon" />
          <input
            type="text"
            placeholder="Filter members..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      <ul className="member-list">
        {filteredMembers.map((m) => {
          const isOnline = online.has(m.id);
          const isSelf = m.id === me.id;
          return (
            <li key={m.id} className="member-item">
              <Avatar user={m} size={36} online={isOnline} />
              <div className="mm-main">
                <div className="mm-name-row">
                  <b>{m.name}</b>
                  {isSelf && <span className="you-tag">You</span>}
                </div>
                <span className="muted small">{m.email}</span>
              </div>

              <span className={`role-badge role-${m.role}`}>
                {m.role === 'owner' ? 'Owner' : 'Member'}
              </span>

              {m.role !== 'owner' && (isOwner || isSelf) && (
                <button
                  className={isSelf ? 'btn-leave' : 'btn-remove'}
                  onClick={() => remove(m)}
                  title={isSelf ? 'Leave Project' : 'Remove Member'}
                >
                  {isSelf ? 'Leave' : 'Remove'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
