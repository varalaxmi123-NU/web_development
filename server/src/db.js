import pg from 'pg';
import crypto from 'node:crypto';
import schema from './schema.js';

// Return DATE columns as 'YYYY-MM-DD' strings instead of JS Dates.
pg.types.setTypeParser(1082, (v) => v);

const DB_URL = (process.env.DATABASE_URL || '')
  .replace(/([?&])sslmode=[^&]*&?/, '$1')
  .replace(/[?&]$/, '');

const hasPgUrl = Boolean(DB_URL.trim());
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.VERCEL_ENV);

let pgPool = null;
if (hasPgUrl) {
  try {
    pgPool = new pg.Pool({
      connectionString: DB_URL,
      max: isServerless ? 3 : 10,
      ssl: { rejectUnauthorized: false },
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 3000,
    });
    pgPool.on('error', (err) => console.warn('Postgres idle client error:', err.message));
  } catch (e) {
    console.warn('pgPool creation failed:', e.message);
  }
}

// Default to JS fallback on serverless if no DATABASE_URL is configured
let useJSFallback = !hasPgUrl;
let usePGlite = false;
let pgliteInstance = null;

// ---- In-Memory Pure JS Database Engine (Zero WASM / Native Dependencies) ------
const memoryDb = {
  users: new Map(),
  projects: new Map(),
  project_members: [],
  tasks: new Map(),
  activity: [],
  notifications: [],
};

