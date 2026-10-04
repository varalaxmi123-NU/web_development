import { useCallback, useEffect, useRef, useState } from 'react';
import { api, session } from './api.js';
import { RealtimeProvider, useRealtime, useSocketEvents } from './realtime.jsx';
import { ToastProvider, useToast, Spinner, Icon, Avatar, Modal } from './components/ui.jsx';
import NotificationsBell from './components/NotificationsBell.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import WelcomePage from './components/WelcomePage.jsx';
import AuthPage from './components/AuthPage.jsx';
import ForgotPasswordPage from './components/ForgotPasswordPage.jsx';
import Sidebar from './components/Sidebar.jsx';
import Dashboard from './components/Dashboard.jsx';
import ProjectView from './components/ProjectView.jsx';
import { cx, getTheme, applyTheme, isTypingTarget } from './utils.js';

applyTheme(getTheme());
import { parseHash, navigate } from './router.js';

import MembersModal from './components/MembersModal.jsx';

export default function App() {
  const [user, setUser] = useState(session.token ? undefined : null);
  const [authScreen, setAuthScreen] = useState('welcome'); // 'welcome' | 'auth' | 'forgot'
  const [authMode, setAuthMode] = useState('login');

  useEffect(() => {
    if (!session.token) return;
    api('/auth/me').then((r) => setUser(r.user)).catch(() => { session.clear(); setUser(null); });
  }, []);

  useEffect(() => {
    const out = () => setUser(null);
    window.addEventListener('teamflow:signed-out', out);
    return () => window.removeEventListener('teamflow:signed-out', out);
  }, []);

  const signOut = () => { session.clear(); setUser(null); setAuthScreen('welcome'); navigate('/'); };

  const handleQuickDemo = async (email, password) => {
    try {
      const r = await api('/auth/login', { method: 'POST', body: { email, password } });
      session.set(r.token);
      setUser(r.user);
    } catch (err) {
      setAuthMode('login');
      setAuthScreen('auth');
    }
  };

  return (
    <ToastProvider>
      {user === undefined ? (
        <div className="splash"><Spinner size={28} /></div>
      ) : !user ? (
        authScreen === 'welcome' ? (
          <WelcomePage
            onEnterApp={(mode) => {
              if (mode === 'forgot') {
                setAuthScreen('forgot');
              } else {
                setAuthMode(mode || 'login');
                setAuthScreen('auth');
              }
            }}
            onQuickDemo={handleQuickDemo}
          />
        ) : authScreen === 'forgot' ? (
          <ForgotPasswordPage
            onAuthed={(u, token) => { session.set(token); setUser(u); }}
            onBackToLogin={() => { setAuthMode('login'); setAuthScreen('auth'); }}
          />
        ) : (
          <AuthPage
            initialMode={authMode}
            onAuthed={(u, token) => { session.set(token); setUser(u); }}
            onBackToHome={() => setAuthScreen('welcome')}
            onOpenForgot={() => setAuthScreen('forgot')}
          />
        )
      ) : (
        <RealtimeProvider user={user}>
          <Shell user={user} onSignOut={signOut} />
        </RealtimeProvider>
      )}
    </ToastProvider>
  );
}

