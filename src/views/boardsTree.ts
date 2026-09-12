import * as vscode from 'vscode';
import { findKanbanBoards } from '../boards/boardFiles';

export class KanbanBoardItem extends vscode.TreeItem {
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

export class KanbanBoardsProvider implements vscode.TreeDataProvider<KanbanBoardItem> {
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

export function getBoardUriFromTarget(
  target: vscode.Uri | KanbanBoardItem | { uri?: vscode.Uri } | undefined
): vscode.Uri | undefined {
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
