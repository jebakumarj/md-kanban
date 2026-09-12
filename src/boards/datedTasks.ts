import * as vscode from 'vscode';
import { parseMarkdown } from '../kanbanParser';
import { addDays, getTodayStart, getWeekStart, isSameDay, parseDateOnly } from '../util/dates';
import { globMatches } from '../util/globs';
import { getCompletedColumnGlobs } from '../util/settings';
import { findKanbanBoards, isArchiveBoardUri, readBoardContent } from './boardFiles';

export type TimelineBucketId = 'today' | 'this-week' | 'next-week' | 'later';

export const TIMELINE_BUCKETS: Array<{ id: TimelineBucketId; label: string; description: string; icon: string }> = [
  { id: 'today', label: 'Today', description: 'Due today', icon: 'calendar' },
  { id: 'this-week', label: 'This Week', description: 'Due later this week', icon: 'calendar' },
  { id: 'next-week', label: 'Next Week', description: 'Due next week', icon: 'calendar' },
  { id: 'later', label: 'Later', description: 'Due after next week', icon: 'calendar' },
];

/**
 * One card with a parseable due date, in a column that is not treated as completed.
 *
 * The overdue, timeline, and calendar views are all filtered projections of this
 * single scan, so the workspace boards are read once per refresh instead of once
 * per view.
 */
export interface DatedTask {
  boardUri: vscode.Uri;
  boardPath: string;
  boardTitle: string;
  columnName: string;
  taskId: string;
  title: string;
  dueDate: string;
  dueDateValue: Date;
  assignee: string;
  priority: string;
}

export interface OverdueTask extends DatedTask {
  daysOverdue: number;
}

export interface TimelineTask extends DatedTask {
  bucket: TimelineBucketId;
}

export interface CalendarTask extends DatedTask {
  isOverdue: boolean;
}

export async function scanDatedTasks(): Promise<DatedTask[]> {
  if (!vscode.workspace.workspaceFolders) {
    return [];
  }

  const completedColumnGlobs = getCompletedColumnGlobs();
  const datedTasks: DatedTask[] = [];

  for (const boardUri of await findKanbanBoards()) {
    if (isArchiveBoardUri(boardUri)) {
      continue;
    }

    const boardContent = await readBoardContent(boardUri);
    if (boardContent === undefined) {
      continue;
    }

    const board = parseMarkdown(boardContent);
    const boardPath = vscode.workspace.asRelativePath(boardUri, false);
    for (const column of board.columns) {
      if (isCompletedColumnName(column.name, completedColumnGlobs)) {
        continue;
      }

      for (const task of column.tasks) {
        const dueDateValue = parseDateOnly(task.dueDate);
        if (!dueDateValue) {
          continue;
        }

        datedTasks.push({
          boardUri,
          boardPath,
          boardTitle: board.title || boardPath,
          columnName: column.name,
          taskId: task.id,
          title: task.title,
          dueDate: task.dueDate,
          dueDateValue,
          assignee: task.assignee,
          priority: task.priority,
        });
      }
    }
  }

  return datedTasks.sort((a, b) => {
    const dueCompare = a.dueDate.localeCompare(b.dueDate);
    const boardCompare = a.boardPath.localeCompare(b.boardPath);
    return dueCompare || boardCompare || a.title.localeCompare(b.title);
  });
}

export function selectOverdueTasks(tasks: DatedTask[], today: Date = getTodayStart()): OverdueTask[] {
  return tasks
    .filter(task => task.dueDateValue < today)
    .map(task => ({
      ...task,
      daysOverdue: Math.max(1, Math.floor((today.getTime() - task.dueDateValue.getTime()) / 86400000)),
    }));
}

export function selectTimelineTasks(tasks: DatedTask[], today: Date = getTodayStart()): TimelineTask[] {
  return tasks
    .filter(task => task.dueDateValue >= today)
    .map(task => ({ ...task, bucket: getTimelineBucket(task.dueDateValue, today) }));
}

export function selectCalendarTasks(tasks: DatedTask[], today: Date = getTodayStart()): CalendarTask[] {
  return tasks.map(task => ({ ...task, isOverdue: task.dueDateValue < today }));
}

export function getTimelineBucket(dueDate: Date, today: Date): TimelineBucketId {
  if (isSameDay(dueDate, today)) {
    return 'today';
  }

  const nextWeekStart = addDays(getWeekStart(today), 7);
  const followingWeekStart = addDays(nextWeekStart, 7);

  if (dueDate < nextWeekStart) {
    return 'this-week';
  }
  if (dueDate < followingWeekStart) {
    return 'next-week';
  }
  return 'later';
}

export function isCompletedColumnName(name: string, globs: string[]): boolean {
  const columnName = name.trim();
  return globs.some(glob => globMatches(columnName, glob));
}
