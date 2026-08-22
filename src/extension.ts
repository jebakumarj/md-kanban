import * as vscode from 'vscode';
import { KanbanPanel } from './kanbanPanel';
import {
  BOARD_TEMPLATES,
  BoardTemplateId,
  createBoardFromTemplate,
  generateId,
  parseMarkdown,
  serializeToMarkdown,
} from './kanbanParser';
import { getTodoMatch } from './todoMatcher';

class KanbanBoardItem extends vscode.TreeItem {
  constructor(public readonly uri: vscode.Uri) {
    super(vscode.workspace.asRelativePath(uri), vscode.TreeItemCollapsibleState.None);
    this.resourceUri = uri;
    this.tooltip = uri.fsPath;
    this.description = vscode.workspace.asRelativePath(vscode.Uri.joinPath(uri, '..'));
    this.contextValue = 'kanbanBoard';
    this.command = {
      command: 'md-kanban.openBoardFile',
      title: 'Open Kanban Board',
      arguments: [uri],
    };
  }
}

class KanbanBoardsProvider implements vscode.TreeDataProvider<KanbanBoardItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<KanbanBoardItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: KanbanBoardItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<KanbanBoardItem[]> {
    if (!vscode.workspace.workspaceFolders) {
      return [];
    }

    const files = await findKanbanBoards();
    return files
      .sort((a, b) => vscode.workspace.asRelativePath(a).localeCompare(vscode.workspace.asRelativePath(b)))
      .map(uri => new KanbanBoardItem(uri));
  }
}

interface CodeTodo {
  uri: vscode.Uri;
  relativePath: string;
  line: number;
  keyword: string;
  title: string;
  text: string;
}

const TODO_DEFAULT_INCLUDE = ['**/*'];
const TODO_DEFAULT_EXCLUDE = ['**/node_modules/**', '**/out/**', '**/dist/**', '**/build/**', '**/coverage/**'];
const TODO_REQUIRED_EXCLUDE = ['**/.git/**', '**/*.kanban.md', '**/kanban.md', '**/.kanban.md'];
const TODO_DEFAULT_KEYWORDS = ['TODO', 'FIXME', 'BUG', 'HACK', 'NOTE'];
const TODO_MAX_FILE_BYTES = 1024 * 1024;
const TODO_BINARY_SAMPLE_BYTES = 8000;
const COMPLETED_COLUMN_DEFAULT_GLOBS = ['Done', 'Closed', 'Shipped', 'Archived'];

type CodeTodoNode = CodeTodoFolderItem | CodeTodoFileItem | CodeTodoItem;
type OverdueTaskNode = OverdueDateItem | OverdueTaskItem;
type TimelineBucketId = 'today' | 'this-week' | 'next-week' | 'later';

const TIMELINE_BUCKETS: Array<{ id: TimelineBucketId; label: string; description: string; icon: string }> = [
  { id: 'today', label: 'Today', description: 'Due today', icon: 'calendar' },
  { id: 'this-week', label: 'This Week', description: 'Due later this week', icon: 'calendar' },
  { id: 'next-week', label: 'Next Week', description: 'Due next week', icon: 'calendar' },
  { id: 'later', label: 'Later', description: 'Due after next week', icon: 'calendar' },
];

interface OverdueTask {
  boardUri: vscode.Uri;
  boardPath: string;
  boardTitle: string;
  columnName: string;
  taskId: string;
  title: string;
  dueDate: string;
  daysOverdue: number;
  assignee: string;
  priority: string;
}

interface TimelineTask {
  bucket: TimelineBucketId;
  boardUri: vscode.Uri;
  boardPath: string;
  boardTitle: string;
  columnName: string;
  taskId: string;
  title: string;
  dueDate: string;
  assignee: string;
  priority: string;
}

interface CalendarTask {
  boardUri: vscode.Uri;
  boardPath: string;
  boardTitle: string;
  columnName: string;
  taskId: string;
  title: string;
  dueDate: string;
  isOverdue: boolean;
  assignee: string;
  priority: string;
}

class CodeTodoFolderItem extends vscode.TreeItem {
  readonly children = new Map<string, CodeTodoFolderItem | CodeTodoFileItem>();

  constructor(name: string) {
    super(name, vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = vscode.ThemeIcon.Folder;
  }
}

class CodeTodoFileItem extends vscode.TreeItem {
  readonly todos: CodeTodo[] = [];

