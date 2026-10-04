import { Router } from 'express';
import { query } from '../db.js';
import { h, NOTIFICATION_SELECT } from '../common.js';
import { emitToUser } from '../realtime.js';

export const notificationsRouter = Router();

notificationsRouter.get('/', h(async (req, res) => {
  const [list, unread] = await Promise.all([
    query(`${NOTIFICATION_SELECT} WHERE n.user_id = $1 ORDER BY n.id DESC LIMIT 40`, [req.user.id]),
    query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [req.user.id]),
  ]);
  res.json({ notifications: list.rows, unread: unread.rows[0].n });
}));

/** Body: { ids: [..] } to mark some, or {} to mark all as read. */
notificationsRouter.post('/read', h(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : null;
  if (ids) {
    await query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2::bigint[]) AND read_at IS NULL', [req.user.id, ids]);
  } else {
    await query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
  }
  const { rows } = await query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
  // Keep the badge in sync across the user's other tabs/devices.
  emitToUser(req.user.id, 'notification:read', { ids, unread: rows[0].n });
  res.json({ ok: true, unread: rows[0].n });
}));