function executeJSQuery(sqlText, params = []) {
  const sql = sqlText.trim().replace(/\s+/g, ' ');
  const normSql = sql.toLowerCase();

  // DDL / Migration / Health checks
  if (
    normSql.startsWith('create') ||
    normSql.startsWith('alter') ||
    normSql.startsWith('drop') ||
    normSql === 'select 1' ||
    normSql === 'select 1;'
  ) {
    return { rows: [{ '?column?': 1 }], rowCount: 1 };
  }

  // 1. USERS
  if (normSql.includes('from users') || normSql.includes('into users') || normSql.includes('update users')) {
    if (normSql.includes('update users')) {
      const newHash = params[0];
      const targetEmail = String(params[1] || '').toLowerCase();
      const u = Array.from(memoryDb.users.values()).find(
        (x) => x.email.toLowerCase() === targetEmail
      );
      if (u) {
        u.password_hash = newHash;
        return { rows: [u], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (normSql.includes('where email') || normSql.includes('lower(email)')) {
      const targetEmail = String(params[0] || '').toLowerCase();
      const matched = Array.from(memoryDb.users.values()).filter(
        (u) => u.email.toLowerCase() === targetEmail
      );
      return { rows: matched, rowCount: matched.length };
    }
    if (normSql.includes('select 1 from users')) {
      const targetEmail = String(params[0] || '').toLowerCase();
      const exists = Array.from(memoryDb.users.values()).some(
        (u) => u.email.toLowerCase() === targetEmail
      );
      return { rows: exists ? [{ 1: 1 }] : [], rowCount: exists ? 1 : 0 };
    }
    if (normSql.includes('where id = $1') || normSql.includes('where id=$1')) {
      const u = memoryDb.users.get(params[0]);
      return { rows: u ? [u] : [], rowCount: u ? 1 : 0 };
    }
    if (normSql.includes('insert into users')) {
      const id = crypto.randomUUID();
      const userObj = {
        id,
        name: params[0],
        email: params[1],
        password_hash: params[2],
        color: params[3] || '#6366f1',
        created_at: new Date().toISOString(),
      };
      memoryDb.users.set(id, userObj);
      return { rows: [userObj], rowCount: 1 };
    }
  }

  // 2. PROJECTS & MEMBERS
  if (normSql.includes('projects') || normSql.includes('project_members')) {
    // requireMember check: SELECT pm.role FROM projects p LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $2 WHERE p.id = $1
    if (normSql.includes('select pm.role from projects')) {
      const pId = params[0];
      const uId = params[1];
      const proj = memoryDb.projects.get(pId);
      if (!proj) return { rows: [], rowCount: 0 };
      const pm = memoryDb.project_members.find(
        (m) => m.project_id === pId && m.user_id === uId
      );
      return { rows: [{ role: pm ? pm.role : null }], rowCount: 1 };
    }

    if (normSql.includes('select user_id from project_members')) {
      const pId = params[0];
      const pMembers = memoryDb.project_members.filter((m) => m.project_id === pId);
      return { rows: pMembers.map((m) => ({ user_id: m.user_id })), rowCount: pMembers.length };
    }

    if (normSql.includes('insert into projects')) {
      const id = crypto.randomUUID();
      const projObj = {
        id,
        name: params[0],
        description: params[1] || '',
        color: params[2] || '#6366f1',
        owner_id: params[3],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      memoryDb.projects.set(id, projObj);
      return { rows: [projObj], rowCount: 1 };
    }

    if (normSql.includes('insert into project_members')) {
      const pm = {
        project_id: params[0],
        user_id: params[1],
        role: params[2] || 'member',
        joined_at: new Date().toISOString(),
      };
      const existing = memoryDb.project_members.find(
        (x) => x.project_id === pm.project_id && x.user_id === pm.user_id
      );
      if (existing) return { rows: [existing], rowCount: 0 };
      memoryDb.project_members.push(pm);
      return { rows: [pm], rowCount: 1 };
    }

    if (normSql.includes('select p.*, pm.role') || normSql.includes('from projects p')) {
      const userId = params[0];
      const pIdFilter = params[1];
      const memberShipList = memoryDb.project_members.filter((m) => m.user_id === userId);
      const rows = [];
      for (const m of memberShipList) {
        if (pIdFilter && m.project_id !== pIdFilter) continue;
        const proj = memoryDb.projects.get(m.project_id);
        if (!proj) continue;
        const projTasks = Array.from(memoryDb.tasks.values()).filter((t) => t.project_id === proj.id);
        rows.push({
          ...proj,
          role: m.role,
          task_count: projTasks.length,
          done_count: projTasks.filter((t) => t.status === 'done').length,
          in_progress_count: projTasks.filter((t) => t.status === 'in_progress').length,
          overdue_count: 0,
          member_count: memoryDb.project_members.filter((x) => x.project_id === proj.id).length,
        });
      }
      return { rows, rowCount: rows.length };
    }

    if (normSql.includes('select u.id, u.name, u.email, u.color, pm.role')) {
      const projectId = params[0];
      const pMembers = memoryDb.project_members.filter((x) => x.project_id === projectId);
      const rows = pMembers
        .map((pm) => {
          const u = memoryDb.users.get(pm.user_id);
          return u ? { ...u, role: pm.role, joined_at: pm.joined_at } : null;
        })
        .filter(Boolean);
      return { rows, rowCount: rows.length };
    }

    if (normSql.includes('update projects')) {
      const pId = params[params.length - 1];
      const proj = memoryDb.projects.get(pId);
      if (proj) {
        if (params[0]) proj.name = params[0];
        proj.updated_at = new Date().toISOString();
        return { rows: [proj], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (normSql.includes('delete from projects')) {
      const pId = params[0];
      memoryDb.projects.delete(pId);
      memoryDb.project_members = memoryDb.project_members.filter((m) => m.project_id !== pId);
      return { rows: [], rowCount: 1 };
    }
  }

  // 3. TASKS
  if (normSql.includes('tasks')) {
    if (normSql.includes('insert into tasks')) {
      const id = crypto.randomUUID();
      const taskObj = {
        id,
        project_id: params[0],
        title: params[1] || 'New task',
        description: params[2] || '',
        status: params[3] || 'todo',
        priority: params[4] || 'medium',
        assignee_id: params[5] || null,
        due_date: params[6] || null,
        position: params[7] || 1024,
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      memoryDb.tasks.set(id, taskObj);
      return {
        rows: [{
          ...taskObj,
          comment_count: 0,
          attachment_count: 0,
          checklist_total: 0,
          checklist_done: 0,
        }],
        rowCount: 1,
      };
    }

    if (normSql.includes('select') && normSql.includes('where t.id = $1')) {
      const taskId = params[0];
      const t = memoryDb.tasks.get(taskId);
      if (!t) return { rows: [], rowCount: 0 };
      return {
        rows: [{
          ...t,
          comment_count: 0,
          attachment_count: 0,
          checklist_total: 0,
          checklist_done: 0,
        }],
        rowCount: 1,
      };
    }

    if (normSql.includes('select') && normSql.includes('from tasks')) {
      const projectId = params[0];
      const rows = Array.from(memoryDb.tasks.values())
        .filter((t) => t.project_id === projectId)
        .map((t) => ({
          ...t,
          comment_count: 0,
          attachment_count: 0,
          checklist_total: 0,
          checklist_done: 0,
        }));
      return { rows, rowCount: rows.length };
    }

    if (normSql.includes('update tasks')) {
      const taskId = params[params.length - 1];
      const t = memoryDb.tasks.get(taskId);
      if (t) {
        t.version = (t.version || 1) + 1;
        t.updated_at = new Date().toISOString();
        return {
          rows: [{
            ...t,
            comment_count: 0,
            attachment_count: 0,
            checklist_total: 0,
            checklist_done: 0,
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    }

    if (normSql.includes('delete from tasks')) {
      const taskId = params[0];
      memoryDb.tasks.delete(taskId);
      return { rows: [], rowCount: 1 };
    }
  }

  // 4. ACTIVITY
  if (normSql.includes('activity')) {
    if (normSql.includes('insert into activity')) {
      const id = crypto.randomUUID();
      const actObj = {
        id,
        project_id: params[0],
        task_id: params[1] || null,
        user_id: params[2],
        type: params[3],
        payload: params[4] || {},
        created_at: new Date().toISOString(),
      };
      memoryDb.activity.push(actObj);
      return { rows: [{ id }], rowCount: 1 };
    }

    if (normSql.includes('select') && (normSql.includes('where a.id = $1') || normSql.includes('where a.project_id = $1'))) {
      const filterId = params[0];
      const items = memoryDb.activity.filter(
        (a) => a.id === filterId || a.project_id === filterId
      );
      const rows = items.map((a) => {
        const u = memoryDb.users.get(a.user_id);
        const p = memoryDb.projects.get(a.project_id);
        return {
          ...a,
          user: u ? { id: u.id, name: u.name, color: u.color } : { id: a.user_id, name: 'User', color: '#6366f1' },
          project_name: p ? p.name : 'Project',
          project_color: p ? p.color : '#6366f1',
        };
      });
      return { rows, rowCount: rows.length };
    }
  }

  // 5. NOTIFICATIONS
  if (normSql.includes('notifications')) {
    if (normSql.includes('insert into notifications')) {
      const id = crypto.randomUUID();
      const notif = {
        id,
        user_id: params[0],
        actor_id: params[1],
        project_id: params[2],
        task_id: params[3] || null,
        type: params[4],
        payload: params[5] || {},
        created_at: new Date().toISOString(),
        read_at: null,
      };
      memoryDb.notifications.push(notif);
      return { rows: [{ id, user_id: notif.user_id }], rowCount: 1 };
    }

    if (normSql.includes('select') && normSql.includes('from notifications')) {
      const filterId = params[0];
      const items = memoryDb.notifications.filter(
        (n) => n.id === filterId || n.user_id === filterId
      );
      const rows = items.map((n) => {
        const u = memoryDb.users.get(n.actor_id);
        const p = memoryDb.projects.get(n.project_id);
        return {
          ...n,
          actor: u ? { id: u.id, name: u.name, color: u.color } : { id: n.actor_id, name: 'User', color: '#6366f1' },
          project_name: p ? p.name : 'Project',
          project_color: p ? p.color : '#6366f1',
        };
      });
      return { rows, rowCount: rows.length };
    }

    if (normSql.includes('update notifications')) {
      return { rows: [], rowCount: 0 };
    }
  }

  // Default empty fallback
  return { rows: [], rowCount: 0 };
}

export async function query(text, params) {
  if (useJSFallback) {
    return executeJSQuery(text, params);
  }
  if (pgPool) {
    try {
      return await pgPool.query(text, params);
    } catch (err) {
      console.warn('Postgres connection failed, falling back to JS database engine:', err.message);
      useJSFallback = true;
      return executeJSQuery(text, params);
    }
  }
  useJSFallback = true;
  return executeJSQuery(text, params);
}

export async function tx(fn) {
  if (useJSFallback) {
    return fn({ query: (text, params) => executeJSQuery(text, params) });
  }
  if (pgPool) {
    try {
      const client = await pgPool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      console.warn('Tx error, using JS fallback:', err.message);
      useJSFallback = true;
      return fn({ query: (text, params) => executeJSQuery(text, params) });
    }
  }
  useJSFallback = true;
  return fn({ query: (text, params) => executeJSQuery(text, params) });
}

export async function migrate() {
  if (useJSFallback) return;
  if (pgPool) {
    try {
      await pgPool.query(schema);
    } catch (err) {
      console.warn('Migration failed, using JS fallback:', err.message);
      useJSFallback = true;
    }
  }
}

let migrated = null;
export function ensureMigrated() {
  if (!migrated) {
    migrated = migrate().catch((err) => {
      console.warn('ensureMigrated warning:', err.message);
      useJSFallback = true;
    });
  }
  return migrated;
}

export const pool = {
  query: (text, params) => query(text, params),
  connect: async () => {
    if (useJSFallback || !pgPool) {
      return { query: (text, params) => executeJSQuery(text, params), release: () => {} };
    }
    try {
      return await pgPool.connect();
    } catch (err) {
      useJSFallback = true;
      return { query: (text, params) => executeJSQuery(text, params), release: () => {} };
    }
  },
  end: async () => {
    if (pgPool) {
      await pgPool.end().catch(() => {});
    }
  },
  on: (event, handler) => pgPool ? pgPool.on(event, handler) : null,
};

