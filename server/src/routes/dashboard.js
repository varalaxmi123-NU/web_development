import { Router } from 'express';
import { query } from '../db.js';
import { h, ACTIVITY_SELECT } from '../common.js';
import { PROJECT_LIST_SQL } from './projects.js';

export const dashboardRouter = Router();

dashboardRouter.get('/', h(async (req, res) => {
  const uid = req.user.id;
  const myProjects = 'SELECT project_id FROM project_members WHERE user_id = $1';

  const [totals, projects, myTasks, activity, trend, workload] = await Promise.all([
    query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'todo')::int        AS todo,
              count(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
              count(*) FILTER (WHERE status = 'review')::int      AS review,
              count(*) FILTER (WHERE status = 'done')::int        AS done,
              count(*) FILTER (WHERE due_date < current_date AND status <> 'done')::int AS overdue,
              count(*) FILTER (WHERE due_date BETWEEN current_date AND current_date + 7 AND status <> 'done')::int AS due_soon,
              count(*) FILTER (WHERE completed_at >= now() - interval '7 days')::int AS completed_week,
              count(*) FILTER (WHERE assignee_id = $1 AND status <> 'done')::int AS mine_open
         FROM tasks WHERE project_id IN (${myProjects})`,
      [uid],
    ),
    query(`${PROJECT_LIST_SQL} GROUP BY p.id, pm.role ORDER BY p.created_at`, [uid]),
    query(
      `SELECT t.id, t.title, t.status, t.priority, t.due_date, t.project_id, t.version,
              p.name AS project_name, p.color AS project_color
         FROM tasks t JOIN projects p ON p.id = t.project_id
        WHERE t.assignee_id = $1 AND t.status <> 'done' AND t.project_id IN (${myProjects})
        ORDER BY t.due_date ASC NULLS LAST,
                 array_position(ARRAY['urgent','high','medium','low'], t.priority)
        LIMIT 25`,
      [uid],
    ),
    query(`${ACTIVITY_SELECT} WHERE a.project_id IN (${myProjects}) ORDER BY a.id DESC LIMIT 25`, [uid]),
    query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS day,
              (SELECT count(*)::int FROM tasks t
                WHERE t.project_id IN (${myProjects}) AND t.completed_at::date = d::date) AS completed,
              (SELECT count(*)::int FROM tasks t
                WHERE t.project_id IN (${myProjects}) AND t.created_at::date = d::date) AS created
         FROM generate_series(current_date - 13, current_date, interval '1 day') AS d
        ORDER BY d`,
      [uid],
    ),
    query(
      `SELECT u.id, u.name, u.color,
              count(t.id) FILTER (WHERE t.status <> 'done')::int AS open,
              count(t.id) FILTER (WHERE t.status <> 'done' AND t.due_date < current_date)::int AS overdue
         FROM tasks t JOIN users u ON u.id = t.assignee_id
        WHERE t.project_id IN (${myProjects})
        GROUP BY u.id ORDER BY open DESC LIMIT 8`,
      [uid],
    ),
  ]);

  res.json({
    totals: totals.rows[0],
    projects: projects.rows,
    myTasks: myTasks.rows,
    activity: activity.rows,
    trend: trend.rows,
    workload: workload.rows,
  });
}));
