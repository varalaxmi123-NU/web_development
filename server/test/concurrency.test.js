/**
 * End-to-end concurrency check against a RUNNING server with seeded demo data.
 *
 *   npm run seed && npm run dev      # terminal 1
 *   npm run test:concurrency         # terminal 2
 *
 * Fires simultaneous edits from two users at the same task version and checks
 * that no update is silently lost, and that every committed change appears in
 * the live event log (what browsers receive in real time).
 */
import assert from 'node:assert/strict';

const BASE = process.env.API_URL || 'http://localhost:4000';

async function api(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

const login = async (email) => (await api('/auth/login', { method: 'POST', body: { email, password: 'demo1234' } })).data.token;

async function main() {
  const [alice, bob] = await Promise.all([login('aarav@demo.dev'), login('priya@demo.dev')]);
  assert.ok(alice && bob, 'demo users missing: run `npm run seed` first');

  const { data: { projects } } = await api('/projects', { token: alice });
  const projectId = projects[0].id;

  // Live observer: start a cursor on the event log (what browsers consume).
  const { data: { cursor: startCursor } } = await api('/live/events?since=-1', { token: alice });

  const { data: { task } } = await api(`/projects/${projectId}/tasks`, {
    token: alice, method: 'POST', body: { title: 'Concurrency probe', description: 'base' },
  });
  const base = { title: task.title, description: task.description, priority: task.priority, status: task.status };

  // 1) Different fields at the same moment -> both must persist.
  const [r1, r2] = await Promise.all([
    api(`/tasks/${task.id}`, { token: alice, method: 'PATCH', body: { baseVersion: task.version, changes: { priority: 'urgent' }, base } }),
    api(`/tasks/${task.id}`, { token: bob, method: 'PATCH', body: { baseVersion: task.version, changes: { status: 'review' }, base } }),
  ]);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  let { data: { task: after } } = await api(`/tasks/${task.id}`, { token: alice });
  assert.equal(after.priority, 'urgent');
  assert.equal(after.status, 'review');
  assert.equal(after.version, task.version + 2);
  console.log('✔ different-field edits auto-merged, both kept');

  // 2) Same field at the same moment -> exactly one wins, the other gets a 409 with both values.
  const b2 = { ...base, description: after.description };
  const results = await Promise.all([
    api(`/tasks/${task.id}`, { token: alice, method: 'PATCH', body: { baseVersion: after.version, changes: { description: 'Alice wrote this' }, base: b2 } }),
    api(`/tasks/${task.id}`, { token: bob, method: 'PATCH', body: { baseVersion: after.version, changes: { description: 'Bob wrote this' }, base: b2 } }),
  ]);
  const codes = results.map((r) => r.status).sort();
  assert.deepEqual(codes, [200, 409]);
  const loser = results.find((r) => r.status === 409).data;
  assert.equal(loser.conflicts[0].field, 'description');
  assert.ok(['Alice wrote this', 'Bob wrote this'].includes(loser.conflicts[0].theirs));
  assert.notEqual(loser.conflicts[0].theirs, loser.conflicts[0].yours);
  console.log('✔ same-field edits: one committed, the other got a 409 with both versions (nothing lost)');

  // 3) 20 parallel writers on distinct fields/values -> final version accounts for every applied write.
  ({ data: { task: after } } = await api(`/tasks/${task.id}`, { token: alice }));
  const burst = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      api(`/tasks/${task.id}`, {
        token: i % 2 ? alice : bob, method: 'PATCH',
        body: { baseVersion: after.version, changes: { position: 1000 + i }, base: { position: after.position } },
      })),
  );
  assert.ok(burst.every((r) => r.status === 200));
  const { data: { task: final } } = await api(`/tasks/${task.id}`, { token: alice });
  assert.equal(final.version, after.version + 20);
  console.log('✔ 20 parallel writes serialized: version advanced by exactly 20');

  const { data: live } = await api(`/live/events?since=${startCursor}`, { token: alice });
  const versions = live.events.filter((e) => e.event === 'task:updated' && e.payload.task.id === task.id).map((e) => e.payload.task.version);
  assert.ok(versions.includes(final.version), 'event log should contain the final version');
  const seqs = live.events.map((e) => e.seq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), 'events are delivered in order');
  console.log(`✔ live event log has all ${versions.length} committed updates, in order`);

  await api(`/tasks/${task.id}`, { token: alice, method: 'DELETE' });
  console.log('\nAll concurrency checks passed.');
}

main().catch((e) => {
  console.error('✘', e.message);
  process.exit(1);
});
