import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { query, tx } from '../db.js';
import {
  h, HttpError, requireMember, memberIds, assertUuid, loadTask, logActivity, clip, ACTIVITY_SELECT, notify,
} from '../common.js';
import { mergeTaskUpdate, validateTaskFields, EDITABLE_FIELDS } from '../merge.js';
import { emitToProject, emitNotifications } from '../realtime.js';
import {
  storageMode, uploadDir, ensureUploadDir, createSignedUpload, objectExists, signedDownloadUrl, removeStoredFiles,
} from '../storage.js';

export const tasksRouter = Router();

const MAX_UPLOAD_BYTES = (Number(process.env.MAX_UPLOAD_MB) || 10) * 1024 * 1024;

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => { ensureUploadDir(); cb(null, uploadDir()); },
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).slice(0, 16)}`),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

async function taskProject(taskId, userId, db) {
  assertUuid(taskId, 'Task');
  const { rows } = await (db || { query }).query('SELECT project_id FROM tasks WHERE id = $1', [taskId]);
  if (!rows[0]) throw new HttpError(404, 'Task not found');
  await requireMember(rows[0].project_id, userId, db || undefined);
  return rows[0].project_id;
}

// ---- Create ----------------------------------------------------------------

tasksRouter.post('/projects/:projectId/tasks', h(async (req, res) => {
  const { projectId } = req.params;
  await requireMember(projectId, req.user.id);
  const b = req.body || {};
  const fields = {
    title: String(b.title || '').trim(),
    description: String(b.description || ''),
    status: b.status || 'todo',
    priority: b.priority || 'medium',
    assignee_id: b.assignee_id || null,
    due_date: b.due_date || null,
  };
  const err = validateTaskFields(fields, { memberIds: await memberIds(projectId) });
  if (err) throw new HttpError(400, err);

  const { task, activity, notes } = await tx(async (c) => {
    const pos = await c.query(
      'SELECT COALESCE(MAX(position), 0) + 1024 AS p FROM tasks WHERE project_id = $1 AND status = $2',
      [projectId, fields.status],
    );
    const { rows } = await c.query(
      `INSERT INTO tasks (project_id, title, description, status, priority, assignee_id, due_date,
                          position, created_by, updated_by, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9, CASE WHEN $4 = 'done' THEN now() END) RETURNING id`,
      [projectId, fields.title, fields.description, fields.status, fields.priority,
        fields.assignee_id, fields.due_date, pos.rows[0].p, req.user.id],
    );
    const act = await logActivity(c, {
      projectId, taskId: rows[0].id, userId: req.user.id, type: 'task_created', payload: { title: fields.title },
    });
    const notes = await notify(c, {
      recipients: [fields.assignee_id], actorId: req.user.id, projectId, taskId: rows[0].id,
      type: 'assigned', payload: { title: fields.title },
    });
    return { task: await loadTask(rows[0].id, c), activity: act, notes };
  });

  emitNotifications(notes);
  emitToProject(projectId, 'task:created', { task, by: req.user });
  emitToProject(projectId, 'activity:new', { activity });
  res.status(201).json({ task });
}));

// ---- Read (with comments, files, history) -----------------------------------

tasksRouter.get('/tasks/:id', h(async (req, res) => {
  await taskProject(req.params.id, req.user.id);
  const [task, comments, attachments, history, checklist] = await Promise.all([
    loadTask(req.params.id),
    query(
      `SELECT c.*, json_build_object('id', u.id, 'name', u.name, 'color', u.color) AS user
         FROM comments c JOIN users u ON u.id = c.user_id
        WHERE c.task_id = $1 ORDER BY c.created_at`,
      [req.params.id],
    ),
    query(
      `SELECT a.id, a.task_id, a.filename, a.mime, a.size, a.created_at,
              json_build_object('id', u.id, 'name', u.name, 'color', u.color) AS user
         FROM attachments a JOIN users u ON u.id = a.user_id
        WHERE a.task_id = $1 ORDER BY a.created_at`,
      [req.params.id],
    ),
    query(`${ACTIVITY_SELECT} WHERE a.task_id = $1 ORDER BY a.id DESC LIMIT 100`, [req.params.id]),
    query('SELECT * FROM checklist_items WHERE task_id = $1 ORDER BY position, created_at', [req.params.id]),
  ]);
  res.json({
    task, comments: comments.rows, attachments: attachments.rows, history: history.rows, checklist: checklist.rows,
  });
}));

// ---- Update: optimistic concurrency + field-level three-way merge -----------

tasksRouter.patch('/tasks/:id', h(async (req, res) => {
  const taskId = req.params.id;
  assertUuid(taskId, 'Task');
  const { baseVersion, changes, base } = req.body || {};
  if (!Number.isInteger(baseVersion)) throw new HttpError(400, 'baseVersion (integer) is required');
  if (!changes || typeof changes !== 'object' || !Object.keys(changes).length)
    throw new HttpError(400, 'changes must be a non-empty object');
  const unknown = Object.keys(changes).filter((f) => !EDITABLE_FIELDS.includes(f));
  if (unknown.length) throw new HttpError(400, `Unknown field(s): ${unknown.join(', ')}`);
  if (typeof changes.title === 'string') changes.title = changes.title.trim();

  const result = await tx(async (c) => {
    // Row lock: concurrent PATCHes on the same task are serialized here, so the
    // version check + write below is atomic.
    const cur = (await c.query('SELECT * FROM tasks WHERE id = $1 FOR UPDATE', [taskId])).rows[0];
    if (!cur) throw new HttpError(404, 'Task not found (it may have been deleted)');
    await requireMember(cur.project_id, req.user.id, c);

    const err = validateTaskFields(changes, { memberIds: await memberIds(cur.project_id, c) });
    if (err) throw new HttpError(400, err);

    const { apply, conflicts } = mergeTaskUpdate(cur, { baseVersion, changes, base: base || {} });
    const applied = Object.keys(apply);
    let activity = null;

    if (applied.length) {
      const sets = [];
      const vals = [];
      for (const f of applied) {
        vals.push(apply[f]);
        sets.push(`${f} = $${vals.length}`);
      }
      if ('status' in apply) {
        sets.push(apply.status === 'done'
          ? 'completed_at = COALESCE(completed_at, now())'
          : 'completed_at = NULL');
      }
      vals.push(req.user.id, taskId);
      await c.query(
        `UPDATE tasks SET ${sets.join(', ')}, version = version + 1, updated_at = now(),
                updated_by = $${vals.length - 1}
          WHERE id = $${vals.length}`,
        vals,
      );

      // Field-level audit trail (position is noise, keep it out of history).
      const diff = {};
      for (const f of applied) {
        if (f === 'position') continue;
        diff[f] = { from: clip(cur[f], 2000), to: clip(apply[f], 2000) };
      }
      if (Object.keys(diff).length) {
        activity = await logActivity(c, {
          projectId: cur.project_id,
          taskId,
          userId: req.user.id,
          type: 'task_updated',
          payload: {
            title: apply.title ?? cur.title,
            changes: diff,
            merged: baseVersion !== cur.version, // applied on top of someone else's newer edit
          },
        });
      }
    }

    // For each conflict, tell the client who made the competing change and when.
    for (const conf of conflicts) {
      const who = await c.query(
        `SELECT u.name, a.created_at FROM activity a LEFT JOIN users u ON u.id = a.user_id
          WHERE a.task_id = $1 AND a.type = 'task_updated' AND a.payload->'changes' ? $2
          ORDER BY a.id DESC LIMIT 1`,
        [taskId, conf.field],
      );
      conf.changedBy = who.rows[0]?.name || null;
      conf.changedAt = who.rows[0]?.created_at || null;
    }

    const task = await loadTask(taskId, c);
    const notes = [];
    if (apply.assignee_id) {
      notes.push(...await notify(c, {
        recipients: [apply.assignee_id], actorId: req.user.id, projectId: cur.project_id, taskId,
        type: 'assigned', payload: { title: task.title },
      }));
    }
    if (apply.status === 'done') {
      notes.push(...await notify(c, {
        recipients: [cur.created_by, cur.assignee_id], actorId: req.user.id, projectId: cur.project_id, taskId,
        type: 'completed', payload: { title: task.title },
      }));
    }
    return {
      task, applied, conflicts, activity, notes, projectId: cur.project_id, merged: applied.length > 0 && baseVersion !== cur.version,
    };
  });

  if (result.applied.length) {
    emitToProject(result.projectId, 'task:updated', { task: result.task, by: req.user, fields: result.applied });
  }
  if (result.activity) emitToProject(result.projectId, 'activity:new', { activity: result.activity });
  emitNotifications(result.notes);

  res.status(result.conflicts.length ? 409 : 200).json({
    task: result.task,
    applied: result.applied,
    conflicts: result.conflicts,
    merged: result.merged,
  });
}));

// ---- Delete ----------------------------------------------------------------

tasksRouter.delete('/tasks/:id', h(async (req, res) => {
  const projectId = await taskProject(req.params.id, req.user.id);
  const { files, activity } = await tx(async (c) => {
    const f = await c.query('SELECT stored_name, storage FROM attachments WHERE task_id = $1', [req.params.id]);
    const del = await c.query('DELETE FROM tasks WHERE id = $1 RETURNING title', [req.params.id]);
    if (!del.rowCount) throw new HttpError(404, 'Task not found');
    const act = await logActivity(c, {
      projectId, taskId: req.params.id, userId: req.user.id, type: 'task_deleted', payload: { title: del.rows[0].title },
    });
    return { files: f.rows, activity: act };
  });
  await removeStoredFiles(files);
  emitToProject(projectId, 'task:deleted', { taskId: req.params.id, by: req.user });
  emitToProject(projectId, 'activity:new', { activity });
  res.json({ ok: true });
}));

// ---- Comments --------------------------------------------------------------

tasksRouter.post('/tasks/:id/comments', h(async (req, res) => {
  const taskId = req.params.id;
  const projectId = await taskProject(taskId, req.user.id);
  const body = String(req.body.body || '').trim();
  if (!body) throw new HttpError(400, 'Comment cannot be empty');
  if (body.length > 5000) throw new HttpError(400, 'Comment is too long');

  // @mentions: the client sends the user ids it inserted; keep only real members.
  const members = await memberIds(projectId);
  const mentions = Array.isArray(req.body.mentions)
    ? [...new Set(req.body.mentions.filter((id) => members.includes(id)))]
    : [];

  const { comment, activity, notes } = await tx(async (c) => {
    const { rows } = await c.query(
      'INSERT INTO comments (task_id, user_id, body) VALUES ($1, $2, $3) RETURNING *',
      [taskId, req.user.id, body],
    );
    const t = await c.query('SELECT title, assignee_id, created_by FROM tasks WHERE id = $1', [taskId]);
    const task = t.rows[0];
    const act = await logActivity(c, {
      projectId, taskId, userId: req.user.id, type: 'comment_added', payload: { title: task.title, excerpt: clip(body, 140) },
    });
    const payload = { title: task.title, excerpt: clip(body, 140) };
    const n1 = await notify(c, { recipients: mentions, actorId: req.user.id, projectId, taskId, type: 'mentioned', payload });
    const n2 = await notify(c, {
      recipients: [task.assignee_id, task.created_by].filter((id) => !mentions.includes(id)),
      actorId: req.user.id, projectId, taskId, type: 'commented', payload,
    });
    return {
      comment: { ...rows[0], user: { id: req.user.id, name: req.user.name, color: req.user.color } },
      activity: act,
      notes: [...n1, ...n2],
    };
  });

  emitNotifications(notes);
  emitToProject(projectId, 'comment:created', { taskId, comment });
  emitToProject(projectId, 'activity:new', { activity });
  res.status(201).json({ comment });
}));

tasksRouter.delete('/comments/:id', h(async (req, res) => {
  assertUuid(req.params.id, 'Comment');
  const { rows } = await query(
    'SELECT c.*, t.project_id FROM comments c JOIN tasks t ON t.id = c.task_id WHERE c.id = $1',
    [req.params.id],
  );
  const comment = rows[0];
  if (!comment) throw new HttpError(404, 'Comment not found');
  if (comment.user_id !== req.user.id) throw new HttpError(403, 'You can only delete your own comments');
  await query('DELETE FROM comments WHERE id = $1', [comment.id]);
  emitToProject(comment.project_id, 'comment:deleted', { taskId: comment.task_id, commentId: comment.id });
  res.json({ ok: true });
}));

// ---- Attachments -----------------------------------------------------------

async function registerAttachment(req, { taskId, projectId, storedName, storage, filename, mime, size }) {
  const { attachment, activity } = await tx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO attachments (task_id, user_id, filename, stored_name, mime, size, storage)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, task_id, filename, mime, size, created_at`,
      [taskId, req.user.id, filename, storedName, mime || 'application/octet-stream', size, storage],
    );
    const t = await c.query('SELECT title FROM tasks WHERE id = $1', [taskId]);
    const act = await logActivity(c, {
      projectId, taskId, userId: req.user.id, type: 'file_attached', payload: { title: t.rows[0].title, filename },
    });
    return {
      attachment: { ...rows[0], user: { id: req.user.id, name: req.user.name, color: req.user.color } },
      activity: act,
    };
  });
  emitToProject(projectId, 'attachment:created', { taskId, attachment });
  emitToProject(projectId, 'activity:new', { activity });
  return attachment;
}

