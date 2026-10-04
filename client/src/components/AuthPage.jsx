import { useState } from 'react';
import { api } from '../api.js';
import { Avatar, AvatarStack, Icon, Spinner, BrandLogo } from './ui.jsx';

const DEMO = [
  { name: 'Aarav Shah', email: 'aarav@demo.dev', color: '#6366f1' },
  { name: 'Priya Nair', email: 'priya@demo.dev', color: '#ec4899' },
  { name: 'Rohan Mehta', email: 'rohan@demo.dev', color: '#f59e0b' },
];

export default function AuthPage({ onAuthed, initialMode = 'login', onBackToHome }) {
  const [mode, setMode] = useState(initialMode);
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
    <div className="auth animate-fade-in">
      <div className="auth-side animate-fade-rise">
        {onBackToHome && (
          <button className="auth-back-btn liquid-glass" onClick={onBackToHome}>
            <Icon name="arrowLeft" size={15} />
            <span>Back to Welcome Screen</span>
          </button>
        )}

        <BrandLogo size={32} className="mb-6" />

        <h1 className="auth-title">
          Plan, build and ship together, <br />
          <span className="auth-title-gradient">in one live workspace.</span>
        </h1>

        <ul className="auth-points">
          <li>
            <Icon name="zap" size={16} className="text-emerald-400" />
            <span>Every change reaches your whole team the moment it happens.</span>
          </li>
          <li>
            <Icon name="shield" size={16} className="text-indigo-400" />
            <span>Two people editing one task never overwrite each other.</span>
          </li>
          <li>
            <Icon name="barChart" size={16} className="text-pink-400" />
            <span>Deadlines, progress and workload on one live dashboard.</span>
          </li>
        </ul>

        <div className="auth-demo" aria-hidden="true">
          <div className="auth-demo-card animate-pulse-subtle">
            <span className="prio prio-urgent">Urgent</span>
            <h4>Pricing page copy</h4>
            <div className="auth-demo-row">
              <span className="auth-demo-edit">
                <Icon name="edit" size={12} /> Priya is editing description…
              </span>
              <AvatarStack users={DEMO.slice(0, 3)} size={22} />
            </div>
          </div>
        </div>
      </div>

      <div className="auth-card animate-fade-rise-delay">
        <div className="seg">
          <button className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>
            Sign in
          </button>
          <button className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>
            Create account
          </button>
        </div>

        <form onSubmit={submit} className="form">
          {mode === 'register' && (
            <label>
              Name
              <input value={form.name} onChange={set('name')} autoComplete="name" placeholder="John Doe" required />
            </label>
          )}
          <label>
            Email
            <input type="email" value={form.email} onChange={set('email')} autoComplete="email" placeholder="aarav@demo.dev" required />
          </label>
          <label>
            Password
            <input
              type="password"
              value={form.password}
              onChange={set('password')}
              minLength={6}
              placeholder="••••••••"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
            />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="btn btn-primary btn-block auth-submit-btn" disabled={busy}>
            {busy ? <Spinner size={16} /> : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div className="demo">
          <div className="demo-head">
            <Icon name="zap" size={14} />
            <span>Try a demo account</span>
          </div>
          <div className="demo-list">
            {DEMO.map((u) => (
              <button
                key={u.email}
                className="demo-btn"
                disabled={busy}
                onClick={() => submit(null, { email: u.email, password: 'demo1234' })}
              >
                <Avatar user={u} size={24} />
                <span>{u.name.split(' ')[0]}</span>
              </button>
            ))}
          </div>
          <p className="hint">
            Tip: each browser tab keeps its own session. Sign in as two people in two tabs to see live collaboration.
          </p>
        </div>
      </div>
    </div>
  );
}
