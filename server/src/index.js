import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp, finishApp } from './app.js';
import { ensureMigrated } from './db.js';

// Long-running server for local development (or any always-on Node host).
// On Vercel the same app runs as a serverless function: see /api/index.js.

const PORT = Number(process.env.PORT) || 4000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = createApp();

// Serve the built client if present (`npm run build`), so one process serves everything.
const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}
finishApp(app);

ensureMigrated()
  .then(() => {
    app.listen(PORT, () => console.log(`TeamFlow API on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('Failed to connect/migrate database:', err.message);
    console.error('Check DATABASE_URL in server/.env (is PostgreSQL running?)');
    process.exit(1);
  });
