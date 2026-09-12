import * as vscode from 'vscode';
import { CodeTodo, scanCodeTodos } from '../todo/todoScanner';

export type CodeTodoNode = CodeTodoFolderItem | CodeTodoFileItem | CodeTodoItem;

export class CodeTodoFolderItem extends vscode.TreeItem {
  readonly children = new Map<string, CodeTodoFolderItem | CodeTodoFileItem>();

  constructor(name: string) {
    super(name, vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = vscode.ThemeIcon.Folder;
  }
}

export class CodeTodoFileItem extends vscode.TreeItem {
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

export class CodeTodoItem extends vscode.TreeItem {
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

export class CodeTodosProvider implements vscode.TreeDataProvider<CodeTodoNode> {
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
