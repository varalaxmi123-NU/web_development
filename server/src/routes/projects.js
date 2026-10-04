import { Router } from 'express';
import { query, tx } from '../db.js';
import {
  h, HttpError, requireMember, assertUuid, logActivity, loadTask, TASK_SELECT, ACTIVITY_SELECT,
} from '../common.js';
import {
  emitToProject, emitToUser, joinUserToProject, closeProjectRoom, presenceSnapshot,
  leaveUserFromProject,
} from '../realtime.js';
import { removeStoredFiles } from '../storage.js';

export const projectsRouter = Router();

export const PROJECT_LIST_SQL = `
  SELECT p.*, pm.role,
         count(t.id)::int                                                         AS task_count,
         count(t.id) FILTER (WHERE t.status = 'done')::int                        AS done_count,
         count(t.id) FILTER (WHERE t.status = 'in_progress')::int                 AS in_progress_count,
         count(t.id) FILTER (WHERE t.due_date < current_date AND t.status <> 'done')::int AS overdue_count,
         (SELECT count(*)::int FROM project_members m WHERE m.project_id = p.id)  AS member_count
    FROM projects p
    JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1
    LEFT JOIN tasks t ON t.project_id = p.id`;

async function projectSummary(projectId, userId) {
  const { rows } = await query(`${PROJECT_LIST_SQL} WHERE p.id = $2 GROUP BY p.id, pm.role`, [
    userId,
    projectId,
  ]);
  return rows[0];
}

projectsRouter.get('/', h(async (req, res) => {
  const { rows } = await query(`${PROJECT_LIST_SQL} GROUP BY p.id, pm.role ORDER BY p.created_at`, [req.user.id]);
  res.json({ projects: rows });
}));

projectsRouter.post('/', h(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw new HttpError(400, 'Project name is required');
  if (name.length > 120) throw new HttpError(400, 'Project name is too long');
  const description = String(req.body.description || '').slice(0, 2000);
  const color = /^#[0-9a-f]{6}$/i.test(req.body.color || '') ? req.body.color : '#6366f1';

  const { project, activity } = await tx(async (c) => {
    const { rows } = await c.query(
      'INSERT INTO projects (name, description, color, owner_id) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, description, color, req.user.id],
    );
    await c.query("INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner')", [
      rows[0].id,
      req.user.id,
    ]);
    const act = await logActivity(c, {
      projectId: rows[0].id, userId: req.user.id, type: 'project_created', payload: { name },
    });
    return { project: rows[0], activity: act };
  });

  joinUserToProject(req.user.id, project.id);
  const summary = await projectSummary(project.id, req.user.id);
  emitToProject(project.id, 'project:created', { project: summary });
  emitToProject(project.id, 'activity:new', { activity });
  res.status(201).json({ project: summary });
}));

projectsRouter.get('/:id', h(async (req, res) => {
  const projectId = req.params.id;
  const role = await requireMember(projectId, req.user.id);
  const [summary, members, tasks, live] = await Promise.all([
    projectSummary(projectId, req.user.id),
    query(
      `SELECT u.id, u.name, u.email, u.color, pm.role, pm.joined_at
         FROM project_members pm JOIN users u ON u.id = pm.user_id
        WHERE pm.project_id = $1 ORDER BY pm.joined_at`,
      [projectId],
    ),
    query(`${TASK_SELECT} WHERE t.project_id = $1 ORDER BY t.status, t.position`, [projectId]),
    presenceSnapshot(projectId),
  ]);
  res.json({
    project: { ...summary, role },
    members: members.rows,
    tasks: tasks.rows,
    onlineUserIds: live.onlineUserIds,
    presence: live.entries,
  });
}));

projectsRouter.patch('/:id', h(async (req, res) => {
  const projectId = req.params.id;
  await requireMember(projectId, req.user.id);
  const sets = [];
  const vals = [];
  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name) throw new HttpError(400, 'Project name is required');
    vals.push(name.slice(0, 120));
    sets.push(`name = $${vals.length}`);
  }
  if (req.body.description !== undefined) {
    vals.push(String(req.body.description).slice(0, 2000));
    sets.push(`description = $${vals.length}`);
  }
  if (req.body.color !== undefined && /^#[0-9a-f]{6}$/i.test(req.body.color)) {
    vals.push(req.body.color);
    sets.push(`color = $${vals.length}`);
  }
  if (!sets.length) throw new HttpError(400, 'Nothing to update');
  vals.push(projectId);
  await query(`UPDATE projects SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length}`, vals);
  const summary = await projectSummary(projectId, req.user.id);
  emitToProject(projectId, 'project:updated', { project: summary });
  res.json({ project: summary });
}));

