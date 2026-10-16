import { DateTime } from 'luxon';
import { demoEventRange, saveDemoEvent } from './demo-events';
import {
  addDays,
  daysBetween,
  expandTasks,
  isOverdue,
  occurrenceFor,
  taskRule,
} from './shared/dates';
import {
  defaultSettings,
  type Backup,
  type CalendarEvent,
  type CalendarInfo,
  type Settings,
  type Task,
  type TaskInput,
  type TaskList,
  type EventInput,
} from './shared/model';

const KEY = 'daymark.demo.v1';
export type DemoState = {
  seededAt?: string;
  lists: TaskList[];
  tasks: Task[];
  events: CalendarEvent[];
  settings: Settings;
};
export const demoCalendars: CalendarInfo[] = [
  {
    id: 'personal',
    summary: 'Calendar one',
    backgroundColor: '#548bce',
    accessRole: 'owner',
    primary: true,
  },
  { id: 'university', summary: 'Calendar two', backgroundColor: '#bc92cd', accessRole: 'reader' },
];
export function seedDemo(now: DateTime = DateTime.now()): DemoState {
  const month = now.startOf('month');
  const day = (d: number) => month.plus({ days: d - 1 }).toISODate()!;
  const today = now.toISODate()!;
  const anchor = Math.min(now.day, 24);
  const at = (d: number, h: number, m = 0) =>
    month.plus({ days: d - 1, hours: h, minutes: m }).toISO()!;
  const base = {
    description: '',
    timeZone: now.zoneName!,
    dueTime: null,
    completed: false,
    completedAt: null,
    createdAt: now.toISO()!,
    updatedAt: now.toISO()!,
    version: 1,
    checklist: [],
    recurrence: null,
    color: null,
  };
  return {
    seededAt: now.toISO()!,
    settings: defaultSettings(),
    lists: [
      { id: 'school', name: 'Tasks', color: '#77946d' },
      { id: 'personal-tasks', name: 'General', color: '#6b9fbe' },
      { id: 'projects', name: 'Projects', color: '#c38b60' },
    ],
    tasks: [
      {
        ...base,
        id: 'demo-presentation',
        title: 'Prepare a draft',
        description: 'Outline the main points, add examples, and review the draft.',
        listId: 'school',
        startDate: day(anchor - 2),
        dueDate: day(anchor + 2),
        checklist: [
          { id: 'outline', title: 'Create an outline', completed: true },
          { id: 'examples', title: 'Add examples', completed: false },
          { id: 'slides', title: 'Review the draft', completed: false },
        ],
      },
      {
        ...base,
        id: 'demo-portfolio',
        title: 'Update a project',
        description: 'Review the project and update its details.',
        listId: 'projects',
        startDate: day(anchor + 1),
        dueDate: day(anchor + 5),
        color: '#c8916d',
      },
      {
        ...base,
        id: 'demo-reading',
        title: 'Review a document',
        listId: 'school',
        startDate: day(anchor - 7),
        dueDate: day(anchor - 4),
        completed: true,
        completedAt: at(anchor - 4, 16),
      },
      {
        ...base,
        id: 'demo-math',
        title: 'Complete an assignment',
        listId: 'school',
        startDate: today,
        dueDate: addDays(today, 1),
        dueTime: '23:59',
      },
      {
        ...base,
        id: 'demo-resume',
        title: 'Update a document',
        listId: 'personal-tasks',
        startDate: null,
        dueDate: day(anchor + 3),
      },
      {
        ...base,
        id: 'demo-groceries',
        title: 'Complete an errand',
        listId: 'personal-tasks',
        startDate: null,
        dueDate: today,
        checklist: [
          { id: 'a', title: 'Item one', completed: false },
          { id: 'b', title: 'Item two', completed: false },
        ],
      },
      {
        ...base,
        id: 'demo-reading-list',
        title: 'Review a resource',
        listId: 'personal-tasks',
        startDate: null,
        dueDate: null,
      },
      {
        ...base,
        id: 'demo-idea',
        title: 'Plan a project',
        listId: 'projects',
        startDate: null,
        dueDate: null,
      },
      {
        ...base,
        id: 'demo-reflection',
        title: 'Weekly review',
        listId: 'personal-tasks',
        startDate: null,
        dueDate: day(5),
        recurrence: { frequency: 'weekly', interval: 1, weekdays: [0], until: null, count: null },
      },
    ],
    events: [
      {
        id: 'demo-jenna',
        calendarId: 'personal',
        summary: 'Scheduled meeting',
        description: 'Discuss updates and next steps.',
        location: 'Meeting location',
        start: { dateTime: at(anchor, 11) },
        end: { dateTime: at(anchor, 12) },
        organizer: { self: true },
        attendees: [{ email: 'guest@example.com', responseStatus: 'accepted' }],
      },
      {
        id: 'demo-design',
        calendarId: 'university',
        summary: 'Workshop',
        location: 'Meeting room',
        start: { dateTime: at(anchor - 1, 14) },
        end: { dateTime: at(anchor - 1, 15, 30) },
      },
      {
        id: 'demo-study',
        calendarId: 'personal',
        summary: 'Group meeting',
        location: 'Meeting room',
        start: { dateTime: at(anchor + 2, 16) },
        end: { dateTime: at(anchor + 2, 17) },
        organizer: { self: true },
      },
      {
        id: 'demo-walk',
        calendarId: 'personal',
        summary: 'Scheduled activity',
        start: { dateTime: at(anchor + 4, 15) },
        end: { dateTime: at(anchor + 4, 17) },
        organizer: { self: true },
      },
      {
        id: 'demo-seminar',
        calendarId: 'university',
        summary: 'Presentation',
        start: { dateTime: at(anchor - 6, 10) },
        end: { dateTime: at(anchor - 6, 11, 30) },
      },
    ],
  };
}
export function refreshUntouchedDemo(state: DemoState, now: DateTime = DateTime.now()): DemoState {
  const sample =
    state.tasks.find((task) => task.id === 'demo-presentation') ||
    state.tasks.find((task) => task.id.startsWith('demo-'));
  const savedAt = state.seededAt || sample?.createdAt;
  if (!savedAt) return state;
  const seededAt = DateTime.fromISO(savedAt).setZone(sample?.timeZone || state.settings.timeZone);
  if (!seededAt.isValid || seededAt.hasSame(now, 'month')) return state;
  const original = seedDemo(seededAt);
  const fresh = seedDemo(now);
  const refresh = <T extends { id: string }>(rows: T[], previous: T[], next: T[]) =>
    rows.map((row) => {
      const oldSample = previous.find((item) => item.id === row.id);
      const newSample = next.find((item) => item.id === row.id);
      return oldSample && newSample && JSON.stringify(row) === JSON.stringify(oldSample)
        ? newSample
        : row;
    });
  return {
    ...state,
    seededAt: now.toISO()!,
    tasks: refresh(state.tasks, original.tasks, fresh.tasks).map((task, index) =>
      state.lists.some((list) => list.id === task.listId) ? task : state.tasks[index],
    ),
    events: refresh(state.events, original.events, fresh.events),
  };
}
const legacyDemoText: Record<string, string> = {
  'Textbook presentation · first draft': 'Prepare a draft',
  'Bring the big ideas together. Outline the argument, add supporting examples, and prepare the first slide draft.':
    'Outline the main points, add examples, and review the draft.',
  'Outline the main ideas': 'Create an outline',
  'Find supporting examples': 'Add examples',
  'Put together the slides': 'Review the draft',
  'A little portfolio refresh': 'Update a project',
  'Update project screenshots and write a few words about what I learned.':
    'Review the project and update its details.',
  'Read chapters 4–6': 'Review a document',
  'Math problem set': 'Complete an assignment',
  'Update my résumé': 'Update a document',
  'Pick up groceries': 'Complete an errand',
  'Coffee beans': 'Item one',
  'Something green': 'Item two',
  'Find a book for the weekend': 'Review a resource',
  'Sketch the next project idea': 'Plan a project',
  'Weekly reflection': 'Weekly review',
  'Coffee with Jenna': 'Scheduled meeting',
  'A good coffee and a catch-up.': 'Discuss updates and next steps.',
  'The neighborhood café': 'Meeting location',
  'jenna@example.com': 'guest@example.com',
  'Design studio': 'Workshop',
  'Studio 204': 'Meeting room',
  'Study group': 'Group meeting',
  'Library, second floor': 'Meeting room',
  'An afternoon outside': 'Scheduled activity',
  'Research seminar': 'Presentation',
  'Personal calendar': 'Calendar one',
  University: 'Calendar two',
  School: 'Tasks',
  Personal: 'General',
};
function genericDemoContent(state: DemoState): DemoState {
  const replace = (value: unknown): unknown => {
    if (typeof value === 'string') return legacyDemoText[value] || value;
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, replace(entry)]));
    return value;
  };
  return {
    ...state,
    tasks: state.tasks.map((task) =>
      task.id.startsWith('demo-') ? (replace(task) as Task) : task,
    ),
    events: state.events.map((event) =>
      event.id.startsWith('demo-') ? (replace(event) as CalendarEvent) : event,
    ),
    lists: state.lists.map((list) => ({ ...list, name: legacyDemoText[list.name] || list.name })),
  };
}

