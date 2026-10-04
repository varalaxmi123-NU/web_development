import { useState } from 'react';
import { FIELD_LABEL, displayValue, timeAgo, cx } from '../utils.js';
import { Icon, Modal } from './ui.jsx';

/**
 * Shown when the server returns 409: someone else changed the same field(s)
 * after this user started editing. Nothing has been overwritten. The user picks,
 * per field, whose version to keep, or writes a merged version for text fields.
 */
export default function ConflictModal({ conflict, task, members, onResolve, onClose }) {
  const [choice, setChoice] = useState(() =>
    Object.fromEntries(conflict.conflicts.map((c) => [c.field, { pick: 'mine', merged: mergeSuggestion(c) }])),
  );
  const isText = (f) => f === 'title' || f === 'description';

  const resolve = () => {
    const changes = {};
    for (const c of conflict.conflicts) {
      const ch = choice[c.field];
      if (ch.pick === 'mine') changes[c.field] = c.yours;
      else if (ch.pick === 'merged') changes[c.field] = ch.merged;
      // 'theirs' -> keep what's already saved; send nothing.
    }
    // Skip fields whose chosen value already equals the saved one.
    for (const f of Object.keys(changes)) if ((changes[f] ?? null) === (task[f] ?? null)) delete changes[f];
    onResolve(changes);
  };

  return (
    <Modal
      title="Your edit overlapped with a teammate’s"
      width={680}
      onClose={null}
      footer={(
        <>
          <button className="btn" onClick={() => onResolve({})}>Keep all of theirs</button>
          <button className="btn btn-primary" onClick={resolve}>Save my choices</button>
        </>
      )}
    >
      <p className="conflict-intro">
        <Icon name="alert" size={15} /> Nothing was overwritten.
        {conflict.applied?.length > 0 && <> Your other changes ({conflict.applied.map((f) => FIELD_LABEL[f]?.toLowerCase()).join(', ')}) were saved.</>}
        {' '}Choose what to keep for each field below.
      </p>

      {conflict.conflicts.map((c) => {
        const ch = choice[c.field];
        const set = (patch) => setChoice((s) => ({ ...s, [c.field]: { ...s[c.field], ...patch } }));
        return (
          <div key={c.field} className="conflict">
            <div className="conflict-field">{FIELD_LABEL[c.field] || c.field}</div>
            <div className="conflict-options">
              <label className={cx('copt', ch.pick === 'theirs' && 'on')}>
                <input type="radio" name={c.field} checked={ch.pick === 'theirs'} onChange={() => set({ pick: 'theirs' })} />
                <span className="copt-head">Theirs{c.changedBy && <> · {c.changedBy}</>}{c.changedAt && <span className="muted"> {timeAgo(c.changedAt)}</span>}</span>
                <span className="copt-val">{displayValue(c.field, c.theirs, members)}</span>
              </label>
              <label className={cx('copt', ch.pick === 'mine' && 'on')}>
                <input type="radio" name={c.field} checked={ch.pick === 'mine'} onChange={() => set({ pick: 'mine' })} />
                <span className="copt-head">Mine</span>
                <span className="copt-val">{displayValue(c.field, c.yours, members)}</span>
              </label>
            </div>
            {isText(c.field) && (
              <div className={cx('copt merged', ch.pick === 'merged' && 'on')}>
                <label className="copt-head">
                  <input type="radio" name={c.field} checked={ch.pick === 'merged'} onChange={() => set({ pick: 'merged' })} />
                  Combine both (edit below)
                </label>
                <textarea rows={c.field === 'description' ? 6 : 2} value={ch.merged}
                  onFocus={() => set({ pick: 'merged' })} onChange={(e) => set({ merged: e.target.value, pick: 'merged' })} />
              </div>
            )}
            {c.base != null && <div className="conflict-base muted">Before either edit: {displayValue(c.field, c.base, members)}</div>}
          </div>
        );
      })}
    </Modal>
  );
}

/** Pre-fill the "combine" box: if one side just appended to the original, merge cleanly. */
function mergeSuggestion(c) {
  const base = c.base ?? '';
  const theirs = c.theirs ?? '';
  const yours = c.yours ?? '';
  if (typeof theirs !== 'string' || typeof yours !== 'string') return yours;
  if (theirs.startsWith(base) && yours.startsWith(base) && base) {
    // Both appended to the same original text: keep base once, then both additions.
    return `${base}${theirs.slice(base.length)}${yours.slice(base.length)}`;
  }
  if (c.field === 'title') return yours;
  return `${theirs}\n\n${yours}`;
}