  constructor(
    uri: vscode.Uri,
    relativePath: string,
  ) {
    super(uri, vscode.TreeItemCollapsibleState.Collapsed);
    this.tooltip = relativePath;
    this.iconPath = vscode.ThemeIcon.File;
  }
}

class CodeTodoItem extends vscode.TreeItem {
  constructor(
    public readonly todo: CodeTodo,
    iconUri: vscode.Uri,
  ) {
    super(todo.title, vscode.TreeItemCollapsibleState.None);
    this.description = `:${todo.line}`;
    this.tooltip = todo.text;
    this.iconPath = iconUri;
    this.contextValue = 'codeTodo';
    this.command = {
      command: 'md-kanban.openCodeTodo',
      title: 'Open TODO',
      arguments: [todo],
    };
  }
}

class CodeTodosProvider implements vscode.TreeDataProvider<CodeTodoNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<CodeTodoNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private roots: CodeTodoNode[] | undefined;

  constructor(private readonly todoIconUri: vscode.Uri) {}

  refresh(): void {
    this.roots = undefined;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: CodeTodoNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: CodeTodoNode): Promise<CodeTodoNode[]> {
    if (!this.roots) {
      this.roots = buildCodeTodoTree(await scanCodeTodos());
    }

    if (!element) {
      return this.roots;
    }

    if (element instanceof CodeTodoFolderItem) {
      return sortCodeTodoNodes(Array.from(element.children.values()));
    }

    if (element instanceof CodeTodoFileItem) {
      return element.todos.map(todo => new CodeTodoItem(todo, this.todoIconUri));
    }

    return [];
  }
}

class OverdueDateItem extends vscode.TreeItem {
  readonly tasks: OverdueTask[] = [];

  constructor(public readonly dueDate: string) {
    super(dueDate, vscode.TreeItemCollapsibleState.Expanded);
    this.tooltip = dueDate;
    this.iconPath = new vscode.ThemeIcon('calendar');
    this.contextValue = 'overdueDate';
  }
}

class OverdueTaskItem extends vscode.TreeItem {
  constructor(public readonly task: OverdueTask) {
    super(task.title, vscode.TreeItemCollapsibleState.None);
    const dayLabel = task.daysOverdue === 1 ? '1 day overdue' : `${task.daysOverdue} days overdue`;
    this.description = `${task.boardTitle} • ${task.columnName}`;
    this.tooltip = [
      dayLabel,
      `Board: ${task.boardTitle}`,
      `Column: ${task.columnName}`,
      task.assignee ? `Assignee: ${task.assignee}` : '',
      task.priority ? `Priority: ${task.priority}` : '',
    ].filter(Boolean).join('\n');
    this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
    this.contextValue = 'overdueTask';
    this.command = {
      command: 'md-kanban.openOverdueTask',
      title: 'Open Overdue Task',
      arguments: [task],
    };
  }
}

class OverdueTasksProvider implements vscode.TreeDataProvider<OverdueTaskNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<OverdueTaskNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private roots: OverdueDateItem[] | undefined;

  refresh(): void {
    this.roots = undefined;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: OverdueTaskNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: OverdueTaskNode): Promise<OverdueTaskNode[]> {
    if (!this.roots) {
      this.roots = buildOverdueTaskTree(await scanOverdueTasks());
    }

    if (!element) {
      return this.roots;
    }

    if (element instanceof OverdueDateItem) {
      return element.tasks.map(task => new OverdueTaskItem(task));
    }

    return [];
  }
}

class CalendarWebviewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private visibleMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  private tasks: CalendarTask[] = [];
  private timelineTasks: TimelineTask[] = [];
  private mode: 'calendar' | 'timeline' = 'calendar';

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
    };
    webviewView.webview.onDidReceiveMessage(message => this.handleMessage(message));
    this.updateModeContext();
    this.refresh();
  }

  async refresh(): Promise<void> {
    this.tasks = await scanCalendarTasks();
    this.timelineTasks = await scanTimelineTasks();
    this.render();
  }

  async showCalendar(): Promise<void> {
    this.mode = 'calendar';
    this.updateModeContext();
    await this.refresh();
    await vscode.commands.executeCommand('md-kanban.calendar.focus');
  }

  async showTimeline(): Promise<void> {
    this.mode = 'timeline';
    this.updateModeContext();
    await this.refresh();
    await vscode.commands.executeCommand('md-kanban.calendar.focus');
  }

  private async handleMessage(message: { type?: string; date?: string; taskId?: string }) {
    if (message.type === 'prevMonth') {
      this.visibleMonth = new Date(this.visibleMonth.getFullYear(), this.visibleMonth.getMonth() - 1, 1);
      this.render();
      return;
    }

    if (message.type === 'nextMonth') {
      this.visibleMonth = new Date(this.visibleMonth.getFullYear(), this.visibleMonth.getMonth() + 1, 1);
      this.render();
      return;
    }

    if (message.type === 'today') {
      const today = getTodayStart();
      this.visibleMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      this.render();
      return;
    }

    if (message.type === 'showTimeline') {
      this.mode = 'timeline';
      this.updateModeContext();
      this.render();
      return;
    }

    if (message.type === 'showCalendar') {
      this.mode = 'calendar';
      this.updateModeContext();
      this.render();
      return;
    }

    if (message.type === 'openDate' && message.date) {
      const task = this.tasks.find(item => item.dueDate === message.date);
      if (task) {
        KanbanPanel.createOrShow(task.boardUri, this.extensionUri, task.taskId);
      }
      return;
    }

    if (message.type === 'openTask' && message.taskId) {
      const task = this.tasks.find(item => item.taskId === message.taskId)
        ?? this.timelineTasks.find(item => item.taskId === message.taskId);
      if (task) {
        KanbanPanel.createOrShow(task.boardUri, this.extensionUri, task.taskId);
      }
    }
  }

  private render(): void {
    if (!this.view) {
      return;
    }
    this.view.webview.html = this.mode === 'timeline'
      ? renderTimelineHtml(this.timelineTasks)
      : renderCalendarHtml(this.visibleMonth, this.tasks);
  }

  private updateModeContext(): void {
    vscode.commands.executeCommand('setContext', 'mdKanban.calendarModeCalendar', this.mode === 'calendar');
    vscode.commands.executeCommand('setContext', 'mdKanban.calendarModeTimeline', this.mode === 'timeline');
  }
}

