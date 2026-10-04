import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { initials, cx } from '../utils.js';

// ---- Avatar ------------------------------------------------------------------

export function Avatar({ user, size = 28, online, ring, title }) {
  if (!user) {
    return (
      <span className="avatar avatar-empty" style={{ width: size, height: size }} title="Unassigned">
        <svg viewBox="0 0 20 20" width={size * 0.55} height={size * 0.55} aria-hidden>
          <circle cx="10" cy="7" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M4 17c1-3.2 3.3-4.6 6-4.6s5 1.4 6 4.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  return (
    <span
      className={cx('avatar', ring && 'avatar-ring')}
      style={{ width: size, height: size, background: user.color, fontSize: size * 0.4 }}
      title={title || user.name}
    >
      {initials(user.name)}
      {online !== undefined && <span className={cx('presence-dot', online && 'on')} />}
    </span>
  );
}

export function AvatarStack({ users, max = 4, size = 24, onlineIds }) {
  const shown = users.slice(0, max);
  const extra = users.length - shown.length;
  return (
    <span className="avatar-stack">
      {shown.map((u) => (
        <Avatar key={u.id} user={u} size={size} online={onlineIds ? onlineIds.has(u.id) : undefined} />
      ))}
      {extra > 0 && <span className="avatar avatar-more" style={{ width: size, height: size }}>+{extra}</span>}
    </span>
  );
}

// ---- Modal -------------------------------------------------------------------

export function Modal({ title, onClose, children, width = 440, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" style={{ maxWidth: width }} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          {onClose && (
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <Icon name="x" />
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---- Toasts ------------------------------------------------------------------

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);
  const push = useCallback((text, tone = 'info', ms = 3500) => {
    const id = ++idRef.current;
    setToasts((t) => [...t.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cx('toast', `toast-${t.tone}`)}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---- Icons (inline, SVG vector paths) ---------------------------------------

const PATHS = {
  x: 'M5 5l10 10M15 5L5 15',
  plus: 'M10 4v12M4 10h12',
  grid: 'M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z',
  board: 'M3 4h4v12H3zM8 4h4v8H8zM13 4h4v10h-4z',
  list: 'M7 5h10M7 10h10M7 15h10M3 5h.01M3 10h.01M3 15h.01',
  activity: 'M2 10h4l2-6 4 12 2-6h4',
  comment: 'M4 4h12v9H8l-4 3z',
  clip: 'M14 7l-5.5 5.5a2 2 0 01-3-3L11 4a3.2 3.2 0 014.6 4.6L10 14.2',
  trash: 'M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10',
  download: 'M10 3v10M6 9l4 4 4-4M4 17h12',
  users: 'M7 9a3 3 0 100-6 3 3 0 000 6zM1.5 17c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5M13 3.3a3 3 0 010 5.4M15 12.7c1.7.5 3 1.9 3.5 4.3',
  search: 'M9 15a6 6 0 100-12 6 6 0 000 12zM13.5 13.5L17 17',
  calendar: 'M3 5h14v12H3zM3 8h14M7 3v4M13 3v4',
  logout: 'M8 4H4v12h4M13 6l4 4-4 4M17 10H8',
  alert: 'M10 3l8 14H2zM10 8v4M10 14.5h.01',
  history: 'M3 10a7 7 0 107-7 7 7 0 00-5 2.1L3 7M3 3v4h4M10 6v4l3 2',
  merge: 'M6 3v6a4 4 0 004 4h4M6 3a1.5 1.5 0 100 .01M14 13l-2.5-2.5M14 13l-2.5 2.5M6 17v-4',
  check: 'M4 10.5l4 4 8-9',
  edit: 'M13 3l4 4-9 9H4v-4z',
  menu: 'M3 5h14M3 10h14M3 15h14',
  bell: 'M5 14V9a5 5 0 0110 0v5l1.5 2h-13zM8.5 18a1.8 1.8 0 003 0',
  sun: 'M10 13.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M4 4l1.4 1.4M14.6 14.6L16 16M4 16l1.4-1.4M14.6 5.4L16 4',
  moon: 'M16.5 12.5A7 7 0 017.5 3.5a7 7 0 109 9z',
  monitor: 'M2.5 4h15v10h-15zM7 17.5h6M10 14v3.5',
  settings: 'M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM16.2 12.3l1.3 1-1.6 2.8-1.6-.5a6.5 6.5 0 01-1.8 1l-.3 1.7H8.8l-.3-1.7a6.5 6.5 0 01-1.8-1l-1.6.5-1.6-2.8 1.3-1a6.6 6.6 0 010-2.1l-1.3-1 1.6-2.8 1.6.5a6.5 6.5 0 011.8-1l.3-1.7h3.2l.3 1.7a6.5 6.5 0 011.8 1l1.6-.5 1.6 2.8-1.3 1a6.6 6.6 0 010 2.1z',
  checklist: 'M3 5l1.5 1.5L7 4M3 11l1.5 1.5L7 10M10 5.5h7M10 11.5h7M3.5 16h.01M10 16h7',
  chevL: 'M12.5 4l-6 6 6 6',
  chevR: 'M7.5 4l6 6-6 6',
  keyboard: 'M2 5h16v10H2zM5 8h.01M8 8h.01M11 8h.01M14 8h.01M5 11h.01M15 11h.01M7.5 12h5',
  cloudOff: 'M3 3l14 14M8 5.2A5 5 0 0115 9h.5a3 3 0 011.3 5.7M13 15H5.5a3.5 3.5 0 01-1-6.9',
  image: 'M3 4h14v12H3zM3 13l4-4 3 3 2-2 5 5M13 7.5h.01',
  zap: 'M11 2L3 11h6l-1 7 8-9h-6l1-7z',
  arrowRight: 'M4 10h12M12 4l4 6-4 6',
  arrowLeft: 'M16 10H4M8 4l-4 6 4 6',
  shield: 'M10 2l7 3v6c0 4.5-3.5 7.5-7 9-3.5-1.5-7-4.5-7-9V5l7-3z',
  atSign: 'M12 10a2 2 0 11-4 0 2 2 0 014 0z M14 10v1.5a2.5 2.5 0 004 0V10a8 8 0 10-2.4 5.6',
  checkSquare: 'M3 5h14v12H3zM6 10l3 3 5-6',
  wifiOff: 'M2 2l16 16M6 8a9 9 0 0110.8 0M8.5 11.5a5 5 0 015 0',
  barChart: 'M4 17v-4M8 17V7M12 17V3M16 17v-7',
  layers: 'M2 7l8-4 8 4-8 4-8-4zM2 11l8 4 8-4M2 15l8 4 8-4',
  sparkles: 'M10 2l1.5 4.5L16 8l-4.5 1.5L10 14l-1.5-4.5L4 8l4.5-1.5z',
  clock: 'M10 18a8 8 0 100-16 8 8 0 000 16zM10 6v4.5l3 1.5',
  trendingUp: 'M2 14l5-5 4 4 7-7M13 6h5v5',
  target: 'M10 18a8 8 0 100-16 8 8 0 000 16zM10 14a4 4 0 100-8 4 4 0 000 8z',
  pieChart: 'M17 10a7 7 0 11-7-7v7h7z M12 3a7 7 0 016.9 6H12V3z',
  userPlus: 'M13 13a4 4 0 100-8 4 4 0 000 8zM5 19c.6-3.2 3.2-5 7-5s6.4 1.8 7 5M16 8h4M18 6v4',
  mail: 'M3 4h14v12H3zM3 5l7 6 7-6',
  lock: 'M5 9h10v8H5zM7 9V6a3 3 0 116 0v3',
  user: 'M10 9a3 3 0 100-6 3 3 0 000 6zM4 17c.8-3 3-4.5 6-4.5s5.2 1.5 6 4.5',
};

export function Icon({ name, size = 16, className }) {
  const path = PATHS[name] || PATHS.zap;
  return (
    <svg
      className={cx('icon', className)}
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={path} />
    </svg>
  );
}

// Brand Logo Component
export function BrandLogo({ size = 28, className }) {
  return (
    <div className={cx('brand-logo-wrap', className)}>
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="32" height="32" rx="9" fill="url(#brand-grad)" />
        <path d="M9 16L15 22L23 10" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M15 10L21 16" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeOpacity="0.7" />
        <defs>
          <linearGradient id="brand-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
            <stop stopColor="#6366F1" />
            <stop offset="0.5" stopColor="#3B82F6" />
            <stop offset="1" stopColor="#EC4899" />
          </linearGradient>
        </defs>
      </svg>
      <span className="brand-title-text">TeamFlow</span>
    </div>
  );
}

export function Spinner({ size = 18 }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="Loading" />;
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}
