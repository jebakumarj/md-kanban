import * as vscode from 'vscode';
import { generateId, ISSUE_TYPES, IssueType, Priority, KanbanTask } from '../kanbanParser';
import { KanbanPanel } from '../kanbanPanel';
import { getHierarchyHtml } from './hierarchyHtml';
import { canBeParentOf } from './issueTree';
import {
  IssueScan,
  editBoardFile,
  findTaskInBoard,
  moveTaskToColumn,
  scanWorkspaceIssues,
  unlinkChildren,
} from './issues';

export interface HierarchyShowOptions {
  boardUri?: string;
  focusId?: string;
}

export class HierarchyPanel {
  public static readonly viewType = 'mdKanban.hierarchyView';
  private static current: HierarchyPanel | undefined;
  private static viewStateStore: vscode.Memento | undefined;
  private static readonly viewStateKey = 'mdKanban.hierarchyViewState';

  public static setViewStateStore(store: vscode.Memento) {
    HierarchyPanel.viewStateStore = store;
  }

  private readonly _panel: vscode.WebviewPanel;
  private _scan: IssueScan = { boards: [], issues: [] };
  private _ready = false;
  private _pendingShow: HierarchyShowOptions | undefined;
  private _refreshTimer: NodeJS.Timeout | undefined;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri, options: HierarchyShowOptions = {}) {
    if (HierarchyPanel.current) {
      HierarchyPanel.current._panel.reveal(vscode.ViewColumn.One);
      HierarchyPanel.current._show(options);
      return;
    }

    const panel = vscode.window.createWebviewPanel(HierarchyPanel.viewType, 'Issue Hierarchy', vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
    });
    HierarchyPanel.current = new HierarchyPanel(panel, extensionUri, options);
  }

  public static scheduleRefresh() {
    const current = HierarchyPanel.current;
    if (!current) {
      return;
    }
    if (current._refreshTimer) {
      clearTimeout(current._refreshTimer);
    }
    current._refreshTimer = setTimeout(() => {
      current._refreshTimer = undefined;
      current._refresh();
    }, 150);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly _extensionUri: vscode.Uri,
    options: HierarchyShowOptions
  ) {
    this._panel = panel;
    this._pendingShow = options;
    this._panel.iconPath = new vscode.ThemeIcon('type-hierarchy');
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(message => this._handleMessage(message), null, this._disposables);
    this._panel.webview.html = getHierarchyHtml(this._panel.webview, this._extensionUri, {
      viewState: HierarchyPanel.viewStateStore?.get(HierarchyPanel.viewStateKey),
    });
  }

  private _show(options: HierarchyShowOptions) {
    if (!this._ready) {
      this._pendingShow = options;
      return;
    }
    if (options.boardUri || options.focusId) {
      this._panel.webview.postMessage({ type: 'show', ...options });
    }
  }

  private async _refresh() {
    this._scan = await scanWorkspaceIssues();
    this._panel.webview.postMessage({ type: 'data', boards: this._scan.boards, issues: this._scan.issues });
  }

  private async _handleMessage(message: { type: string; [key: string]: any }) {
    try {
      switch (message.type) {
        case 'ready': {
          await this._refresh();
          this._ready = true;
          if (this._pendingShow) {
            const options = this._pendingShow;
            this._pendingShow = undefined;
            this._show(options);
          }
          break;
        }

        case 'refresh':
          await this._refresh();
          break;

        case 'createIssue': {
          const issueType = toIssueType(message.issueType);
          const parentId = this._checkParent(issueType, message.parentId);
          if (parentId === undefined) {
            break;
          }
          const id = generateId();
          const created = await editBoardFile(vscode.Uri.parse(message.boardUri), board => {
            const column = board.columns.find(c => c.name === message.column) ?? board.columns[0];
            if (!column) {
              return false;
            }
            const task: KanbanTask = {
              id,
              title: String(message.title || '').trim() || 'Untitled',
              description: String(message.description || '').trim(),
              tags: [],
              priority: toPriority(message.priority),
              workload: 'normal',
              dueDate: String(message.dueDate || ''),
              subtasks: [],
              assignee: String(message.assignee || '').trim(),
              source: '',
              group: '',
              issueType,
              parentId,
            };
            column.tasks.push(task);
            return true;
          });
          if (!created) {
            this._notice('Could not add the issue. Check that the board has at least one column.', false);
          }
          await this._refresh();
          if (created) {
            this._panel.webview.postMessage({ type: 'show', focusId: id });
          }
          break;
        }

        case 'updateIssue': {
          const issueType = toIssueType(message.issueType);
          const parentId = this._checkParent(issueType, message.parentId, message.id);
          if (parentId === undefined) {
            break;
          }
          await editBoardFile(vscode.Uri.parse(message.boardUri), board => {
            const found = findTaskInBoard(board, message.id);
            if (!found) {
              return false;
            }
            const task = found.task;
            task.title = String(message.title || '').trim() || task.title;
            task.description = String(message.description || '').trim();
            task.priority = toPriority(message.priority);
            task.assignee = String(message.assignee || '').trim();
            task.dueDate = String(message.dueDate || '');
            task.issueType = issueType;
            task.parentId = parentId;
            if (message.column) {
              moveTaskToColumn(board, task.id, message.column);
            }
            return true;
          });
          await this._refresh();
          break;
        }

        case 'setStatus': {
          await editBoardFile(vscode.Uri.parse(message.boardUri), board =>
            moveTaskToColumn(board, message.id, message.column)
          );
          await this._refresh();
          break;
        }

        case 'setParent': {
          const issue = this._scan.issues.find(i => i.id === message.id && i.boardUri === message.boardUri);
          if (!issue) {
            break;
          }
          const parentId = this._checkParent(issue.issueType, message.parentId, issue.id);
          if (parentId === undefined) {
            break;
          }
          await editBoardFile(vscode.Uri.parse(message.boardUri), board => {
            const found = findTaskInBoard(board, message.id);
            if (!found || found.task.parentId === parentId) {
              return false;
            }
            found.task.parentId = parentId;
            return true;
          });
          await this._refresh();
          break;
        }

        case 'deleteIssue': {
          const deleted = await editBoardFile(vscode.Uri.parse(message.boardUri), board => {
            const found = findTaskInBoard(board, message.id);
            if (!found) {
              return false;
            }
            found.column.tasks.splice(found.index, 1);
            return true;
          });
          if (deleted) {
            await unlinkChildren(message.id, this._scan.issues);
          }
          await this._refresh();
          break;
        }

        case 'openInBoard': {
          KanbanPanel.createOrShow(vscode.Uri.parse(message.boardUri), this._extensionUri, message.id);
          break;
        }

        case 'saveViewState': {
          await HierarchyPanel.viewStateStore?.update(HierarchyPanel.viewStateKey, message.state);
          break;
        }
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this._notice(`Could not update the issue: ${text}`, false);
    }
  }

  private _checkParent(childType: IssueType, rawParentId: unknown, childId?: string): string | undefined {
    const parentId = typeof rawParentId === 'string' ? rawParentId.trim() : '';
    if (!parentId || childType === 'epic') {
      return '';
    }
    if (parentId === childId) {
      this._notice('An issue cannot be its own parent.', false);
      return undefined;
    }
    const parent = this._scan.issues.find(issue => issue.id === parentId);
    if (!parent) {
      this._notice('The selected parent issue was not found.', false);
      return undefined;
    }
    if (!canBeParentOf(parent.issueType, childType)) {
      this._notice(`A ${childType} cannot be placed under a ${parent.issueType}.`, false);
      return undefined;
    }
    return parentId;
  }

  private _notice(message: string, ok: boolean) {
    this._panel.webview.postMessage({ type: 'notice', message, ok });
  }

  public dispose() {
    HierarchyPanel.current = undefined;
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
    }
    this._panel.dispose();
    while (this._disposables.length) {
      this._disposables.pop()?.dispose();
    }
  }
}

function toIssueType(value: unknown): IssueType {
  return (ISSUE_TYPES as unknown[]).includes(value) ? (value as IssueType) : 'task';
}

function toPriority(value: unknown): Priority {
  return value === 'critical' || value === 'high' || value === 'low' ? value : 'medium';
}