export function activate(context: vscode.ExtensionContext) {
  const boardsProvider = new KanbanBoardsProvider();
  const todosProvider = new CodeTodosProvider(
    vscode.Uri.joinPath(context.extensionUri, 'src', 'image', 'todo-checked.svg')
  );
  const overdueProvider = new OverdueTasksProvider();
  const calendarProvider = new CalendarWebviewProvider(context.extensionUri);
  const boardsView = vscode.window.createTreeView('md-kanban.boards', {
    treeDataProvider: boardsProvider,
    showCollapseAll: false,
  });
  context.subscriptions.push(boardsView);

  const todosView = vscode.window.createTreeView('md-kanban.codeTodos', {
    treeDataProvider: todosProvider,
    showCollapseAll: false,
  });
  context.subscriptions.push(todosView);

  const overdueView = vscode.window.createTreeView('md-kanban.overdueTasks', {
    treeDataProvider: overdueProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(overdueView);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('md-kanban.calendar', calendarProvider)
  );

  const boardWatcher = vscode.workspace.createFileSystemWatcher('**/*kanban.md');
  boardWatcher.onDidCreate(() => {
    boardsProvider.refresh();
    overdueProvider.refresh();
    calendarProvider.refresh();
  });
  boardWatcher.onDidDelete(() => {
    boardsProvider.refresh();
    overdueProvider.refresh();
    calendarProvider.refresh();
  });
  boardWatcher.onDidChange(() => {
    boardsProvider.refresh();
    overdueProvider.refresh();
    calendarProvider.refresh();
  });
  context.subscriptions.push(boardWatcher);

  const codeWatcher = vscode.workspace.createFileSystemWatcher('**/*');
  codeWatcher.onDidCreate(() => todosProvider.refresh());
  codeWatcher.onDidDelete(() => todosProvider.refresh());
  codeWatcher.onDidChange(() => todosProvider.refresh());
  context.subscriptions.push(codeWatcher);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(event => {
      if (
        event.affectsConfiguration('mdKanban.todoInclude') ||
        event.affectsConfiguration('mdKanban.todoExclude') ||
        event.affectsConfiguration('mdKanban.todoKeywords')
      ) {
        todosProvider.refresh();
      }

      if (event.affectsConfiguration('mdKanban.completedColumnGlobs')) {
        overdueProvider.refresh();
        calendarProvider.refresh();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('md-kanban.openBoard', async () => {
      const files = await findKanbanBoards(20);

      if (files.length === 0) {
        const create = await vscode.window.showInformationMessage(
          'No kanban board files found. Create one?',
          'Create'
        );
        if (create === 'Create') {
          await createNewBoard(context.extensionUri);
        }
        return;
      }

      if (files.length === 1) {
        KanbanPanel.createOrShow(files[0], context.extensionUri);
        return;
      }

      const picked = await vscode.window.showQuickPick(
        files.map(f => ({
          label: vscode.workspace.asRelativePath(f),
          uri: f,
        })),
        { placeHolder: 'Select a Kanban board to open' }
      );

      if (picked) {
        KanbanPanel.createOrShow(picked.uri, context.extensionUri);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('md-kanban.openBoardFile', async (target: vscode.Uri | KanbanBoardItem | { uri?: vscode.Uri }) => {
      const fileUri = getBoardUriFromTarget(target) ?? getActiveBoardUri();
      if (fileUri) {
        KanbanPanel.createOrShow(fileUri, context.extensionUri);
      } else {
        vscode.window.showErrorMessage('Could not open the selected Kanban board.');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('md-kanban.createBoard', async () => {
      const created = await createNewBoard(context.extensionUri);
      if (created) {
        boardsProvider.refresh();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('md-kanban.refreshBoards', () => boardsProvider.refresh())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('md-kanban.refreshCodeTodos', () => todosProvider.refresh())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('md-kanban.refreshOverdueTasks', () => overdueProvider.refresh())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('md-kanban.showOverdueTasks', async () => {
      overdueProvider.refresh();
      await vscode.commands.executeCommand('md-kanban.overdueTasks.focus');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('md-kanban.refreshTimeline', () => calendarProvider.refresh())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('md-kanban.showTimeline', () => calendarProvider.showTimeline())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('md-kanban.refreshCalendar', () => calendarProvider.refresh())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('md-kanban.showCalendar', () => calendarProvider.showCalendar())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('md-kanban.openCodeTodo', async (target: CodeTodo | CodeTodoItem) => {
      const todo = target instanceof CodeTodoItem ? target.todo : target;
      if (!todo || !todo.uri) {
        return;
      }

      const doc = await vscode.workspace.openTextDocument(todo.uri);
      const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
      const position = new vscode.Position(Math.max(0, todo.line - 1), 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('md-kanban.addTodoToBoard', async (target: CodeTodo | CodeTodoItem) => {
      const todo = target instanceof CodeTodoItem ? target.todo : target;
      if (!todo || !todo.uri) {
        vscode.window.showErrorMessage('Could not find the selected TODO.');
        return;
      }

      const added = await addTodoToBoard(todo);
      if (added) {
        boardsProvider.refresh();
        vscode.window.showInformationMessage(
          `Added TODO to ${vscode.workspace.asRelativePath(added.boardUri)} in ${added.columnName}.`
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('md-kanban.openOverdueTask', async (target: OverdueTask | OverdueTaskItem) => {
      const task = target instanceof OverdueTaskItem ? target.task : target;
      if (task?.boardUri) {
        KanbanPanel.createOrShow(task.boardUri, context.extensionUri, task.taskId);
      }
    })
  );

}

async function scanCodeTodos(): Promise<CodeTodo[]> {
  if (!vscode.workspace.workspaceFolders) {
    return [];
  }

  const settings = getTodoScanSettings();
  const files = await findTodoScanFiles(settings.include, settings.exclude, 2000);
  const todos: CodeTodo[] = [];

  for (const uri of files) {
    let content: string;
    try {
      const data = await vscode.workspace.fs.readFile(uri);
      if (shouldSkipTodoScanData(data)) {
        continue;
      }
      content = Buffer.from(data).toString('utf-8');
    } catch {
      continue;
    }

    const relativePath = vscode.workspace.asRelativePath(uri, false);
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const todoMatch = getTodoMatch(lines[i], settings.keywords);
      if (!todoMatch) {
        continue;
      }

      todos.push({
        uri,
        relativePath,
        line: i + 1,
        keyword: todoMatch.keyword,
        title: todoMatch.title || todoMatch.keyword,
        text: lines[i].trim(),
      });
    }
  }

  return todos.sort((a, b) => {
    const fileCompare = a.relativePath.localeCompare(b.relativePath);
    return fileCompare || a.line - b.line;
  });
}

async function scanOverdueTasks(): Promise<OverdueTask[]> {
  if (!vscode.workspace.workspaceFolders) {
    return [];
  }

  const today = getTodayStart();
  const completedColumnGlobs = getCompletedColumnGlobs();
  const overdueTasks: OverdueTask[] = [];

  for (const boardUri of await findKanbanBoards()) {
    if (isArchiveBoardUri(boardUri)) {
      continue;
    }

    let boardContent: string;
    try {
      const data = await vscode.workspace.fs.readFile(boardUri);
      boardContent = Buffer.from(data).toString('utf-8');
    } catch {
      continue;
    }

    const board = parseMarkdown(boardContent);
    const boardPath = vscode.workspace.asRelativePath(boardUri, false);
    for (const column of board.columns) {
      if (isCompletedColumnName(column.name, completedColumnGlobs)) {
        continue;
      }

      for (const task of column.tasks) {
        const dueDate = parseDateOnly(task.dueDate);
        if (!dueDate || dueDate >= today) {
          continue;
        }

        overdueTasks.push({
          boardUri,
          boardPath,
          boardTitle: board.title || boardPath,
          columnName: column.name,
          taskId: task.id,
          title: task.title,
          dueDate: task.dueDate,
          daysOverdue: Math.max(1, Math.floor((today.getTime() - dueDate.getTime()) / 86400000)),
          assignee: task.assignee,
          priority: task.priority,
        });
      }
    }
  }

  return overdueTasks.sort((a, b) => {
    const dueCompare = a.dueDate.localeCompare(b.dueDate);
    const boardCompare = a.boardPath.localeCompare(b.boardPath);
    return dueCompare || boardCompare || a.title.localeCompare(b.title);
  });
}

function buildOverdueTaskTree(tasks: OverdueTask[]): OverdueDateItem[] {
  const dates = new Map<string, OverdueDateItem>();

  for (const task of tasks) {
    let date = dates.get(task.dueDate);
    if (!date) {
      date = new OverdueDateItem(task.dueDate);
      dates.set(task.dueDate, date);
    }
    date.tasks.push(task);
  }

  const roots = Array.from(dates.values()).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  for (const date of roots) {
    const count = date.tasks.length;
    const maxDaysOverdue = Math.max(...date.tasks.map(task => task.daysOverdue));
    date.description = `${count} card${count === 1 ? '' : 's'} • ${maxDaysOverdue}d overdue`;
    date.tooltip = `${date.dueDate}\n${date.description}`;
  }

  return roots;
}

async function scanTimelineTasks(): Promise<TimelineTask[]> {
  if (!vscode.workspace.workspaceFolders) {
    return [];
  }

  const today = getTodayStart();
  const completedColumnGlobs = getCompletedColumnGlobs();
  const timelineTasks: TimelineTask[] = [];

  for (const boardUri of await findKanbanBoards()) {
    if (isArchiveBoardUri(boardUri)) {
      continue;
    }

    let boardContent: string;
    try {
      const data = await vscode.workspace.fs.readFile(boardUri);
      boardContent = Buffer.from(data).toString('utf-8');
    } catch {
      continue;
    }

    const board = parseMarkdown(boardContent);
    const boardPath = vscode.workspace.asRelativePath(boardUri, false);
    for (const column of board.columns) {
      if (isCompletedColumnName(column.name, completedColumnGlobs)) {
        continue;
      }

      for (const task of column.tasks) {
        const dueDate = parseDateOnly(task.dueDate);
        if (!dueDate || dueDate < today) {
          continue;
        }

        timelineTasks.push({
          bucket: getTimelineBucket(dueDate, today),
          boardUri,
          boardPath,
          boardTitle: board.title || boardPath,
          columnName: column.name,
          taskId: task.id,
          title: task.title,
          dueDate: task.dueDate,
          assignee: task.assignee,
          priority: task.priority,
        });
      }
    }
  }

  return timelineTasks.sort((a, b) => {
    const dueCompare = a.dueDate.localeCompare(b.dueDate);
    const boardCompare = a.boardPath.localeCompare(b.boardPath);
    return dueCompare || boardCompare || a.title.localeCompare(b.title);
  });
}

async function scanCalendarTasks(): Promise<CalendarTask[]> {
  if (!vscode.workspace.workspaceFolders) {
    return [];
  }

  const today = getTodayStart();
  const completedColumnGlobs = getCompletedColumnGlobs();
  const calendarTasks: CalendarTask[] = [];

  for (const boardUri of await findKanbanBoards()) {
    if (isArchiveBoardUri(boardUri)) {
      continue;
    }

    let boardContent: string;
    try {
      const data = await vscode.workspace.fs.readFile(boardUri);
      boardContent = Buffer.from(data).toString('utf-8');
    } catch {
      continue;
    }

    const board = parseMarkdown(boardContent);
    const boardPath = vscode.workspace.asRelativePath(boardUri, false);
    for (const column of board.columns) {
      if (isCompletedColumnName(column.name, completedColumnGlobs)) {
        continue;
      }

      for (const task of column.tasks) {
        const dueDate = parseDateOnly(task.dueDate);
        if (!dueDate) {
          continue;
        }

        calendarTasks.push({
          boardUri,
          boardPath,
          boardTitle: board.title || boardPath,
          columnName: column.name,
          taskId: task.id,
          title: task.title,
          dueDate: task.dueDate,
          isOverdue: dueDate < today,
          assignee: task.assignee,
          priority: task.priority,
        });
      }
    }
  }

  return calendarTasks.sort((a, b) => {
    const dueCompare = a.dueDate.localeCompare(b.dueDate);
    const boardCompare = a.boardPath.localeCompare(b.boardPath);
    return dueCompare || boardCompare || a.title.localeCompare(b.title);
  });
}

function getTimelineBucket(dueDate: Date, today: Date): TimelineBucketId {
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

function renderTimelineHtml(tasks: TimelineTask[]): string {
  const grouped = groupTimelineTasks(tasks);
  const payload = JSON.stringify({ buckets: TIMELINE_BUCKETS.map(bucket => ({
    ...bucket,
    tasks: grouped.get(bucket.id) || [],
  })) }).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
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
    }
  </style>
</head>
<body>
  <div id="timeline"></div>
  <script>
    const vscode = acquireVsCodeApi();
    const data = ${payload};
    const timeline = document.getElementById('timeline');
    const visibleBuckets = data.buckets.filter(bucket => bucket.tasks.length > 0);
    if (visibleBuckets.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No upcoming dated cards.';
      timeline.appendChild(empty);
    }

    for (const bucket of visibleBuckets) {
      const section = document.createElement('details');
      section.className = 'bucket';
      section.open = true;

      const summary = document.createElement('summary');

      const label = document.createElement('span');
      label.className = 'bucket-label';
      label.textContent = bucket.label;
      summary.appendChild(label);

      const count = document.createElement('span');
      count.className = 'bucket-count';
      count.textContent = String(bucket.tasks.length);
      summary.appendChild(count);
      section.appendChild(summary);

      const list = document.createElement('ul');
      list.className = 'task-list';

      for (const task of bucket.tasks) {
        const row = document.createElement('li');
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'task-row';
        item.title = task.title + '\\n' + task.boardTitle + '\\n' + task.dueDate;
        item.addEventListener('click', () => {
          vscode.postMessage({ type: 'openTask', taskId: task.taskId });
        });

        const icon = document.createElement('span');
        icon.className = 'task-icon';
        icon.textContent = '-';
        item.appendChild(icon);

        const content = document.createElement('span');
        content.className = 'task-content';

        const taskTitle = document.createElement('div');
        taskTitle.className = 'task-title';
        taskTitle.textContent = task.title;
        content.appendChild(taskTitle);

        const meta = document.createElement('div');
        meta.className = 'task-meta';
        meta.textContent = task.dueDate + ' • ' + task.columnName + ' • ' + task.boardTitle;
        content.appendChild(meta);

        item.appendChild(content);
        row.appendChild(item);
        list.appendChild(row);
      }

      section.appendChild(list);
      timeline.appendChild(section);
    }

  </script>
</body>
</html>`;
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

function renderCalendarHtml(visibleMonth: Date, tasks: CalendarTask[]): string {
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
  const payload = JSON.stringify({ monthLabel, cells }).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {
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
    }
  </style>
</head>
<body>
  <div class="calendar-header">
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
  <div class="empty" id="empty-state" hidden>No dated cards in this month.</div>
  <script>
    const vscode = acquireVsCodeApi();
    const data = ${payload};
    document.getElementById('month-title').textContent = data.monthLabel;
    const grid = document.getElementById('calendar-grid');
    const hasVisibleTasks = data.cells.some(cell => cell.inMonth && cell.count > 0);
    document.getElementById('empty-state').hidden = hasVisibleTasks;

    for (const cell of data.cells) {
      const day = document.createElement('button');
      day.type = 'button';
      day.className = 'day' + (cell.inMonth ? '' : ' other-month') + (cell.isToday ? ' today' : '') + (cell.count > 0 ? ' has-tasks' : '');
      day.title = cell.tooltip || cell.date;
      day.disabled = cell.count === 0;
      day.addEventListener('click', () => {
        if (cell.count > 0) {
          vscode.postMessage({ type: 'openDate', date: cell.date });
        }
      });

      const number = document.createElement('div');
      number.className = 'day-number';
      number.textContent = String(cell.day);
      day.appendChild(number);

      if (cell.count > 0) {
        const dot = document.createElement('span');
        dot.className = 'task-dot' + (cell.overdueCount > 0 ? ' overdue' : '');
        day.appendChild(dot);

        const count = document.createElement('span');
        count.className = 'task-count';
        count.textContent = String(cell.count);
        day.appendChild(count);

      }

      grid.appendChild(day);
    }

    document.querySelectorAll('[data-action]').forEach(button => {
      button.addEventListener('click', () => {
        vscode.postMessage({ type: button.dataset.action });
      });
    });
  </script>
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

function getCompletedColumnGlobs(): string[] {
  const config = vscode.workspace.getConfiguration('mdKanban');
  return uniqueStrings(getStringArraySetting(config, 'completedColumnGlobs', COMPLETED_COLUMN_DEFAULT_GLOBS));
}

function isCompletedColumnName(name: string, globs: string[]): boolean {
  const columnName = name.trim();
  return globs.some(glob => globMatches(columnName, glob));
}

function globMatches(value: string, glob: string): boolean {
  const pattern = glob.trim();
  if (!pattern) {
    return false;
  }

  const regex = new RegExp(
    '^' + escapeRegExp(pattern).replace(/\\\*/g, '.*').replace(/\\\?/g, '.') + '$',
    'i'
  );
  return regex.test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getTodayStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function getWeekStart(date: Date): Date {
  const day = date.getDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  return addDays(date, -daysSinceMonday);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function isSameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function toDateIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateOnly(value: string): Date | undefined {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return undefined;
  }

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function getTodoScanSettings(): { include: string[]; exclude: string[]; keywords: string[] } {
  const config = vscode.workspace.getConfiguration('mdKanban');
  const include = getStringArraySetting(config, 'todoInclude', TODO_DEFAULT_INCLUDE);
  const exclude = [
    ...TODO_REQUIRED_EXCLUDE,
    ...getStringArraySetting(config, 'todoExclude', TODO_DEFAULT_EXCLUDE),
  ];
  const keywords = getStringArraySetting(config, 'todoKeywords', TODO_DEFAULT_KEYWORDS);

  return {
    include: uniqueStrings(include),
    exclude: uniqueStrings(exclude),
    keywords: uniqueStrings(keywords.map(keyword => keyword.toUpperCase())),
  };
}

function getStringArraySetting(
  config: vscode.WorkspaceConfiguration,
  key: string,
  fallback: string[]
): string[] {
  const value = config.get<unknown>(key);
  if (!Array.isArray(value)) {
    return fallback;
  }

  const entries = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map(entry => entry.trim())
    .filter(Boolean);

  return entries.length > 0 ? entries : fallback;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

async function findTodoScanFiles(include: string[], exclude: string[], maxResults: number): Promise<vscode.Uri[]> {
  const excludeGlob = combineGlobPatterns(exclude);
  const files = new Map<string, vscode.Uri>();

  for (const includeGlob of include) {
    if (files.size >= maxResults) {
      break;
    }

    const found = await vscode.workspace.findFiles(includeGlob, excludeGlob, maxResults - files.size);
    for (const uri of found) {
      files.set(uri.fsPath.toLowerCase(), uri);
    }
  }

  return Array.from(files.values());
}

function combineGlobPatterns(patterns: string[]): string | undefined {
  const cleaned = uniqueStrings(patterns.map(pattern => pattern.trim()).filter(Boolean));
  if (cleaned.length === 0) {
    return undefined;
  }

  if (cleaned.length === 1) {
    return cleaned[0];
  }

  return `{${cleaned.join(',')}}`;
}

function shouldSkipTodoScanData(data: Uint8Array): boolean {
  if (data.byteLength > TODO_MAX_FILE_BYTES) {
    return true;
  }

  const sampleLength = Math.min(data.byteLength, TODO_BINARY_SAMPLE_BYTES);
  for (let i = 0; i < sampleLength; i++) {
    if (data[i] === 0) {
      return true;
    }
  }

  return false;
}

function buildCodeTodoTree(todos: CodeTodo[]): CodeTodoNode[] {
  const roots = new Map<string, CodeTodoFolderItem | CodeTodoFileItem>();

  for (const todo of todos) {
    const parts = todo.relativePath.split(/[\\/]/).filter(Boolean);
    if (parts.length === 0) {
      continue;
    }

    let siblings = roots;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      let folder = siblings.get(part);
      if (!(folder instanceof CodeTodoFolderItem)) {
        folder = new CodeTodoFolderItem(part);
        siblings.set(part, folder);
      }
      siblings = folder.children;
    }

    const fileName = parts[parts.length - 1];
    let file = siblings.get(fileName);
    if (!(file instanceof CodeTodoFileItem)) {
      file = new CodeTodoFileItem(todo.uri, todo.relativePath);
      siblings.set(fileName, file);
    }
    file.todos.push(todo);
  }

  return sortCodeTodoNodes(Array.from(roots.values()));
}

function sortCodeTodoNodes(nodes: CodeTodoNode[]): CodeTodoNode[] {
  return nodes.sort((a, b) => {
    const aIsFolder = a instanceof CodeTodoFolderItem;
    const bIsFolder = b instanceof CodeTodoFolderItem;
    if (aIsFolder !== bIsFolder) {
      return aIsFolder ? -1 : 1;
    }

    return a.label?.toString().localeCompare(b.label?.toString() || '') || 0;
  });
}

async function createNewBoard(extensionUri: vscode.Uri): Promise<vscode.Uri | undefined> {
  const fileUri = await createBoardFile();
  if (fileUri) {
    KanbanPanel.createOrShow(fileUri, extensionUri);
  }
  return fileUri;
}

async function createBoardFile(): Promise<vscode.Uri | undefined> {
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

async function addTodoToBoard(todo: CodeTodo): Promise<{ boardUri: vscode.Uri; columnName: string } | undefined> {
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

async function findKanbanBoards(limit?: number): Promise<vscode.Uri[]> {
  const matches = await Promise.all([
    vscode.workspace.findFiles('**/*.kanban.md', '**/node_modules/**'),
    vscode.workspace.findFiles('**/kanban.md', '**/node_modules/**'),
    vscode.workspace.findFiles('**/.kanban.md', '**/node_modules/**'),
  ]);
  const unique = new Map<string, vscode.Uri>();
  for (const uri of matches.flat()) {
    if (isKanbanBoardUri(uri)) {
      unique.set(uri.toString(), uri);
    }
  }
  const boards = Array.from(unique.values());
  return typeof limit === 'number' ? boards.slice(0, limit) : boards;
}

function isKanbanBoardUri(uri: vscode.Uri): boolean {
  const fileName = uri.path.split('/').pop()?.toLowerCase();
  return fileName === 'kanban.md' || fileName?.endsWith('.kanban.md') || false;
}

function isArchiveBoardUri(uri: vscode.Uri): boolean {
  return uri.path.split('/').pop()?.toLowerCase() === 'archive.kanban.md';
}

function getBoardUriFromTarget(target: vscode.Uri | KanbanBoardItem | { uri?: vscode.Uri } | undefined): vscode.Uri | undefined {
  if (!target) {
    return undefined;
  }
  if (target instanceof KanbanBoardItem) {
    return target.uri;
  }
  if (target instanceof vscode.Uri) {
    return target;
  }
  return target.uri;
}

function getActiveBoardUri(): vscode.Uri | undefined {
  const uri = vscode.window.activeTextEditor?.document.uri;
  return uri && isKanbanBoardUri(uri) ? uri : undefined;
}

export function deactivate() {}
