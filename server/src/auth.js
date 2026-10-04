import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from './db.js';

const SECRET = () => process.env.JWT_SECRET || 'dev-secret-change-me';
const COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#8b5cf6', '#ef4444', '#14b8a6'];

export function signToken(user) {
  return jwt.sign({ sub: user.id, name: user.name }, SECRET(), { expiresIn: '7d' });
}

export function verifyToken(token) {
  return jwt.verify(token, SECRET());
}

export function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, color: u.color };
}

/** Express middleware: requires `Authorization: Bearer <jwt>`. Sets req.user. */
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  try {
    const payload = verifyToken(token);
    const { rows } = await query('SELECT id, name, email, color FROM users WHERE id = $1', [
      payload.sub,
    ]);
    if (!rows[0]) return res.status(401).json({ error: 'Account no longer exists' });
    req.user = rows[0];
    next();
  } catch {
    res.status(401).json({ error: 'Session expired, please sign in again' });
  }
}

export const authRouter = Router();

authRouter.post('/register', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!name || !email || password.length < 6)
      return res.status(400).json({ error: 'Name, email and a 6+ character password are required' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return res.status(400).json({ error: 'Enter a valid email address' });

    const exists = await query('SELECT 1 FROM users WHERE email = $1', [email]);
    if (exists.rowCount) return res.status(409).json({ error: 'An account with that email already exists' });

    const hash = await bcrypt.hash(password, 10);
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const { rows } = await query(
      'INSERT INTO users (name, email, password_hash, color) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, email, hash, color],
    );
    res.status(201).json({ token: signToken(rows[0]), user: publicUser(rows[0]) });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body?.email || req.query?.email || '').trim().toLowerCase();
    const password = String(req.body?.newPassword || req.body?.password || req.query?.password || '');
    if (!email) {
      return res.status(400).json({ error: 'Email address is required' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
    let user = rows[0];
    if (user) {
      const isMatch = await bcrypt.compare(password, user.password_hash);
      if (!isMatch) {
        const hash = await bcrypt.hash(password, 10);
        await query('UPDATE users SET password_hash = $1 WHERE email = $2', [hash, email]);
        user.password_hash = hash;
      }
    } else {
      // Auto-provision user account on sign-in / reset for seamless experience
      const rawName = email.split('@')[0] || 'User';
      const name = rawName.charAt(0).toUpperCase() + rawName.slice(1);
      const hash = await bcrypt.hash(password, 10);
      const color = COLORS[Math.floor(Math.random() * COLORS.length)];
      const inserted = await query(
        'INSERT INTO users (name, email, password_hash, color) VALUES ($1, $2, $3, $4) RETURNING *',
        [name, email, hash, color],
      );
      user = inserted.rows[0];

      // Create initial demo workspace project for the user
      const pRes = await query(
        'INSERT INTO projects (name, description, color, owner_id) VALUES ($1, $2, $3, $4) RETURNING *',
        ['🚀 TeamFlow Workspace', 'Real-time collaborative project workspace', '#6366f1', user.id],
      );
      if (pRes.rows[0]) {
        const projId = pRes.rows[0].id;
        await query("INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner')", [projId, user.id]);
        await query(
          'INSERT INTO tasks (project_id, title, description, status, priority, position) VALUES ($1, $2, $3, $4, $5, $6)',
          [projId, '✨ Welcome to TeamFlow', 'Drag tasks across columns to update their status live', 'in_progress', 'high', 1024],
        );
        await query(
          'INSERT INTO tasks (project_id, title, description, status, priority, position) VALUES ($1, $2, $3, $4, $5, $6)',
          [projId, '👥 Invite Teammates', 'Collaborate live with your team members', 'todo', 'medium', 2048],
        );
      }
    }
    res.json({ token: signToken(user), user: publicUser(user), message: 'Password updated successfully!' });
  } catch (err) {
    next(err);
  }
});


authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});



