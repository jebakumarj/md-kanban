import * as vscode from 'vscode';
import { findKanbanBoards } from './boards/boardFiles';
import { KanbanPanel } from './kanbanPanel';
import {
  BOARD_TEMPLATES,
  BoardTemplateId,
  createBoardFromTemplate,
  generateId,
  parseMarkdown,
  serializeToMarkdown,
} from './kanbanParser';
import { CodeTodo } from './todo/todoScanner';

export async function createNewBoard(extensionUri: vscode.Uri): Promise<vscode.Uri | undefined> {
  const fileUri = await createBoardFile();
  if (fileUri) {
    KanbanPanel.createOrShow(fileUri, extensionUri);
  }
  return fileUri;
}

export async function createBoardFile(): Promise<vscode.Uri | undefined> {
  const name = await vscode.window.showInputBox({
    prompt: 'Enter a name for the Kanban board',
    value: 'project',
    validateInput: (v) => {
      if (!v || v.trim().length === 0) {
        return 'Name cannot be empty';
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(v.trim())) {
        return 'Use only letters, numbers, hyphens and underscores';
      }
      return undefined;
    },
  });

  if (!name) {
    return undefined;
  }

  const pickedTemplate = await vscode.window.showQuickPick(
    BOARD_TEMPLATES.map(template => ({
      label: template.label,
      description: template.description,
      templateId: template.id,
    })),
    {
      placeHolder: 'Select a board template',
    }
  );

  if (!pickedTemplate) {
    return undefined;
  }

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showErrorMessage('Please open a folder first.');
    return undefined;
  }

  const fileName = `${name.trim()}.kanban.md`;
  const fileUri = vscode.Uri.joinPath(workspaceFolders[0].uri, fileName);

  try {
    await vscode.workspace.fs.stat(fileUri);
    vscode.window.showWarningMessage(`${fileName} already exists.`);
  } catch {
    const content = createBoardFromTemplate(
      name.trim().replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) + ' Board',
      pickedTemplate.templateId as BoardTemplateId
    );
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf-8'));
  }

  return fileUri;
}

export async function addTodoToBoard(todo: CodeTodo): Promise<{ boardUri: vscode.Uri; columnName: string } | undefined> {
  const boardUri = await pickTargetBoard();
  if (!boardUri) {
    return undefined;
  }

  let boardContent: string;
  try {
    const data = await vscode.workspace.fs.readFile(boardUri);
    boardContent = Buffer.from(data).toString('utf-8');
  } catch (error) {
    vscode.window.showErrorMessage(`Could not read board: ${getErrorMessage(error)}`);
    return undefined;
  }

  const board = parseMarkdown(boardContent);
  if (board.columns.length === 0) {
    vscode.window.showErrorMessage('Selected board has no columns.');
    return undefined;
  }

  const pickedColumn = await vscode.window.showQuickPick(
    board.columns.map(column => ({
      label: column.name,
      description: `${column.tasks.length} card${column.tasks.length === 1 ? '' : 's'}`,
      column,
    })),
    { placeHolder: 'Select a target column' }
  );

  if (!pickedColumn) {
    return undefined;
  }

  pickedColumn.column.tasks.push({
    id: generateId(),
    title: todo.title,
    description: getTodoTaskDescription(todo),
    tags: ['todo'],
    priority: 'medium',
    workload: 'normal',
    dueDate: '',
    subtasks: [],
    assignee: '',
    source: `${todo.relativePath}:${todo.line}`,
    group: '',
  });

  await vscode.workspace.fs.writeFile(boardUri, Buffer.from(serializeToMarkdown(board), 'utf-8'));
  return { boardUri, columnName: pickedColumn.column.name };
}

async function pickTargetBoard(): Promise<vscode.Uri | undefined> {
  const files = (await findKanbanBoards())
    .filter(uri => uri.path.split('/').pop()?.toLowerCase() !== 'archive.kanban.md');

  if (files.length === 0) {
    const create = await vscode.window.showInformationMessage(
      'No kanban board files found. Create one?',
      'Create'
    );
    if (create !== 'Create') {
      return undefined;
    }
    return createBoardFile();
  }

  const picked = await vscode.window.showQuickPick(
    files.map(uri => ({
      label: vscode.workspace.asRelativePath(uri),
      uri,
    })),
    { placeHolder: 'Select a board for this TODO' }
  );

  return picked?.uri;
}

function getTodoTaskDescription(todo: CodeTodo): string {
  const source = `${todo.relativePath}:${todo.line}`;
  const fileLink = getVsCodeFileLink(todo.uri, todo.line);
  return [
    `Source: ${source}`,
    `Backlink: ${fileLink}`,
    '',
    'Original TODO:',
    todo.text,
  ].join('\n');
}

function getVsCodeFileLink(uri: vscode.Uri, line: number): string {
  return `vscode://file/${encodeURI(uri.fsPath.replace(/\\/g, '/'))}:${line}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
