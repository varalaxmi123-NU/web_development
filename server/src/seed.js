import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool, migrate, tx } from './db.js';

/**
 * Creates demo users + projects so you can demo collaboration immediately.
 * Re-running it resets only the demo data (emails ending in @demo.dev).
 * All demo accounts use the password: demo1234
 */

const USERS = [
  { name: 'Aarav Shah', email: 'aarav@demo.dev', color: '#6366f1' },
  { name: 'Priya Nair', email: 'priya@demo.dev', color: '#ec4899' },
  { name: 'Rohan Mehta', email: 'rohan@demo.dev', color: '#f59e0b' },
  { name: 'Sara Khan', email: 'sara@demo.dev', color: '#10b981' },
];

const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

const PROJECTS = [
  {
    name: 'Website Relaunch',
    color: '#6366f1',
    description: 'New marketing site with pricing, docs and blog.',
    members: [0, 1, 2, 3],
    tasks: [
      ['Finalize sitemap and IA', 'done', 'high', 0, -9, 'Agree on top-level navigation and URL structure.', -8],
      ['Design system tokens', 'done', 'medium', 1, -6, 'Colors, type scale, spacing, radii.', -5],
      ['Homepage hero design', 'review', 'high', 1, 1, 'Two variants for A/B test. Need copy from Rohan.', null],
      ['Pricing page copy', 'in_progress', 'urgent', 2, -1, 'Three tiers. Legal must review the refund wording.', null],
      ['Set up Next.js project + CI', 'done', 'high', 0, -4, 'Vercel previews on every PR.', -3],
      ['Blog CMS integration', 'in_progress', 'medium', 0, 4, 'Evaluate headless CMS options, wire up preview mode.', null],
      ['Docs search', 'todo', 'medium', 3, 9, 'Full-text search across docs with keyboard shortcut.', null],
      ['Lighthouse performance pass', 'todo', 'low', 3, 12, 'Target 95+ on mobile.', null],
      ['Cookie consent banner', 'todo', 'high', null, -2, 'Required before launch in EU.', null],
      ['Launch checklist', 'todo', 'urgent', 2, 6, 'Redirects, analytics, OG images, sitemap.xml.', null],
    ],
  },
  {
    name: 'Mobile App v2',
    color: '#ec4899',
    description: 'Offline-first rewrite of the field-sales app.',
    members: [0, 1, 3],
    tasks: [
      ['Offline sync spike', 'done', 'urgent', 0, -10, 'Compare CRDT vs. server-authoritative sync.', -7],
      ['Login with OTP', 'done', 'high', 3, -5, 'SMS OTP with rate limiting.', -2],
      ['Order capture screen', 'in_progress', 'high', 1, 2, 'Form with product picker and live totals.', null],
      ['Push notifications', 'review', 'medium', 3, 3, 'Order status updates.', null],
      ['Crash reporting', 'todo', 'medium', 0, 8, 'Wire up crash + ANR reporting.', null],
      ['Accessibility audit', 'todo', 'low', null, 15, 'Screen reader labels, contrast, tap targets.', null],
    ],
  },
];

const CHECKLISTS = [
  [9, [['301 redirects from old URLs', true], ['Analytics + consent wired up', true], ['OG images for all pages', false], ['sitemap.xml submitted', false], ['Smoke test on mobile', false]]],
  [3, [['Starter tier copy', true], ['Pro tier copy', true], ['Enterprise tier copy', false], ['Legal review of refund wording', false]]],
  [5, [['Pick CMS', true], ['Preview mode', false], ['Webhook rebuilds', false]]],
];

const COMMENTS = [
  [2, 2, 'Copy draft is in the shared folder — headline still needs a punchier verb.'],
  [2, 1, 'Thanks! I will drop it into variant B this afternoon.'],
  [3, 0, 'Reminder: legal wants the 14-day refund wording verbatim.'],
  [5, 3, 'Preview mode works locally, deploy previews still 404.'],
];

