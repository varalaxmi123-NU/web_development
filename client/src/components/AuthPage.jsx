import { useState } from 'react';
import { api } from '../api.js';
import { Avatar, AvatarStack, Icon, Spinner } from './ui.jsx';

const DEMO = [
  { name: 'Aarav Shah', email: 'aarav@demo.dev', color: '#6366f1' },
  { name: 'Priya Nair', email: 'priya@demo.dev', color: '#ec4899' },
  { name: 'Rohan Mehta', email: 'rohan@demo.dev', color: '#f59e0b' },
];

export default function AuthPage({ onAuthed }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e, override) => {
    e?.preventDefault();
    setError('');
    setBusy(true);
    try {
      const body = override || (mode === 'login' ? { email: form.email, password: form.password } : form);
      const r = await api(`/auth/${override ? 'login' : mode}`, { method: 'POST', body });
      onAuthed(r.user, r.token);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="auth">
      <div className="auth-side">
        <div className="brand brand-lg"><span className="brand-mark" />TeamFlow</div>
        <h1>Plan, build and ship together, in one live workspace.</h1>
        <ul className="auth-points">
          <li>Every change reaches your whole team the moment it happens.</li>
          <li>Two people editing one task never overwrite each other.</li>
          <li>Deadlines, progress and workload on one dashboard.</li>
        </ul>
        <div className="auth-demo" aria-hidden="true">
          <div className="auth-demo-card">
            <span className="prio prio-urgent">Urgent</span>
            <h4>Pricing page copy</h4>
            <div className="auth-demo-row">
              <span className="auth-demo-edit"><Icon name="edit" size={12} /> Priya is editing the description</span>
              <AvatarStack users={DEMO.slice(0, 3)} size={22} />
            </div>
          </div>
        </div>
      </div>

      <div className="auth-card">
        <div className="seg">
          <button className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>Sign in</button>
          <button className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>Create account</button>
        </div>

        <form onSubmit={submit} className="form">
          {mode === 'register' && (
            <label>Name<input value={form.name} onChange={set('name')} autoComplete="name" required /></label>
          )}
          <label>Email<input type="email" value={form.email} onChange={set('email')} autoComplete="email" required /></label>
          <label>
            Password
            <input type="password" value={form.password} onChange={set('password')} minLength={6}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? <Spinner size={16} /> : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div className="demo">
          <div className="demo-head">Try a demo account <span>(run <code>npm run seed</code> first)</span></div>
          <div className="demo-list">
            {DEMO.map((u) => (
              <button key={u.email} className="demo-btn" disabled={busy}
                onClick={() => submit(null, { email: u.email, password: 'demo1234' })}>
                <Avatar user={u} size={26} />
                <span>{u.name.split(' ')[0]}</span>
              </button>
            ))}
          </div>
          <p className="hint">Tip: each browser tab keeps its own session. Sign in as two people in two tabs to see live collaboration.</p>
        </div>
      </div>
    </div>
  );
}
