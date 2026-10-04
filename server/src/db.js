import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import schema from './schema.js';

// Return DATE columns as 'YYYY-MM-DD' strings instead of JS Dates.
pg.types.setTypeParser(1082, (v) => v);

const DB_URL = (process.env.DATABASE_URL || 'postgres://teamflow:teamflow@localhost:5432/teamflow')
  .replace(/([?&])sslmode=[^&]*&?/, '$1')
  .replace(/[?&]$/, '');
const isLocal = /@(localhost|127\.0\.0\.1|db)(:|\/)/.test(DB_URL);
const serverless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

const pgPool = new pg.Pool({
  connectionString: DB_URL,
  max: serverless ? 3 : 10,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  idleTimeoutMillis: serverless ? 10000 : 30000,
  connectionTimeoutMillis: 3000,
});

pgPool.on('error', (err) => console.warn('Postgres idle client error:', err.message));

let pgliteInstance = null;
let usePGlite = !process.env.DATABASE_URL && isLocal && serverless;
let useJSFallback = false;

// ---- In-Memory Pure JS Database Fallback (Zero Native WASM Dependencies) ------
const memoryDb = {
  users: new Map(),
  projects: new Map(),
  project_members: [],
  tasks: new Map(),
  activity: [],
  presence: new Map(),
};

function executeJSQuery(sqlText, params = []) {
  const sql = sqlText.trim().replace(/\s+/g, ' ');
  const normSql = sql.toLowerCase();

  // DDL / Migration / Dummy health queries -> succeed immediately
  if (
    normSql.startsWith('create') ||
    normSql.startsWith('alter') ||
    normSql.startsWith('drop') ||
    normSql.startsWith('select 1')
  ) {
    return { rows: [{ '?column?': 1 }], rowCount: 1 };
  }

  // 1. USERS
  if (normSql.includes('users')) {
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
    if (normSql.includes('where id = $1')) {
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
    if (normSql.includes('select p.*, pm.role') || normSql.includes('from projects')) {
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
      return { rows: [taskObj], rowCount: 1 };
    }
    if (normSql.includes('select') && normSql.includes('from tasks')) {
      const projectId = params[0];
      const rows = Array.from(memoryDb.tasks.values()).filter((t) => t.project_id === projectId);
      return { rows, rowCount: rows.length };
    }
  }

  return { rows: [], rowCount: 0 };
}

async function getPGlite() {
  if (!pgliteInstance) {
    try {
      if (serverless) {
        pgliteInstance = new PGlite('memory://');
        console.log('⚡ [Serverless] Using in-memory PGlite database (memory://)');
      } else {
        try { fs.mkdirSync('./data', { recursive: true }); } catch { /* ignore */ }
        pgliteInstance = new PGlite('./data/pglite');
        console.log('⚡ Using embedded PGlite database fallback at ./data/pglite');
      }
    } catch (e) {
      console.warn('⚡ PGlite disk init failed, using pure JS fallback:', e.message);
      useJSFallback = true;
    }
  }
  return pgliteInstance;
}

function isConnError(err) {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  const code = err.code || '';
  return (
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('etimedout') ||
    msg.includes('connect') ||
    msg.includes('locked') ||
    msg.includes('pglite')
  );
}

export async function query(text, params) {
  if (useJSFallback) {
    return executeJSQuery(text, params);
  }
  if (usePGlite) {
    try {
      const db = await getPGlite();
      if (useJSFallback) return executeJSQuery(text, params);
      return await db.query(text, params);
    } catch (err) {
      console.warn('PGlite query error, activating JS memory fallback:', err.message);
      useJSFallback = true;
      return executeJSQuery(text, params);
    }
  }
  try {
    return await pgPool.query(text, params);
  } catch (err) {
    if (isConnError(err)) {
      usePGlite = true;
      try {
        const db = await getPGlite();
        if (useJSFallback) return executeJSQuery(text, params);
        await db.exec(schema).catch(() => {});
        return await db.query(text, params);
      } catch (pglErr) {
        console.warn('PGlite init failed, using JS memory DB:', pglErr.message);
        useJSFallback = true;
        return executeJSQuery(text, params);
      }
    }
    throw err;
  }
}

export async function tx(fn) {
  if (useJSFallback) {
    return fn({ query: (text, params) => executeJSQuery(text, params) });
  }
  if (usePGlite) {
    try {
      const db = await getPGlite();
      if (useJSFallback) return fn({ query: (text, params) => executeJSQuery(text, params) });
      return await db.transaction(async (txClient) => {
        return fn({ query: (text, params) => txClient.query(text, params) });
      });
    } catch {
      useJSFallback = true;
      return fn({ query: (text, params) => executeJSQuery(text, params) });
    }
  }
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
    if (isConnError(err)) {
      usePGlite = true;
      try {
        const db = await getPGlite();
        if (useJSFallback) return fn({ query: (text, params) => executeJSQuery(text, params) });
        await db.exec(schema).catch(() => {});
        return await tx(fn);
      } catch {
        useJSFallback = true;
        return fn({ query: (text, params) => executeJSQuery(text, params) });
      }
    }
    throw err;
  }
}

export async function migrate() {
  if (useJSFallback) return;
  if (usePGlite) {
    try {
      const db = await getPGlite();
      if (useJSFallback) return;
      await db.exec(schema);
    } catch {
      useJSFallback = true;
    }
    return;
  }
  try {
    await pgPool.query(schema);
  } catch (err) {
    if (isConnError(err)) {
      usePGlite = true;
      try {
        const db = await getPGlite();
        if (useJSFallback) return;
        await db.exec(schema);
      } catch {
        useJSFallback = true;
      }
      return;
    }
    console.warn('Migration warning:', err.message);
  }
}

let migrated = null;
/** Run the (idempotent) schema once per process / serverless instance. */
export function ensureMigrated() {
  if (!migrated) {
    migrated = migrate().catch((err) => {
      console.warn('ensureMigrated warning, enabling JS DB fallback:', err.message);
      useJSFallback = true;
    });
  }
  return migrated;
}

export const pool = {
  query: (text, params) => query(text, params),
  connect: async () => {
    if (useJSFallback) {
      return { query: (text, params) => executeJSQuery(text, params), release: () => {} };
    }
    if (usePGlite) {
      try {
        const db = await getPGlite();
        if (useJSFallback) return { query: (text, params) => executeJSQuery(text, params), release: () => {} };
        return { query: (text, params) => db.query(text, params), release: () => {} };
      } catch {
        useJSFallback = true;
        return { query: (text, params) => executeJSQuery(text, params), release: () => {} };
      }
    }
    try {
      return await pgPool.connect();
    } catch (err) {
      if (isConnError(err)) {
        usePGlite = true;
        try {
          const db = await getPGlite();
          if (useJSFallback) return { query: (text, params) => executeJSQuery(text, params), release: () => {} };
          await db.exec(schema).catch(() => {});
          return { query: (text, params) => db.query(text, params), release: () => {} };
        } catch {
          useJSFallback = true;
          return { query: (text, params) => executeJSQuery(text, params), release: () => {} };
        }
      }
      throw err;
    }
  },
  end: async () => {
    if (!usePGlite && !useJSFallback) {
      await pgPool.end().catch(() => {});
    }
  },
  on: (event, handler) => pgPool.on(event, handler),
};
