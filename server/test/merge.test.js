import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeTaskUpdate, validateTaskFields } from '../src/merge.js';

const task = (over = {}) => ({
  id: 't1', title: 'Write spec', description: 'v1', status: 'todo', priority: 'medium',
  assignee_id: null, due_date: '2026-10-10', position: 1024, version: 5, ...over,
});

test('same version: every change applies', () => {
  const r = mergeTaskUpdate(task(), { baseVersion: 5, changes: { title: 'New', status: 'done' } });
  assert.deepEqual(r.apply, { title: 'New', status: 'done' });
  assert.equal(r.conflicts.length, 0);
});

test('stale version, different fields: both edits survive (auto-merge)', () => {
  // Alice changed status at v5 -> v6. Bob, still on v5, edits the title.
  const current = task({ status: 'in_progress', version: 6 });
  const r = mergeTaskUpdate(current, {
    baseVersion: 5, changes: { title: 'Bob title' }, base: { title: 'Write spec' },
  });
  assert.deepEqual(r.apply, { title: 'Bob title' });
  assert.equal(r.conflicts.length, 0);
});

test('stale version, same field: conflict, nothing overwritten', () => {
  const current = task({ description: 'Alice text', version: 6 });
  const r = mergeTaskUpdate(current, {
    baseVersion: 5, changes: { description: 'Bob text' }, base: { description: 'v1' },
  });
  assert.deepEqual(r.apply, {});
  assert.deepEqual(r.conflicts, [{ field: 'description', base: 'v1', theirs: 'Alice text', yours: 'Bob text' }]);
});

test('partial: non-conflicting fields apply, conflicting ones are reported', () => {
  const current = task({ priority: 'urgent', version: 7 });
  const r = mergeTaskUpdate(current, {
    baseVersion: 5,
    changes: { priority: 'low', due_date: '2026-11-01' },
    base: { priority: 'medium', due_date: '2026-10-10' },
  });
  assert.deepEqual(r.apply, { due_date: '2026-11-01' });
  assert.equal(r.conflicts[0].field, 'priority');
  assert.equal(r.conflicts[0].theirs, 'urgent');
});

test('both sides converged on the same value: no-op, no conflict', () => {
  const current = task({ status: 'done', version: 6 });
  const r = mergeTaskUpdate(current, { baseVersion: 5, changes: { status: 'done' }, base: { status: 'todo' } });
  assert.deepEqual(r.apply, {});
  assert.deepEqual(r.noop, ['status']);
  assert.equal(r.conflicts.length, 0);
});

test('stale version without base value is treated as a conflict (safe default)', () => {
  const current = task({ version: 9 });
  const r = mergeTaskUpdate(current, { baseVersion: 5, changes: { title: 'X' } });
  assert.equal(r.conflicts.length, 1);
});

test('position is last-writer-wins', () => {
  const current = task({ position: 5000, version: 9 });
  const r = mergeTaskUpdate(current, { baseVersion: 5, changes: { position: 1500 }, base: { position: 1024 } });
  assert.deepEqual(r.apply, { position: 1500 });
});

test('null / empty-string equivalence for clearable fields', () => {
  const current = task({ assignee_id: null, version: 6 });
  const r = mergeTaskUpdate(current, { baseVersion: 5, changes: { assignee_id: 'u2' }, base: { assignee_id: '' } });
  assert.deepEqual(r.apply, { assignee_id: 'u2' });
});

test('unknown fields are ignored by the merge', () => {
  const r = mergeTaskUpdate(task(), { baseVersion: 5, changes: { version: 99, project_id: 'x' } });
  assert.deepEqual(r.apply, {});
});

test('validation', () => {
  assert.equal(validateTaskFields({ title: '  ' }), 'Title is required');
  assert.match(validateTaskFields({ status: 'nope' }), /Status/);
  assert.match(validateTaskFields({ due_date: '10/10/2026' }), /YYYY-MM-DD/);
  assert.match(validateTaskFields({ assignee_id: 'u9' }, { memberIds: ['u1'] }), /member/);
  assert.equal(validateTaskFields({ title: 'ok', priority: 'high', due_date: null }), null);
});
