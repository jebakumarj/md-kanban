import * as vscode from 'vscode';
import { CalendarTask, TIMELINE_BUCKETS, TimelineBucketId, TimelineTask } from '../boards/datedTasks';
import { addDays, getTodayStart, getWeekStart, toDateIso } from '../util/dates';

/**
 * HTML for the Calendar side-panel view.
 *
 * Both modes follow the same rules as the board panel webview: a locked-down
 * Content-Security-Policy, the view data embedded as JSON, and all behavior in
 * `media/calendar.js` rather than an inline script.
 */

export function renderCalendarHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  visibleMonth: Date,
  tasks: CalendarTask[]
): string {
  const monthStart = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
  const monthLabel = monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const todayIso = toDateIso(getTodayStart());
  const tasksByDate = groupCalendarTasksByDate(tasks);
  const cells = getCalendarCells(monthStart).map(date => {
    const iso = toDateIso(date);
    const dayTasks = tasksByDate.get(iso) || [];
    const overdueCount = dayTasks.filter(task => task.isOverdue).length;
    return {
      date: iso,
      day: date.getDate(),
      inMonth: date.getMonth() === monthStart.getMonth(),
      isToday: iso === todayIso,
      count: dayTasks.length,
      overdueCount,
      tooltip: dayTasks.map(task => `${task.title} (${task.boardTitle})`).join('\n'),
    };
  });

  const body = `  <div class="calendar-header">
    <button class="nav-button" type="button" data-action="prevMonth" title="Previous month">&lsaquo;</button>
    <div class="calendar-title" id="month-title"></div>
    <button class="nav-button" type="button" data-action="nextMonth" title="Next month">&rsaquo;</button>
    <button class="nav-button" type="button" data-action="today" title="Today">&#9673;</button>
  </div>
  <div class="weekday-grid">
    <div class="weekday">Mon</div>
    <div class="weekday">Tue</div>
    <div class="weekday">Wed</div>
    <div class="weekday">Thu</div>
    <div class="weekday">Fri</div>
    <div class="weekday">Sat</div>
    <div class="weekday">Sun</div>
  </div>
  <div class="calendar-grid" id="calendar-grid"></div>
  <div class="empty" id="empty-state" hidden>No dated cards in this month.</div>`;

  return renderShell(webview, extensionUri, CALENDAR_STYLES, body, { mode: 'calendar', monthLabel, cells });
}

export function renderTimelineHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  tasks: TimelineTask[]
): string {
  const grouped = groupTimelineTasks(tasks);
  const buckets = TIMELINE_BUCKETS.map(bucket => ({
    ...bucket,
    tasks: grouped.get(bucket.id) || [],
  }));

  return renderShell(webview, extensionUri, TIMELINE_STYLES, '  <div id="timeline"></div>', {
    mode: 'timeline',
    buckets,
  });
}

function renderShell(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  styles: string,
  body: string,
  payload: unknown
): string {
  const payloadJson = JSON.stringify(payload).replace(/</g, '\\u003c');
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'calendar.js')
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src ${webview.cspSource};">
  <style>
${styles}
  </style>
</head>
<body>
${body}
<script type="application/json" id="calendar-data">${payloadJson}</script>
<script src="${scriptUri}"></script>
</body>
</html>`;
}

function getCalendarCells(monthStart: Date): Date[] {
  const gridStart = getWeekStart(monthStart);
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

function groupCalendarTasksByDate(tasks: CalendarTask[]): Map<string, CalendarTask[]> {
  const grouped = new Map<string, CalendarTask[]>();
  for (const task of tasks) {
    const group = grouped.get(task.dueDate) || [];
    group.push(task);
    grouped.set(task.dueDate, group);
  }
  return grouped;
}

function groupTimelineTasks(tasks: TimelineTask[]): Map<TimelineBucketId, TimelineTask[]> {
  const grouped = new Map<TimelineBucketId, TimelineTask[]>();
  for (const bucket of TIMELINE_BUCKETS) {
    grouped.set(bucket.id, []);
  }
  for (const task of tasks) {
    grouped.get(task.bucket)?.push(task);
  }
  return grouped;
}

const CALENDAR_STYLES = `    :root {
      color-scheme: light dark;
    }

    body {
      margin: 0;
      padding: 10px;
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    .calendar-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      margin-bottom: 8px;
    }

    .calendar-title {
      min-width: 0;
      flex: 1;
      text-align: center;
      font-weight: 700;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    button {
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 4px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      font: inherit;
      cursor: pointer;
    }

    button:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .nav-button {
      width: 28px;
      height: 28px;
      padding: 0;
      line-height: 1;
    }

    .weekday-grid,
    .calendar-grid {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: 3px;
    }

    .weekday {
      text-align: center;
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
      font-weight: 700;
      padding-bottom: 2px;
    }

    .day {
      position: relative;
      min-height: 34px;
      padding: 4px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 5px;
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      text-align: left;
      overflow: hidden;
    }

    .day.other-month {
      opacity: 0.45;
    }

    .day.today {
      border-color: var(--vscode-focusBorder);
      box-shadow: 0 0 0 1px var(--vscode-focusBorder) inset;
    }

    .day.has-tasks {
      cursor: pointer;
    }

    .day-number {
      font-weight: 700;
      font-size: 11px;
    }

    .task-dot {
      position: absolute;
      top: 5px;
      right: 5px;
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: var(--vscode-charts-blue);
    }

    .task-dot.overdue {
      background: var(--vscode-errorForeground);
    }

    .task-count {
      display: inline-block;
      margin-top: 5px;
      padding: 0 4px;
      border-radius: 999px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      font-size: 9px;
      line-height: 1.35;
    }

    .empty {
      margin-top: 10px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      line-height: 1.4;
    }`;

const TIMELINE_STYLES = `    body {
      margin: 0;
      padding: 8px;
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    .bucket {
      margin-bottom: 2px;
    }

    .bucket summary {
      display: list-item;
      min-height: 22px;
      padding: 2px 4px;
      border-radius: 3px;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      user-select: none;
    }

    .bucket summary:hover {
      background: var(--vscode-list-hoverBackground);
      color: var(--vscode-list-hoverForeground, var(--vscode-foreground));
    }

    .bucket-label {
      display: inline-block;
      max-width: calc(100% - 42px);
      overflow: hidden;
      text-overflow: ellipsis;
      vertical-align: top;
      white-space: nowrap;
      font-weight: 600;
    }

    .bucket-count {
      float: right;
      margin-left: 8px;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }

    .task-content {
      min-width: 0;
    }

    .task-list {
      margin: 1px 0 6px;
      padding: 0;
      list-style: none;
    }

    .task-row {
      width: 100%;
      display: grid;
      grid-template-columns: 14px minmax(0, 1fr);
      gap: 2px;
      align-items: start;
      min-height: 24px;
      padding: 2px 4px 2px 14px;
      border: 0;
      border-radius: 3px;
      background: transparent;
      color: var(--vscode-foreground);
      text-align: left;
      font: inherit;
      cursor: pointer;
    }

    .task-row:hover {
      background: var(--vscode-list-hoverBackground);
      color: var(--vscode-list-hoverForeground, var(--vscode-foreground));
    }

    .task-row:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }

    .task-icon {
      color: var(--vscode-descriptionForeground);
      line-height: 18px;
      text-align: center;
    }

    .task-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      line-height: 18px;
    }

    .task-meta {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      line-height: 15px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .empty {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      line-height: 1.4;
    }`;
