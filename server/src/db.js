import pg from 'pg';
import schema from './schema.js';

// Return DATE columns as 'YYYY-MM-DD' strings instead of JS Dates, so they
// compare cleanly in the merge engine and don't shift across time zones.
pg.types.setTypeParser(1082, (v) => v);

// Works with local PostgreSQL (Docker) and hosted Postgres such as Supabase.
// Hosted databases require SSL; any ?sslmode=... in the URL is stripped so the
// ssl option below applies consistently.
const DB_URL = (process.env.DATABASE_URL || 'postgres://teamflow:teamflow@localhost:5432/teamflow')
  .replace(/([?&])sslmode=[^&]*&?/, '$1')
  .replace(/[?&]$/, '');
const isLocal = /@(localhost|127\.0\.0\.1|db)(:|\/)/.test(DB_URL);
const serverless = Boolean(process.env.VERCEL);

export const pool = new pg.Pool({
  connectionString: DB_URL,
  // Serverless functions run many small instances: keep each one's pool tiny.
  max: serverless ? 3 : 10,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  idleTimeoutMillis: serverless ? 10000 : 30000,
  connectionTimeoutMillis: 10000,
});

// Hosted poolers (e.g. Supabase) may close idle connections. Without this
// handler, that error would crash the server; the pool simply reconnects.
pool.on('error', (err) => console.warn('Postgres idle client error (will reconnect):', err.message));

export async function query(text, params) {
  return pool.query(text, params);
}

/** Run fn(client) inside a transaction; commits on success, rolls back on throw. */
export async function tx(fn) {
  const client = await pool.connect();
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
}

export async function migrate() {
  await pool.query(schema);
}

let migrated = null;
/** Run the (idempotent) schema once per process / serverless instance. */
export function ensureMigrated() {
  if (!migrated) migrated = migrate().catch((err) => { migrated = null; throw err; });
  return migrated;
}