async function main() {
  await migrate();
  const hash = await bcrypt.hash('demo1234', 10);

  await tx(async (c) => {
    await c.query(
      "DELETE FROM projects WHERE owner_id IN (SELECT id FROM users WHERE email LIKE '%@demo.dev')",
    );
    await c.query("DELETE FROM users WHERE email LIKE '%@demo.dev'");

    const users = [];
    for (const u of USERS) {
      const { rows } = await c.query(
        'INSERT INTO users (name, email, password_hash, color) VALUES ($1,$2,$3,$4) RETURNING id, name',
        [u.name, u.email, hash, u.color],
      );
      users.push(rows[0]);
    }

    for (const p of PROJECTS) {
      const owner = users[p.members[0]];
      const { rows } = await c.query(
        'INSERT INTO projects (name, description, color, owner_id) VALUES ($1,$2,$3,$4) RETURNING id',
        [p.name, p.description, p.color, owner.id],
      );
      const projectId = rows[0].id;
      for (const [i, m] of p.members.entries()) {
        await c.query('INSERT INTO project_members (project_id, user_id, role) VALUES ($1,$2,$3)', [
          projectId, users[m].id, i === 0 ? 'owner' : 'member',
        ]);
      }
      await c.query(
        "INSERT INTO activity (project_id, user_id, type, payload, created_at) VALUES ($1,$2,'project_created',$3, now() - interval '14 days')",
        [projectId, owner.id, { name: p.name }],
      );

      const taskIds = [];
      let pos = 1024;
      for (const [title, status, priority, assignee, due, description, doneOffset] of p.tasks) {
        const createdAgo = Math.abs(due) + 3;
        const { rows: t } = await c.query(
          `INSERT INTO tasks (project_id, title, description, status, priority, assignee_id, due_date, position,
                              created_by, updated_by, created_at, completed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9, now() - ($10::text || ' days')::interval,
                   CASE WHEN $11::int IS NULL THEN NULL ELSE now() + ($11::int || ' days')::interval END)
           RETURNING id`,
          [projectId, title, description, status, priority, assignee === null ? null : users[assignee].id,
            day(due), pos, owner.id, String(Math.min(createdAgo, 13)), doneOffset],
        );
        pos += 1024;
        taskIds.push(t[0].id);
        await c.query(
          "INSERT INTO activity (project_id, task_id, user_id, type, payload, created_at) VALUES ($1,$2,$3,'task_created',$4, now() - interval '3 days')",
          [projectId, t[0].id, owner.id, { title }],
        );
      }

      if (p === PROJECTS[0]) {
        for (const [ti, ui, body] of COMMENTS) {
          await c.query('INSERT INTO comments (task_id, user_id, body) VALUES ($1,$2,$3)', [taskIds[ti], users[ui].id, body]);
        }
        for (const [ti, items] of CHECKLISTS) {
          let cpos = 1024;
          for (const [title, done] of items) {
            await c.query(
              'INSERT INTO checklist_items (task_id, title, done, position, created_by, done_by) VALUES ($1,$2,$3,$4,$5,$6)',
              [taskIds[ti], title, done, cpos, owner.id, done ? owner.id : null],
            );
            cpos += 1024;
          }
        }
        // A couple of unread notifications so the bell isn't empty on first login.
        await c.query(
          `INSERT INTO notifications (user_id, actor_id, project_id, task_id, type, payload, created_at) VALUES
           ($1, $2, $3, $4, 'mentioned', $5, now() - interval '25 minutes'),
           ($1, $6, $3, $7, 'assigned', $8, now() - interval '2 hours')`,
          [users[0].id, users[2].id, projectId, taskIds[3],
            { title: PROJECTS[0].tasks[3][0], excerpt: '@Aarav Shah can you sanity-check the Pro tier copy?' },
            users[1].id, taskIds[5], { title: PROJECTS[0].tasks[5][0] }],
        );
      }
    }
  });

  console.log('Seeded demo data. Sign in with any of:');
  for (const u of USERS) console.log(`  ${u.email}  /  demo1234`);
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
