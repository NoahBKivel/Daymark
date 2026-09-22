import * as Dialog from '@radix-ui/react-dialog';
import {
  X,
  Plus,
  Trash2,
  Check,
  CalendarDays,
  Clock3,
  Repeat2,
  ListTodo,
  ExternalLink,
  MapPin,
  Users,
  Video,
} from 'lucide-react';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { addDays } from '../shared/dates';
import {
  eventInputSchema,
  DEFAULT_CALENDAR_COLOR,
  GOOGLE_EVENT_COLORS,
  taskInputSchema,
  type CalendarEvent,
  type CalendarInfo,
  type EditScope,
  type Recurrence,
  type Settings,
  type Task,
  type TaskInput,
  type TaskList,
} from '../shared/model';
import type { Client } from '../api';

export const FeedbackContext = createContext('');
const EmbeddedModalContext = createContext(false);
export function Modal({
  title,
  description,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const feedback = useContext(FeedbackContext);
  const embedded = useContext(EmbeddedModalContext);
  if (embedded) return <>{children}</>;
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className={`modal ${wide ? 'modal-wide' : ''}`}
          aria-describedby={description ? 'dialog-description' : undefined}
        >
          <div className="modal-heading">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              {description && (
                <Dialog.Description id="dialog-description">{description}</Dialog.Description>
              )}
            </div>
            <Dialog.Close className="icon-button" aria-label="Close dialog">
              <X size={19} />
            </Dialog.Close>
          </div>
          {children}
          {feedback && (
            <div className="dialog-status" role="status">
              {feedback}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function CreationDialog({
  kind,
  children,
  onClose,
}: {
  kind: 'event' | 'task';
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <Modal
      title={kind === 'event' ? 'Something to look forward to' : 'Make room for a task'}
      onClose={onClose}
    >
      <EmbeddedModalContext.Provider value>{children}</EmbeddedModalContext.Provider>
    </Modal>
  );
}
export const COLORS = [
  '#77946d',
  '#6b9fbe',
  '#c38b60',
  '#b783a0',
  '#a18bc4',
  '#c9a650',
  '#659c96',
  '#74849d',
];
export function ColorPicker({
  value,
  onChange,
  inherit = false,
  custom = true,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  inherit?: boolean;
  custom?: boolean;
}) {
  return (
    <div className="color-picker">
      {inherit && (
        <button
          type="button"
          className={`color-inherit ${!value ? 'selected' : ''}`}
          onClick={() => onChange(null)}
        >
          List color
        </button>
      )}
      {COLORS.map((c) => (
        <button
          type="button"
          key={c}
          aria-label={`Color ${c}`}
          aria-pressed={value === c}
          className="color-choice"
          style={{ backgroundColor: c }}
          onClick={() => onChange(c)}
        >
          {value === c && <Check size={14} />}
        </button>
      ))}
      {custom && (
        <label className="custom-color" title="Custom color">
          <span>Custom</span>
          <input
            aria-label="Custom color"
            type="color"
            value={value || COLORS[0]}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      )}
    </div>
  );
}
function EventColorPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  return (
    <div className="color-picker event-color-picker">
      <button
        type="button"
        className={`color-inherit ${!value ? 'selected' : ''}`}
        aria-pressed={!value}
        onClick={() => onChange(null)}
      >
        Calendar color
      </button>
      {GOOGLE_EVENT_COLORS.map((color) => (
        <button
          type="button"
          key={color.id}
          aria-label={`Event color ${color.name}`}
          aria-pressed={value === color.id}
          className="color-choice"
          style={{ backgroundColor: color.hex }}
          onClick={() => onChange(color.id)}
        >
          {value === color.id && <Check size={14} />}
        </button>
      ))}
    </div>
  );
}
export function RepeatFields({
  value,
  onChange,
}: {
  value: Recurrence | null;
  onChange: (r: Recurrence | null) => void;
}) {
  return (
    <div className="repeat-fields">
      <label>
        <span>
          <Repeat2 size={15} /> Repeat
        </span>
        <select
          aria-label="Repeat"
          value={value?.frequency || 'none'}
          onChange={(e) =>
            onChange(
              e.target.value === 'none'
                ? null
                : {
                    frequency: e.target.value as Recurrence['frequency'],
                    interval: 1,
                    weekdays: [],
                    until: null,
                    count: null,
                  },
            )
          }
        >
          <option value="none">Does not repeat</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
      </label>
      {value && (
        <div className="repeat-options">
          <label>
            Every
            <input
              aria-label="Repeat interval"
              type="number"
              min="1"
              max="99"
              value={value.interval}
              onChange={(e) => onChange({ ...value, interval: Number(e.target.value) })}
            />
          </label>
          {value.frequency === 'weekly' && (
            <div className="weekday-picker">
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                <button
                  type="button"
                  key={i}
                  aria-label={`Repeat on ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i]}`}
                  aria-pressed={value.weekdays.includes(i)}
                  className={value.weekdays.includes(i) ? 'selected' : ''}
                  onClick={() =>
                    onChange({
                      ...value,
                      weekdays: value.weekdays.includes(i)
                        ? value.weekdays.filter((v) => v !== i)
                        : [...value.weekdays, i],
                    })
                  }
                >
                  {d}
                </button>
              ))}
            </div>
          )}
          <label>
            Ends
            <select
              aria-label="Repeat ending"
              value={value.until ? 'date' : value.count ? 'count' : 'never'}
              onChange={(e) =>
                onChange({
                  ...value,
                  until:
                    e.target.value === 'date'
                      ? DateTime.now().plus({ months: 3 }).toISODate()!
                      : null,
                  count: e.target.value === 'count' ? 10 : null,
                })
              }
            >
              <option value="never">Never</option>
              <option value="date">On a date</option>
              <option value="count">After a number</option>
            </select>
          </label>
          {value.until && (
            <input
              aria-label="Repeat end date"
              type="date"
              value={value.until}
              onChange={(e) => onChange({ ...value, until: e.target.value })}
            />
          )}{' '}
          {!!value.count && (
            <input
              aria-label="Number of occurrences"
              type="number"
              min="1"
              max="10000"
              value={value.count}
              onChange={(e) => onChange({ ...value, count: Number(e.target.value) })}
            />
          )}
        </div>
      )}
    </div>
  );
}
function CreationSwitch({ kind, onSwitch }: { kind: 'event' | 'task'; onSwitch: () => void }) {
  return (
    <div className="creation-switch" role="group" aria-label="Create as">
      {(['event', 'task'] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={kind === option}
          onClick={() => {
            if (kind !== option) onSwitch();
          }}
        >
          {option === 'event' ? 'Event' : 'Task'}
        </button>
      ))}
    </div>
  );
}

