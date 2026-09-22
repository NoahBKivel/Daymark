import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import luxonPlugin from '@fullcalendar/luxon3';
import type { DatesSetArg, EventContentArg, EventInput as FCEvent } from '@fullcalendar/core';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Check,
  Plus,
  Menu,
  Search,
  PanelRightClose,
  PanelRightOpen,
  Settings2,
  ListTodo,
  CircleHelp,
  ArrowUpRight,
  RefreshCw,
  Download,
  Upload,
  LogOut,
  Sun,
  Moon,
  Monitor,
  X,
  MoreHorizontal,
  Circle,
  ArrowRight,
  CheckCheck,
  Clock3,
  Pencil,
  AlertCircle,
} from 'lucide-react';
import { DateTime } from 'luxon';
import { makeClient, request } from './api';
import { demoState, resetDemo } from './demo';
import { addDays, daysBetween, formatTime, isOverdue, taskOverlaps } from './shared/dates';
import {
  backupSchema,
  defaultSettings,
  DEFAULT_CALENDAR_COLOR,
  GOOGLE_EVENT_COLORS,
  type CalendarEvent,
  type RangeData,
  type SessionUser,
  type Settings,
  type SyncStatus,
  type Task,
  type TaskList,
} from './shared/model';
import {
  ColorPicker,
  CreationDialog,
  EventEditor,
  FeedbackContext,
  Modal,
  TaskEditor,
} from './components/Dialogs';

type Editor =
  | { kind: 'task'; task?: Task; date?: string; draft?: { title: string; description: string } }
  | {
      kind: 'event';
      event?: CalendarEvent;
      date?: string;
      draft?: { title: string; description: string };
    }
  | null;
type ExpandedMonthDay = {
  monthStart: string;
  date: string;
};
const todayString = () => DateTime.now().toISODate()!;
const initRange = () => {
  const now = DateTime.now().startOf('month');
  return {
    start: now.minus({ days: now.weekday % 7 }).toISODate()!,
    end: now.plus({ months: 1, days: 7 }).toISODate()!,
  };
};
function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={`logo ${small ? 'small' : ''}`}>
      <span className="logo-icon">
        <CalendarDays size={small ? 18 : 23} strokeWidth={1.8} />
        <Check className="logo-tick" size={small ? 8 : 10} />
      </span>
      {!small && (
        <span>
          daymark<span className="brand-dot">.</span>
        </span>
      )}
    </span>
  );
}