function Shell({ user, onSignOut }) {
  const [route, setRoute] = useState(parseHash);
  const [projects, setProjects] = useState(null);
  const [navOpen, setNavOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [activeInviteProject, setActiveInviteProject] = useState(null);
  const [theme, setTheme] = useState(getTheme);
  const { status, resyncTick, mode } = useRealtime();

  const handleTopInvite = async () => {
    let targetId = route.projectId;
    if (!targetId && projects && projects.length > 0) {
      targetId = projects[0].id;
    }
    if (!targetId) {
      toast('Please create a project first before inviting teammates.', 'warn');
      return;
    }
    try {
      const r = await api(`/projects/${targetId}`);
      setActiveInviteProject({
        project: r.project,
        members: r.members,
        online: new Set(r.onlineUserIds),
      });
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  // Global shortcuts: Ctrl/⌘+K search, ? help.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); return; }
      if (e.key === '?' && !isTypingTarget(e.target) && !document.querySelector('.modal-backdrop')) { e.preventDefault(); setHelp(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const cycleTheme = () => {
    const next = { system: 'light', light: 'dark', dark: 'system' }[theme];
    applyTheme(next);
    setTheme(next);
  };
  const toast = useToast();
  const routeRef = useRef(route);
  routeRef.current = route;

  useEffect(() => {
    const onHash = () => { setRoute(parseHash()); setNavOpen(false); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const loadProjects = useCallback(() => {
    api('/projects').then((r) => setProjects(r.projects)).catch((e) => toast(e.message, 'error'));
  }, [toast]);

  useEffect(loadProjects, [loadProjects, resyncTick]);

  // Project counters change with almost every event; coalesce refetches.
  const timer = useRef(null);
  const refetchSoon = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(loadProjects, 400);
  }, [loadProjects]);

  useSocketEvents(
    ['project:created', 'project:updated', 'project:deleted', 'project:removed',
      'task:created', 'task:updated', 'task:deleted', 'member:added', 'member:removed'],
    (event, data) => {
      if (event === 'project:created') {
        setProjects((ps) => (ps && !ps.some((p) => p.id === data.project.id) ? [...ps, data.project] : ps));
      } else if (event === 'project:updated') {
        setProjects((ps) => ps?.map((p) => (p.id === data.project.id ? { ...data.project, role: p.role } : p)));
      } else if (event === 'project:deleted' || event === 'project:removed') {
        setProjects((ps) => ps?.filter((p) => p.id !== data.projectId));
        if (routeRef.current.projectId === data.projectId) {
          toast(event === 'project:deleted' ? 'This project was deleted' : 'You were removed from this project', 'warn');
          navigate('/');
        }
      } else {
        refetchSoon();
      }
    },
  );

  return (
    <div className={cx('shell', navOpen && 'nav-open')}>
      <Sidebar
        user={user}
        projects={projects}
        route={route}
        onSignOut={onSignOut}
        onCreated={(p) => { setProjects((ps) => (ps?.some((x) => x.id === p.id) ? ps : [...(ps || []), p])); navigate(`/p/${p.id}`); }}
      />
      <div className="nav-scrim" onClick={() => setNavOpen(false)} />
      <div className="main">
        <header className="topbar">
          <button className="icon-btn nav-toggle" onClick={() => setNavOpen((o) => !o)} aria-label="Menu">
            <Icon name="menu" />
          </button>
          <div className="topbar-title">
            {route.view === 'dashboard' ? 'Dashboard' : projects?.find((p) => p.id === route.projectId)?.name || 'Project'}
          </div>
          <button className="search-trigger" onClick={() => setPalette(true)} aria-label="Search (Ctrl+K)">
            <Icon name="search" size={15} />
            <span>Search</span>
            <kbd>Ctrl K</kbd>
          </button>
          <button className="topbar-invite-btn" onClick={handleTopInvite} title="Invite teammate to project">
            <Icon name="userPlus" size={15} />
            <span>Invite Team</span>
          </button>
          <ConnectionPill status={status} mode={mode} />
          <button className="icon-btn" onClick={cycleTheme} title={`Theme: ${theme} (click to change)`} aria-label={`Theme: ${theme}`}>
            <Icon name={theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'monitor'} size={17} />
          </button>
          <NotificationsBell />
          <Avatar user={user} size={30} />
        </header>
        <main className="content">
          {route.view === 'dashboard' && <Dashboard user={user} />}
          {route.view === 'project' && (
            <ProjectView key={route.projectId} projectId={route.projectId} taskId={route.taskId} user={user} />
          )}
        </main>
      </div>
      {palette && <CommandPalette projects={projects || []} onClose={() => setPalette(false)} />}
      {help && <ShortcutsModal onClose={() => setHelp(false)} />}
      {activeInviteProject && (
        <MembersModal
          project={activeInviteProject.project}
          members={activeInviteProject.members}
          online={activeInviteProject.online}
          me={user}
          onClose={() => setActiveInviteProject(null)}
        />
      )}
    </div>
  );
}

const SHORTCUTS = [
  ['Ctrl/⌘ + K', 'Search tasks and projects'],
  ['N', 'New task (on a project)'],
  ['/', 'Filter tasks'],
  ['1 · 2 · 3 · 4', 'Board · List · Calendar · Activity'],
  ['Esc', 'Close the open task or dialog'],
  ['@', 'Mention a teammate in a comment'],
  ['Ctrl/⌘ + Enter', 'Send comment / save description'],
  ['?', 'Show this list'],
];

function ShortcutsModal({ onClose }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} width={420}>
      <dl className="shortcuts">
        {SHORTCUTS.map(([k, v]) => (<div key={k}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>))}
      </dl>
    </Modal>
  );
}

function ConnectionPill({ status, mode }) {
  const label = { live: 'Live', connecting: 'Connecting…', reconnecting: 'Reconnecting…', offline: 'Offline' }[status];
  const title = status !== 'live'
    ? 'Changes will sync when the connection returns'
    : mode === 'push' ? 'Real-time: instant push (Supabase Realtime) with gap-free catch-up' : 'Real-time: syncing every 2 seconds';
  return (
    <span className={cx('conn-pill', `conn-${status}`)} title={title}>
      <span className="conn-dot" />
      {label}
    </span>
  );
}
