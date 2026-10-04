import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { useRealtime, useSocketEvents } from '../realtime.jsx';
import { STATUSES, PRIORITY_LABEL, STATUS_LABEL, dueInfo, cx } from '../utils.js';
import { Avatar, Empty, Spinner, Icon, useToast } from './ui.jsx';
import { ActivityRow } from './ActivityFeed.jsx';

export default function Dashboard({ user }) {
  const [data, setData] = useState(null);
  const [pulse, setPulse] = useState(false);
  const { resyncTick } = useRealtime();
  const toast = useToast();

  const load = useCallback(() => {
    api('/dashboard').then(setData).catch((e) => toast(e.message, 'error'));
  }, [toast]);

  useEffect(load, [load, resyncTick]);

  // Any change in any of my projects -> refresh (coalesced), with a subtle pulse.
  const timer = useRef(null);
  useSocketEvents(
    ['task:created', 'task:updated', 'task:deleted', 'activity:new', 'member:added', 'member:removed', 'project:created', 'project:deleted'],
    () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        load();
        setPulse(true);
        setTimeout(() => setPulse(false), 900);
      }, 300);
    },
  );
  useEffect(() => () => clearTimeout(timer.current), []);

  if (!data) return <div className="center-pad"><Spinner size={28} /></div>;
  const { totals, projects, myTasks, activity, trend, workload } = data;
  const pct = totals.total ? Math.round((totals.done / totals.total) * 100) : 0;

  return (
    <div className={cx('dashboard', pulse && 'pulse')}>
      {/* Workspace Greeting Header */}
      <div className="dash-hello">
        <div className="dash-hello-main">
          <h1>
            Good {greeting()}, {user.name.split(' ')[0]}
          </h1>
          <p>
            {totals.mine_open ? (
              <>
                You have <b>{totals.mine_open}</b> open task{totals.mine_open === 1 ? '' : 's'} across{' '}
                <b>{projects.length}</b> active project{projects.length === 1 ? '' : 's'}.
              </>
            ) : (
              'You have no open tasks assigned. All items on track!'
            )}
          </p>
        </div>
        <div className="dash-hello-right">
          <div className="dash-quick-badge">
            <Icon name="zap" size={14} />
            <span>{pct}% Total Sprint Done</span>
          </div>
        </div>
      </div>

      {/* KPI Tiles */}
      <div className="tiles">
        <Tile
          label="Overall Progress"
          value={`${pct}%`}
          sub={`${totals.done} of ${totals.total} tasks completed`}
          meter={pct}
          icon="trendingUp"
        />
        <Tile
          label="In Progress"
          value={totals.in_progress}
          sub={`${totals.review} in review`}
          icon="clock"
        />
        <Tile
          label="Shipped (7 days)"
          value={totals.completed_week}
          sub="tasks shipped this week"
          tone="good"
          icon="check"
        />
        <Tile
          label="Due in 7 days"
          value={totals.due_soon}
          sub="open tasks upcoming"
          tone={totals.due_soon ? 'warn' : undefined}
          icon="calendar"
        />
        <Tile
          label="Overdue"
          value={totals.overdue}
          sub={totals.overdue ? 'requires immediate focus' : 'all items on track'}
          tone={totals.overdue ? 'danger' : 'good'}
          icon="alert"
        />
      </div>

      {/* Grid Content */}
      <div className="dash-grid">
        {/* Task Velocity Chart */}
        <section className="panel span-2">
          <div className="panel-head">
            <h2>
              <Icon name="barChart" size={18} /> Task Velocity (Last 14 Days)
            </h2>
            <div className="legend">
              <span className="legend-badge lg-created-badge"><i className="lg-created" /> Created</span>
              <span className="legend-badge lg-done-badge"><i className="lg-done" /> Completed</span>
            </div>
          </div>
          <TrendChart trend={trend} />
          <StatusBar totals={totals} />
        </section>

        {/* My Tasks */}
        <section className="panel">
          <div className="panel-head">
            <h2>
              <Icon name="target" size={18} /> My Assigned Tasks
            </h2>
            <span className="count-pill">{myTasks.length}</span>
          </div>
          {myTasks.length === 0 ? (
            <Empty title="No tasks assigned to you">
              All items are completed or on track! ✨
            </Empty>
          ) : (
            <ul className="mytasks">
              {myTasks.map((t) => {
                const due = dueInfo(t);
                return (
                  <li
                    key={t.id}
                    className="mytask-item"
                    onClick={() => navigate(`/p/${t.project_id}/t/${t.id}`)}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && navigate(`/p/${t.project_id}/t/${t.id}`)}
                  >
                    <span className={`prio-bar prio-${t.priority}`} title={PRIORITY_LABEL[t.priority]} />
                    <div className="mt-main">
                      <div className="mt-top-row">
                        <span className="mt-title">{t.title}</span>
                        <span className={cx('status-badge', `st-${t.status}`)}>
                          {STATUS_LABEL[t.status]}
                        </span>
                      </div>
                      <span className="mt-meta">
                        <span className="proj-dot" style={{ background: t.project_color }} />
                        {t.project_name}
                      </span>
                    </div>
                    {due && <span className={`due due-${due.tone}`}>{due.label}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Project Workspaces Progress */}
        <section className="panel span-2">
          <div className="panel-head">
            <h2>
              <Icon name="layers" size={18} /> Project Workspaces
            </h2>
            <a href="#/" className="panel-link">View All</a>
          </div>
          {projects.length === 0 ? (
            <Empty title="No active projects">Create your first project from the sidebar.</Empty>
          ) : (
            <div className="proj-rows">
              {projects.map((p) => {
                const ppct = p.task_count ? Math.round((p.done_count / p.task_count) * 100) : 0;
                return (
                  <a key={p.id} className="proj-row" href={`#/p/${p.id}`}>
                    <span className="proj-dot lg" style={{ background: p.color, boxShadow: `0 0 10px ${p.color}40` }} />
                    <div className="pr-main">
                      <div className="pr-top">
                        <b>{p.name}</b>
                        <span className="pr-pct">{ppct}%</span>
                      </div>
                      <div className="meter">
                        <span style={{ width: `${ppct}%`, background: p.color }} />
                      </div>
                      <div className="pr-meta">
                        {p.done_count}/{p.task_count} completed · {p.in_progress_count} in progress · {p.member_count} member{p.member_count === 1 ? '' : 's'}
                        {p.overdue_count > 0 && <span className="text-danger"> · {p.overdue_count} overdue</span>}
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </section>

        {/* Team Workload */}
        <section className="panel">
          <div className="panel-head">
            <h2>
              <Icon name="users" size={18} /> Team Workload
            </h2>
            <span className="muted">Open tasks</span>
          </div>
          {workload.length === 0 ? (
            <Empty title="No assigned work yet" />
          ) : (
            <ul className="workload">
              {workload.map((w) => {
                const max = Math.max(...workload.map((x) => x.open), 1);
                return (
                  <li key={w.id}>
                    <Avatar user={w} size={26} />
                    <span className="wl-name">{w.name}</span>
                    <div className="wl-bar">
                      <span style={{ width: `${(w.open / max) * 100}%`, background: w.color || 'var(--accent)' }} />
                    </div>
                    <span className="wl-num">
                      {w.open}
                      {w.overdue > 0 && <em className="text-danger" title="Overdue tasks"> ({w.overdue}!)</em>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Live Activity Feed */}
        <section className="panel span-3">
          <div className="panel-head">
            <h2>
              <Icon name="activity" size={18} /> Live Activity Feed
            </h2>
            <span className="live-tag">
              <span className="conn-dot" /> Live Push
            </span>
          </div>
          {activity.length === 0 ? (
            <Empty title="No recent activity logged" />
          ) : (
            <ul className="activity">
              {activity.slice(0, 12).map((a) => (
                <ActivityRow
                  key={a.id}
                  a={a}
                  showProject
                  onClick={a.task_id && a.type !== 'task_deleted' ? () => navigate(`/p/${a.project_id}/t/${a.task_id}`) : () => navigate(`/p/${a.project_id}`)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

function Tile({ label, value, sub, tone, meter, icon }) {
  const isFeature = label === 'Overall Progress';
  const iconClass = tone ? `tile-icon-bg tile-icon-${tone}` : 'tile-icon-bg tile-icon-primary';
  return (
    <div className={cx('tile', isFeature && 'tile-feature', tone && `tile-${tone}`)}>
      <div className="tile-top">
        <span className="tile-label">{label}</span>
        {icon && (
          <div className={iconClass}>
            <Icon name={icon} size={15} />
          </div>
        )}
      </div>
      <div className="tile-value-row">
        <span className="tile-value">{value}</span>
      </div>
      {meter !== undefined && (
        <div className="meter sm tile-meter">
          <span style={{ width: `${meter}%` }} />
        </div>
      )}
      <span className="tile-sub">{sub}</span>
    </div>
  );
}

function StatusBar({ totals }) {
  const total = totals.total || 1;
  return (
    <div className="statusbar-wrap">
      <div className="statusbar">
        {STATUSES.map((s) => totals[s.id] > 0 && (
          <span key={s.id} style={{ flex: totals[s.id] / total, background: s.color }} title={`${s.label}: ${totals[s.id]}`} />
        ))}
      </div>
      <div className="statusbar-legend">
        {STATUSES.map((s) => (
          <span key={s.id}>
            <i style={{ background: s.color }} />
            {s.label} <b>{totals[s.id]}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function TrendChart({ trend }) {
  const [hover, setHover] = useState(null);
  const W = 640, H = 160, P = { l: 28, r: 12, t: 16, b: 24 };
  const max = Math.max(2, ...trend.map((d) => Math.max(d.created, d.completed)));
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const bw = iw / trend.length;
  const y = (v) => P.t + ih - (v / max) * ih;
  const ticks = [0, Math.ceil(max / 2), max];
  return (
    <div className="trend">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Tasks created and completed per day">
        <defs>
          <linearGradient id="grad-created" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#818cf8" stopOpacity="0.75" />
          </linearGradient>
          <linearGradient id="grad-done" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#34d399" stopOpacity="0.75" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={P.l - 8} y={y(t) + 4} className="axis" textAnchor="end">{t}</text>
          </g>
        ))}
        {trend.map((d, i) => {
          const x = P.l + i * bw;
          const w = Math.min(12, Math.max(4, bw / 3));
          const createdH = Math.max(3, P.t + ih - y(d.created));
          const completedH = Math.max(3, P.t + ih - y(d.completed));
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className="chart-bar-group">
              <rect x={x} y={P.t} width={bw} height={ih} className={hover === i ? 'hover-band on' : 'hover-band'} />
              <rect x={x + bw / 2 - w - 1} y={y(d.created)} width={w} height={createdH} rx="3" ry="3" fill="url(#grad-created)" className="bar-created" />
              <rect x={x + bw / 2 + 1} y={y(d.completed)} width={w} height={completedH} rx="3" ry="3" fill="url(#grad-done)" className="bar-done" />
              {(i % 2 === 1 || trend.length < 8) && (
                <text x={x + bw / 2} y={H - 6} className="axis" textAnchor="middle">{d.day.slice(8)}</text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="trend-tip" style={{ left: `${((hover + 0.5) / trend.length) * 100}%` }}>
          <b>{new Date(`${trend[hover].day}T00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</b>
          <span><i className="tip-dot created" /> {trend[hover].created} created</span>
          <span><i className="tip-dot completed" /> {trend[hover].completed} completed</span>
        </div>
      )}
    </div>
  );
}
