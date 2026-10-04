import { useState } from 'react';
import { api } from '../api.js';
import { Icon, Spinner, BrandLogo } from './ui.jsx';

export default function ForgotPasswordPage({ onAuthed, onBackToLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!email.trim()) {
      setError('Please enter your email address');
      return;
    }
    if (password.length < 6) {
      setError('New password must be at least 6 characters');
      return;
    }

    setBusy(true);
    try {
      const r = await api('/auth/login', {
        method: 'POST',
        body: { email: email.trim(), password, newPassword: password, isReset: true },
      });
      setSuccess('Password reset successfully! Logging you in...');
      setTimeout(() => {
        onAuthed(r.user, r.token);
      }, 1000);
    } catch (err) {
      setError(err.message || 'Failed to reset password');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="forgot-page-wrapper animate-fade-in">
      <div className="forgot-page-card animate-fade-rise">
        <div className="forgot-logo-row">
          <BrandLogo size={42} />
        </div>

        <h1 className="forgot-title">Reset Your Password</h1>
        <p className="forgot-subtitle">
          Enter your registered email address and your new password below to update your account credentials instantly.
        </p>

        <form onSubmit={handleSubmit} className="forgot-form">
          <div className="auth-field-group">
            <label htmlFor="forgot-email">Email Address</label>
            <div className="auth-input-wrapper">
              <Icon name="mail" size={18} className="auth-input-icon" />
              <input
                id="forgot-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="you@company.com"
                required
              />
            </div>
          </div>

          <div className="auth-field-group">
            <label htmlFor="forgot-password">New Password</label>
            <div className="auth-input-wrapper">
              <Icon name="lock" size={18} className="auth-input-icon" />
              <input
                id="forgot-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                autoComplete="new-password"
                placeholder="Enter new password (min 6 characters)"
                required
              />
            </div>
          </div>

          {error && <div className="auth-form-error">{error}</div>}
          {success && (
            <div className="auth-form-error" style={{ background: '#ecfdf5', color: '#059669', borderColor: '#a7f3d0' }}>
              {success}
            </div>
          )}

          <button className="auth-primary-btn" disabled={busy} style={{ marginTop: '12px' }}>
            {busy ? (
              <Spinner size={18} />
            ) : (
              <>
                <span>Reset Password & Sign In</span>
                <Icon name="arrowRight" size={16} />
              </>
            )}
          </button>

          <div className="forgot-back-row">
            <button type="button" onClick={onBackToLogin} className="forgot-back-btn">
              <Icon name="arrowLeft" size={14} />
              <span>Back to Sign In</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
