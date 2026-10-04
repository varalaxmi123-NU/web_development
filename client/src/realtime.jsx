import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, API_BASE } from './api.js';

/**
 * Live updates for one signed-in tab.
 *
 * Two layers, so nothing is ever missed:
 *  1. Push: Supabase Realtime Broadcast (instant), when the server is configured for it.
 *  2. Catch-up: the server's gap-free event log (GET /api/live/events?since=cursor).
 *     Polled every ~2s when push isn't available, every 15s as a safety net when it is,
 *     and immediately after any reconnect. Each event carries a sequence number and is
 *     applied exactly once.
 *
 * Components use the same small API as before: useSocketEvent(event, handler),
 * socket.emit('presence:set' | 'typing', …), status, resyncTick.
 *
 * `status`     live | connecting | reconnecting | offline   (shown in the top bar)
 * `mode`       push | poll
 * `resyncTick` increments after recovering from a connection problem; views
 *              depend on it and re-fetch, so state is reconciled with the database.
 */
const RealtimeCtx = createContext({ socket: null, status: 'connecting', resyncTick: 0, mode: 'poll' });
export const useRealtime = () => useContext(RealtimeCtx);

const POLL_MS = 2000;
const SAFETY_POLL_MS = 15000;
const HEARTBEAT_MS = 20000;

function newSessionId() {
  try { return crypto.randomUUID(); } catch { return `s-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`; }
}

