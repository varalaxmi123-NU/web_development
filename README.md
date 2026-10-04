# TeamFlow — Collaborative Project Workspace

**PS ID: ALG-WEB-01** · React + Node/Express (Vercel Functions) + Supabase (PostgreSQL, Realtime, Storage)

One live workspace for remote teams: projects, tasks, assignment, comments, file attachments, deadlines, progress, and a dashboard. Every change appears for everyone instantly, and **two people editing the same task can never silently overwrite each other**.

![Board](docs/screenshots/board.png)

---

## Feature checklist

| Requirement | What TeamFlow does |
|---|---|
| **Projects and tasks** | Create projects, invite members by email, Kanban board (drag and drop between and within columns), sortable list view, quick-add, filters (search, assignee, priority). |
| **Task assignment / status** | Assignee, status (To do → In progress → In review → Done), priority. Changing status from the board, list or task drawer. |
| **Comments / files** | Threaded comments per task (live), file attachments with drag-and-drop upload, progress bar, download, delete. |
| **Deadlines / progress** | Due dates with overdue / today / this-week highlighting, per-project progress bars, completion timestamps. |
| **Dashboard** | KPI tiles, 14-day created-vs-completed chart, status distribution, my tasks by deadline, per-project progress, team workload, live activity feed. |
| **Real-time updates** | Supabase Realtime pushes every change instantly, backed by a gap-free event log so nothing is missed after a disconnect. Tasks, comments, files, checklists, members, presence and activity stream to every member. |
| **Bonus: no lost updates** | Versioned rows + server-side **field-level three-way merge** under a row lock. Different fields auto-merge; same-field collisions return a conflict that the user resolves explicitly. Full field-level audit history. |

### Beyond the brief

| Feature | Why it matters |
|---|---|
| **Live presence** | See who is online, who has a task open, and *who is editing which field*, before you collide. |
| **@mentions + notification center** | Type `@` in a comment to mention a teammate. Mentions, assignments, comments on your tasks and completions arrive instantly in the bell, synced across tabs. |
| **Typing indicator** | "Priya is typing…" in a task's comment thread. |
| **Checklists (subtasks)** | Progress shows on the card (`3/6`). Ticks send an explicit done/undone, so simultaneous ticks can't cancel each other. |
| **Calendar view** | Month view of deadlines; drag a task to another day to reschedule it, live for everyone. |
| **Offline-safe edits** | Lose connection mid-edit and the change is queued locally ("1 change waiting to sync"). On reconnect it replays through the same conflict-safe merge, so it can't clobber edits teammates made meanwhile. |
| **Ctrl/⌘ + K search** | Jump to any task or project across your workspace. |
| **Keyboard shortcuts** | `N` new task, `/` filter, `1-4` switch views, `?` for the full list. |
| **Image previews, light/dark/system theme, mobile layout** | |

---

## Quick start (about 2 minutes)

Prerequisites: **Node 18+**, and one of: a **Supabase** project, **Docker**, or a local **PostgreSQL 13+**.

```bash
# 1. Database
docker compose up -d db          # or Supabase / your own Postgres; see the sections below

# 2. Install everything
npm run setup

# 3. Demo data (4 users, 2 projects, tasks, comments)
npm run seed

# 4. Run API (port 4000) + web app (port 5173)
npm run dev
```

Open **http://localhost:5173** and click a demo account. All demo users use password `demo1234`:

| User | Email |
|---|---|
| Aarav Shah | aarav@demo.dev |
| Priya Nair | priya@demo.dev |
| Rohan Mehta | rohan@demo.dev |
| Sara Khan | sara@demo.dev |

> Sessions are stored per browser tab, so you can sign in as **two different people in two tabs** of the same browser to demo collaboration.

### Using Supabase (no Docker needed)

