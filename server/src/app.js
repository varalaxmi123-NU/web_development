import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { ensureMigrated, pool } from './db.js';
import { authRouter, requireAuth } from './auth.js';
import { projectsRouter } from './routes/projects.js';
import { tasksRouter } from './routes/tasks.js';
import { dashboardRouter } from './routes/dashboard.js';
import { notificationsRouter } from './routes/notifications.js';
import { liveRouter, presenceLeave } from './routes/live.js';
import { realtimeScope, pushConfig } from './realtime.js';
import { storageMode } from './storage.js';

/**
 * The Express app, shared by:
 *  - server/src/index.js  → long-running server for local dev / any Node host
 *  - api/index.js         → a Vercel serverless function
 */
export function createApp() {
  // Comma-separated list of allowed browser origins (only needed when the
  // frontend is served from a different domain than the API).
  const origins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map((o) => o.trim()).filter(Boolean);

  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: origins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true, db: 'up', realtime: pushConfig() ? 'supabase+log' : 'log', storage: storageMode() });
    } catch {
      res.status(503).json({ ok: false, db: 'down' });
    }
  });

  // Make sure tables exist (once per process / serverless instance).
  app.use('/api', (req, res, next) => ensureMigrated().then(() => next(), next));
  // Collect real-time events per request; flushed just before the response.
  app.use('/api', realtimeScope);

  app.post('/api/live/presence/leave', express.text({ type: '*/*' }), presenceLeave);
  app.use('/api/auth', authRouter);
  app.use('/api/projects', requireAuth, projectsRouter);
  app.use('/api/dashboard', requireAuth, dashboardRouter);
  app.use('/api/notifications', requireAuth, notificationsRouter);
  app.use('/api/live', requireAuth, liveRouter);
  app.use('/api', requireAuth, tasksRouter);

  return app;
}

/** 404 + error handling; call after any extra routes (e.g. static files). */
export function finishApp(app) {
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : err.message;
      return res.status(400).json({ error: msg });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
    // Postgres: invalid input syntax / FK violation / check violation
    if (['22P02', '22007', '22008'].includes(err.code)) return res.status(400).json({ error: 'Invalid value' });
    if (err.code === '23503') return res.status(400).json({ error: 'Referenced record does not exist' });
    if (err.code === '23514') return res.status(400).json({ error: 'Value not allowed' });
    if (['ECONNREFUSED', 'ENOTFOUND', '28P01', 'ETIMEDOUT'].includes(err.code)) {
      console.error('Database connection problem:', err.message);
      return res.status(503).json({ error: 'Database unavailable. Check DATABASE_URL.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  });
  return app;
}
