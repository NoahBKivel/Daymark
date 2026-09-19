# Potential future option: store tasks in Google Calendar

> **Status: Deferred for possible future evaluation.** Daymark currently keeps tasks in D1, keeps events in Google Calendar, and sends one-way copies to Google Tasks. Nothing in this document is approved for implementation.

## Idea

Represent Daymark tasks as Google Calendar events. Daymark would read the user's calendars, distinguish task events from ordinary events, and render both through the existing interface. A dated task would be an all-day event spanning its start date through its deadline, making Google Calendar the source of truth for events and dated tasks.

Do not use a `TASK:` title prefix as the authoritative marker. A user could remove it, and an unrelated event could begin with it. It could remain an optional visual convention. Use Google Calendar private extended properties instead:

```json
{
  "summary": "Finish textbook presentation",
  "start": { "date": "2026-09-15" },
  "end": { "date": "2026-09-19" },
  "transparency": "transparent",
  "reminders": { "useDefault": false },
  "extendedProperties": {
    "private": {
      "daymarkType": "task",
      "daymarkVersion": "1",
      "listId": "school",
      "completedAt": "",
      "deadlineTime": "17:00",
      "deadlineTimeZone": "America/New_York"
    }
  }
}
```

Titles and descriptions would remain readable in Google Calendar. Hidden metadata would hold completion, list membership, deadline time, color overrides, recurrence data, and checklists. Google limits each property value to 1,024 characters and all extended properties on an event to 32 KB across at most 300 properties, so checklist JSON would require versioned chunks and a reasonable size limit. See [Google Calendar extended properties](https://developers.google.com/workspace/calendar/api/guides/extended-properties).

## Recommended structure

Create one user-owned `Daymark Tasks` secondary calendar per account. This separates tasks from appointments, lets users show or hide them in Google Calendar, and makes task discovery and migration safer. Task events should be transparent/free, have no attendees, and have reminders disabled unless Daymark later adds task reminders. Daymark would combine this calendar with the user's ordinary calendars in its interface.

One calendar per task list is another possibility, but it would create more calendars and more management complexity. A single task calendar with list metadata is the preferred design.

## Task mapping

- **Dates:** Store tasks as all-day events. Google uses an exclusive end date, matching Daymark's internal model. A task covering September 15–18 ends on September 19 in the API.
- **Deadline-only tasks:** Use one-day all-day events.
- **Deadline time:** Store the time and time zone in private metadata. It remains a label and does not reserve hourly space.
- **Completion:** Store a separate completion timestamp. Keep the original event dates when completed.
- **Lists and colors:** Store stable list IDs and optional color overrides. Google's limited color palette may not reproduce every Daymark color exactly.
- **Descriptions:** Use the normal event description.
- **Checklists:** Store versioned, chunked JSON in private metadata. Google Calendar would not provide a checklist editor.
- **Recurrence:** Use recurring Google events where possible. Completing or changing one occurrence creates an exception. Editing an occurrence and future occurrences still requires splitting the series while preserving history.
- **Loading:** Fetch and paginate only the visible date range, with separate paginated task-history searches. Incremental sync is available but requires somewhere to persist sync tokens; visible-range fetching with browser-memory caching may be sufficient. See [Google Calendar synchronization](https://developers.google.com/workspace/calendar/api/guides/sync).

## Limitations and unresolved decisions

### Undated tasks

Calendar events require dates. Possible choices are:

1. Keep undated tasks in D1, leaving task data split between systems.
2. Put them on reserved sentinel dates in a normally hidden `Daymark Data` calendar and suppress those dates in Daymark.
3. Remove undated-task support.

The hidden metadata calendar keeps all task data in Google, but it is an artificial convention that must be protected from accidental edits.

### Edits outside Daymark

Google Calendar could edit a task's title, description, and dates. It could not edit hidden completion, checklist, or deadline-time fields. Deleting the event in Google Calendar would delete the task. Daymark must validate metadata on read, preserve unknown fields on write, and surface damaged records rather than silently losing them.

### Permissions and size

Daymark can modify tasks only on calendars where the signed-in user has write permission. The dedicated task calendar should remain owned by that user. Very large checklists may exceed Calendar's metadata limits and would need an explicit maximum size.

## Benefits

- Remove D1 task, checklist, recurrence, exception, and Google Tasks mapping records.
- Remove the Google Tasks export queue, retry reconciliation, and duplicate-copy risk.
- Make dated task data recoverable from the user's Google account.
- Reflect task date changes made directly in Google Calendar.
- Use Google's recurring-event infrastructure instead of exporting a rolling Google Tasks window.

## Why D1 would probably remain

Moving task content does not remove the current need to store users, sessions, encrypted Google credentials, settings, allowlist state, and possibly synchronization state. A database-free design could place encrypted authorization state in secure cookies and settings in special Google events, but that makes revocation, multiple devices, account deletion, and long-lived token security harder.

The preferred form of this option is therefore:

1. Make Google Calendar authoritative for events and Daymark tasks.
2. Keep a small D1 database for authentication, encrypted Google credentials, account state, and settings.
3. Remove task and Google Tasks synchronization data from D1.
4. Stop requesting and using the Google Tasks API scope.

This puts personal calendar and task content in Google while retaining a safer server-side login design.

## Possible migration

1. Version the extended-property schema and decide how undated tasks work.
2. Create a dedicated Daymark task calendar for each connected account.
3. Implement task parsing, validation, and Calendar-backed mutations using etags.
4. Cover direct Google edits, deletions, recurrence exceptions, malformed metadata, and size limits with tests.
5. Build an idempotent migration that creates one event per existing task and records progress.
6. Verify every migrated task before disabling Google Tasks export.
7. Keep a private D1 backup and Daymark JSON export during a rollback period.
8. Remove obsolete task tables and sync code only after live verification.

## Decision summary

This option is technically feasible and could simplify Daymark. The strongest form uses a dedicated calendar and private extended properties rather than a title prefix. Undated tasks are the main unresolved modeling problem. D1 should probably remain as small authentication infrastructure even if all event and task content moves to Google.

Do not begin implementation until this option is deliberately selected and the undated-task behavior is decided.