1. Create a project at supabase.com (region: **South Asia (Mumbai)**) and save the database password.
2. **Connect → Session pooler** → copy the URI.
3. Copy `server/.env.example` to `server/.env` and set `DATABASE_URL` to that URI, with your password filled in. SSL is handled automatically.
4. Skip `docker compose`: run `npm run setup`, `npm run seed`, `npm run dev`.

Tables are created on first start and are visible in Supabase's **Table Editor**.

### Using your own Postgres

```bash
createdb teamflow
cp server/.env.example server/.env    # then edit DATABASE_URL
```

The schema is created automatically when the server starts (idempotent).

### Production build

```bash
npm run build      # builds client/dist
npm start          # Express serves the API and the built client on :4000
```

---

## Deploying (Vercel + Supabase, all free)

Everything runs on **one Vercel project**: the React app as static files and the Express API as a serverless function (`api/index.js`, routed by `vercel.json`). **Supabase** provides the database, instant push (Realtime Broadcast) and file storage.

1. **Supabase → Project Settings → API Keys**: copy the **Publishable** key and a **Secret** key. The project URL is `https://<ref>.supabase.co`.
2. **Supabase → Connect → Transaction pooler**: copy that connection string (port **6543**), which is best for serverless.
3. **Vercel → Add New → Project →** import the repo. Leave Root Directory as the repo root; `vercel.json` sets the build. Add these environment variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Transaction pooler URL (password filled in, special characters URL-encoded) |
| `JWT_SECRET` | any long random string |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` (legacy `anon` key also works) |
| `SUPABASE_SECRET_KEY` | `sb_secret_…` (legacy `service_role` key also works) |

4. Deploy. Tables and the private `attachments` storage bucket are created automatically on first request. Check `https://<your-app>.vercel.app/api/health`, which should report `"realtime":"supabase+log","storage":"supabase"`.

If the Supabase variables are missing, the app still works: live updates fall back to syncing from the event log every 2 seconds.

## 3-minute judge demo script

1. Open two tabs. Sign in as **Aarav** in one and **Priya** in the other. Open **Website Relaunch** in both.
2. **Real-time:** drag a card to *Done* in Aarav's tab. It moves in Priya's tab with a highlight and a toast. Quick-add a task in Priya's tab; it appears for Aarav.
3. **Presence:** Aarav opens *Docs search*. Priya's card shows Aarav's avatar ring. Aarav clicks into the description; Priya sees **"Aarav is editing"** on that field.
4. **Same-field conflict (bonus):** both type different descriptions. Aarav saves first. Priya instantly sees a warning that Aarav changed the field. Priya saves: instead of overwriting, she gets a **side-by-side resolver** (Theirs / Mine / Combine both). Pick *Combine*, save, and it propagates to Aarav.
5. **Offline safety:** stop the server (Ctrl + C), change a task's priority, and you'll see "1 change waiting to sync". Restart the server and it syncs to everyone automatically.
6. **Mentions:** in Priya's tab, comment `@Aarav Shah can you check this?`. Aarav's bell rings instantly; clicking the notification opens the task.
7. **Different-field auto-merge:** at the same moment, Aarav changes *Priority* and Priya changes *Status*. Both changes survive; the history marks the second one **auto-merged**.
8. **History tab:** every field change shows who, when, before → after.
9. **Dashboard and Calendar:** KPIs, chart, workload and activity update live as you work.

![Conflict resolver](docs/screenshots/conflict.png)

![Task with checklist](docs/screenshots/task.png)

![Calendar](docs/screenshots/calendar.png)

---

## How "no silent lost updates" works

Every task row has an integer `version`, bumped by one on each committed change. The client never sends "set description = X". It sends **what it wants and what it started from**:

```json
PATCH /api/tasks/:id
{
  "baseVersion": 7,
  "changes": { "description": "Priya's text" },
  "base":    { "description": "text Priya started editing from" }
}
```

On the server, inside one transaction:

