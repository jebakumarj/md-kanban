import * as vscode from 'vscode';
import { KanbanPanel } from './kanbanPanel';
import { createDefaultBoard } from './kanbanParser';

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

    const files = await vscode.workspace.findFiles('**/*.kanban.md', '**/node_modules/**');
    return files
      .sort((a, b) => vscode.workspace.asRelativePath(a).localeCompare(vscode.workspace.asRelativePath(b)))
      .map(uri => new KanbanBoardItem(uri));
  }
}

interface CodeTodo {
  uri: vscode.Uri;
  relativePath: string;
  line: number;
  title: string;
  text: string;
}

type CodeTodoNode = CodeTodoFolderItem | CodeTodoFileItem | CodeTodoItem;

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

export function activate(context: vscode.ExtensionContext) {
  const boardsProvider = new KanbanBoardsProvider();
  const todosProvider = new CodeTodosProvider(
    vscode.Uri.joinPath(context.extensionUri, 'src', 'image', 'todo-checked.svg')
  );
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

  const boardWatcher = vscode.workspace.createFileSystemWatcher('**/*.kanban.md');
  boardWatcher.onDidCreate(() => boardsProvider.refresh());
  boardWatcher.onDidDelete(() => boardsProvider.refresh());
  boardWatcher.onDidChange(() => boardsProvider.refresh());
  context.subscriptions.push(boardWatcher);

  const codeWatcher = vscode.workspace.createFileSystemWatcher('**/*');
  codeWatcher.onDidCreate(() => todosProvider.refresh());
  codeWatcher.onDidDelete(() => todosProvider.refresh());
  codeWatcher.onDidChange(() => todosProvider.refresh());
  context.subscriptions.push(codeWatcher);

  context.subscriptions.push(
    vscode.commands.registerCommand('md-kanban.openBoard', async () => {
      const files = await vscode.workspace.findFiles('**/*.kanban.md', '**/node_modules/**', 20);

      if (files.length === 0) {
        const create = await vscode.window.showInformationMessage(
          'No .kanban.md files found. Create one?',
          'Create'
        );
        if (create === 'Create') {
          await createNewBoard();
        }
        return;
      }

      if (files.length === 1) {
        KanbanPanel.createOrShow(files[0]);
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
        KanbanPanel.createOrShow(picked.uri);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('md-kanban.openBoardFile', (target: vscode.Uri | KanbanBoardItem) => {
      const fileUri = target instanceof KanbanBoardItem ? target.uri : target;
      if (fileUri) {
        KanbanPanel.createOrShow(fileUri);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('md-kanban.createBoard', async () => {
      const created = await createNewBoard();
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
}

async function scanCodeTodos(): Promise<CodeTodo[]> {
  if (!vscode.workspace.workspaceFolders) {
    return [];
  }

  const files = await vscode.workspace.findFiles(
    '**/*',
    '{**/.git/**,**/node_modules/**,**/out/**,**/dist/**,**/build/**,**/coverage/**,**/*.kanban.md}',
    2000
  );
  const todos: CodeTodo[] = [];

  for (const uri of files) {
    let content: string;
    try {
      const data = await vscode.workspace.fs.readFile(uri);
      content = Buffer.from(data).toString('utf-8');
    } catch {
      continue;
    }

    const relativePath = vscode.workspace.asRelativePath(uri, false);
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const todoTitle = getTodoTitle(lines[i]);
      if (todoTitle === undefined) {
        continue;
      }

      todos.push({
        uri,
        relativePath,
        line: i + 1,
        title: todoTitle || 'TODO',
        text: lines[i].trim(),
      });
    }
  }

  return todos.sort((a, b) => {
    const fileCompare = a.relativePath.localeCompare(b.relativePath);
    return fileCompare || a.line - b.line;
  });
}

function getTodoTitle(line: string): string | undefined {
  const lineCommentMatch = line.match(/\/\/\s*TODO(?::|\b)\s*(.*)$/i);
  if (lineCommentMatch) {
    return lineCommentMatch[1].trim();
  }

  const blockCommentMatch = line.match(/^\s*(?:\/\*+\s*|\*\s*)TODO(?::|\b)\s*(.*?)(?:\s*\*\/\s*)?$/i);
  if (blockCommentMatch) {
    return blockCommentMatch[1].trim();
  }

  return undefined;
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

async function createNewBoard(): Promise<vscode.Uri | undefined> {
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
    const content = createDefaultBoard(name.trim().replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) + ' Board');
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf-8'));
  }

  KanbanPanel.createOrShow(fileUri);
  return fileUri;
}

export function deactivate() {}
