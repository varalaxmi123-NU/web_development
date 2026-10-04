import { query } from './db.js';

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** Wrap an async route so thrown errors reach the error middleware. */
export const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

export function assertUuid(v, what = 'Resource') {
  if (!isUuid(v)) throw new HttpError(404, `${what} not found`);
}

/** Throws 403/404 unless userId is a member. Returns the member's role. */
export async function requireMember(projectId, userId, db = { query }) {
  assertUuid(projectId, 'Project');
  const { rows } = await db.query(
    `SELECT pm.role FROM projects p
       LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $2
      WHERE p.id = $1`,
    [projectId, userId],
  );
  if (!rows[0]) throw new HttpError(404, 'Project not found');
  if (!rows[0].role) throw new HttpError(403, 'You are not a member of this project');
  return rows[0].role;
}

export async function memberIds(projectId, db = { query }) {
  const { rows } = await db.query('SELECT user_id FROM project_members WHERE project_id = $1', [projectId]);
  return rows.map((r) => r.user_id);
}

export const TASK_SELECT = `
  SELECT t.*,
         (SELECT count(*)::int FROM comments c WHERE c.task_id = t.id)    AS comment_count,
         (SELECT count(*)::int FROM attachments a WHERE a.task_id = t.id) AS attachment_count,
         (SELECT count(*)::int FROM checklist_items ci WHERE ci.task_id = t.id) AS checklist_total,
         (SELECT count(*)::int FROM checklist_items ci WHERE ci.task_id = t.id AND ci.done) AS checklist_done
    FROM tasks t`;

export const NOTIFICATION_SELECT = `
  SELECT n.id, n.type, n.payload, n.read_at, n.created_at, n.project_id, n.task_id,
         json_build_object('id', u.id, 'name', u.name, 'color', u.color) AS actor,
         p.name AS project_name, p.color AS project_color
    FROM notifications n
    LEFT JOIN users u ON u.id = n.actor_id
    LEFT JOIN projects p ON p.id = n.project_id`;

/**
 * Insert notifications for each recipient (never the actor themself, never
 * duplicates). Returns full rows; emit them after the transaction commits.
 */
export async function notify(db, { recipients, actorId, projectId, taskId = null, type, payload = {} }) {
  const out = [];
  for (const userId of new Set(recipients.filter((id) => id && id !== actorId))) {
    const { rows } = await db.query(
      `INSERT INTO notifications (user_id, actor_id, project_id, task_id, type, payload)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, user_id`,
      [userId, actorId, projectId, taskId, type, payload],
    );
    const full = await db.query(`${NOTIFICATION_SELECT} WHERE n.id = $1`, [rows[0].id]);
    out.push({ userId, notification: full.rows[0] });
  }
  return out;
}

export async function loadTask(taskId, db = { query }) {
  const { rows } = await db.query(`${TASK_SELECT} WHERE t.id = $1`, [taskId]);
  return rows[0] || null;
}

export const ACTIVITY_SELECT = `
  SELECT a.id, a.project_id, a.task_id, a.type, a.payload, a.created_at,
         json_build_object('id', u.id, 'name', u.name, 'color', u.color) AS user,
         p.name AS project_name, p.color AS project_color
    FROM activity a
    LEFT JOIN users u ON u.id = a.user_id
    JOIN projects p ON p.id = a.project_id`;

/** Insert an activity row and return it in the same shape clients receive. */
export async function logActivity(db, { projectId, taskId = null, userId, type, payload = {} }) {
  const { rows } = await db.query(
    `INSERT INTO activity (project_id, task_id, user_id, type, payload)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [projectId, taskId, userId, type, payload],
  );
  const full = await db.query(`${ACTIVITY_SELECT} WHERE a.id = $1`, [rows[0].id]);
  return full.rows[0];
}

/** Trim long text values so activity payloads stay small. */
export function clip(v, n = 280) {
  if (typeof v !== 'string') return v;
  return v.length > n ? `${v.slice(0, n)}…` : v;
}
