import { z } from 'zod';
import { DateTime } from 'luxon';

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => DateTime.fromISO(v).isValid, 'Invalid date');
export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const recurrenceSchema = z.object({
  frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  interval: z.number().int().min(1).max(99).default(1),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  until: dateSchema.nullable().default(null),
  count: z.number().int().min(1).max(10000).nullable().default(null),
});
export const checklistSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9-]+$/),
  title: z.string().trim().min(1).max(500),
  completed: z.boolean(),
});
export const taskInputSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    description: z.string().max(7000).default(''),
    listId: z.string().min(1).max(100),
    color: colorSchema.nullable().default(null),
    startDate: dateSchema.nullable().default(null),
    dueDate: dateSchema.nullable().default(null),
    dueTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable()
      .default(null),
    timeZone: z.string().refine((v) => DateTime.now().setZone(v).isValid, 'Invalid time zone'),
    completed: z.boolean().default(false),
    checklist: z.array(checklistSchema).max(100).default([]),
    recurrence: recurrenceSchema.nullable().default(null),
  })
  .superRefine((t, ctx) => {
    if ((t.startDate || t.dueTime || t.recurrence) && !t.dueDate)
      ctx.addIssue({
        code: 'custom',
        message: 'A deadline is needed for a start date, time, or repeat rule',
        path: ['dueDate'],
      });
    if (t.startDate && t.dueDate && t.startDate > t.dueDate)
      ctx.addIssue({
        code: 'custom',
        message: 'Start date must be on or before the deadline',
        path: ['startDate'],
      });
    if (t.recurrence?.until && t.dueDate && t.recurrence.until < t.dueDate)
      ctx.addIssue({
        code: 'custom',
        message: 'Repeat end must not precede the first deadline',
        path: ['recurrence'],
      });
  });
