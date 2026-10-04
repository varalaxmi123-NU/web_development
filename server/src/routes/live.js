import { Router } from 'express';
import { query } from '../db.js';
import { h, HttpError, isUuid } from '../common.js';
import {
  pushConfig, topicFor, presenceSnapshot, pushEphemeral, PRESENCE_TTL_SECONDS,
} from '../realtime.js';

export const liveRouter = Router();

const MY_PROJECTS = 'SELECT project_id FROM project_members WHERE user_id = $1';

/** How this browser should receive live updates. */
liveRouter.get('/config', h(async (req, res) => {
  const { rows } = await query(MY_PROJECTS, [req.user.id]);
  res.json({
    push: pushConfig(), // { url, key } for Supabase Realtime, or null → polling only
    topics: {
      user: topicFor('u', req.user.id),
      projects: Object.fromEntries(rows.map((r) => [r.project_id, topicFor('p', r.project_id)])),
    },
  });
}));

/**
 * Gap-free catch-up: every event for my projects (and me) after `since`.
 * since=-1 just returns the current cursor. Optional ?project=<id> adds that
 * project's presence (who's online / viewing / typing).
 */
liveRouter.get('/events', h(async (req, res) => {
  const since = Number(req.query.since);
  if (!Number.isFinite(since)) throw new HttpError(400, 'since must be a number');
  let events = [];
  let cursor = since;
  let more = false;
  if (since < 0) {
    const { rows } = await query('SELECT COALESCE(MAX(seq), 0)::bigint AS seq FROM events');
    cursor = Number(rows[0].seq);
  } else {
    const LIMIT = 300;
    const { rows } = await query(
      `SELECT seq, event, payload FROM events
        WHERE seq > $2 AND (project_id IN (${MY_PROJECTS}) OR user_id = $1)
        ORDER BY seq LIMIT ${LIMIT}`,
      [req.user.id, since],
    );
    events = rows.map((r) => ({ seq: Number(r.seq), event: r.event, payload: { ...r.payload, seq: Number(r.seq) } }));
    if (rows.length) cursor = events[events.length - 1].seq;
    more = rows.length === LIMIT;
  }

  let presence = null;
  const projectId = req.query.project;
  if (isUuid(projectId)) {
    const member = await query('SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, req.user.id]);
    if (member.rowCount) presence = await presenceSnapshot(projectId);
  }
  res.json({ events, cursor, more, presence });
}));

const validSession = (s) => typeof s === 'string' && /^[\w-]{8,64}$/.test(s);

/** Heartbeat + "what I'm looking at". Called on change and every ~20s. */
liveRouter.post('/presence', h(async (req, res) => {
  const { sessionId } = req.body || {};
  if (!validSession(sessionId)) throw new HttpError(400, 'Invalid session');
  let projectId = isUuid(req.body.projectId) ? req.body.projectId : null;
  if (projectId) {
    const m = await query('SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, req.user.id]);
    if (!m.rowCount) projectId = null;
  }
  const taskId = projectId && isUuid(req.body.taskId) ? req.body.taskId : null;
  const field = taskId && typeof req.body.field === 'string' ? req.body.field.slice(0, 40) : null;

  const prev = (await query(
    `SELECT project_id, task_id, field, updated_at < now() - make_interval(secs => $2) AS stale
       FROM presence WHERE session_id = $1`,
    [sessionId, PRESENCE_TTL_SECONDS],
  )).rows[0];

  await query(
    `INSERT INTO presence (session_id, user_id, project_id, task_id, field, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (session_id) DO UPDATE
       SET user_id = EXCLUDED.user_id, project_id = EXCLUDED.project_id, task_id = EXCLUDED.task_id,
           field = EXCLUDED.field, updated_at = now(),
           typing_task_id = CASE WHEN presence.project_id IS DISTINCT FROM EXCLUDED.project_id THEN NULL ELSE presence.typing_task_id END`,
    [sessionId, req.user.id, projectId, taskId, field],
  );

  const changed = !prev || prev.stale || prev.project_id !== projectId || prev.task_id !== taskId || prev.field !== field;
  if (changed) {
    const projects = new Set([projectId, prev?.project_id].filter(Boolean));
    for (const p of projects) pushEphemeral(p, 'presence:update', await presenceSnapshot(p));
  }
  if (Math.random() < 0.02) query("DELETE FROM presence WHERE updated_at < now() - interval '10 minutes'").catch(() => {});
  res.json({ ok: true });
}));

/** "Priya is typing…" (ephemeral). */
liveRouter.post('/typing', h(async (req, res) => {
  const { sessionId, projectId, taskId } = req.body || {};
  if (!validSession(sessionId) || !isUuid(projectId) || !isUuid(taskId)) throw new HttpError(400, 'Invalid typing event');
  const { rowCount } = await query(
    `UPDATE presence SET typing_task_id = $3, typing_at = now(), updated_at = now()
      WHERE session_id = $1 AND user_id = $2 AND project_id = $4`,
    [sessionId, req.user.id, taskId, projectId],
  );
  if (rowCount) pushEphemeral(projectId, 'typing', { taskId, userId: req.user.id, name: req.user.name });
  res.json({ ok: true });
}));

/** Tab closed (sent with navigator.sendBeacon, so no auth header). */
export async function presenceLeave(req, res) {
  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body || '{}');
    const sessionId = body?.sessionId;
    if (validSession(sessionId)) {
      const { rows } = await query('DELETE FROM presence WHERE session_id = $1 RETURNING project_id', [sessionId]);
      if (rows[0]?.project_id) pushEphemeral(rows[0].project_id, 'presence:update', await presenceSnapshot(rows[0].project_id));
    }
  } catch { /* best effort */ }
  res.json({ ok: true });
}
