import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import schema from './schema.js';

// Return DATE columns as 'YYYY-MM-DD' strings instead of JS Dates, so they
// compare cleanly in the merge engine and don't shift across time zones.
pg.types.setTypeParser(1082, (v) => v);

const DB_URL = (process.env.DATABASE_URL || 'postgres://teamflow:teamflow@localhost:5432/teamflow')
  .replace(/([?&])sslmode=[^&]*&?/, '$1')
  .replace(/[?&]$/, '');
const isLocal = /@(localhost|127\.0\.0\.1|db)(:|\/)/.test(DB_URL);
const serverless = Boolean(process.env.VERCEL);

const pgPool = new pg.Pool({
  connectionString: DB_URL,
  max: serverless ? 3 : 10,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  idleTimeoutMillis: serverless ? 10000 : 30000,
  connectionTimeoutMillis: 3000,
});

pgPool.on('error', (err) => console.warn('Postgres idle client error:', err.message));

let pgliteInstance = null;
let usePGlite = false;

async function getPGlite() {
  if (!pgliteInstance) {
    fs.mkdirSync('./data', { recursive: true });
    pgliteInstance = new PGlite('./data/pglite');
    console.log('⚡ Using embedded PGlite database fallback at ./data/pglite');
  }
  return pgliteInstance;
}

export async function query(text, params) {
  if (usePGlite) {
    const db = await getPGlite();
    return db.query(text, params);
  }
  try {
    return await pgPool.query(text, params);
  } catch (err) {
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || (err.message && err.message.includes('ECONNREFUSED'))) {
      usePGlite = true;
      const db = await getPGlite();
      await db.exec(schema);
      return db.query(text, params);
    }
    throw err;
  }
}

export async function tx(fn) {
  if (usePGlite) {
    const db = await getPGlite();
    return db.transaction(async (txClient) => {
      return fn({
        query: (text, params) => txClient.query(text, params),
      });
    });
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
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || (err.message && err.message.includes('ECONNREFUSED'))) {
      usePGlite = true;
      const db = await getPGlite();
      await db.exec(schema);
      return tx(fn);
    }
    throw err;
  }
}

export async function migrate() {
  if (usePGlite) {
    const db = await getPGlite();
    await db.exec(schema);
    return;
  }
  try {
    await pgPool.query(schema);
  } catch (err) {
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || (err.message && err.message.includes('ECONNREFUSED'))) {
      usePGlite = true;
      const db = await getPGlite();
      await db.exec(schema);
      return;
    }
    throw err;
  }
}

let migrated = null;
/** Run the (idempotent) schema once per process / serverless instance. */
export function ensureMigrated() {
  if (!migrated) migrated = migrate().catch((err) => { migrated = null; throw err; });
  return migrated;
}

export const pool = {
  query: (text, params) => query(text, params),
  connect: async () => {
    if (usePGlite) {
      const db = await getPGlite();
      return {
        query: (text, params) => db.query(text, params),
        release: () => {},
      };
    }
    try {
      return await pgPool.connect();
    } catch (err) {
      if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || (err.message && err.message.includes('ECONNREFUSED'))) {
        usePGlite = true;
        const db = await getPGlite();
        await db.exec(schema);
        return {
          query: (text, params) => db.query(text, params),
          release: () => {},
        };
      }
      throw err;
    }
  },
  end: async () => {
    if (!usePGlite) {
      await pgPool.end().catch(() => {});
    }
  },
  on: (event, handler) => pgPool.on(event, handler),
};