function MiniCalendar({
  date,
  selected,
  weekStart,
  onPick,
}: {
  date: string;
  selected: string;
  weekStart: number;
  onPick: (date: string) => void;
}) {
  const [month, setMonth] = useState(() => DateTime.fromISO(date).startOf('month'));
  useEffect(() => setMonth(DateTime.fromISO(date).startOf('month')), [date.slice(0, 7)]);
  const start = month.minus({ days: ((month.weekday % 7) - weekStart + 7) % 7 });
  return (
    <div className="mini-calendar">
      <div className="mini-heading">
        <strong>{month.toFormat('MMMM yyyy')}</strong>
        <div>
          <button
            className="icon-button small"
            aria-label="Previous mini calendar month"
            onClick={() => setMonth(month.minus({ months: 1 }))}
          >
            <ChevronLeft size={15} />
          </button>
          <button
            className="icon-button small"
            aria-label="Next mini calendar month"
            onClick={() => setMonth(month.plus({ months: 1 }))}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
      <div className="mini-grid">
        {Array.from({ length: 7 }, (_, i) => (
          <span className="mini-weekday" key={i}>
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'][(i + weekStart) % 7]}
          </span>
        ))}
        {Array.from({ length: 42 }, (_, i) => {
          const d = start.plus({ days: i });
          const iso = d.toISODate()!;
          return (
            <button
              key={iso}
              aria-label={d.toLocaleString(DateTime.DATE_FULL)}
              aria-current={iso === todayString() ? 'date' : undefined}
              className={`${d.month !== month.month ? 'outside' : ''} ${iso === todayString() ? 'today' : ''} ${iso === selected ? 'selected' : ''}`}
              onClick={() => onPick(iso)}
            >
              {d.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function App() {
  const queryClient = useQueryClient();
  const calendarRef = useRef<FullCalendar>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [settings, setSettings] = useState<Settings>(
    () => demoState().settings || defaultSettings(),
  );
  const demo = !user;
  const mode = demo ? 'demo' : user.id;
  const client = useMemo(() => makeClient(demo), [demo]);
  const [range, setRange] = useState(initRange);
  const [title, setTitle] = useState(DateTime.now().toFormat('MMMM yyyy'));
  const [view, setView] = useState('dayGridMonth');
  const [expandedMonthDay, setExpandedMonthDay] = useState<ExpandedMonthDay | null>(null);
  const [currentMonthStart, setCurrentMonthStart] = useState(
    DateTime.now().startOf('month').toISODate(),
  );
  const [selectedDate, setSelectedDate] = useState(todayString);
  const [sidebar, setSidebar] = useState(() => window.innerWidth > 900);
  const [taskPanel, setTaskPanel] = useState(() => window.innerWidth > 1100);
  const [editor, setEditor] = useState<Editor>(null);
  const [createMenu, setCreateMenu] = useState(false);
  const [dialog, setDialog] = useState<'settings' | 'about' | 'privacy' | 'connect' | null>(
    location.pathname === '/privacy' ? 'privacy' : null,
  );
  const [listEditor, setListEditor] = useState<Partial<TaskList> | null>(null);
  const [listName, setListName] = useState('');
  const [listColor, setListColor] = useState<string | null>('#77946d');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('open');
  const [taskListFilter, setTaskListFilter] = useState('');
  const monthDayIsExpanded =
    expandedMonthDay !== null && expandedMonthDay.monthStart === currentMonthStart;

  useEffect(() => {
    if (!monthDayIsExpanded || !expandedMonthDay) return;

    let button: HTMLButtonElement | null = null;
    const frame = requestAnimationFrame(() => {
      const calendar = document.querySelector<HTMLElement>('.calendar-container');
      const dayBottom = calendar?.querySelector<HTMLElement>(
        `[data-date="${expandedMonthDay.date}"] .fc-daygrid-day-bottom`,
      );
      if (!dayBottom) return;

      button = document.createElement('button');
      button.type = 'button';
      button.className = 'fc-daygrid-more-link fc-more-link';
      button.textContent = 'Hide';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const dayCell = dayBottom.closest<HTMLElement>('[data-date]');
        const dayTop = dayCell?.getBoundingClientRect().top;
        const expandedDate = expandedMonthDay.date;
        const restoreDayTop = () => {
          const restoredDay = document.querySelector<HTMLElement>(
            `.calendar-container [data-date="${expandedDate}"]`,
          );
          const restoredScroller = restoredDay?.closest<HTMLElement>('.fc-scroller');
          if (restoredDay && restoredScroller && dayTop !== undefined) {
            const difference = restoredDay.getBoundingClientRect().top - dayTop;
            if (difference > 0.5) {
              const desiredScrollTop = restoredScroller.scrollTop + difference;
              const maximumScrollTop =
                restoredScroller.scrollHeight - restoredScroller.clientHeight;
              if (desiredScrollTop > maximumScrollTop) {
                let spacer = restoredScroller.querySelector<HTMLElement>(
                  ':scope > .calendar-collapse-spacer',
                );
                if (!spacer) {
                  spacer = document.createElement('div');
                  spacer.className = 'calendar-collapse-spacer';
                  restoredScroller.appendChild(spacer);
                }
                const currentHeight = Number.parseFloat(spacer.style.height || '0');
                spacer.style.height = `${currentHeight + desiredScrollTop - maximumScrollTop}px`;
                void spacer.offsetHeight;
              }
              restoredScroller.scrollTop = desiredScrollTop;
            } else if (difference < -0.5) {
              restoredScroller.scrollTop += difference;
            }
            return Math.abs(difference) <= 0.5;
          }
          return false;
        };
        setExpandedMonthDay(null);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            calendarRef.current?.getApi().updateSize();
            let attempts = 0;
            let stableChecks = 0;
            const anchor = window.setInterval(() => {
              const restoredDay = document.querySelector<HTMLElement>(
                `.calendar-container [data-date="${expandedDate}"]`,
              );
              if (restoredDay && restoreDayTop()) stableChecks += 1;
              else stableChecks = 0;
              attempts += 1;
              if (stableChecks >= 3 || attempts >= 20) window.clearInterval(anchor);
            }, 50);
          });
        });
      });
      dayBottom.appendChild(button);
    });

    return () => {
      cancelAnimationFrame(frame);
      button?.remove();
    };
  }, [expandedMonthDay, monthDayIsExpanded]);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [page, setPage] = useState(0);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const config = await request<{ configured: boolean }>('/config');
        if (!alive) return;
        setConfigured(config.configured);
        if (config.configured && !new URLSearchParams(location.search).has('demo')) {
          try {
            const me = await request<{
              user: SessionUser;
              settings: Settings;
              hasSettings: boolean;
            }>('/me');
            const s = me.hasSettings ? me.settings : defaultSettings();
            if (!me.hasSettings) await request('/settings', 'PUT', s);
            if (alive) {
              setSettings(s);
              setUser(me.user);
            }
          } catch {
            /* Public demo is available before login. */
          }
        }
      } catch {
        /* Local demo remains available without a running Worker. */
      } finally {
        if (alive) setAuthReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!authReady) return;
    const params = new URLSearchParams(location.search);
    if (params.has('authError'))
      setToast('Sign-in was not completed. Please use an invited Google account.');
    const id = params.get('task');
    if (!id || demo) return;
    void request<Task>(`/tasks/${encodeURIComponent(id)}`)
      .then((task) => setEditor({ kind: 'task', task }))
      .catch((e) => setToast((e as Error).message));
  }, [authReady, mode]);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme =
        settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : settings.theme;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [settings.theme]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => setPage(0), [filter, taskListFilter, deferredSearch]);
  const listsQuery = useQuery({ queryKey: [mode, 'lists'], queryFn: client.lists });
  const lists = listsQuery.data || [];
  const calendarsQuery = useQuery({
    queryKey: [mode, 'calendars'],
    queryFn: client.calendars,
    staleTime: 60_000,
  });
  const calendars = calendarsQuery.data || [];
  const rangeQuery = useQuery({
    queryKey: [mode, 'range', range.start, range.end, settings.timeZone],
    queryFn: async () => {
      const cached = queryClient
        .getQueryCache()
        .findAll({ queryKey: [mode, 'range'] })
        .find(
          (q) =>
            !q.state.isInvalidated &&
            q.queryKey[2] !== range.start &&
            String(q.queryKey[2]) <= range.start &&
            String(q.queryKey[3]) >= range.end &&
            q.queryKey[4] === settings.timeZone &&
            Date.now() - q.state.dataUpdatedAt < 30_000,
        );
      if (cached?.state.data) {
        const d = cached.state.data as RangeData;
        return { ...d, tasks: d.tasks.filter((t) => taskOverlaps(t, range.start, range.end)) };
      }
      return client.range(range.start, range.end);
    },
    refetchInterval: demo ? false : 60_000,
    refetchIntervalInBackground: false,
  });
  const panelQuery = useQuery({
    queryKey: [mode, 'task-panel', deferredSearch, filter, taskListFilter, page],
    queryFn: () => client.search(deferredSearch, filter, taskListFilter || undefined, page),
    enabled: taskPanel,
  });
  const syncQuery = useQuery({
    queryKey: [mode, 'sync'],
    queryFn: async () => {
      const status = await request<SyncStatus>('/sync');
      if (status.pending && !status.reconnect)
        void request('/sync/pump', 'POST', {}).catch(() => {});
      return status;
    },
    enabled: !demo,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const saved = useCallback(
    (message: string) => {
      void queryClient.invalidateQueries({ queryKey: [mode] });
      setToast(message);
    },
    [mode, queryClient],
  );
  const tasks = rangeQuery.data?.tasks || [];
  const events = rangeQuery.data?.events || [];
  const visibleTasks = tasks.filter(
    (t) => !hidden.has(`list:${t.listId}`) && (settings.showCompleted || !t.completed),
  );
  const visibleEvents = events.filter((e) => !hidden.has(`calendar:${e.calendarId}`));
  const calendarEvents = useMemo<FCEvent[]>(
    () => [
      ...visibleTasks.map((t) => ({
        id: `task:${t.id}`,
        title: t.title,
        start: t.startDate || t.dueDate!,
        end: addDays(t.dueDate!, 1),
        allDay: true,
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        classNames: [
          'calendar-task',
          ...(t.completed ? ['completed'] : []),
          ...(isOverdue(t) ? ['overdue'] : []),
        ],
        extendedProps: {
          kind: 'task',
          task: t,
          color: t.color || lists.find((l) => l.id === t.listId)?.color || '#77946d',
        },
      })),
      ...visibleEvents.map((e) => ({
        id: `event:${e.calendarId}:${e.id}`,
        title: e.summary,
        start: e.start.date || e.start.dateTime,
        end: e.end.date || e.end.dateTime,
        allDay: !!e.start.date,
        editable:
          ['owner', 'writer'].includes(
            calendars.find((c) => c.id === e.calendarId)?.accessRole || '',
          ) &&
          (!e.eventType || e.eventType === 'default') &&
          (!e.organizer || e.organizer.self || e.guestsCanModify),
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        classNames: ['calendar-event'],
        extendedProps: {
          kind: 'event',
          event: e,
          color:
            GOOGLE_EVENT_COLORS.find((color) => color.id === e.colorId)?.hex ||
            calendars.find((c) => c.id === e.calendarId)?.backgroundColor ||
            DEFAULT_CALENDAR_COLOR.hex,
        },
      })),
    ],
    [visibleTasks, visibleEvents, lists, calendars],
  );
  function goTo(date: string, day = false) {
    const api = calendarRef.current?.getApi();
    if (day) {
      api?.changeView('timeGridDay', date);
      setView('timeGridDay');
    } else api?.gotoDate(date);
    setSelectedDate(date);
    if (window.innerWidth < 900) setSidebar(false);
  }
  function changeView(next: string) {
    calendarRef.current?.getApi().changeView(next);
    setView(next);
  }
  function datesSet(info: DatesSetArg) {
    setRange({ start: info.startStr.slice(0, 10), end: info.endStr.slice(0, 10) });
    setTitle(info.view.title);
    setSelectedDate(info.view.currentStart.toISOString().slice(0, 10));
    setCurrentMonthStart(info.view.currentStart.toISOString().slice(0, 10));
  }
  async function toggleTask(t: Task) {
    try {
      await client.saveTask({ ...t, completed: !t.completed }, t);
      saved(t.completed ? 'Task reopened' : 'Task completed');
    } catch (e) {
      setToast((e as Error).message);
    }
  }
  function toggleVisible(key: string) {
    setHidden((s) => {
      const n = new Set(s);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  }
  async function signIn() {
    if (!configured) {
      setDialog('connect');
      return;
    }
    setBusy(true);
    try {
      const callback = new URL(location.href);
      callback.searchParams.delete('demo');
      callback.searchParams.delete('authError');
      const result = await request<{ url: string }>('/auth/sign-in/social', 'POST', {
        provider: 'google',
        callbackURL: callback.href,
        errorCallbackURL: `${location.origin}/?authError=1`,
      });
      location.assign(result.url);
    } catch (e) {
      setToast((e as Error).message);
      setBusy(false);
    }
  }
  async function logout() {
    await request('/auth/sign-out', 'POST', {});
    queryClient.clear();
    location.assign('/?demo=1');
  }
  async function updateSettings(next: Settings) {
    setSettings(next);
    try {
      await client.saveSettings(next);
      void queryClient.invalidateQueries({ queryKey: [mode, 'range'] });
    } catch (e) {
      setToast((e as Error).message);
    }
  }
  function openList(list?: TaskList) {
    setListEditor(list || {});
    setListName(list?.name || '');
    setListColor(list?.color || '#77946d');
  }
  async function exportData() {
    try {
      const backup = await client.export();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `daymark-${todayString()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setToast('Your task backup is ready.');
    } catch (e) {
      setToast((e as Error).message);
    }
  }
  const renderEvent = (arg: EventContentArg) => {
    const { kind, task, event, color } = arg.event.extendedProps as {
      kind: string;
      task?: Task;
      event?: CalendarEvent;
      color: string;
    };
    return (
      <div className="event-card" style={{ '--event-color': color } as React.CSSProperties}>
        <div className="event-card-title">
          {kind === 'task' && task ? (
            <button
              className={`event-check ${task.completed ? 'checked' : ''}`}
              aria-label={`${task.completed ? 'Reopen' : 'Complete'} ${task.title}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                void toggleTask(task);
              }}
            >
              {task.completed ? <Check size={11} /> : <span />}
            </button>
          ) : null}
          <span>{arg.event.title}</span>
          {task?.recurrence && <RefreshCw className="event-repeat" size={10} />}
        </div>
        {kind === 'event' && event?.start.dateTime && (
          <div className="event-card-time">
            <Clock3 size={11} />
            {formatTime(event.start.dateTime, settings.timeZone, settings.hour24)}–
            {formatTime(event.end.dateTime!, settings.timeZone, settings.hour24)}
          </div>
        )}
        {task?.dueTime && arg.isEnd && (
          <div className="task-deadline">
            Due{' '}
            {DateTime.fromISO(`${task.dueDate}T${task.dueTime}`, { zone: task.timeZone }).toFormat(
              settings.hour24 ? 'HH:mm' : 'h:mm a',
            )}
          </div>
        )}
      </div>
    );
  };
  const taskRows = panelQuery.data?.tasks || [];
  const completedCount = tasks.filter((t) => t.completed).length;
  return (
    <FeedbackContext.Provider value={toast}>
      <div className="app-shell">
        <header className="topbar">
          <div className="brand-area">
            <button
              className="icon-button menu-toggle"
              aria-label="Toggle sidebar"
              aria-expanded={sidebar}
              onClick={() => setSidebar(!sidebar)}
            >
              <Menu size={20} />
            </button>
            <Logo />
          </div>
          <div className="topbar-actions">
            {demo ? (
              <span className="demo-badge">
                <span />
                Demo workspace
              </span>
            ) : (
              <button
                className="sync-label"
                onClick={() => {
                  if (syncQuery.data?.reconnect) {
                    void signIn();
                    return;
                  }
                  void request('/sync/retry', 'POST', {})
                    .then(() => saved('Sync requested'))
                    .catch((e: Error) => setToast(e.message));
                }}
              >
                <RefreshCw size={13} />
                {syncQuery.data?.reconnect
                  ? 'Reconnect Google'
                  : syncQuery.data?.failed
                    ? 'Sync needs attention'
                    : syncQuery.data?.pending
                      ? `${syncQuery.data.pending} pending`
                      : 'Connected to Google'}
              </button>
            )}
            <button
              className="icon-button"
              aria-label="Help and about"
              onClick={() => setDialog('about')}
            >
              <CircleHelp size={19} />
            </button>
            <button
              className="icon-button"
              aria-label="Settings"
              onClick={() => setDialog('settings')}
            >
              <Settings2 size={19} />
            </button>
            {demo ? (
              <button
                className="button connect-button"
                onClick={() => void signIn()}
                disabled={busy || !authReady}
              >
                Connect Google <ArrowUpRight size={15} />
              </button>
            ) : (
              <button className="avatar" title={user.email} onClick={() => setDialog('settings')}>
                {user.name.slice(0, 1).toUpperCase()}
              </button>
            )}
          </div>
        </header>
        <div className="workspace">
          {sidebar && (
            <>
              <button
                className="mobile-backdrop"
                aria-label="Close sidebar"
                onClick={() => setSidebar(false)}
              />
              <aside className="sidebar">
                <div className="create-wrapper">
                  <button
                    className="create-button"
                    aria-expanded={createMenu}
                    aria-controls="create-menu"
                    onClick={() => setCreateMenu(!createMenu)}
                  >
                    <Plus size={20} />
                    <span>Create</span>
                    <ChevronDown size={15} />
                  </button>
                  {createMenu && (
                    <div id="create-menu" className="create-menu">
                      <button
                        onClick={() => {
                          setCreateMenu(false);
                          setEditor({ kind: 'task', date: todayString() });
                        }}
                      >
                        <ListTodo size={16} />
                        Task
                      </button>
                      <button
                        onClick={() => {
                          setCreateMenu(false);
                          setEditor({ kind: 'event', date: todayString() });
                        }}
                      >
                        <CalendarDays size={16} />
                        Event
                      </button>
                    </div>
                  )}
                </div>
                <MiniCalendar
                  date={selectedDate}
                  selected={selectedDate}
                  weekStart={settings.weekStart}
                  onPick={(d) => goTo(d)}
                />
                <div className="sidebar-section">
                  <div className="section-label">
                    My calendars <ChevronDown size={13} />
                  </div>
                  {calendars.map((c) => (
                    <button
                      key={c.id}
                      className="visibility-row"
                      onClick={() => toggleVisible(`calendar:${c.id}`)}
                      aria-pressed={!hidden.has(`calendar:${c.id}`)}
                    >
                      <span
                        className={`visibility-check ${hidden.has(`calendar:${c.id}`) ? 'off' : ''}`}
                        style={{ '--check-color': c.backgroundColor } as React.CSSProperties}
                      >
                        {!hidden.has(`calendar:${c.id}`) && <Check size={12} />}
                      </span>
                      <span>{c.summary}</span>
                      {c.accessRole === 'reader' && <span className="tiny-label">view</span>}
                    </button>
                  ))}
                  {calendarsQuery.isError && (
                    <p className="sidebar-note">
                      Google calendars are unavailable. Your tasks are still here.
                    </p>
                  )}
                </div>
                <div className="sidebar-section">
                  <div className="section-label">
                    Task lists{' '}
                    <button
                      className="icon-button small"
                      aria-label="Create task list"
                      onClick={() => openList()}
                    >
                      <Plus size={15} />
                    </button>
                  </div>
                  {lists.map((l) => (
                    <div className="list-visibility" key={l.id}>
                      <button
                        className="visibility-row"
                        onClick={() => toggleVisible(`list:${l.id}`)}
                        aria-pressed={!hidden.has(`list:${l.id}`)}
                      >
                        <span
                          className={`visibility-check ${hidden.has(`list:${l.id}`) ? 'off' : ''}`}
                          style={{ '--check-color': l.color } as React.CSSProperties}
                        >
                          {!hidden.has(`list:${l.id}`) && <Check size={12} />}
                        </span>
                        <span>{l.name}</span>
                      </button>
                      <button
                        className="icon-button small list-edit"
                        aria-label={`Edit ${l.name} list`}
                        onClick={() => openList(l)}
                      >
                        <MoreHorizontal size={15} />
                      </button>
                    </div>
                  ))}
                  <button
                    className="show-completed"
                    aria-pressed={settings.showCompleted}
                    onClick={() =>
                      void updateSettings({ ...settings, showCompleted: !settings.showCompleted })
                    }
                  >
                    <span className={`neutral-checkbox ${settings.showCompleted ? 'checked' : ''}`}>
                      {settings.showCompleted && <Check size={11} />}
                    </span>
                    Show completed tasks
                  </button>
                </div>
                <div className="sidebar-bottom">
                  <button className="privacy-link" onClick={() => setDialog('privacy')}>
                    Privacy & your data <ArrowUpRight size={12} />
                  </button>
                </div>
              </aside>
            </>
          )}
          <main className="calendar-main">
            <div className="calendar-toolbar">
              <div className="calendar-title-group">
                <h1>{title}</h1>
              </div>
              <div className="calendar-controls">
                <button
                  className="button today-button"
                  onClick={() => calendarRef.current?.getApi().today()}
                >
                  Today
                </button>
                <div className="nav-buttons">
                  <button
                    className="icon-button"
                    aria-label="Previous period"
                    onClick={() => calendarRef.current?.getApi().prev()}
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Next period"
                    onClick={() => calendarRef.current?.getApi().next()}
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
                <div className="view-switch" aria-label="Calendar view">
                  {[
                    ['dayGridMonth', 'Month'],
                    ['timeGridWeek', 'Week'],
                    ['timeGridDay', 'Day'],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      aria-pressed={view === value}
                      className={view === value ? 'active' : ''}
                      onClick={() => changeView(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  className={`icon-button task-panel-toggle ${taskPanel ? 'active' : ''}`}
                  aria-label="Toggle task panel"
                  aria-expanded={taskPanel}
                  onClick={() => setTaskPanel(!taskPanel)}
                >
                  {taskPanel ? <PanelRightClose size={19} /> : <PanelRightOpen size={19} />}
                </button>
              </div>
            </div>
            {rangeQuery.data?.errors.length ? (
              <div className="range-warning" role="status">
                <AlertCircle size={15} />
                <span>{rangeQuery.data.errors[0]}</span>
                <button className="text-button" onClick={() => void rangeQuery.refetch()}>
                  Retry
                </button>
                {rangeQuery.data.errors[0].includes('Reconnect') && (
                  <button className="text-button" onClick={() => void signIn()}>
                    Reconnect
                  </button>
                )}
              </div>
            ) : null}
            {rangeQuery.isError && (
              <div className="range-warning" role="alert">
                <AlertCircle size={15} />
                {(rangeQuery.error as Error).message}
                <button className="text-button" onClick={() => void rangeQuery.refetch()}>
                  Retry
                </button>
              </div>
            )}
            <div className={`calendar-container ${rangeQuery.isFetching ? 'is-fetching' : ''}`}>
              <FullCalendar
                ref={calendarRef}
                plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, luxonPlugin]}
                initialView={view}
                initialDate={currentMonthStart}
                headerToolbar={false}
                height="100%"
                timeZone={settings.timeZone}
                firstDay={settings.weekStart}
                fixedWeekCount
                showNonCurrentDates
                nowIndicator
                editable
                selectable
                selectMirror
                eventResizableFromStart
                dayMaxEvents={monthDayIsExpanded ? false : 3}
                moreLinkContent={(info) => `Show + ${info.num} more`}
                moreLinkClick={(info) => {
                  document
                    .querySelectorAll('.calendar-collapse-spacer')
                    .forEach((spacer) => spacer.remove());
                  setExpandedMonthDay({
                    monthStart: info.view.currentStart.toISOString().slice(0, 10),
                    date: info.date.toISOString().slice(0, 10),
                  });
                  // FullCalendar treats a void return as a request to open its popover.
                  // A truthy non-view result cancels that default without navigating or scrolling.
                  return true as never;
                }}
                slotMinTime="00:00:00"
                slotMaxTime="24:00:00"
                scrollTime="08:00:00"
                slotDuration="00:30:00"
                allDayText="tasks & all-day"
                eventTimeFormat={{ hour: 'numeric', minute: '2-digit', hour12: !settings.hour24 }}
                slotLabelFormat={{ hour: 'numeric', minute: '2-digit', hour12: !settings.hour24 }}
                events={calendarEvents}
                eventOrder="-duration,allDay,start,title"
                datesSet={datesSet}
                navLinks
                navLinkDayClick={(date) =>
                  goTo(DateTime.fromJSDate(date).setZone(settings.timeZone).toISODate()!, true)
                }
                dateClick={(info) =>
                  setEditor(
                    info.allDay
                      ? { kind: 'task', date: info.dateStr.slice(0, 10) }
                      : { kind: 'event', date: info.dateStr },
                  )
                }
                select={(info) => {
                  if (
                    info.startStr.slice(0, 10) !== addDays(info.endStr.slice(0, 10), -1) &&
                    info.allDay
                  ) {
                    setEditor({ kind: 'task', date: info.startStr.slice(0, 10) });
                  }
                  calendarRef.current?.getApi().unselect();
                }}
                eventClick={(info) => {
                  const props = info.event.extendedProps;
                  if (props.kind === 'task') setEditor({ kind: 'task', task: props.task });
                  else setEditor({ kind: 'event', event: props.event });
                }}
                eventContent={renderEvent}
                eventChange={async (info) => {
                  const props = info.event.extendedProps;
                  try {
                    if (props.kind === 'task') {
                      const t = props.task as Task;
                      const start = info.event.startStr.slice(0, 10);
                      const due = addDays(info.event.endStr.slice(0, 10), -1);
                      const draft = {
                        ...t,
                        startDate: t.startDate || start !== due ? start : null,
                        dueDate: due,
                      };
                      if (t.seriesId) {
                        info.revert();
                        setEditor({ kind: 'task', task: draft });
                        return;
                      }
                      await client.saveTask(draft, t);
                      saved('Task dates updated');
                    } else {
                      const e = props.event as CalendarEvent;
                      const moved = {
                        ...e,
                        start: info.event.allDay
                          ? { date: info.event.startStr.slice(0, 10) }
                          : { dateTime: info.event.startStr, timeZone: settings.timeZone },
                        end: info.event.allDay
                          ? { date: info.event.endStr.slice(0, 10) }
                          : { dateTime: info.event.endStr, timeZone: settings.timeZone },
                      };
                      info.revert();
                      setEditor({ kind: 'event', event: moved });
                    }
                  } catch (e) {
                    info.revert();
                    setToast((e as Error).message);
                  }
                }}
                />
            </div>
            <footer className="calendar-footer">
              {!demo && (
                <div>
                  <span className="status-dot" />
                  {rangeQuery.isFetching ? 'Refreshing your calendar…' : 'Calendar up to date'}
                </div>
              )}
              <span>
                {visibleTasks.length} tasks <span className="footer-divider">·</span>{' '}
                {completedCount} completed <span className="footer-divider">·</span>{' '}
                {settings.timeZone.split('/').pop()?.replaceAll('_', ' ')}
              </span>
            </footer>
          </main>
          {taskPanel && (
            <aside className="task-panel">
              <div className="task-panel-heading">
                <div>
                  <ListTodo size={18} />
                  <h2>My tasks</h2>
                  <span className="count-pill">
                    {taskRows.length}
                    {panelQuery.data?.hasMore ? '+' : ''}
                  </span>
                </div>
                <button
                  className="icon-button small"
                  aria-label="Add task"
                  onClick={() => setEditor({ kind: 'task' })}
                >
                  <Plus size={18} />
                </button>
              </div>
              <div className="task-search">
                <Search size={15} />
                <input
                  aria-label="Search tasks"
                  placeholder="Find a task…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button
                    className="icon-button small"
                    aria-label="Clear search"
                    onClick={() => setSearch('')}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
              <div className="task-filter-row">
                <select
                  aria-label="Task filter"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="open">To do</option>
                  <option value="all">All tasks</option>
                  <option value="overdue">Overdue</option>
                  <option value="undated">Unscheduled</option>
                  <option value="completed">Completed</option>
                </select>
                <select
                  aria-label="Filter task list"
                  value={taskListFilter}
                  onChange={(e) => setTaskListFilter(e.target.value)}
                >
                  <option value="">All lists</option>
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="panel-task-list">
                {panelQuery.isError && (
                  <p className="form-error">
                    Couldn’t load tasks.{' '}
                    <button className="text-button" onClick={() => void panelQuery.refetch()}>
                      Retry
                    </button>
                  </p>
                )}
                {!panelQuery.isLoading && !taskRows.length && (
                  <div className="empty-tasks">
                    <CheckCheck size={30} />
                    <strong>No tasks</strong>
                    <p>
                      {search
                        ? 'No tasks match your search.'
                        : 'No tasks match the selected filters.'}
                    </p>
                  </div>
                )}
                {taskRows.map((t) => {
                  const list = lists.find((l) => l.id === t.listId);
                  const overdue = isOverdue(t);
                  return (
                    <div className={`panel-task ${t.completed ? 'completed' : ''}`} key={t.id}>
                      <button
                        className={`task-checkbox ${t.completed ? 'checked' : ''}`}
                        aria-label={`${t.completed ? 'Reopen' : 'Complete'} ${t.title}`}
                        onClick={() => void toggleTask(t)}
                      >
                        {t.completed && <Check size={12} />}
                      </button>
                      <button
                        className="panel-task-body"
                        onClick={() => setEditor({ kind: 'task', task: t })}
                      >
                        <span className="panel-task-title">{t.title}</span>
                        <span className="panel-task-meta">
                          <span
                            className="list-dot"
                            style={{ background: t.color || list?.color }}
                          />
                          {list?.name}
                          <span className="meta-separator">·</span>
                          <span className={overdue ? 'overdue-text' : ''}>
                            {t.dueDate
                              ? t.dueDate === todayString()
                                ? 'Today'
                                : DateTime.fromISO(t.dueDate).toFormat('MMM d')
                              : 'No date'}
                          </span>
                          {t.recurrence && <RefreshCw size={10} />}
                        </span>
                        {t.checklist.length > 0 && (
                          <span className="check-progress">
                            <span>
                              <i
                                style={{
                                  width: `${(100 * t.checklist.filter((i) => i.completed).length) / t.checklist.length}%`,
                                  background: list?.color,
                                }}
                              />
                            </span>
                            {t.checklist.filter((i) => i.completed).length}/{t.checklist.length}
                          </span>
                        )}
                      </button>
                    </div>
                  );
                })}
                <button className="add-task-inline" onClick={() => setEditor({ kind: 'task' })}>
                  <Plus size={16} />
                  Add a task
                </button>
                {(page > 0 || panelQuery.data?.hasMore) && (
                  <div className="pagination">
                    <button
                      className="icon-button"
                      disabled={!page}
                      aria-label="Previous task page"
                      onClick={() => setPage(page - 1)}
                    >
                      <ChevronLeft size={17} />
                    </button>
                    <span>Page {page + 1}</span>
                    <button
                      className="icon-button"
                      disabled={!panelQuery.data?.hasMore}
                      aria-label="Next task page"
                      onClick={() => setPage(page + 1)}
                    >
                      <ChevronRight size={17} />
                    </button>
                  </div>
                )}
              </div>
            </aside>
          )}
        </div>
        {editor?.kind === 'task' && editor.task && (
          <TaskEditor
            key={editor.task.id}
            client={client}
            settings={settings}
            lists={lists}
            task={editor.task}
            onClose={() => setEditor(null)}
            onSaved={saved}
          />
        )}
        {editor?.kind === 'event' && editor.event && (
          <EventEditor
            key={editor.event.id}
            client={client}
            settings={settings}
            calendars={calendars}
            event={editor.event}
            onClose={() => setEditor(null)}
            onSaved={saved}
          />
        )}
        {editor &&
          ((editor.kind === 'task' && !editor.task) ||
            (editor.kind === 'event' && !editor.event)) && (
            <CreationDialog kind={editor.kind} onClose={() => setEditor(null)}>
              {editor.kind === 'task' ? (
                <TaskEditor
                  key={`new-task-${editor.date}`}
                  draft={editor.draft}
                  onSwitch={({ date, ...draft }) => setEditor({ kind: 'event', date, draft })}
                  client={client}
                  settings={settings}
                  lists={lists}
                  date={editor.date}
                  onClose={() => setEditor(null)}
                  onSaved={saved}
                />
              ) : (
                <EventEditor
                  key={`new-event-${editor.date}`}
                  draft={editor.draft}
                  onSwitch={({ date, ...draft }) => setEditor({ kind: 'task', date, draft })}
                  client={client}
                  settings={settings}
                  calendars={calendars}
                  date={editor.date}
                  onClose={() => setEditor(null)}
                  onSaved={saved}
                />
              )}
            </CreationDialog>
          )}
        {listEditor && (
          <Modal
            title={listEditor.id ? 'Edit task list' : 'New task list'}
            onClose={() => setListEditor(null)}
          >
            <form
              className="editor-form"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await client.saveList({ name: listName, color: listColor! }, listEditor.id);
                  saved('Task list saved');
                  setListEditor(null);
                } catch (err) {
                  setToast((err as Error).message);
                }
              }}
            >
              <label>
                List name
                <input
                  autoFocus
                  aria-label="List name"
                  required
                  maxLength={80}
                  placeholder="School, Personal, Projects…"
                  value={listName}
                  onChange={(e) => setListName(e.target.value)}
                />
              </label>
              <label>Color</label>
              <ColorPicker value={listColor} onChange={setListColor} />
              <div className="modal-footer">
                <button className="button primary">Save list</button>
              </div>
            </form>
          </Modal>
        )}
        {dialog === 'settings' && (
          <Modal
            title="Settings"
            description="A few preferences for your calendar."
            onClose={() => setDialog(null)}
          >
            <div className="settings-content">
              <div className="section-label">Appearance</div>
              <div className="theme-choices">
                {(
                  [
                    ['system', Monitor, 'System'],
                    ['light', Sun, 'Light'],
                    ['dark', Moon, 'Dark'],
                  ] as const
                ).map(([theme, Icon, label]) => (
                  <button
                    key={theme}
                    className={settings.theme === theme ? 'selected' : ''}
                    aria-pressed={settings.theme === theme}
                    onClick={() => void updateSettings({ ...settings, theme })}
                  >
                    <Icon size={21} />
                    {label}
                  </button>
                ))}
              </div>
              <div className="form-grid">
                <label>
                  Week starts on
                  <select
                    value={settings.weekStart}
                    onChange={(e) =>
                      void updateSettings({
                        ...settings,
                        weekStart: Number(e.target.value) as 0 | 1,
                      })
                    }
                  >
                    <option value={0}>Sunday</option>
                    <option value={1}>Monday</option>
                  </select>
                </label>
                <label>
                  Time format
                  <select
                    value={String(settings.hour24)}
                    onChange={(e) =>
                      void updateSettings({ ...settings, hour24: e.target.value === 'true' })
                    }
                  >
                    <option value="false">12-hour · 2:30 PM</option>
                    <option value="true">24-hour · 14:30</option>
                  </select>
                </label>
              </div>
              <label>
                Calendar time zone
                <select
                  value={settings.timeZone}
                  onChange={(e) => void updateSettings({ ...settings, timeZone: e.target.value })}
                >
                  {[...new Set([settings.timeZone, ...Intl.supportedValuesOf('timeZone')])].map(
                    (zone) => (
                      <option key={zone}>{zone}</option>
                    ),
                  )}
                </select>
              </label>
              <div className="section-label settings-section">Your data</div>
              <p className="muted small-text">
                Export your complete task history, dates, checklists, and colors. Google credentials
                are never included.
              </p>
              <div className="settings-data-actions">
                <button className="button secondary" onClick={() => void exportData()}>
                  <Download size={15} />
                  Export tasks
                </button>
                <button className="button secondary" onClick={() => importRef.current?.click()}>
                  <Upload size={15} />
                  Restore backup
                </button>
              </div>
              <p className="muted small-text">
                {demo
                  ? 'Restoring replaces this browser’s demo tasks.'
                  : 'Restore adds your backup to an empty task account; existing history is never overwritten.'}
              </p>
              <input
                hidden
                ref={importRef}
                type="file"
                accept="application/json,.json"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const backup = backupSchema.parse(JSON.parse(await file.text()));
                    await client.restore(backup);
                    setSettings(backup.settings);
                    saved('Task backup restored');
                  } catch (err) {
                    setToast((err as Error).message);
                  }
                  e.target.value = '';
                }}
              />
              {demo ? (
                <button
                  className="text-button settings-section"
                  onClick={() => {
                    resetDemo();
                    setSettings(demoState().settings);
                    saved('Demo reset. A fresh start.');
                  }}
                >
                  Reset demo workspace <RefreshCw size={14} />
                </button>
              ) : (
                <>
                  <p className="signed-in-note">Signed in as {user.email}</p>
                  <button className="text-button" onClick={() => void logout()}>
                    <LogOut size={16} />
                    Sign out
                  </button>
                </>
              )}
            </div>
          </Modal>
        )}
        {dialog === 'connect' && (
          <Modal
            title="Your calendar, connected"
            description="Google sign-in is not configured on this deployment yet."
            onClose={() => setDialog(null)}
          >
            <div className="prose">
              <p>
                The interactive demo is ready to explore. To use your real calendar, the app owner
                needs to configure a Google OAuth client and an invitation list on the server.
              </p>
              <p>
                Your Google password is never entered here. Once configured, Google will ask you to
                authorize calendar and task access.
              </p>
              <button className="button primary" onClick={() => setDialog(null)}>
                Explore the demo <ArrowRight size={16} />
              </button>
            </div>
          </Modal>
        )}
        {dialog === 'about' && (
          <Modal title="About Daymark" onClose={() => setDialog(null)}>
            <div className="prose">
              <Logo />
              <p>Daymark brings events, assignments, and multi-day tasks into one calm calendar.</p>
              <p>
                Tasks stretch from their start date through their deadline. Check them off and they
                stay in place—a record of what you’ve done. Click a date to open its hourly
                timeline.
              </p>
              <div className="about-actions">
                <button
                  className="button primary"
                  onClick={() => {
                    setDialog(null);
                    setEditor({ kind: 'event', date: todayString() });
                  }}
                >
                  <CalendarDays size={16} />
                  Create an event
                </button>
                <button
                  className="button secondary"
                  onClick={() => {
                    setDialog(null);
                    setEditor({ kind: 'task' });
                  }}
                >
                  <Plus size={16} />
                  Create a task
                </button>
              </div>
              <p className="muted small-text">
                {demo
                  ? 'This is a fictional workspace. Demo edits are saved only in this browser and never sent to Google.'
                  : 'Your tasks are saved securely in your account. Supported fields are copied to Google Tasks.'}
              </p>
            </div>
          </Modal>
        )}
        {dialog === 'privacy' && (
          <Modal
            title="Your calendar is yours."
            onClose={() => {
              setDialog(null);
              if (location.pathname === '/privacy') history.replaceState(null, '', '/');
            }}
          >
            <div className="prose">
              <h3>Private by account</h3>
              <p>
                Only invited Google accounts can sign in. Each person can access only their own
                tasks and the Google calendars their account is permitted to use.
              </p>
              <h3>What is stored</h3>
              <p>
                Daymark stores your account details, task lists, tasks, checklists, recurrence
                history, preferences, and synchronization records in its Cloudflare database. Google
                authorization tokens are encrypted on the server and are never included in exports.
              </p>
              <h3>Google access</h3>
              <p>
                Google Calendar supplies your events. Saving events can update Google Calendar and
                send invitations when you choose. App-created tasks are copied to Google Tasks;
                their extra date ranges and colors stay in Daymark. Daymark does not sell your data
                or use it for advertising.
              </p>
              <h3>Demo and control</h3>
              <p>
                Public demo data is fictional and stays in your browser. You can export your tasks
                in Settings and revoke Google access in your Google Account. Contact the person who
                invited you to request removal of your account data.
              </p>
              <button className="button secondary" onClick={() => setDialog('settings')}>
                Manage your data <ArrowRight size={15} />
              </button>
            </div>
          </Modal>
        )}
        {toast && (
          <div role="status" className="toast">
            <Check size={16} />
            <span>{toast}</span>
            <button
              className="icon-button small"
              aria-label="Dismiss message"
              onClick={() => setToast('')}
            >
              <X size={14} />
            </button>
          </div>
        )}
        <button
          className="mobile-create"
          aria-label="Create a task"
          onClick={() => setEditor({ kind: 'task', date: todayString() })}
        >
          <Plus size={23} />
        </button>
      </div>
    </FeedbackContext.Provider>
  );
}
