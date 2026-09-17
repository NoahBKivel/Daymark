import {
  demoCalendars,
  demoDeleteTask,
  demoExport,
  demoRange,
  demoRestore,
  demoSaveEvent,
  demoSaveTask,
  demoSearch,
  demoState,
  writeDemo,
} from './demo';
import { deleteDemoEvent } from './demo-events';
import type {
  Backup,
  CalendarEvent,
  CalendarInfo,
  EditScope,
  EventInput,
  RangeData,
  Settings,
  Task,
  TaskInput,
  TaskList,
} from './shared/model';

export async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = (await r
    .json()
    .catch(() => ({ error: 'The server could not be reached. Please retry.' }))) as T & {
    error?: string;
  };
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}
export function makeClient(demo: boolean) {
  return {
    lists: async () => (demo ? demoState().lists : request<TaskList[]>('/lists')),
    calendars: async () => (demo ? demoCalendars : request<CalendarInfo[]>('/calendars')),
    range: async (start: string, end: string) =>
      demo
        ? demoRange(start, end)
        : request<RangeData>(`/range?${new URLSearchParams({ start, end })}`),
    search: async (q: string, filter: string, listId: string | undefined, page: number) =>
      demo
        ? demoSearch(q, filter, listId, page)
        : request<{ tasks: Task[]; hasMore: boolean }>(
            `/tasks?${new URLSearchParams({ q, filter, page: String(page), ...(listId ? { listId } : {}) })}`,
          ),
    saveTask: async (task: TaskInput, existing?: Task, scope = 'one') =>
      demo
        ? demoSaveTask(task, existing?.id, scope)
        : request<Task>(
            `/tasks${existing ? `/${encodeURIComponent(existing.id)}` : ''}`,
            existing ? 'PUT' : 'POST',
            { task, version: existing?.version, scope },
          ),
    deleteTask: async (task: Task, scope = 'one') =>
      demo
        ? demoDeleteTask(task.id, scope)
        : request(`/tasks/${encodeURIComponent(task.id)}`, 'DELETE', {
            scope,
            version: task.version,
          }),
    saveList: async (list: Omit<TaskList, 'id'>, id?: string) => {
      if (!demo)
        return request<TaskList>(
          `/lists${id ? `/${encodeURIComponent(id)}` : ''}`,
          id ? 'PUT' : 'POST',
          list,
        );
      const s = demoState();
      const saved = { ...list, id: id || crypto.randomUUID() };
      s.lists = [...s.lists.filter((l) => l.id !== saved.id), saved];
      writeDemo(s);
      return saved;
    },
    saveSettings: async (settings: Settings) => {
      if (!demo) return request<Settings>('/settings', 'PUT', settings);
      const s = demoState();
      s.settings = settings;
      writeDemo(s);
      return settings;
    },
    saveEvent: async (
      input: EventInput,
      calendarId: string,
      existing: CalendarEvent | undefined,
      scope: EditScope,
      sendUpdates: 'all' | 'none',
      createMeet: boolean,
      requestId: string,
    ) =>
      demo
        ? demoSaveEvent(input, calendarId, existing?.id, scope)
        : request<CalendarEvent>(
            `/events/${encodeURIComponent(calendarId)}${existing ? `/${encodeURIComponent(existing.id)}` : ''}`,
            existing ? 'PUT' : 'POST',
            { input, etag: existing?.etag, scope, sendUpdates, createMeet, requestId },
          ),
    deleteEvent: async (event: CalendarEvent, scope: EditScope, sendUpdates: 'all' | 'none') => {
      if (!demo)
        return request(
          `/events/${encodeURIComponent(event.calendarId)}/${encodeURIComponent(event.id)}`,
          'DELETE',
          { etag: event.etag, scope, sendUpdates },
        );
      const s = demoState();
      s.events = deleteDemoEvent(s.events, event, scope);
      writeDemo(s);
    },
    rsvp: async (event: CalendarEvent, status: 'accepted' | 'declined' | 'tentative') => {
      if (!demo)
        return request(
          `/events/${encodeURIComponent(event.calendarId)}/${encodeURIComponent(event.id)}/rsvp`,
          'POST',
          { status, etag: event.etag },
        );
      const s = demoState();
      const e = s.events.find((e) => e.id === event.id);
      if (e) e.attendees = e.attendees?.map((a) => (a.self ? { ...a, responseStatus: status } : a));
      writeDemo(s);
    },
    export: async () => (demo ? demoExport() : request<Backup>('/export')),
    restore: async (backup: Backup) =>
      demo ? demoRestore(backup) : request('/restore', 'POST', backup),
  };
}
export type Client = ReturnType<typeof makeClient>;