const cleanName = (name) => String(name || 'file').replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 255) || 'file';

/**
 * Step 1 of an upload. With Supabase Storage, returns a signed URL the browser
 * uploads to directly; otherwise tells the browser to POST multipart here.
 */
tasksRouter.post('/tasks/:id/attachments/init', h(async (req, res) => {
  const taskId = req.params.id;
  const projectId = await taskProject(taskId, req.user.id);
  if (storageMode() !== 'supabase') return res.json({ mode: 'disk' });
  const size = Number(req.body.size) || 0;
  if (size > MAX_UPLOAD_BYTES) throw new HttpError(400, `File is too large (max ${Math.round(MAX_UPLOAD_BYTES / 1048576)} MB)`);
  const ext = path.extname(cleanName(req.body.filename)).slice(0, 16).replace(/[^.\w-]/g, '');
  const objectPath = `${projectId}/${taskId}/${crypto.randomUUID()}${ext}`;
  const signed = await createSignedUpload(objectPath);
  res.json({ mode: 'supabase', path: objectPath, token: signed.token, signedUrl: signed.signedUrl });
}));

/** Step 2 (Supabase): confirm the object landed, then record it. */
tasksRouter.post('/tasks/:id/attachments/complete', h(async (req, res) => {
  const taskId = req.params.id;
  const projectId = await taskProject(taskId, req.user.id);
  const objectPath = String(req.body.path || '');
  if (!objectPath.startsWith(`${projectId}/${taskId}/`) || objectPath.includes('..')) throw new HttpError(400, 'Invalid upload');
  const obj = await objectExists(objectPath);
  if (!obj) throw new HttpError(400, 'Upload not found in storage, please try again');
  const size = Number(obj.metadata?.size ?? req.body.size) || 0;
  const attachment = await registerAttachment(req, {
    taskId, projectId, storedName: objectPath, storage: 'supabase',
    filename: cleanName(req.body.filename), mime: obj.metadata?.mimetype || req.body.mime, size,
  });
  res.status(201).json({ attachment });
}));

