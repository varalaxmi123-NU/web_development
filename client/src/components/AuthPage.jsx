import { useState } from 'react';
import { api } from '../api.js';
import { AvatarStack, Icon, Spinner, BrandLogo } from './ui.jsx';

const PREVIEW_USERS = [
  { name: 'Aarav Shah', email: 'aarav@demo.dev', color: '#6366f1' },
  { name: 'Priya Nair', email: 'priya@demo.dev', color: '#ec4899' },
  { name: 'Rohan Mehta', email: 'rohan@demo.dev', color: '#f59e0b' },
];

export default function AuthPage({ onAuthed, initialMode = 'login', onBackToHome }) {
  const [mode, setMode] = useState(initialMode);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e?.preventDefault();
    setError('');
    setBusy(true);
    try {
      const body = mode === 'login' ? { email: form.email, password: form.password } : form;
      const r = await api(`/auth/${mode}`, { method: 'POST', body });
      onAuthed(r.user, r.token);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="auth-modern animate-fade-in">
      {/* Left Side: Dark Hero Section with Ambient Gradient Blur Mesh */}
      <div className="auth-hero-side animate-fade-rise">
        <div className="auth-mesh-glow auth-mesh-glow-1" />
        <div className="auth-mesh-glow auth-mesh-glow-2" />

        <div className="auth-hero-content">
          {onBackToHome && (
            <button className="auth-back-link" onClick={onBackToHome}>
              <Icon name="arrowLeft" size={15} />
              <span>Back to Welcome Screen</span>
            </button>
          )}

          <BrandLogo size={36} className="auth-brand-logo" />

          <h1 className="auth-hero-heading">
            Plan, build and ship together, <br />
            <span className="auth-hero-gradient">in one live workspace.</span>
          </h1>

          <ul className="auth-feature-list">
            <li>
              <span className="auth-feature-badge badge-emerald">
                <Icon name="zap" size={15} />
              </span>
              <span>Every change reaches your whole team the moment it happens.</span>
            </li>
            <li>
              <span className="auth-feature-badge badge-indigo">
                <Icon name="shield" size={15} />
              </span>
              <span>Two people editing one task never overwrite each other.</span>
            </li>
            <li>
              <span className="auth-feature-badge badge-pink">
                <Icon name="barChart" size={15} />
              </span>
              <span>Deadlines, progress and workload on one live dashboard.</span>
            </li>
          </ul>

          {/* Lower Glassmorphism Preview Vignette Card */}
          <div className="auth-preview-card" aria-hidden="true">
            <div className="auth-card-badge-row">
              <span className="auth-prio-tag prio-urgent">Urgent</span>
              <span className="auth-live-pulse">
                <span className="conn-dot" /> Live
              </span>
            </div>
            <h4>Pricing page copy</h4>
            <div className="auth-card-footer">
              <span className="auth-live-editing">
                <Icon name="edit" size={13} /> Priya is editing description…
              </span>
              <AvatarStack users={PREVIEW_USERS} size={24} />
            </div>
          </div>
        </div>
      </div>

      {/* Right Side: Sleek Auth Form Section */}
      <div className="auth-form-side animate-fade-rise-delay">
        <div className="auth-form-container">
          {/* Segmented Control Tab Switcher */}
          <div className="auth-seg-control">
            <button
              className={`auth-seg-tab ${mode === 'login' ? 'active' : ''}`}
              onClick={() => setMode('login')}
            >
              Sign in
            </button>
            <button
              className={`auth-seg-tab ${mode === 'register' ? 'active' : ''}`}
              onClick={() => setMode('register')}
            >
              Create account
            </button>
          </div>

          <form onSubmit={submit} className="auth-form">
            {mode === 'register' && (
              <div className="auth-field-group">
                <label htmlFor="auth-name">Full Name</label>
                <div className="auth-input-wrapper">
                  <Icon name="user" size={17} className="auth-input-icon" />
                  <input
                    id="auth-name"
                    value={form.name}
                    onChange={set('name')}
                    autoComplete="name"
                    placeholder="Aarav Shah"
                    required
                  />
                </div>
              </div>
            )}

            <div className="auth-field-group">
              <label htmlFor="auth-email">Email Address</label>
              <div className="auth-input-wrapper">
                <Icon name="mail" size={17} className="auth-input-icon" />
                <input
                  id="auth-email"
                  type="email"
                  value={form.email}
                  onChange={set('email')}
                  autoComplete="email"
                  placeholder="aarav@demo.dev"
                  required
                />
              </div>
            </div>

            <div className="auth-field-group">
              <div className="auth-label-row">
                <label htmlFor="auth-password">Password</label>
                {mode === 'login' && (
                  <button
                    type="button"
                    className="auth-forgot-link"
                    onClick={() => alert('Demo account: Use password "demo1234" to sign in.')}
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="auth-input-wrapper">
                <Icon name="lock" size={17} className="auth-input-icon" />
                <input
                  id="auth-password"
                  type="password"
                  value={form.password}
                  onChange={set('password')}
                  minLength={6}
                  placeholder="••••••••"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                />
              </div>
            </div>

            {error && <div className="auth-form-error">{error}</div>}

            <button className="auth-primary-btn" disabled={busy}>
              {busy ? (
                <Spinner size={18} />
              ) : (
                <>
                  <span>{mode === 'login' ? 'Sign in' : 'Create account'}</span>
                  <Icon name="arrowRight" size={16} />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