export function readDemo(): DemoState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const stored = genericDemoContent(JSON.parse(raw) as DemoState);
      const state = refreshUntouchedDemo(stored);
      writeDemo(state);
      memory = state;
      return state;
    }
  } catch {
    /* A disabled/full browser store should not prevent the demo. */
  }
  const state = seedDemo();
  writeDemo(state);
  return state;
}
export function writeDemo(state: DemoState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* Demo still works for this session. */
  }
  memory = state;
}
let memory: DemoState | undefined;
export const demoState = () => memory || readDemo();
export const resetDemo = () => {
  const state = seedDemo();
  writeDemo(state);
  return state;
};
export function demoRange(start: string, end: string) {
  const s = demoState();
  return {
    tasks: expandTasks(s.tasks, start, end),
    events: demoEventRange(s.events, start, end),
    errors: [],
  };
}
export function demoResolve(id: string) {
  const s = demoState();
  const t = s.tasks.find((t) => t.id === id);
  if (t) return t;
  const i = id.lastIndexOf('@');
  return i < 0
    ? undefined
    : occurrenceFor(
        s.tasks.find((t) => t.id === id.slice(0, i))!,
        id.slice(i + 1),
      );
}
export function demoSaveTask(
  input: TaskInput,
  id: string = crypto.randomUUID(),
  scope = 'one',
): Task {
  const s = demoState();
  const existing = demoResolve(id);
  const now = new Date().toISOString();
  let task: Task = {
    ...input,
    id,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    completedAt: input.completed ? existing?.completedAt || now : null,
    version: (existing?.version || 0) + 1,
    ...(existing?.seriesId
      ? { seriesId: existing.seriesId, originalDate: existing.originalDate }
      : {}),
  };
  if (existing?.seriesId && scope === 'following') {
    const base = s.tasks.find((t) => t.id === existing.seriesId)!;
    const cut = existing.originalDate!;
    if (
      task.recurrence?.count &&
      base.recurrence &&
      task.recurrence.count === base.recurrence.count
    ) {
      const before = taskRule(base.dueDate!, base.recurrence).between(
        new Date(`${base.dueDate}T00:00:00Z`),
        new Date(`${addDays(cut, -1)}T23:59:59Z`),
        true,
      ).length;
      task.recurrence = { ...task.recurrence, count: Math.max(1, task.recurrence.count - before) };
    }
    if (cut === base.dueDate) base.deleted = true;
    else base.recurrence = { ...base.recurrence!, until: addDays(cut, -1) };
    base.version++;
    s.tasks = s.tasks.map((t) =>
      t.seriesId === base.id && t.originalDate! >= cut && !t.completed
        ? { ...t, deleted: true }
        : t,
    );
    task = {
      ...task,
      id: crypto.randomUUID(),
      seriesId: undefined,
      originalDate: undefined,
      version: 1,
    };
  }
  s.tasks = [...s.tasks.filter((t) => t.id !== task.id), task];
  writeDemo(s);
  return task;
}
export function demoDeleteTask(id: string, scope = 'one') {
  const s = demoState();
  const t = demoResolve(id);
  if (!t) return;
  if (t.seriesId && scope === 'following') {
    const base = s.tasks.find((x) => x.id === t.seriesId)!;
    if (t.originalDate === base.dueDate) base.deleted = true;
    else base.recurrence = { ...base.recurrence!, until: addDays(t.originalDate!, -1) };
    s.tasks = s.tasks.map((x) =>
      x.seriesId === base.id && x.originalDate! >= t.originalDate! && !x.completed
        ? { ...x, deleted: true }
        : x,
    );
  } else {
    s.tasks = [...s.tasks.filter((x) => x.id !== id), { ...t, deleted: true }];
  }
  writeDemo(s);
}
export function demoSearch(q: string, filter: string, listId: string | undefined, page: number) {
  const s = demoState();
  const today = DateTime.now().toISODate()!;
  const regular = s.tasks.filter((t) => !t.deleted && !t.recurrence && !t.seriesId);
  const instances = expandTasks(s.tasks, addDays(today, -31), addDays(today, 91)).filter(
    (t) => t.seriesId,
  );
  const tasks = [...regular, ...instances]
    .filter(
      (t) =>
        (!q || `${t.title} ${t.description}`.toLowerCase().includes(q.toLowerCase())) &&
        (!listId || t.listId === listId) &&
        (filter === 'all' ||
          (filter === 'open' && !t.completed) ||
          (filter === 'completed' && t.completed) ||
          (filter === 'undated' && !t.dueDate) ||
          (filter === 'overdue' && isOverdue(t))),
    )
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  return { tasks: tasks.slice(page * 50, page * 50 + 50), hasMore: tasks.length > (page + 1) * 50 };
}
export function demoSaveEvent(
  input: EventInput,
  calendarId: string,
  id: string = crypto.randomUUID(),
  scope = 'one',
): CalendarEvent {
  const s = demoState();
  const { rows, event } = saveDemoEvent(s.events, input, calendarId, id, scope);
  s.events = rows;
  writeDemo(s);
  return event;
}
export function demoExport(): Backup {
  const s = demoState();
  return {
    format: 'daymark',
    version: 1,
    exportedAt: new Date().toISOString(),
    lists: s.lists,
    tasks: s.tasks,
    settings: s.settings,
  };
}
export function demoRestore(b: Backup) {
  const s = demoState();
  s.lists = b.lists;
  s.tasks = b.tasks;
  s.settings = b.settings;
  writeDemo(s);
}