/** Local-disk upload (multipart). */
tasksRouter.post('/tasks/:id/attachments', upload.single('file'), h(async (req, res) => {
  const taskId = req.params.id;
  let projectId;
  try {
    projectId = await taskProject(taskId, req.user.id);
    if (!req.file) throw new HttpError(400, 'No file uploaded');
  } catch (e) {
    if (req.file) fs.unlink(req.file.path, () => {});
    throw e;
  }
  const f = req.file;
  // Multer decodes multipart filenames as latin1; restore UTF-8 names.
  const filename = cleanName(Buffer.from(f.originalname, 'latin1').toString('utf8'));
  const attachment = await registerAttachment(req, {
    taskId, projectId, storedName: f.filename, storage: 'disk', filename, mime: f.mimetype, size: f.size,
  });
  res.status(201).json({ attachment });
}));

tasksRouter.get('/attachments/:id/download', h(async (req, res) => {
  assertUuid(req.params.id, 'File');
  const { rows } = await query(
    'SELECT a.*, t.project_id FROM attachments a JOIN tasks t ON t.id = a.task_id WHERE a.id = $1',
    [req.params.id],
  );
  const a = rows[0];
  if (!a) throw new HttpError(404, 'File not found');
  await requireMember(a.project_id, req.user.id);
  if (a.storage === 'supabase') {
    // The browser fetches the file straight from Storage with this short-lived link.
    return res.json({ url: await signedDownloadUrl(a.stored_name, a.filename), filename: a.filename });
  }
  const full = path.join(uploadDir(), a.stored_name);
  if (!fs.existsSync(full)) throw new HttpError(410, 'File is missing from storage');
  res.download(full, a.filename);
}));