1. `SELECT … FROM tasks WHERE id = $1 FOR UPDATE`: concurrent writers to the same task are serialized.
2. Field-level **three-way merge** (`server/src/merge.js`) for each changed field:

   | Situation | Result |
   |---|---|
   | `baseVersion == current.version` | Nobody else wrote, so apply. |
   | `current[f] == base[f]` | Someone changed *other* fields, so apply (auto-merge). |
   | `current[f] == changes[f]` | Both converged on the same value, so no-op. |
   | otherwise | **Conflict**: field is *not* written. |

3. Non-conflicting fields are committed (`version + 1`), with a field-level diff written to the `activity` audit log.
4. Response: `200` (all applied, `merged: true` if it was combined with someone else's newer edit), or **`409`** with `{ task, applied, conflicts: [{ field, base, theirs, yours, changedBy, changedAt }] }`.

The client then shows the resolver. The user's text is held in the dialog, never discarded. Resolving re-submits against the latest version, so a third concurrent edit would surface a new conflict rather than be overwritten.

Card ordering (`position`) is deliberately last-writer-wins, because it is cosmetic.

### Real-time reliability

* **Writes go through REST; live messages only describe committed state.** A dropped connection can never lose a write, and the client always gets a definitive HTTP result.
* **Two delivery paths.** Every change is written to an `events` table with a gap-free sequence number and pushed instantly via **Supabase Realtime Broadcast**. Clients apply each event exactly once (by sequence number) and periodically catch up from their cursor, so a missed push is filled in automatically. Without push, the catch-up runs every 2 seconds.
* **Serverless-safe.** Events from a request are recorded in order and flushed in one call *before* the HTTP response is sent, so nothing is lost when a function freezes.
* **Version-guarded client state**: task events are applied only if `incoming.version >= local.version`, so out-of-order or duplicate events are harmless.
* **Reconnect = resync**: after any connection problem, the open project, task and dashboard are re-fetched from the database.
* **Offline queue** for task edits, replayed through the same conflict-safe merge.
* Status pill shows *Live / Reconnecting / Offline* (hover it to see whether push is active).

## Architecture

```
 Browser (React)                  Vercel Function: Express API          Supabase
 ┌────────────────┐  REST writes  ┌──────────────────────────────┐     ┌──────────────────┐
 │ Dashboard      │ ────────────▶ │ routes: auth, projects,      │ SQL │ Postgres         │
 │ Board / List / │               │ tasks, comments, checklist,  │ ──▶ │  tasks (version) │
 │ Calendar       │ ◀──────────── │ files, notifications, live   │ tx+ │  events (seq)    │
 │ Task drawer    │  JSON / 409   │ merge.js (3-way merge)       │ lock│  presence, …     │
 │ Conflict UI    │               │ realtime.js ── broadcast ──────────▶ Realtime         │
 └──────┬─────────┘               └──────────────────────────────┘     │ Storage (files)  │
        │  instant push (Realtime Broadcast) ◀─────────────────────────┤                  │
        └─ catch-up GET /api/live/events?since=<seq>  (gap-free)        └──────────────────┘
```

```
teamflow/
├── api/index.js              Vercel serverless entry
├── vercel.json               Vercel build + routing
├── docker-compose.yml        Postgres 16 (optional, local)
├── server/
│   ├── src/
│   │   ├── index.js          Express app, error handling, static client
│   │   ├── schema.js         Tables + indexes (auto-migrated)
│   │   ├── merge.js          Conflict-safe three-way merge + validation
│   │   ├── app.js            Express app (shared by local server + Vercel function)
│   │   ├── realtime.js       Event log + Supabase Realtime push + presence
│   │   ├── storage.js        Supabase Storage (signed URLs) or local disk
│   │   ├── auth.js           JWT auth (bcrypt passwords)
│   │   ├── common.js         Membership checks, activity log helpers
│   │   ├── seed.js           Demo data
│   │   └── routes/           projects.js · tasks.js · dashboard.js · notifications.js
│   └── test/
│       ├── merge.test.js         Unit tests for the merge engine
│       └── concurrency.test.js   Live race tests against a running server
└── client/
    └── src/
        ├── App.jsx, router.js, api.js, realtime.jsx
        └── components/       Dashboard, ProjectView, Board, ListView, TaskDrawer,
                              ConflictModal, ActivityFeed, MembersModal, AuthPage, Sidebar,
                              CalendarView, Checklist, NotificationsBell, CommandPalette,
                              ProjectSettingsModal
```

---

## Tests

```bash
npm test                    # merge-engine unit tests (no DB needed)

# With the server running and seeded:
npm run test:concurrency    # fires simultaneous edits from two users
```

`test:concurrency` checks that:
* two simultaneous edits to **different fields** both persist;
* two simultaneous edits to the **same field** produce exactly one `200` and one `409` carrying both values;
* **20 parallel writers** are serialized (version advances by exactly 20);
* the live event log contains every committed update, in order.

---

## API reference

All endpoints except auth require `Authorization: Bearer <token>`.

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/register` · `/api/auth/login` | → `{ token, user }` |
| GET | `/api/auth/me` | |
| GET / POST | `/api/projects` | List (with progress counts) / create |
| GET / PATCH / DELETE | `/api/projects/:id` | Detail incl. members, tasks, online users, presence. Delete is owner-only. |
| POST / DELETE | `/api/projects/:id/members[/:userId]` | Invite by email / remove (unassigns their tasks) |
| GET | `/api/projects/:id/activity?before=&limit=` | Paginated activity feed |
| POST | `/api/projects/:id/tasks` | Create task |
| GET / PATCH / DELETE | `/api/tasks/:id` | GET includes comments, files, history. PATCH = versioned merge (200 / 409). |
| POST | `/api/tasks/:id/comments` · DELETE `/api/comments/:id` | Body `{ body, mentions: [userId] }` |
| POST | `/api/tasks/:id/attachments` | multipart `file`, 10 MB default |
| GET / DELETE | `/api/attachments/:id[/download]` | |
| GET | `/api/dashboard` | Totals, trend, my tasks, workload, activity |
| POST | `/api/tasks/:id/checklist` · PATCH / DELETE `/api/checklist/:id` | Checklist items (`{ done: true / false }`) |
| GET / POST | `/api/notifications` · `/api/notifications/read` | List + unread count / mark read (`{ ids }` or all) |
| GET | `/api/search?q=` | Task search across your projects |

**Live events (server → client, via Supabase Realtime and `GET /api/live/events`):** `task:created|updated|deleted`, `comment:created|deleted`, `attachment:created|deleted`, `checklist:changed`, `member:added|removed`, `project:created|updated|deleted|removed`, `activity:new`, `presence:update`, `typing`, `notification:new|read`.
**Client → server:** `POST /api/live/presence { sessionId, projectId, taskId, field }` (heartbeat), `POST /api/live/typing`.

---

## Configuration (`server/.env`)

| Variable | Default |
|---|---|
| `PORT` | `4000` |
| `DATABASE_URL` | `postgres://teamflow:teamflow@localhost:5432/teamflow` |
| `JWT_SECRET` | dev secret (**set this in production**) |
| `CLIENT_ORIGIN` | `http://localhost:5173` |
| `UPLOAD_DIR` | `./uploads` |
| `MAX_UPLOAD_MB` | `10` |
| `SUPABASE_URL` | unset → no push, files on disk |
| `SUPABASE_PUBLISHABLE_KEY` | Realtime push (sent to browsers; public by design) |
| `SUPABASE_SECRET_KEY` | server-only: broadcasting + Storage |

## Notes and next steps

* Realtime channel names are unguessable per-project capabilities handed only to members; all data is still authorized and re-read via the API. A next step would be Supabase private channels with RLS.
* Without Supabase configured, files are stored on local disk (fine for local development).
* Possible extensions: subtasks, labels, @mentions with notifications, real-time collaborative text (CRDT) for long descriptions.