projectsRouter.delete('/:id', h(async (req, res) => {
  const projectId = req.params.id;
  const role = await requireMember(projectId, req.user.id);
  if (role !== 'owner') throw new HttpError(403, 'Only the project owner can delete it');
  const files = await query(
    'SELECT a.stored_name, a.storage FROM attachments a JOIN tasks t ON t.id = a.task_id WHERE t.project_id = $1',
    [projectId],
  );
  await query('DELETE FROM projects WHERE id = $1', [projectId]);
  emitToProject(projectId, 'project:deleted', { by: req.user });
  closeProjectRoom(projectId);
  await removeStoredFiles(files.rows);
  res.json({ ok: true });
}));

// ---- Members ---------------------------------------------------------------

projectsRouter.post('/:id/members', h(async (req, res) => {
  const projectId = req.params.id;
  await requireMember(projectId, req.user.id);
  const email = String(req.body.email || '').trim().toLowerCase();
  const { rows } = await query('SELECT id, name, email, color FROM users WHERE email = $1', [email]);
  const user = rows[0];
  if (!user) throw new HttpError(404, 'No account with that email yet. Ask them to sign up first.');

  const result = await tx(async (c) => {
    const ins = await c.query(
      `INSERT INTO project_members (project_id, user_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING RETURNING role, joined_at`,
      [projectId, user.id],
    );
    if (!ins.rowCount) throw new HttpError(409, `${user.name} is already a member`);
    const act = await logActivity(c, {
      projectId, userId: req.user.id, type: 'member_added', payload: { name: user.name },
    });
    return { member: { ...user, ...ins.rows[0] }, activity: act };
  });

  joinUserToProject(user.id, projectId);
  emitToProject(projectId, 'member:added', { member: result.member });
  emitToProject(projectId, 'activity:new', { activity: result.activity });
  // Tell the new member's open sessions so the project appears in their sidebar.
  const summary = await projectSummary(projectId, user.id);
  emitToUser(user.id, 'project:created', { projectId, project: summary });
  res.status(201).json({ member: result.member });
}));

projectsRouter.delete('/:id/members/:userId', h(async (req, res) => {
  const { id: projectId, userId } = req.params;
  assertUuid(userId, 'Member');
  const role = await requireMember(projectId, req.user.id);
  if (role !== 'owner' && userId !== req.user.id)
    throw new HttpError(403, 'Only the owner can remove other members');

  const { updatedIds, activity } = await tx(async (c) => {
    const target = await c.query(
      'SELECT pm.role, u.name FROM project_members pm JOIN users u ON u.id = pm.user_id WHERE project_id = $1 AND user_id = $2',
      [projectId, userId],
    );
    if (!target.rowCount) throw new HttpError(404, 'Member not found');
    if (target.rows[0].role === 'owner') throw new HttpError(400, 'The owner cannot be removed');
    await c.query('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
    // Unassign their tasks. Bumping version keeps concurrent editors honest.
    const upd = await c.query(
      `UPDATE tasks SET assignee_id = NULL, version = version + 1, updated_at = now(), updated_by = $3
        WHERE project_id = $1 AND assignee_id = $2 RETURNING id`,
      [projectId, userId, req.user.id],
    );
    const act = await logActivity(c, {
      projectId, userId: req.user.id, type: 'member_removed', payload: { name: target.rows[0].name },
    });
    return { updatedIds: upd.rows.map((r) => r.id), activity: act };
  });

  for (const id of updatedIds) {
    const task = await loadTask(id);
    emitToProject(projectId, 'task:updated', { task, by: req.user, fields: ['assignee_id'] });
  }
  emitToProject(projectId, 'member:removed', { userId });
  leaveUserFromProject(userId, projectId);
  emitToUser(userId, 'project:removed', { projectId });
  emitToProject(projectId, 'activity:new', { activity });
  res.json({ ok: true });
}));

// ---- Activity --------------------------------------------------------------

projectsRouter.get('/:id/activity', h(async (req, res) => {
  const projectId = req.params.id;
  await requireMember(projectId, req.user.id);
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const before = Number(req.query.before) || null;
  const { rows } = await query(
    `${ACTIVITY_SELECT} WHERE a.project_id = $1 AND ($2::bigint IS NULL OR a.id < $2)
      ORDER BY a.id DESC LIMIT $3`,
    [projectId, before, limit],
  );
  res.json({ activity: rows });
}));