function WeekdayDateInput({
  label,
  type,
  value,
  timeZone,
  required,
  onChange,
}: {
  label: string;
  type: 'date' | 'datetime-local';
  value: string;
  timeZone: string;
  required?: boolean;
  onChange: (value: string) => void;
}) {
  const date = value.slice(0, 10);
  const weekday = date
    ? DateTime.fromISO(date, { zone: timeZone }).setLocale('en-US').toFormat('ccc')
    : '—';
  return (
    <div className="weekday-date-input">
      <span aria-hidden="true">{weekday}</span>
      <input
        aria-label={label}
        type={type}
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

type BaseProps = {
  draft?: { title: string; description: string };
  onSwitch?: (draft: { title: string; description: string; date?: string }) => void;
  client: Client;
  settings: Settings;
  onClose: () => void;
  onSaved: (message: string) => void;
};
export function TaskEditor({
  draft,
  onSwitch,
  client,
  settings,
  lists,
  task,
  date,
  onClose,
  onSaved,
}: { lists: TaskList[]; task?: Task; date?: string } & BaseProps) {
  const [form, setForm] = useState<TaskInput>(() =>
    task
      ? { ...task }
      : {
          title: draft?.title || '',
          description: draft?.description || '',
          listId: lists[0]?.id || '',
          color: DEFAULT_CALENDAR_COLOR.hex,
          startDate: null,
          dueDate: date || null,
          dueTime: null,
          timeZone: settings.timeZone,
          completed: false,
          checklist: [],
          recurrence: null,
        },
  );
  const [scope, setScope] = useState<'one' | 'following'>('one');
  const [checkTitle, setCheckTitle] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const update = <K extends keyof TaskInput>(key: K, value: TaskInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const addCheck = () => {
    if (checkTitle.trim()) {
      update('checklist', [
        ...form.checklist,
        { id: crypto.randomUUID(), title: checkTitle.trim(), completed: false },
      ]);
      setCheckTitle('');
    }
  };
  async function save() {
    setBusy(true);
    setError('');
    try {
      await client.saveTask(taskInputSchema.parse(form), task, scope);
      onSaved(task ? 'Task updated' : 'Task created');
      onClose();
    } catch (e) {
      setError(
        e instanceof z.ZodError ? e.issues.map((i) => i.message).join('. ') : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!task) return;
    setBusy(true);
    try {
      await client.deleteTask(task, scope);
      onSaved('Task deleted');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={task ? 'Task details' : 'Make room for a task'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="editor-form"
      >
        {!task && onSwitch && (
          <CreationSwitch
            kind="task"
            onSwitch={() =>
              onSwitch({
                title: form.title,
                description: form.description,
                date: form.startDate || form.dueDate || undefined,
              })
            }
          />
        )}
        <div className="title-field">
          <button
            type="button"
            className={`task-checkbox large ${form.completed ? 'checked' : ''}`}
            aria-label={form.completed ? 'Mark incomplete' : 'Mark complete'}
            onClick={() => update('completed', !form.completed)}
          >
            {form.completed && <Check size={18} />}
          </button>
          <input
            autoFocus
            aria-label="Task title"
            placeholder="What would you like to do?"
            value={form.title}
            maxLength={500}
            onChange={(e) => update('title', e.target.value)}
            required
          />
        </div>
        <label>
          <span>
            <ListTodo size={15} /> List
          </span>
          <select
            aria-label="Task list"
            value={form.listId}
            onChange={(e) => update('listId', e.target.value)}
          >
            {lists.map((l) => (
              <option value={l.id} key={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <label>
            <span>
              <CalendarDays size={15} /> Start date
            </span>
            <WeekdayDateInput
              label="Start date"
              type="date"
              value={form.startDate || ''}
              timeZone={settings.timeZone}
              onChange={(value) => update('startDate', value || null)}
            />
          </label>
          <label>
            <span>
              <CalendarDays size={15} /> Deadline
            </span>
            <WeekdayDateInput
              label="Deadline"
              type="date"
              value={form.dueDate || ''}
              timeZone={settings.timeZone}
              onChange={(value) =>
                setForm((f) => ({
                  ...f,
                  dueDate: value || null,
                  ...(!value ? { startDate: null, dueTime: null, recurrence: null } : {}),
                }))
              }
            />
          </label>
        </div>
        <div className="form-grid">
          <label>
            <span>
              <Clock3 size={15} /> Deadline time <small>optional</small>
            </span>
            <input
              aria-label="Deadline time"
              type="time"
              disabled={!form.dueDate}
              value={form.dueTime || ''}
              onChange={(e) => update('dueTime', e.target.value || null)}
            />
          </label>
          <label>
            Time zone
            <input
              aria-label="Task time zone"
              value={form.timeZone}
              onChange={(e) => update('timeZone', e.target.value)}
            />
          </label>
        </div>
        {form.dueDate && (
          <RepeatFields value={form.recurrence} onChange={(r) => update('recurrence', r)} />
        )}
        {task?.seriesId && (
          <label>
            Apply changes to
            <select
              aria-label="Task edit scope"
              value={scope}
              onChange={(e) => setScope(e.target.value as 'one' | 'following')}
            >
              <option value="one">Only this occurrence</option>
              <option value="following">This and future occurrences</option>
            </select>
          </label>
        )}
        <label>
          Description
          <textarea
            aria-label="Task description"
            rows={3}
            placeholder="Notes, ideas, a link to get started…"
            value={form.description}
            onChange={(e) => update('description', e.target.value)}
          />
        </label>
        <div className="checklist">
          <div className="section-label">
            Checklist{' '}
            <span>
              {form.checklist.filter((i) => i.completed).length}/{form.checklist.length}
            </span>
          </div>
          {form.checklist.map((item) => (
            <div className="checklist-item" key={item.id}>
              <input
                aria-label={`Complete ${item.title}`}
                type="checkbox"
                checked={item.completed}
                onChange={() =>
                  update(
                    'checklist',
                    form.checklist.map((i) =>
                      i.id === item.id ? { ...i, completed: !i.completed } : i,
                    ),
                  )
                }
              />
              <input
                aria-label="Subtask title"
                className={item.completed ? 'done' : ''}
                value={item.title}
                onChange={(e) =>
                  update(
                    'checklist',
                    form.checklist.map((i) =>
                      i.id === item.id ? { ...i, title: e.target.value } : i,
                    ),
                  )
                }
              />
              <button
                type="button"
                className="icon-button small"
                aria-label={`Remove ${item.title}`}
                onClick={() =>
                  update(
                    'checklist',
                    form.checklist.filter((i) => i.id !== item.id),
                  )
                }
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <div className="checklist-add">
            <Plus size={16} />
            <input
              aria-label="New subtask"
              placeholder="Add a small step"
              value={checkTitle}
              onChange={(e) => setCheckTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addCheck();
                }
              }}
            />
            <button type="button" className="text-button" onClick={addCheck}>
              Add
            </button>
          </div>
        </div>
        <div>
          <div className="section-label">Color</div>
          <ColorPicker
            inherit
            custom={false}
            value={form.color}
            onChange={(c) => update('color', c)}
          />
        </div>
        {task?.completedAt && (
          <p className="muted small-text">
            Completed{' '}
            {DateTime.fromISO(task.completedAt)
              .setZone(settings.timeZone)
              .toLocaleString(DateTime.DATETIME_MED)}
          </p>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="modal-footer">
          {task && (
            <button
              type="button"
              className="text-button danger"
              onClick={() => setDeleting(!deleting)}
            >
              <Trash2 size={16} />
              Delete
            </button>
          )}
          <div className="footer-actions">
            <button type="button" className="button secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="button primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save task'}
            </button>
          </div>
        </div>
        {deleting && (
          <div className="confirm-row">
            <span>
              Delete {scope === 'following' ? 'this and future occurrences' : 'this task'}? This
              also removes its Google copy.
            </span>
            <button
              type="button"
              className="button danger-fill"
              disabled={busy}
              onClick={() => void remove()}
            >
              Delete task
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}
export function EventEditor({
  draft,
  onSwitch,
  client,
  settings,
  calendars,
  event,
  date,
  onClose,
  onSaved,
}: { calendars: CalendarInfo[]; event?: CalendarEvent; date?: string } & BaseProps) {
  const initialDate = DateTime.fromISO(
    date || DateTime.now().setZone(settings.timeZone).toISODate()!,
    { zone: settings.timeZone },
  );
  const initial = date?.includes('T') ? initialDate : initialDate.set({ hour: 10 });
  const [title, setTitle] = useState(event?.summary || draft?.title || '');
  const [calendarId, setCalendarId] = useState(
    event?.calendarId || calendars.find((c) => c.accessRole === 'owner')?.id || '',
  );
  const [allDay, setAllDay] = useState(!!event?.start.date);
  const [start, setStart] = useState(
    event?.start.date ||
      DateTime.fromISO(event?.start.dateTime || initial.toISO()!)
        .setZone(settings.timeZone)
        .toFormat("yyyy-MM-dd'T'HH:mm"),
  );
  const [end, setEnd] = useState(
    event?.end.date
      ? addDays(event.end.date, -1)
      : DateTime.fromISO(event?.end.dateTime || initial.plus({ hours: 1 }).toISO()!)
          .setZone(settings.timeZone)
          .toFormat("yyyy-MM-dd'T'HH:mm"),
  );
  const [description, setDescription] = useState(event?.description || draft?.description || '');
  const [location, setLocation] = useState(event?.location || '');
  const [guests, setGuests] = useState(
    event?.attendees
      ?.filter((a) => !a.self)
      .map((a) => a.email)
      .join(', ') || '',
  );
  const [availability, setAvailability] = useState<'opaque' | 'transparent'>(
    event?.transparency === 'transparent' ? 'transparent' : 'opaque',
  );
  const [visibility, setVisibility] = useState<'default' | 'public' | 'private'>(
    event ? (event.visibility as 'default' | 'public' | 'private') || 'default' : 'private',
  );
  const [colorId, setColorId] = useState<string | null>(
    event?.colorId || DEFAULT_CALENDAR_COLOR.id,
  );
  const [meet, setMeet] = useState(false);
  const [sendUpdates, setSendUpdates] = useState<'all' | 'none'>('all');
  const [scope, setScope] = useState<EditScope>('one');
  const [repeat, setRepeat] = useState('keep');
  const [reminder, setReminder] = useState(event ? 'keep' : 'default');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const cal = calendars.find((c) => c.id === calendarId);
  const readOnly =
    !!event &&
    (!['owner', 'writer'].includes(cal?.accessRole || '') ||
      (!!event.eventType && event.eventType !== 'default') ||
      (!!event.organizer && !event.organizer.self && !event.guestsCanModify));
  async function save() {
    setBusy(true);
    setError('');
    try {
      const self = event?.attendees?.filter((a) => a.self).map((a) => ({ email: a.email })) || [];
      const attendees = [
        ...self,
        ...guests
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((email) => ({ email })),
      ].filter(
        (a, i, all) => all.findIndex((b) => b.email.toLowerCase() === a.email.toLowerCase()) === i,
      );
      const input = eventInputSchema.parse({
        summary: title,
        description,
        location,
        start: allDay
          ? { date: start.slice(0, 10) }
          : {
              dateTime: DateTime.fromISO(start, { zone: settings.timeZone }).toISO(),
              timeZone: settings.timeZone,
            },
        end: allDay
          ? { date: addDays(end.slice(0, 10), 1) }
          : {
              dateTime: DateTime.fromISO(end, { zone: settings.timeZone }).toISO(),
              timeZone: settings.timeZone,
            },
        attendees,
        transparency: availability,
        visibility,
        colorId,
        ...(repeat === 'keep'
          ? {}
          : { recurrence: repeat === 'none' ? [] : [`RRULE:FREQ=${repeat}`] }),
        reminders:
          reminder === 'keep'
            ? undefined
            : reminder === 'default'
              ? { useDefault: true }
              : {
                  useDefault: false,
                  overrides:
                    reminder === '-1' ? [] : [{ method: 'popup', minutes: Number(reminder) }],
                },
      });
      await client.saveEvent(input, calendarId, event, scope, sendUpdates, meet, requestId);
      onSaved(event ? 'Event updated' : 'Event created');
      onClose();
    } catch (e) {
      setError(
        e instanceof z.ZodError ? e.issues.map((i) => i.message).join('. ') : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!event) return;
    setBusy(true);
    try {
      await client.deleteEvent(event, scope, sendUpdates);
      onSaved('Event deleted');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={readOnly ? 'Event details' : event ? 'Edit event' : 'Something to look forward to'}
      description={
        readOnly
          ? 'This event is managed by its organizer.'
          : event
            ? settings.timeZone.replaceAll('_', ' ')
            : undefined
      }
      onClose={onClose}
    >
      <form
        className="editor-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {!event && onSwitch && (
          <CreationSwitch
            kind="event"
            onSwitch={() => onSwitch({ title, description, date: start.slice(0, 10) })}
          />
        )}
        <fieldset disabled={readOnly} className="event-fields">
          <input
            autoFocus
            className="event-title-input"
            aria-label="Event title"
            placeholder="Add a title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <label>
            Calendar
            <select
              aria-label="Event calendar"
              value={calendarId}
              disabled={!!event}
              onChange={(e) => setCalendarId(e.target.value)}
            >
              {calendars
                .filter(
                  (c) => c.id === event?.calendarId || ['writer', 'owner'].includes(c.accessRole),
                )
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.summary}
                  </option>
                ))}
            </select>
          </label>
          <div>
            <div className="section-label">Color</div>
            <EventColorPicker value={colorId} onChange={setColorId} />
          </div>
          <label className="inline-label">
            <input
              type="checkbox"
              checked={allDay}
              onChange={(e) => {
                const v = e.target.checked;
                setAllDay(v);
                setStart(v ? start.slice(0, 10) : `${start.slice(0, 10)}T10:00`);
                setEnd(v ? end.slice(0, 10) : `${end.slice(0, 10)}T11:00`);
              }}
            />
            All-day event
          </label>
          <div className="form-grid">
            <label>
              Starts
              <WeekdayDateInput
                label="Event start"
                type={allDay ? 'date' : 'datetime-local'}
                value={start}
                timeZone={settings.timeZone}
                onChange={setStart}
                required
              />
            </label>
            <label>
              Ends
              <WeekdayDateInput
                label="Event end"
                type={allDay ? 'date' : 'datetime-local'}
                value={end}
                timeZone={settings.timeZone}
                onChange={setEnd}
                required
              />
            </label>
          </div>
          <label>
            <span>
              <Repeat2 size={15} /> Repeat
            </span>
            <select
              aria-label="Event repeat"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
            >
              <option value="keep">
                {event?.recurringEventId || event?.recurrence
                  ? 'Keep existing repeat schedule'
                  : 'Does not repeat'}
              </option>
              <option value="none">Does not repeat</option>
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
              <option value="YEARLY">Yearly</option>
            </select>
          </label>
          {(event?.recurringEventId || event?.recurrence) && (
            <label>
              Apply changes to
              <select
                aria-label="Event edit scope"
                value={scope}
                onChange={(e) => setScope(e.target.value as EditScope)}
              >
                <option value="one">Only this event</option>
                <option value="following">This and following events</option>
                <option value="all">All events in the series</option>
              </select>
              {scope === 'following' && (
                <small>Following-event edits reset future exceptions, as in Google Calendar.</small>
              )}
            </label>
          )}
          <label>
            <span>
              <MapPin size={15} /> Location
            </span>
            <input
              aria-label="Location"
              placeholder="Add a place"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </label>
          <label>
            <span>
              <Users size={15} /> Guests
            </span>
            <input
              aria-label="Guests"
              placeholder="Email addresses, separated by commas"
              value={guests}
              onChange={(e) => setGuests(e.target.value)}
            />
          </label>
          <label>
            <span>
              <Video size={15} /> Google Meet
            </span>
            {event?.hangoutLink ? (
              <a href={event.hangoutLink} target="_blank" rel="noreferrer" className="text-link">
                Join meeting <ExternalLink size={13} />
              </a>
            ) : (
              <span className="inline-label">
                <input type="checkbox" checked={meet} onChange={(e) => setMeet(e.target.checked)} />
                Create a meeting link
              </span>
            )}
          </label>
          <label>
            Description
            <textarea
              aria-label="Event description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Anything else to know?"
            />
          </label>
          <div className="form-grid">
            <label>
              Show as
              <select
                value={availability}
                onChange={(e) => setAvailability(e.target.value as 'opaque' | 'transparent')}
              >
                <option value="opaque">Busy</option>
                <option value="transparent">Free</option>
              </select>
            </label>
            <label>
              Visibility
              <select
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as 'default' | 'public' | 'private')}
              >
                <option value="default">Calendar default</option>
                <option value="private">Private</option>
                <option value="public">Public</option>
              </select>
            </label>
          </div>
          <label>
            Google event reminder
            <select value={reminder} onChange={(e) => setReminder(e.target.value)}>
              {event && <option value="keep">Keep existing reminders</option>}
              <option value="default">Calendar default</option>
              <option value="-1">No reminder</option>
              <option value="0">At event time</option>
              <option value="10">10 minutes before</option>
              <option value="30">30 minutes before</option>
              <option value="60">1 hour before</option>
              <option value="1440">1 day before</option>
            </select>
          </label>
          {(guests || event?.attendees?.length) && (
            <label>
              Guest notifications
              <select
                aria-label="Guest notifications"
                value={sendUpdates}
                onChange={(e) => setSendUpdates(e.target.value as 'all' | 'none')}
              >
                <option value="all">Send invitations and updates to guests</option>
                <option value="none">Do not send update emails</option>
              </select>
            </label>
          )}
        </fieldset>
        {event?.attendees?.some((a) => a.self) && (
          <div className="rsvp">
            <span>Going?</span>
            {(['accepted', 'tentative', 'declined'] as const).map((status, i) => (
              <button
                type="button"
                key={status}
                className="button secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await client.rsvp(event, status);
                    onSaved('RSVP updated');
                    onClose();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {['Yes', 'Maybe', 'No'][i]}
              </button>
            ))}
          </div>
        )}
        {event?.htmlLink && (
          <a className="text-link" href={event.htmlLink} target="_blank" rel="noreferrer">
            Open in Google Calendar <ExternalLink size={14} />
          </a>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          {event && !readOnly && (
            <button
              type="button"
              className="text-button danger"
              onClick={() => setDeleting(!deleting)}
            >
              <Trash2 size={16} />
              Delete
            </button>
          )}
          <div className="footer-actions">
            <button type="button" className="button secondary" onClick={onClose}>
              {readOnly ? 'Close' : 'Cancel'}
            </button>
            {!readOnly && (
              <button className="button primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save event'}
              </button>
            )}
          </div>
        </div>
        {deleting && (
          <div className="confirm-row">
            <span>
              Delete{' '}
              {scope === 'one'
                ? 'this event'
                : scope === 'all'
                  ? 'the entire series'
                  : 'this and following events'}
              ?
            </span>
            <button
              type="button"
              className="button danger-fill"
              disabled={busy}
              onClick={() => void remove()}
            >
              Delete event
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}
