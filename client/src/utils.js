export const STATUSES = [
  { id: 'todo', label: 'To do', color: 'var(--st-todo)' },
  { id: 'in_progress', label: 'In progress', color: 'var(--st-progress)' },
  { id: 'review', label: 'In review', color: 'var(--st-review)' },
  { id: 'done', label: 'Done', color: 'var(--st-done)' },
];
export const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.id, s.label]));

export const PRIORITIES = [
  { id: 'urgent', label: 'Urgent' },
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' },
];
export const PRIORITY_LABEL = Object.fromEntries(PRIORITIES.map((p) => [p.id, p.label]));
export const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 };

export const FIELD_LABEL = {
  title: 'Title',
  description: 'Description',
  status: 'Status',
  priority: 'Priority',
  assignee_id: 'Assignee',
  due_date: 'Due date',
};

export const PROJECT_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#8b5cf6', '#ef4444', '#64748b'];

export function initials(name = '?') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('');
}

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Days from today to a YYYY-MM-DD date (negative = past). */
export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date();
  const a = Date.UTC(y, m - 1, d);
  const b = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
  return Math.round((a - b) / 86400000);
}

export function dueInfo(task) {
  const n = daysUntil(task.due_date);
  if (n === null) return null;
  const done = task.status === 'done';
  const [y, m, d] = task.due_date.split('-').map(Number);
  const label = new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (done) return { label, tone: 'muted' };
  if (n < 0) return { label: n === -1 ? 'Yesterday' : `${-n}d overdue`, tone: 'danger', full: label };
  if (n === 0) return { label: 'Today', tone: 'warn' };
  if (n === 1) return { label: 'Tomorrow', tone: 'warn' };
  if (n <= 7) return { label, tone: 'soon' };
  return { label, tone: 'muted' };
}

export function timeAgo(ts) {
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Human-readable value of a task field (for history + conflict dialogs). */
export function displayValue(field, value, members = []) {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'status') return STATUS_LABEL[value] || value;
  if (field === 'priority') return PRIORITY_LABEL[value] || value;
  if (field === 'assignee_id') return members.find((m) => m.id === value)?.name || 'Former member';
  if (field === 'due_date') {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return String(value);
}

/** Position for a card dropped between `prev` and `next` (either may be missing). */
export function positionBetween(prev, next) {
  if (prev == null && next == null) return 1024;
  if (prev == null) return next / 2;
  if (next == null) return prev + 1024;
  return (prev + next) / 2;
}

export function cx(...parts) {
  return parts.filter(Boolean).join(' ');
}

// ---- Theme (light / dark / system) ----------------------------------------------
const THEME_KEY = 'teamflow_theme';
export function getTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'system'; } catch { return 'system'; }
}
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
}

/** Split a comment into text and @mention parts for members whose names appear. */
export function splitMentions(body, members = []) {
  const names = members.map((m) => m.name).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!names.length) return [{ text: body }];
  const esc = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`@(${esc.join('|')})`, 'g');
  const parts = [];
  let last = 0;
  for (const m of body.matchAll(re)) {
    if (m.index > last) parts.push({ text: body.slice(last, m.index) });
    parts.push({ mention: m[1] });
    last = m.index + m[0].length;
  }
  if (last < body.length) parts.push({ text: body.slice(last) });
  return parts;
}

export function isTypingTarget(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}
