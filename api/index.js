// Vercel serverless entry: the whole Express API runs as one function.
// vercel.json rewrites /api/<path> to this function as /api?__path=<path>.
import { createApp, finishApp } from '../server/src/app.js';

const app = finishApp(createApp());

export default function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.searchParams.get('__path');
  if (p !== null) {
    url.searchParams.delete('__path');
    const qs = url.searchParams.toString();
    req.url = `/api/${p}${qs ? `?${qs}` : ''}`;
  }
  return app(req, res);
}


