import { useState } from 'react';
import { api } from '../api.js';
import { Icon, Spinner, BrandLogo } from './ui.jsx';

export default function AuthPage({ onAuthed, initialMode = 'login', onBackToHome }) {
  const [mode, setMode] = useState(initialMode); // 'login' | 'register' | 'forgot'
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e?.preventDefault();
    setError('');
    setSuccessMsg('');

    if (mode === 'forgot') {
      if (form.password !== form.confirmPassword) {
        setError('New passwords do not match');
        return;
      }
    }

    setBusy(true);
    try {
      if (mode === 'forgot') {
        const r = await api('/auth/reset-password', {
          method: 'POST',
          body: { email: form.email, newPassword: form.password },
        });
        setSuccessMsg('Password updated successfully! Logging you in...');
        setTimeout(() => {
          onAuthed(r.user, r.token);
        }, 1200);
      } else {
        const body = mode === 'login' ? { email: form.email, password: form.password } : form;
        const r = await api(`/auth/${mode}`, { method: 'POST', body });
        onAuthed(r.user, r.token);
      }
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
            <div className="auth-top-nav">
              <button className="auth-back-link" onClick={onBackToHome}>
                <Icon name="arrowLeft" size={15} />
                <span>Back to Welcome Screen</span>
              </button>
            </div>
          )}

          <div className="auth-logo-row">
            <BrandLogo size={36} />
          </div>

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
            </div>
          </div>
        </div>
      </div>

      {/* Right Side: Auth Form Section */}
      <div className="auth-form-side animate-fade-rise-delay">
        <div className="auth-form-container">
          {/* Segmented Control Tab Switcher */}
          <div className="auth-seg-control">
            <button
              className={`auth-seg-tab ${mode === 'login' ? 'active' : ''}`}
              onClick={() => { setMode('login'); setError(''); setSuccessMsg(''); }}
            >
              Sign in
            </button>
            <button
              className={`auth-seg-tab ${mode === 'register' ? 'active' : ''}`}
              onClick={() => { setMode('register'); setError(''); setSuccessMsg(''); }}
            >
              Create account
            </button>
            {mode === 'forgot' && (
              <button className="auth-seg-tab active">
                Reset Password
              </button>
            )}
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
                  placeholder="you@company.com"
                  required
                />
              </div>
            </div>

            <div className="auth-field-group">
              <div className="auth-label-row">
                <label htmlFor="auth-password">
                  {mode === 'forgot' ? 'New Password' : 'Password'}
                </label>
                {mode === 'login' && (
                  <button
                    type="button"
                    className="auth-forgot-link"
                    onClick={() => { setMode('forgot'); setError(''); setSuccessMsg(''); }}
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
                  placeholder={mode === 'forgot' ? 'Enter new password' : '••••••••'}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                />
              </div>
            </div>

            {mode === 'forgot' && (
              <div className="auth-field-group">
                <label htmlFor="auth-confirm-password">Confirm New Password</label>
                <div className="auth-input-wrapper">
                  <Icon name="lock" size={17} className="auth-input-icon" />
                  <input
                    id="auth-confirm-password"
                    type="password"
                    value={form.confirmPassword}
                    onChange={set('confirmPassword')}
                    minLength={6}
                    placeholder="Confirm new password"
                    autoComplete="new-password"
                    required
                  />
                </div>
              </div>
            )}

            {error && <div className="auth-form-error">{error}</div>}
            {successMsg && (
              <div className="auth-form-error" style={{ background: '#ecfdf5', color: '#059669', borderColor: '#a7f3d0' }}>
                {successMsg}
              </div>
            )}

            <button className="auth-primary-btn" disabled={busy}>
              {busy ? (
                <Spinner size={18} />
              ) : (
                <>
                  <span>
                    {mode === 'login'
                      ? 'Sign in'
                      : mode === 'register'
                      ? 'Create account'
                      : 'Reset Password & Sign in'}
                  </span>
                  <Icon name="arrowRight" size={16} />
                </>
              )}
            </button>

            {mode === 'forgot' && (
              <div style={{ textAlign: 'center', marginTop: '12px' }}>
                <button
                  type="button"
                  className="auth-forgot-link"
                  onClick={() => { setMode('login'); setError(''); setSuccessMsg(''); }}
                  style={{ fontSize: '0.875rem' }}
                >
                  ← Back to Sign in
                </button>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

