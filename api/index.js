// Vercel serverless entry: the whole Express API runs as one function.
import { createApp, finishApp } from '../server/src/app.js';

const app = finishApp(createApp());

export default function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.searchParams.get('__path');
  if (p !== null) {
    url.searchParams.delete('__path');
    const qs = url.searchParams.toString();
    req.url = `/api/${p}${qs ? `?${qs}` : ''}`;
  } else if (!req.url.startsWith('/api')) {
    req.url = `/api${req.url}`;
  }
  return app(req, res);
}

