// Vercel serverless entry: the whole Express API runs as one function.
import { createApp, finishApp } from '../server/src/app.js';

const app = finishApp(createApp());

export default function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.searchParams.get('__path');

  let targetPath = req.url;
  if (p !== null) {
    url.searchParams.delete('__path');
    const qs = url.searchParams.toString();
    targetPath = `/${p}${qs ? `?${qs}` : ''}`;
  }

  // Ensure targetPath starts with /api
  if (!targetPath.startsWith('/api')) {
    targetPath = `/api${targetPath.startsWith('/') ? '' : '/'}${targetPath}`;
  }

  req.url = targetPath;
  return app(req, res);
}



