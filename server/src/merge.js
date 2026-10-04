/**
 * Conflict-safe task merge engine.
 *
 * Every task row carries a `version` that the server bumps on each commit.
 * A client edit is sent as:
 *
 *   { baseVersion, changes: { field: newValue }, base: { field: valueClientStartedFrom } }
 *
 * The server locks the row (SELECT ... FOR UPDATE) and runs a field-level
 * three-way merge between `base` (what the client saw), `current` (what is in
 * the database now) and `changes` (what the client wants):
 *
 *  - versions match                → nobody else wrote; apply everything.
 *  - current[f] === base[f]        → someone else edited *other* fields; safe to apply f.
 *  - current[f] === changes[f]     → both sides converged on the same value; no-op.
 *  - otherwise                     → a real conflict: the field is NOT written and the
 *                                    client gets both versions to resolve explicitly.
 *
 * So two people editing different fields of one task both win, and two people
 * editing the same field never silently overwrite each other.
 */

export const FIELD_KINDS = {
  title: 'text',
  description: 'text',
  status: 'enum',
  priority: 'enum',
  assignee_id: 'ref',
  due_date: 'date',
  // Card ordering inside a column is cosmetic; last writer wins.
  position: 'lww',
};

export const EDITABLE_FIELDS = Object.keys(FIELD_KINDS);

export function normalize(v) {
  if (v === undefined || v === '') return null;
  return v;
}

export function sameValue(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (typeof na === 'number' || typeof nb === 'number') return Number(na) === Number(nb);
  return na === nb;
}

/**
 * @param {object} current   task row as it is in the DB right now (locked)
 * @param {object} edit      { baseVersion:number, changes:object, base?:object }
 * @returns {{ apply: object, conflicts: Array<{field, base, theirs, yours}>, noop: string[] }}
 */
export function mergeTaskUpdate(current, edit) {
  const { baseVersion, changes = {}, base = {} } = edit;
  const apply = {};
  const conflicts = [];
  const noop = [];
  const versionMatches = Number(baseVersion) === Number(current.version);

  for (const [field, yours] of Object.entries(changes)) {
    if (!(field in FIELD_KINDS)) continue;

    if (sameValue(current[field], yours)) {
      noop.push(field);
      continue;
    }

    const untouchedSinceBase =
      Object.prototype.hasOwnProperty.call(base, field) && sameValue(current[field], base[field]);

    if (versionMatches || FIELD_KINDS[field] === 'lww' || untouchedSinceBase) {
      apply[field] = normalize(yours);
    } else {
      conflicts.push({
        field,
        base: Object.prototype.hasOwnProperty.call(base, field) ? normalize(base[field]) : null,
        theirs: normalize(current[field]),
        yours: normalize(yours),
      });
    }
  }

  return { apply, conflicts, noop };
}

const STATUSES = ['todo', 'in_progress', 'review', 'done'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

/** Validate a partial task payload. Returns an error string or null. */
export function validateTaskFields(fields, { memberIds } = {}) {
  for (const [k, v] of Object.entries(fields)) {
    switch (k) {
      case 'title':
        if (typeof v !== 'string' || !v.trim()) return 'Title is required';
        if (v.length > 200) return 'Title must be 200 characters or fewer';
        break;
      case 'description':
        if (v != null && typeof v !== 'string') return 'Description must be text';
        if (v && v.length > 20000) return 'Description is too long';
        break;
      case 'status':
        if (!STATUSES.includes(v)) return `Status must be one of ${STATUSES.join(', ')}`;
        break;
      case 'priority':
        if (!PRIORITIES.includes(v)) return `Priority must be one of ${PRIORITIES.join(', ')}`;
        break;
      case 'assignee_id':
        if (normalize(v) !== null && memberIds && !memberIds.includes(v))
          return 'Assignee must be a member of this project';
        break;
      case 'due_date':
        if (normalize(v) !== null && !/^\d{4}-\d{2}-\d{2}$/.test(v))
          return 'Due date must be YYYY-MM-DD';
        break;
      case 'position':
        if (!Number.isFinite(Number(v))) return 'Position must be a number';
        break;
      default:
        break;
    }
  }
  return null;
}

export { STATUSES, PRIORITIES };
