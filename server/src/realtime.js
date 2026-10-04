import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { query } from './db.js';

/**
 * Real-time layer (serverless-friendly, no long-lived server needed).
 *
 * 1. Every change is written to the `events` table with a gap-free sequence
 *    number. Clients can always catch up from their cursor via
 *    GET /api/live/events?since=<seq>; this is the reliability backbone.
 * 2. The same events are pushed instantly through Supabase Realtime Broadcast
 *    (REST API) when SUPABASE_URL + keys are configured. If push is unavailable,
 *    clients fall back to short polling of the event log automatically.
 *
 * Writes still go through REST and broadcasts only describe committed state,
 * so a lost push can never lose data. Clients apply each event once (by seq)
 * and ignore task versions older than what they hold.
 */

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TOPIC_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

export const PRESENCE_TTL_SECONDS = 40;

export function pushConfig() {
  if (!SUPABASE_URL || !PUBLISHABLE_KEY || !SECRET_KEY) return null;
  return { url: SUPABASE_URL, key: PUBLISHABLE_KEY };
}

export function supabaseHeaders() {
  const h = { apikey: SECRET_KEY, 'Content-Type': 'application/json' };
  // Legacy service_role keys are JWTs and also go in Authorization.
  if (SECRET_KEY.startsWith('eyJ')) h.Authorization = `Bearer ${SECRET_KEY}`;
  return h;
}

/**
 * Channel names are unguessable capabilities (HMAC of the id), handed only to
 * members by the API. Data itself is always re-fetched/authorized via REST.
 */
export function topicFor(kind, id) {
  const sig = crypto.createHmac('sha256', TOPIC_SECRET).update(`${kind}:${id}`).digest('hex').slice(0, 24);
  return `tf-${kind}-${id}-${sig}`;
}

// ---- Per-request batching -----------------------------------------------------
// Events are recorded in order during a request and flushed (one Supabase call)
// right before the HTTP response is sent; serverless functions may freeze after
// responding, so nothing is left running in the background.
const als = new AsyncLocalStorage();

export function realtimeScope(_req, res, next) {
  const store = { chain: Promise.resolve(), messages: [] };
  const json = res.json.bind(res);
  res.json = (body) => {
    flush(store).finally(() => json(body));
    return res;
  };
  als.run(store, next);
}

async function flush(store) {
  await store.chain;
  if (store.messages.length) await push(store.messages.splice(0));
}

async function push(messages) {
  if (!pushConfig() || !messages.length) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: supabaseHeaders(),
      body: JSON.stringify({ messages: messages.map((m) => ({ ...m, private: false })) }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) console.warn('Realtime broadcast failed:', res.status, await res.text().catch(() => ''));
  } catch (err) {
    // Clients will still catch up from the event log.
    console.warn('Realtime broadcast error:', err.message);
  }
}

function record({ projectId = null, userId = null, event, payload }) {
  const work = async () => {
    const { rows } = await query(
      'INSERT INTO events (project_id, user_id, event, payload) VALUES ($1, $2, $3, $4) RETURNING seq',
      [projectId, userId, event, payload],
    );
    const seq = Number(rows[0].seq);
    if (seq % 500 === 0) query("DELETE FROM events WHERE created_at < now() - interval '2 days'").catch(() => {});
    return { topic: projectId ? topicFor('p', projectId) : topicFor('u', userId), event, payload: { ...payload, seq } };
  };
  const store = als.getStore();
  if (store) {
    store.chain = store.chain.then(work).then((m) => { store.messages.push(m); }).catch((e) => console.warn('event log:', e.message));
  } else {
    work().then((m) => push([m])).catch((e) => console.warn('event log:', e.message));
  }
}

/** Push-only message (presence, typing): not stored in the event log. */
export function pushEphemeral(projectId, event, payload) {
  const m = { topic: topicFor('p', projectId), event, payload: { projectId, ...payload } };
  const store = als.getStore();
  if (store) store.messages.push(m);
  else push([m]);
}

export function emitToProject(projectId, event, data) {
  record({ projectId, event, payload: { projectId, ...data } });
}

export function emitToUser(userId, event, data) {
  record({ userId, event, payload: data });
}

/** Deliver rows produced by common.notify() to each recipient. */
export function emitNotifications(list = []) {
  for (const { userId, notification } of list) emitToUser(userId, 'notification:new', { notification });
}

// Membership is checked when events are read, so these are no-ops now.
export function joinUserToProject() {}
export function leaveUserFromProject() {}
export function closeProjectRoom() {}

// ---- Presence (heartbeat rows) ---------------------------------------------------

export async function presenceSnapshot(projectId) {
  const [entries, online, typing] = await Promise.all([
    query(
      `SELECT DISTINCT ON (user_id, task_id) user_id AS "userId", task_id AS "taskId", field
         FROM presence
        WHERE project_id = $1 AND task_id IS NOT NULL AND updated_at > now() - make_interval(secs => $2)
        ORDER BY user_id, task_id, updated_at DESC`,
      [projectId, PRESENCE_TTL_SECONDS],
    ),
    query(
      `SELECT DISTINCT p.user_id FROM presence p
         JOIN project_members pm ON pm.user_id = p.user_id AND pm.project_id = $1
        WHERE p.updated_at > now() - make_interval(secs => $2)`,
      [projectId, PRESENCE_TTL_SECONDS],
    ),
    query(
      `SELECT DISTINCT ON (p.user_id) p.user_id AS "userId", u.name, p.typing_task_id AS "taskId"
         FROM presence p JOIN users u ON u.id = p.user_id
        WHERE p.project_id = $1 AND p.typing_task_id IS NOT NULL AND p.typing_at > now() - interval '4 seconds'
        ORDER BY p.user_id, p.typing_at DESC`,
      [projectId],
    ),
  ]);
  return {
    projectId,
    entries: entries.rows,
    onlineUserIds: online.rows.map((r) => r.user_id),
    typing: typing.rows,
  };
}

export async function presenceForProject(projectId) {
  return (await presenceSnapshot(projectId)).entries;
}

export async function onlineUserIdsFor(projectId) {
  return (await presenceSnapshot(projectId)).onlineUserIds;
}