tasksRouter.delete('/attachments/:id', h(async (req, res) => {
  assertUuid(req.params.id, 'File');
  const { rows } = await query(
    `SELECT a.*, t.project_id, pm.role FROM attachments a
       JOIN tasks t ON t.id = a.task_id
       LEFT JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = $2
      WHERE a.id = $1`,
    [req.params.id, req.user.id],
  );
  const a = rows[0];
  if (!a || !a.role) throw new HttpError(404, 'File not found');
  if (a.user_id !== req.user.id && a.role !== 'owner')
    throw new HttpError(403, 'Only the uploader or project owner can remove this file');
  await query('DELETE FROM attachments WHERE id = $1', [a.id]);
  await removeStoredFiles([a]);
  emitToProject(a.project_id, 'attachment:deleted', { taskId: a.task_id, attachmentId: a.id });
  res.json({ ok: true });
}));

// ---- Checklist (subtasks) ------------------------------------------------------

async function checklistCounts(taskId, db = { query }) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE done)::int AS done
       FROM checklist_items WHERE task_id = $1`,
    [taskId],
  );
  return rows[0];
}

async function itemContext(itemId, userId) {
  assertUuid(itemId, 'Checklist item');
  const { rows } = await query(
    'SELECT ci.*, t.project_id, t.title AS task_title FROM checklist_items ci JOIN tasks t ON t.id = ci.task_id WHERE ci.id = $1',
    [itemId],
  );
  if (!rows[0]) throw new HttpError(404, 'Checklist item not found (it may have been deleted)');
  await requireMember(rows[0].project_id, userId);
  return rows[0];
}

tasksRouter.post('/tasks/:id/checklist', h(async (req, res) => {
  const taskId = req.params.id;
  const projectId = await taskProject(taskId, req.user.id);
  const title = String(req.body.title || '').trim();
  if (!title) throw new HttpError(400, 'Checklist item needs a title');
  if (title.length > 300) throw new HttpError(400, 'Checklist item is too long');
  const { rows } = await query(
    `INSERT INTO checklist_items (task_id, title, position, created_by)
     VALUES ($1, $2, (SELECT COALESCE(MAX(position), 0) + 1024 FROM checklist_items WHERE task_id = $1), $3)
     RETURNING *`,
    [taskId, title, req.user.id],
  );
  const counts = await checklistCounts(taskId);
  emitToProject(projectId, 'checklist:changed', { taskId, item: rows[0], counts, by: req.user });
  res.status(201).json({ item: rows[0], counts });
}));

tasksRouter.patch('/checklist/:id', h(async (req, res) => {
  const item = await itemContext(req.params.id, req.user.id);
  const sets = [];
  const vals = [];
  if (typeof req.body.done === 'boolean') {
    vals.push(req.body.done, req.user.id);
    sets.push(`done = $${vals.length - 1}`, `done_by = CASE WHEN $${vals.length - 1} THEN $${vals.length}::uuid END`);
  }
  if (req.body.title !== undefined) {
    const title = String(req.body.title).trim();
    if (!title) throw new HttpError(400, 'Checklist item needs a title');
    vals.push(title.slice(0, 300));
    sets.push(`title = $${vals.length}`);
  }
  if (!sets.length) throw new HttpError(400, 'Nothing to update');
  vals.push(item.id);
  const { rows } = await query(
    `UPDATE checklist_items SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length} RETURNING *`,
    vals,
  );
  const counts = await checklistCounts(item.task_id);
  if (req.body.done === true && !item.done) {
    const act = await logActivity({ query }, {
      projectId: item.project_id, taskId: item.task_id, userId: req.user.id, type: 'checklist_done',
      payload: { title: item.task_title, item: rows[0].title },
    });
    emitToProject(item.project_id, 'activity:new', { activity: act });
  }
  emitToProject(item.project_id, 'checklist:changed', { taskId: item.task_id, item: rows[0], counts, by: req.user });
  res.json({ item: rows[0], counts });
}));

tasksRouter.delete('/checklist/:id', h(async (req, res) => {
  const item = await itemContext(req.params.id, req.user.id);
  await query('DELETE FROM checklist_items WHERE id = $1', [item.id]);
  const counts = await checklistCounts(item.task_id);
  emitToProject(item.project_id, 'checklist:changed', { taskId: item.task_id, deletedId: item.id, counts, by: req.user });
  res.json({ ok: true, counts });
}));

// ---- Search (Ctrl+K) ------------------------------------------------------------

tasksRouter.get('/search', h(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ tasks: [] });
  const { rows } = await query(
    `SELECT t.id, t.title, t.status, t.priority, t.project_id, p.name AS project_name, p.color AS project_color
       FROM tasks t JOIN projects p ON p.id = t.project_id
      WHERE t.project_id IN (SELECT project_id FROM project_members WHERE user_id = $1)
        AND (t.title ILIKE $2 OR t.description ILIKE $2)
      ORDER BY (t.status = 'done'), t.updated_at DESC
      LIMIT 12`,
    [req.user.id, `%${q.replace(/[%_\\]/g, '\\$&')}%`],
  );
  res.json({ tasks: rows });
}));