export function RealtimeProvider({ user, children }) {
  const [status, setStatus] = useState('connecting');
  const [mode, setMode] = useState('poll');
  const [resyncTick, setResyncTick] = useState(0);

  // A tiny event bus that looks like the old socket to components.
  const socket = useMemo(() => {
    const handlers = new Map();
    return {
      handlers,
      on(ev, fn) { if (!handlers.has(ev)) handlers.set(ev, new Set()); handlers.get(ev).add(fn); },
      off(ev, fn) { handlers.get(ev)?.delete(fn); },
      emit: () => {}, // replaced once the transport starts
    };
  }, [user]);

  useEffect(() => {
    if (!user) return undefined;
    let alive = true;
    const sessionId = newSessionId();
    let cursor = null;
    let failed = false;
    let everLive = false;
    let pushOk = false;
    let wake = null;
    const seen = new Set();
    const seenOrder = [];
    let presence = { projectId: null, taskId: null, field: null };
    let sb = null;
    const channels = new Map(); // topic -> { channel, ok }

    const dispatch = (ev, payload) => socket.handlers.get(ev)?.forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } });

    const deliver = (ev, payload) => {
      if (payload && payload.seq != null) {
        if (seen.has(payload.seq)) return;
        seen.add(payload.seq);
        seenOrder.push(payload.seq);
        if (seenOrder.length > 5000) seen.delete(seenOrder.shift());
      }
      if (ev === 'typing' && payload.userId === user.id) return;
      dispatch(ev, payload);
      if (ev === 'project:created' || ev === 'project:removed' || ev === 'project:deleted') refreshTopics();
    };

    const markHealthy = () => {
      if (failed && everLive) setResyncTick((n) => n + 1);
      failed = false;
      everLive = true;
      setStatus('live');
    };
    const markFailed = () => {
      failed = true;
      setStatus(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'reconnecting');
    };

    // ---- Catch-up loop over the event log --------------------------------------------
    const poll = async () => {
      if (cursor == null) cursor = (await api('/live/events?since=-1')).cursor;
      const q = presence.projectId ? `&project=${presence.projectId}` : '';
      const r = await api(`/live/events?since=${cursor}${q}`);
      for (const e of r.events) deliver(e.event, e.payload);
      cursor = r.cursor;
      if (r.presence && r.presence.projectId === presence.projectId) {
        deliver('presence:update', r.presence);
        for (const t of r.presence.typing || []) {
          deliver('typing', { projectId: r.presence.projectId, taskId: t.taskId, userId: t.userId, name: t.name });
        }
      }
      return r.more;
    };

    const sleep = (ms) => new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      wake = () => { clearTimeout(t); resolve(); };
    });

    (async () => {
      while (alive) {
        let wait;
        try {
          const more = await poll();
          markHealthy();
          wait = more ? 0 : pushOk ? SAFETY_POLL_MS : POLL_MS;
        } catch (err) {
          if (err.status === 401) return; // signed out; App handles it
          markFailed();
          wait = 3000;
        }
        if (alive) await sleep(wait);
      }
    })();
    const pollNow = () => wake?.();

    // ---- Presence + typing --------------------------------------------------------------
    const sendPresence = () => api('/live/presence', { method: 'POST', body: { sessionId, ...presence } }).catch(() => {});
    const heartbeat = setInterval(sendPresence, HEARTBEAT_MS);
    socket.emit = (ev, data = {}) => {
      if (ev === 'presence:set') {
        presence = { projectId: data.projectId || null, taskId: data.taskId || null, field: data.field || null };
        sendPresence().then(pollNow);
      } else if (ev === 'typing') {
        api('/live/typing', { method: 'POST', body: { sessionId, projectId: data.projectId, taskId: data.taskId } }).catch(() => {});
      }
    };
    const leave = () => {
      try {
        navigator.sendBeacon?.(`${API_BASE}/api/live/presence/leave`, JSON.stringify({ sessionId }));
      } catch { /* ignore */ }
    };
    window.addEventListener('pagehide', leave);

    // ---- Push via Supabase Realtime (optional) -----------------------------------------
    const updatePushState = () => {
      const all = [...channels.values()];
      const ok = all.length > 0 && all.every((c) => c.ok);
      if (ok !== pushOk) {
        pushOk = ok;
        setMode(ok ? 'push' : 'poll');
        pollNow(); // catch up whenever push state changes
      }
    };

    async function refreshTopics() {
      if (!sb) return;
      try {
        const cfg = await api('/live/config');
        subscribe([cfg.topics.user, ...Object.values(cfg.topics.projects)]);
      } catch { /* next refresh will retry */ }
    }

    function subscribe(topics) {
      const wanted = new Set(topics);
      for (const [topic, c] of channels) {
        if (!wanted.has(topic)) { sb.removeChannel(c.channel); channels.delete(topic); }
      }
      for (const topic of wanted) {
        if (channels.has(topic)) continue;
        const entry = { channel: sb.channel(topic), ok: false };
        channels.set(topic, entry);
        entry.channel
          .on('broadcast', { event: '*' }, (msg) => deliver(msg.event, msg.payload))
          .subscribe((state) => {
            entry.ok = state === 'SUBSCRIBED';
            updatePushState();
          });
      }
      updatePushState();
    }

    (async () => {
      try {
        const cfg = await api('/live/config');
        if (!alive || !cfg.push) return;
        const { createClient } = await import('@supabase/supabase-js');
        if (!alive) return;
        sb = createClient(cfg.push.url, cfg.push.key, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        });
        subscribe([cfg.topics.user, ...Object.values(cfg.topics.projects)]);
      } catch (err) {
        console.warn('Realtime push unavailable, using event-log sync:', err?.message || err);
      }
    })();

    const onOnline = () => pollNow();
    const onOffline = () => setStatus('offline');
    const onVisible = () => { if (document.visibilityState === 'visible') { sendPresence(); pollNow(); } };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      alive = false;
      wake?.();
      clearInterval(heartbeat);
      leave();
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
      if (sb) sb.removeAllChannels();
      socket.emit = () => {};
    };
  }, [user, socket]);

  return <RealtimeCtx.Provider value={{ socket, status, resyncTick, mode }}>{children}</RealtimeCtx.Provider>;
}

/** Subscribe to a live event with an always-fresh handler (no stale closures). */
export function useSocketEvent(event, handler) {
  const { socket } = useRealtime();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!socket) return undefined;
    const fn = (...args) => ref.current(...args);
    socket.on(event, fn);
    return () => socket.off(event, fn);
  }, [socket, event]);
}

/** Subscribe to several events with one handler(eventName, payload). */
export function useSocketEvents(events, handler) {
  const { socket } = useRealtime();
  const ref = useRef(handler);
  ref.current = handler;
  const key = events.join('|');
  useEffect(() => {
    if (!socket) return undefined;
    const fns = events.map((ev) => [ev, (data) => ref.current(ev, data)]);
    fns.forEach(([ev, fn]) => socket.on(ev, fn));
    return () => fns.forEach(([ev, fn]) => socket.off(ev, fn));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, key]);
}
