import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { useRealtime, useSocketEvents } from '../realtime.jsx';
import { STATUSES, PRIORITY_LABEL, STATUS_LABEL, dueInfo, cx } from '../utils.js';
import { Avatar, Empty, Spinner, useToast } from './ui.jsx';
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

  if (!data) return <div className="center-pad"><Spinner size={24} /></div>;
  const { totals, projects, myTasks, activity, trend, workload } = data;
  const pct = totals.total ? Math.round((totals.done / totals.total) * 100) : 0;

  return (
    <div className={cx('dashboard', pulse && 'pulse')}>
      <div className="dash-hello">
        <div>
          <h1>Good {greeting()}, {user.name.split(' ')[0]}</h1>
          <p>
            {totals.mine_open
              ? <>You have <b>{totals.mine_open}</b> open task{totals.mine_open === 1 ? '' : 's'} across {projects.length} project{projects.length === 1 ? '' : 's'}.</>
              : 'You have no open tasks assigned. Nice.'}
          </p>
        </div>
      </div>

      <div className="tiles">
        <Tile label="Overall progress" value={`${pct}%`} sub={`${totals.done} of ${totals.total} tasks done`} meter={pct} />
        <Tile label="In progress" value={totals.in_progress} sub={`${totals.review} in review`} />
        <Tile label="Completed (7 days)" value={totals.completed_week} sub="tasks shipped this week" tone="good" />
        <Tile label="Due in 7 days" value={totals.due_soon} sub="open tasks" tone={totals.due_soon ? 'warn' : undefined} />
        <Tile label="Overdue" value={totals.overdue} sub={totals.overdue ? 'need attention' : 'all on track'} tone={totals.overdue ? 'danger' : 'good'} />
      </div>

      <div className="dash-grid">
        <section className="panel span-2">
          <div className="panel-head"><h2>Task flow, last 14 days</h2>
            <div className="legend"><span><i className="lg-created" />Created</span><span><i className="lg-done" />Completed</span></div>
          </div>
          <TrendChart trend={trend} />
          <StatusBar totals={totals} />
        </section>

        <section className="panel">
          <div className="panel-head"><h2>My tasks</h2><span className="muted">{myTasks.length}</span></div>
          {myTasks.length === 0 ? <Empty title="Nothing assigned to you" /> : (
            <ul className="mytasks">
              {myTasks.map((t) => {
                const due = dueInfo(t);
                return (
                  <li key={t.id} onClick={() => navigate(`/p/${t.project_id}/t/${t.id}`)} tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && navigate(`/p/${t.project_id}/t/${t.id}`)}>
                    <span className={`prio-bar prio-${t.priority}`} title={PRIORITY_LABEL[t.priority]} />
                    <div className="mt-main">
                      <span className="mt-title">{t.title}</span>
                      <span className="mt-meta"><span className="proj-dot" style={{ background: t.project_color }} />{t.project_name} · {STATUS_LABEL[t.status]}</span>
                    </div>
                    {due && <span className={`due due-${due.tone}`}>{due.label}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="panel span-2">
          <div className="panel-head"><h2>Projects</h2></div>
          {projects.length === 0 ? <Empty title="No projects yet">Create one from the sidebar.</Empty> : (
            <div className="proj-rows">
              {projects.map((p) => {
                const ppct = p.task_count ? Math.round((p.done_count / p.task_count) * 100) : 0;
                return (
                  <a key={p.id} className="proj-row" href={`#/p/${p.id}`}>
                    <span className="proj-dot lg" style={{ background: p.color }} />
                    <div className="pr-main">
                      <div className="pr-top"><b>{p.name}</b><span>{ppct}%</span></div>
                      <div className="meter"><span style={{ width: `${ppct}%`, background: p.color }} /></div>
                      <div className="pr-meta">
                        {p.done_count}/{p.task_count} done · {p.in_progress_count} in progress · {p.member_count} member{p.member_count === 1 ? '' : 's'}
                        {p.overdue_count > 0 && <span className="text-danger"> · {p.overdue_count} overdue</span>}
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head"><h2>Team workload</h2><span className="muted">open tasks</span></div>
          {workload.length === 0 ? <Empty title="No assigned work yet" /> : (
            <ul className="workload">
              {workload.map((w) => {
                const max = Math.max(...workload.map((x) => x.open), 1);
                return (
                  <li key={w.id}>
                    <Avatar user={w} size={24} />
                    <span className="wl-name">{w.name}</span>
                    <div className="wl-bar"><span style={{ width: `${(w.open / max) * 100}%`, background: w.color }} /></div>
                    <span className="wl-num">{w.open}{w.overdue > 0 && <em className="text-danger" title="overdue"> ({w.overdue}!)</em>}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="panel span-3">
          <div className="panel-head"><h2>Recent activity</h2><span className="live-tag"><span className="conn-dot" />live</span></div>
          {activity.length === 0 ? <Empty title="Quiet so far" /> : (
            <ul className="activity">
              {activity.slice(0, 12).map((a) => (
                <ActivityRow key={a.id} a={a} showProject
                  onClick={a.task_id && a.type !== 'task_deleted' ? () => navigate(`/p/${a.project_id}/t/${a.task_id}`) : () => navigate(`/p/${a.project_id}`)} />
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

function Tile({ label, value, sub, tone, meter }) {
  return (
    <div className={cx('tile', tone && `tile-${tone}`)}>
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
      {meter !== undefined && <div className="meter sm"><span style={{ width: `${meter}%` }} /></div>}
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
          <span key={s.id}><i style={{ background: s.color }} />{s.label} <b>{totals[s.id]}</b></span>
        ))}
      </div>
    </div>
  );
}

function TrendChart({ trend }) {
  const [hover, setHover] = useState(null);
  const W = 640, H = 150, P = { l: 24, r: 8, t: 10, b: 22 };
  const max = Math.max(2, ...trend.map((d) => Math.max(d.created, d.completed)));
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const bw = iw / trend.length;
  const y = (v) => P.t + ih - (v / max) * ih;
  const ticks = [0, Math.ceil(max / 2), max];
  return (
    <div className="trend">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Tasks created and completed per day">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={P.l - 6} y={y(t) + 3} className="axis" textAnchor="end">{t}</text>
          </g>
        ))}
        {trend.map((d, i) => {
          const x = P.l + i * bw;
          const w = Math.min(10, bw / 3);
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={x} y={P.t} width={bw} height={ih} className={hover === i ? 'hover-band on' : 'hover-band'} />
              <rect x={x + bw / 2 - w - 1} y={y(d.created)} width={w} height={P.t + ih - y(d.created)} rx="2" className="bar-created" />
              <rect x={x + bw / 2 + 1} y={y(d.completed)} width={w} height={P.t + ih - y(d.completed)} rx="2" className="bar-done" />
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
          <span>{trend[hover].created} created · {trend[hover].completed} completed</span>
        </div>
      )}
    </div>
  );
}