export type TaskInput = z.infer<typeof taskInputSchema>;
export type Recurrence = z.infer<typeof recurrenceSchema>;
export type Task = TaskInput & {
  id: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  seriesId?: string;
  originalDate?: string;
  excludedDates?: string[];
  deleted?: boolean;
};
export const listInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: colorSchema,
});
export type TaskList = z.infer<typeof listInputSchema> & { id: string };
export const settingsSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  timeZone: z.string().refine((v) => DateTime.now().setZone(v).isValid),
  weekStart: z.union([z.literal(0), z.literal(1)]).default(0),
  hour24: z.boolean().default(false),
  showCompleted: z.boolean().default(true),
});
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings = (): Settings => ({
  theme: 'system',
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
  weekStart: 0,
  hour24: false,
  showCompleted: true,
});
export type CalendarInfo = {
  id: string;
  summary: string;
  backgroundColor: string;
  accessRole: string;
  primary?: boolean;
  timeZone?: string;
};
export type EventDate = { date?: string; dateTime?: string; timeZone?: string };
export const GOOGLE_EVENT_COLORS = [
  { id: '1', name: 'Lavender', hex: '#7986cb' },
  { id: '2', name: 'Sage', hex: '#33b679' },
  { id: '3', name: 'Grape', hex: '#8e24aa' },
  { id: '4', name: 'Flamingo', hex: '#e67c73' },
  { id: '5', name: 'Banana', hex: '#f6c026' },
  { id: '6', name: 'Tangerine', hex: '#f5511d' },
  { id: '7', name: 'Peacock', hex: '#039be5' },
  { id: '8', name: 'Graphite', hex: '#616161' },
  { id: '9', name: 'Blueberry', hex: '#3f51b5' },
  { id: '10', name: 'Basil', hex: '#0b8043' },
  { id: '11', name: 'Tomato', hex: '#d60000' },
] as const;
export const DEFAULT_CALENDAR_COLOR = GOOGLE_EVENT_COLORS[1];
export type GoogleEventColorId = (typeof GOOGLE_EVENT_COLORS)[number]['id'];
export type CalendarEvent = {
  id: string;
  calendarId: string;
  summary: string;
  start: EventDate;
  end: EventDate;
  description?: string;
  location?: string;
  etag?: string;
  status?: string;
  htmlLink?: string;
  eventType?: string;
  recurringEventId?: string;
  originalStartTime?: EventDate;
  recurrence?: string[];
  attendees?: {
    email: string;
    displayName?: string;
    responseStatus?: string;
    self?: boolean;
    organizer?: boolean;
  }[];
  organizer?: { email?: string; self?: boolean };
  creator?: { self?: boolean };
  transparency?: string;
  visibility?: string;
  colorId?: string | null;
  reminders?: { useDefault: boolean; overrides?: { method: 'email' | 'popup'; minutes: number }[] };
  hangoutLink?: string;
  conferenceData?: Record<string, unknown>;
  guestsCanModify?: boolean;
  guestsCanInviteOthers?: boolean;
};
export const eventInputSchema = z
  .object({
    summary: z.string().trim().min(1).max(500),
    description: z.string().max(10000).default(''),
    location: z.string().max(1000).default(''),
    start: z.object({
      date: dateSchema.optional(),
      dateTime: z.string().datetime({ offset: true }).optional(),
      timeZone: z.string().optional(),
    }),
    end: z.object({
      date: dateSchema.optional(),
      dateTime: z.string().datetime({ offset: true }).optional(),
      timeZone: z.string().optional(),
    }),
    attendees: z
      .array(z.object({ email: z.string().email() }))
      .max(200)
      .default([]),
    transparency: z.enum(['opaque', 'transparent']).default('opaque'),
    visibility: z.enum(['default', 'public', 'private']).default('default'),
    colorId: z
      .enum(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'])
      .nullable()
      .optional(),
    recurrence: z.array(z.string().max(1000)).max(10).optional(),
    reminders: z
      .object({
        useDefault: z.boolean(),
        overrides: z
          .array(
            z.object({
              method: z.enum(['popup', 'email']),
              minutes: z.number().int().min(0).max(40320),
            }),
          )
          .max(5)
          .optional(),
      })
      .optional(),
  })
  .superRefine((e, ctx) => {
    const allDay = !!e.start.date;
    if (
      allDay !== !!e.end.date ||
      !!e.start.date === !!e.start.dateTime ||
      !!e.end.date === !!e.end.dateTime
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Use either dates or times for both event boundaries',
      });
    if ((e.start.date || e.start.dateTime || '') >= (e.end.date || e.end.dateTime || '') && allDay)
      ctx.addIssue({ code: 'custom', message: 'Event end must follow its start' });
    if (!allDay && Date.parse(e.end.dateTime || '') <= Date.parse(e.start.dateTime || ''))
      ctx.addIssue({ code: 'custom', message: 'Event end must follow its start' });
  });
export type EventInput = z.infer<typeof eventInputSchema>;
export type RangeData = { tasks: Task[]; events: CalendarEvent[]; errors: string[] };
export type SyncStatus = { pending: number; failed: number; reconnect: boolean };
export type SessionUser = { id: string; name: string; email: string; image?: string | null };
export type EditScope = 'one' | 'following' | 'all';
export type Backup = {
  format: 'daymark';
  version: 1;
  exportedAt: string;
  lists: TaskList[];
  tasks: Task[];
  settings: Settings;
};
export const backupSchema = z.object({
  format: z.literal('daymark'),
  version: z.literal(1),
  exportedAt: z.string(),
  lists: z.array(listInputSchema.extend({ id: z.string().max(100) })).max(100),
  tasks: z
    .array(
      taskInputSchema.safeExtend({
        id: z.string().max(150),
        completedAt: z.string().nullable(),
        createdAt: z.string(),
        updatedAt: z.string(),
        version: z.number().int(),
        seriesId: z.string().optional(),
        originalDate: dateSchema.optional(),
        excludedDates: z.array(dateSchema).optional(),
        deleted: z.boolean().optional(),
      }),
    )
    .max(10000),
  settings: settingsSchema,
});
