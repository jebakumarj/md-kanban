import * as vscode from 'vscode';
import { findKanbanBoards, isArchiveBoardUri, readBoardContent } from '../boards/boardFiles';
import { isCompletedColumnName } from '../boards/datedTasks';
import { IssueType, KanbanBoard, KanbanColumn, KanbanTask, parseMarkdown, serializeToMarkdown } from '../kanbanParser';
import { getCompletedColumnGlobs } from '../util/settings';

export interface WorkspaceIssue {
  id: string;
  title: string;
  issueType: IssueType;
  parentId: string;
  done: boolean;
  boardUri: string;
  boardPath: string;
  boardTitle: string;
  column: string;
  group: string;
  description: string;
  priority: string;
  workload: string;
  assignee: string;
  dueDate: string;
  tags: string[];
  checklistDone: number;
  checklistTotal: number;
}

export type IssueIndexEntry = Pick<
  WorkspaceIssue,
  'id' | 'title' | 'issueType' | 'parentId' | 'done' | 'boardUri' | 'boardTitle' | 'column'
>;

export function toIssueIndex(issues: WorkspaceIssue[]): IssueIndexEntry[] {
  return issues.map(({ id, title, issueType, parentId, done, boardUri, boardTitle, column }) => ({
    id,
    title,
    issueType,
    parentId,
    done,
    boardUri,
    boardTitle,
    column,
  }));
}

export interface WorkspaceBoard {
  uri: string;
  path: string;
  title: string;
  columns: Array<{ name: string; done: boolean }>;
}

export interface IssueScan {
  boards: WorkspaceBoard[];
  issues: WorkspaceIssue[];
}

export async function scanWorkspaceIssues(): Promise<IssueScan> {
  if (!vscode.workspace.workspaceFolders) {
    return { boards: [], issues: [] };
  }

  const completedColumnGlobs = getCompletedColumnGlobs();
  const scan: IssueScan = { boards: [], issues: [] };
  const boardUris = (await findKanbanBoards())
    .filter(uri => !isArchiveBoardUri(uri))
    .sort((a, b) => vscode.workspace.asRelativePath(a).localeCompare(vscode.workspace.asRelativePath(b)));

  for (const uri of boardUris) {
    const content = await readBoardContent(uri);
    if (content === undefined) {
      continue;
    }

    const board = parseMarkdown(content);
    const boardPath = vscode.workspace.asRelativePath(uri, false);
    const boardTitle = board.title || boardPath;
    scan.boards.push({
      uri: uri.toString(),
      path: boardPath,
      title: boardTitle,
      columns: board.columns.map(column => ({
        name: column.name,
        done: isCompletedColumnName(column.name, completedColumnGlobs),
      })),
    });

    for (const column of board.columns) {
      const done = isCompletedColumnName(column.name, completedColumnGlobs);
      for (const task of column.tasks) {
        scan.issues.push({
          id: task.id,
          title: task.title,
          issueType: task.issueType,
          parentId: task.parentId,
          done,
          boardUri: uri.toString(),
          boardPath,
          boardTitle,
          column: column.name,
          group: task.group,
          description: task.description,
          priority: task.priority,
          workload: task.workload,
          assignee: task.assignee,
          dueDate: task.dueDate,
          tags: task.tags,
          checklistDone: task.subtasks.filter(subtask => subtask.done).length,
          checklistTotal: task.subtasks.length,
        });
      }
    }
  }

  return scan;
}

export async function editBoardFile(uri: vscode.Uri, mutate: (board: KanbanBoard) => boolean): Promise<boolean> {
  const content = await readBoardContent(uri);
  if (content === undefined) {
    return false;
  }

  const board = parseMarkdown(content);
  if (!mutate(board)) {
    return false;
  }

  await vscode.workspace.fs.writeFile(uri, Buffer.from(serializeToMarkdown(board), 'utf-8'));
  return true;
}

export function findTaskInBoard(
  board: KanbanBoard,
  taskId: string
): { column: KanbanColumn; index: number; task: KanbanTask } | undefined {
  for (const column of board.columns) {
    const index = column.tasks.findIndex(task => task.id === taskId);
    if (index !== -1) {
      return { column, index, task: column.tasks[index] };
    }
  }
  return undefined;
}

export function moveTaskToColumn(board: KanbanBoard, taskId: string, columnName: string): boolean {
  const found = findTaskInBoard(board, taskId);
  const target = board.columns.find(column => column.name === columnName);
  if (!found || !target || found.column === target) {
    return false;
  }

  found.column.tasks.splice(found.index, 1);
  let insertIdx = target.tasks.length;
  if (found.task.group) {
    const lastInGroup = target.tasks.reduce((last, task, idx) => (task.group === found.task.group ? idx : last), -1);
    if (lastInGroup !== -1) {
      insertIdx = lastInGroup + 1;
    }
  }
  target.tasks.splice(insertIdx, 0, found.task);
  return true;
}

export async function unlinkChildren(
  parentId: string,
  issues: Array<Pick<WorkspaceIssue, 'parentId' | 'boardUri'>>
): Promise<void> {
  const boardUris = new Set(issues.filter(issue => issue.parentId === parentId).map(issue => issue.boardUri));
  for (const boardUri of boardUris) {
    await editBoardFile(vscode.Uri.parse(boardUri), board => {
      let changed = false;
      for (const column of board.columns) {
        for (const task of column.tasks) {
          if (task.parentId === parentId) {
            task.parentId = '';
            changed = true;
          }
        }
      }
      return changed;
    });
  }
}
