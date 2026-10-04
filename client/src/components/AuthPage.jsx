import { useState } from 'react';
import { api } from '../api.js';
import { Icon, Spinner, BrandLogo } from './ui.jsx';

export default function AuthPage({ onAuthed, initialMode = 'login', onBackToHome, onOpenForgot }) {
  const [mode, setMode] = useState(initialMode); // 'login' | 'register' | 'forgot'
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const handleForgotClick = () => {
    if (onOpenForgot) {
      onOpenForgot();
    } else {
      setMode('forgot');
      setError('');
      setSuccessMsg('');
    }
  };

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
        const r = await api('/auth/login', {
          method: 'POST',
          body: { email: form.email, password: form.password, newPassword: form.password, isReset: true },
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
          {mode === 'forgot' ? (
            <div className="auth-forgot-page animate-fade-in">
              <div style={{ marginBottom: '20px' }}>
                <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--fg)', marginBottom: '6px' }}>
                  Reset Your Password
                </h2>
                <p style={{ fontSize: '0.875rem', color: 'var(--fg-muted)', lineHeight: '1.4' }}>
                  Enter your registered email address and your new password below to update your credentials immediately.
                </p>
              </div>

              <form onSubmit={submit} className="auth-form">
                <div className="auth-field-group">
                  <label htmlFor="auth-forgot-email">Email Address</label>
                  <div className="auth-input-wrapper">
                    <Icon name="mail" size={17} className="auth-input-icon" />
                    <input
                      id="auth-forgot-email"
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
                  <label htmlFor="auth-forgot-password">New Password</label>
                  <div className="auth-input-wrapper">
                    <Icon name="lock" size={17} className="auth-input-icon" />
                    <input
                      id="auth-forgot-password"
                      type="password"
                      value={form.password}
                      onChange={set('password')}
                      minLength={6}
                      placeholder="Enter your new password"
                      autoComplete="new-password"
                      required
                    />
                  </div>
                </div>

                <div className="auth-field-group">
                  <label htmlFor="auth-forgot-confirm">Confirm New Password</label>
                  <div className="auth-input-wrapper">
                    <Icon name="lock" size={17} className="auth-input-icon" />
                    <input
                      id="auth-forgot-confirm"
                      type="password"
                      value={form.confirmPassword}
                      onChange={set('confirmPassword')}
                      minLength={6}
                      placeholder="Confirm your new password"
                      autoComplete="new-password"
                      required
                    />
                  </div>
                </div>

                {error && <div className="auth-form-error">{error}</div>}
                {successMsg && (
                  <div className="auth-form-error" style={{ background: '#ecfdf5', color: '#059669', borderColor: '#a7f3d0' }}>
                    {successMsg}
                  </div>
                )}

                <button className="auth-primary-btn" disabled={busy} style={{ marginTop: '8px' }}>
                  {busy ? (
                    <Spinner size={18} />
                  ) : (
                    <>
                      <span>Reset Password & Sign in</span>
                      <Icon name="arrowRight" size={16} />
                    </>
                  )}
                </button>

                <div style={{ textAlign: 'center', marginTop: '16px' }}>
                  <button
                    type="button"
                    onClick={() => { setMode('login'); setError(''); setSuccessMsg(''); }}
                    style={{
                      fontSize: '0.875rem',
                      color: 'var(--brand)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontWeight: 600,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <Icon name="arrowLeft" size={14} />
                    <span>Return to Sign in</span>
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <>
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
                    <label htmlFor="auth-password">Password</label>
                    {mode === 'login' && (
                      <button
                        type="button"
                        className="auth-forgot-link"
                        onClick={handleForgotClick}
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}

