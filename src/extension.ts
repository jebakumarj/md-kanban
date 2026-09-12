import * as vscode from 'vscode';
import { addTodoToBoard, createNewBoard } from './boardCommands';
import { findKanbanBoards, getActiveBoardUri } from './boards/boardFiles';
import { OverdueTask } from './boards/datedTasks';
import { KanbanPanel } from './kanbanPanel';
import { CodeTodo } from './todo/todoScanner';
import { KanbanBoardItem, KanbanBoardsProvider, getBoardUriFromTarget } from './views/boardsTree';
import { CalendarWebviewProvider } from './views/calendarView';
import { OverdueTaskItem, OverdueTasksProvider } from './views/overdueTree';
import { CodeTodoItem, CodeTodosProvider } from './views/todosTree';

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

      if (event.affectsConfiguration('mdKanban.boardExclude')) {
        boardsProvider.refresh();
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

export function deactivate() {}
