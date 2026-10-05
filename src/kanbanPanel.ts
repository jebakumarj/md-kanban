import * as vscode from 'vscode';
import { archiveTaskFromBoard } from './archive';
import { parseMarkdown, serializeToMarkdown, KanbanBoard, generateId } from './kanbanParser';
import { openTaskSource } from './source';
import { getCompletedColumnGlobs } from './util/settings';
import { getWebviewContent, WebviewBoardConfig } from './webviewContent';

export class KanbanPanel {
  public static readonly viewType = 'mdKanban.boardView';
  private static panels: Map<string, KanbanPanel> = new Map();

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _fileUri: vscode.Uri;
  private _board: KanbanBoard;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(fileUri: vscode.Uri, extensionUri: vscode.Uri, taskId?: string) {
    const key = fileUri.toString();
    const existing = KanbanPanel.panels.get(key);
    if (existing) {
      existing._panel.reveal(vscode.ViewColumn.One);
      if (taskId) {
        existing.openTaskInView(taskId);
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      KanbanPanel.viewType,
      'Kanban Board',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'media'),
        ],
      }
    );

    const kanbanPanel = new KanbanPanel(panel, extensionUri, fileUri, taskId);
    KanbanPanel.panels.set(key, kanbanPanel);
    panel.reveal(vscode.ViewColumn.One);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, fileUri: vscode.Uri, private _pendingTaskId?: string) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._fileUri = fileUri;
    this._board = { title: '', columns: [] };

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message) => this._handleMessage(message),
      null,
      this._disposables
    );

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
    if (workspaceFolder) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(
          workspaceFolder,
          vscode.workspace.asRelativePath(fileUri)
        )
      );
      watcher.onDidChange(() => this._loadAndRefresh());
      this._disposables.push(watcher);
    }

    this._loadAndRefresh();
  }

  private async _loadAndRefresh() {
    try {
      const data = await vscode.workspace.fs.readFile(this._fileUri);
      const content = Buffer.from(data).toString('utf-8');
      this._board = parseMarkdown(content);
    } catch {
      this._board = {
        title: 'Kanban Board',
        columns: [
          { name: 'To Do', tasks: [] },
          { name: 'In Progress', tasks: [] },
          { name: 'Done', tasks: [] },
        ],
      };
    }

    this._panel.title = this._board.title;
    try {
      this._panel.webview.html = getWebviewContent(
        this._panel.webview,
        this._extensionUri,
        this._board,
        this._getWebviewConfig()
      );
      if (this._pendingTaskId) {
        const taskId = this._pendingTaskId;
        this._pendingTaskId = undefined;
        setTimeout(() => this._postOpenTask(taskId), 100);
      }
    } catch {
      vscode.window.showErrorMessage('Could not render the Kanban board. See MD Kanban output logs for details.');
    }
  }

  private async _save() {
    const md = serializeToMarkdown(this._board);
    await vscode.workspace.fs.writeFile(this._fileUri, Buffer.from(md, 'utf-8'));
  }

  private async _handleMessage(message: { type: string; [key: string]: any }) {
    switch (message.type) {
      case 'addTask': {
        const col = this._board.columns.find(c => c.name === message.column);
        if (col) {
          col.tasks.push({
            id: generateId(),
            title: message.title,
            description: message.description || '',
            tags: message.tags || [],
            priority: message.priority || 'medium',
            workload: message.workload || 'normal',
            dueDate: message.dueDate || '',
            subtasks: message.subtasks || [],
            assignee: message.assignee || '',
            source: message.source || '',
            group: message.group || '',
          });
          await this._save();
          this._sendBoardUpdate();
        }
        break;
      }

      case 'editTask': {
        for (const col of this._board.columns) {
          const task = col.tasks.find(t => t.id === message.taskId);
          if (task) {
            task.title = message.title;
            task.description = message.description || '';
            task.tags = message.tags || [];
            task.priority = message.priority || 'medium';
            task.workload = message.workload || 'normal';
            task.dueDate = message.dueDate || '';
            task.subtasks = message.subtasks || [];
            task.assignee = message.assignee || '';
            task.source = message.source || '';
            task.group = message.group || '';
            await this._save();
            this._sendBoardUpdate();
            break;
          }
        }
        break;
      }

      case 'deleteTask': {
        for (const col of this._board.columns) {
          const idx = col.tasks.findIndex(t => t.id === message.taskId);
          if (idx !== -1) {
            col.tasks.splice(idx, 1);
            await this._save();
            this._sendBoardUpdate();
            break;
          }
        }
        break;
      }

      case 'moveTask': {
        const fromCol = this._board.columns.find(c => c.name === message.fromColumn);
        const toCol = this._board.columns.find(c => c.name === message.toColumn);
        if (fromCol && toCol) {
          const taskIdx = fromCol.tasks.findIndex(t => t.id === message.taskId);
          if (taskIdx !== -1) {
            const targetLength = toCol.tasks.length;
            const [task] = fromCol.tasks.splice(taskIdx, 1);
            let insertIdx = this._clampIndex(message.toIndex, targetLength);
            if (fromCol === toCol && taskIdx < insertIdx) {
              insertIdx--;
            }
            toCol.tasks.splice(insertIdx, 0, task);
            await this._save();
            this._sendBoardUpdate();
          }
        }
        break;
      }

      case 'moveTaskToGroup': {
        const fromCol = this._board.columns.find(c => c.name === message.fromColumn);
        const toCol = this._board.columns.find(c => c.name === message.toColumn);
        if (fromCol && toCol) {
          const taskIdx = fromCol.tasks.findIndex(t => t.id === message.taskId);
          if (taskIdx !== -1) {
            const targetLength = toCol.tasks.length;
            const [task] = fromCol.tasks.splice(taskIdx, 1);
            task.group = message.group ?? '';
            let insertIdx = this._getMoveInsertIndex(toCol, message, targetLength);
            toCol.tasks.splice(insertIdx, 0, task);
            await this._save();
            this._sendBoardUpdate();
          }
        }
        break;
      }

      case 'updateTaskGroup': {
        for (const col of this._board.columns) {
          const task = col.tasks.find(t => t.id === message.taskId);
          if (task) {
            task.group = message.group ?? '';
            await this._save();
            this._sendBoardUpdate();
            break;
          }
        }
        break;
      }

      case 'renameGroup': {
        const col = this._board.columns.find(c => c.name === message.column);
        if (col && message.oldName && message.newName) {
          for (const task of col.tasks) {
            if (task.group === message.oldName) {
              task.group = message.newName;
            }
          }
          await this._save();
          this._sendBoardUpdate();
        }
        break;
      }

      case 'moveGroup': {
        const fromCol = this._board.columns.find(c => c.name === message.fromColumn);
        const toCol = this._board.columns.find(c => c.name === message.toColumn);
        const groupName = message.group;
        if (fromCol && toCol && groupName) {
          const groupTasks = fromCol.tasks.filter(t => t.group === groupName);
          if (groupTasks.length === 0) {
            break;
          }

          fromCol.tasks = fromCol.tasks.filter(t => t.group !== groupName);
          const targetGroupNames = Array.from(new Set(
            toCol.tasks
              .map(t => t.group)
              .filter((g): g is string => !!g && g !== groupName)
          ));
          const groupIndex = this._clampIndex(message.toGroupIndex, targetGroupNames.length);
          const beforeGroup = targetGroupNames[groupIndex];
          let insertIdx = 0;

          if (beforeGroup) {
            insertIdx = toCol.tasks.findIndex(t => t.group === beforeGroup);
          } else {
            const lastGroupedIdx = toCol.tasks.reduce((last, task, idx) => task.group ? idx : last, -1);
            insertIdx = lastGroupedIdx === -1 ? 0 : lastGroupedIdx + 1;
          }

          toCol.tasks.splice(insertIdx, 0, ...groupTasks);
          await this._save();
          this._sendBoardUpdate();
        }
        break;
      }

      case 'addColumn': {
        const colName = (message.name || '').trim();
        if (colName && !this._board.columns.find(c => c.name === colName)) {
          this._board.columns.push({ name: colName, tasks: [] });
          await this._save();
          this._sendBoardUpdate();
        }
        break;
      }

      case 'deleteColumn': {
        const idx = this._board.columns.findIndex(c => c.name === message.name);
        if (idx !== -1) {
          this._board.columns.splice(idx, 1);
          await this._save();
          this._sendBoardUpdate();
        }
        break;
      }

      case 'renameColumn': {
        const col = this._board.columns.find(c => c.name === message.oldName);
        const newName = (message.newName || '').trim();
        if (col && newName) {
          col.name = newName;
          await this._save();
          this._sendBoardUpdate();
        }
        break;
      }

      case 'moveColumn': {
        const fromIdx = this._board.columns.findIndex(c => c.name === message.name);
        if (fromIdx !== -1) {
          const targetLength = this._board.columns.length;
          const [column] = this._board.columns.splice(fromIdx, 1);
          const insertIdx = this._clampIndex(message.toIndex, targetLength - 1);
          this._board.columns.splice(insertIdx, 0, column);
          await this._save();
          this._sendBoardUpdate();
        }
        break;
      }

      case 'updateTitle': {
        this._board.title = message.title || 'Kanban Board';
        this._panel.title = this._board.title;
        await this._save();
        break;
      }

      case 'openMarkdown': {
        const doc = await vscode.workspace.openTextDocument(this._fileUri);
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
        break;
      }

      case 'openSource': {
        await openTaskSource(message.source, this._fileUri);
        break;
      }

      case 'archiveTask': {
        if (isArchiveBoardFile(this._fileUri)) {
          this._panel.webview.postMessage({
            type: 'archiveResult',
            ok: false,
            message: 'Cards in archive.kanban.md cannot be archived again.',
          });
          break;
        }

        try {
          const archived = await archiveTaskFromBoard(this._board, this._fileUri, {
            taskId: message.taskId,
            taskSnapshot: message.task,
            fromColumn: message.fromColumn,
            taskIndex: message.taskIndex,
          });

          if (archived) {
            await this._save();
            await vscode.commands.executeCommand('md-kanban.refreshBoards').then(undefined, () => undefined);
            this._sendBoardUpdate();
            this._panel.webview.postMessage({
              type: 'archiveResult',
              ok: true,
              message: `Archived card to archive.kanban.md in ${archived.archiveColumnName}.`,
            });
            vscode.window.showInformationMessage(`Archived card to archive.kanban.md in ${archived.archiveColumnName}.`);
          } else {
            this._panel.webview.postMessage({
              type: 'archiveResult',
              ok: false,
              message: 'Card was not found.',
            });
            vscode.window.showInformationMessage('Card was not found.');
          }
        } catch (error) {
          const messageText = error instanceof Error ? error.message : String(error);
          this._panel.webview.postMessage({
            type: 'archiveResult',
            ok: false,
            message: `Could not archive card: ${messageText}`,
          });
          vscode.window.showErrorMessage(`Could not archive card: ${messageText}`);
        }
        break;
      }
    }
  }

  private _clampIndex(index: unknown, max: number): number {
    const value = typeof index === 'number' && Number.isFinite(index) ? index : max;
    return Math.max(0, Math.min(value, max));
  }

  private _getMoveInsertIndex(
    column: { tasks: { id: string }[] },
    message: { [key: string]: any },
    fallbackLength: number
  ): number {
    if (typeof message.beforeTaskId === 'string') {
      const beforeIdx = column.tasks.findIndex(t => t.id === message.beforeTaskId);
      if (beforeIdx !== -1) {
        return beforeIdx;
      }
    }

    if (typeof message.afterTaskId === 'string') {
      const afterIdx = column.tasks.findIndex(t => t.id === message.afterTaskId);
      if (afterIdx !== -1) {
        return afterIdx + 1;
      }
    }

    return this._clampIndex(message.toIndex, fallbackLength);
  }

  private _getWebviewConfig(): WebviewBoardConfig {
    return {
      canArchiveCards: !isArchiveBoardFile(this._fileUri),
      completedColumnGlobs: getCompletedColumnGlobs(),
    };
  }

  /** Pushes settings that affect board rendering to every open board. */
  public static refreshConfig() {
    for (const panel of KanbanPanel.panels.values()) {
      panel._panel.webview.postMessage({
        type: 'configUpdate',
        config: panel._getWebviewConfig(),
      });
    }
  }

  private _sendBoardUpdate() {
    this._panel.webview.postMessage({
      type: 'boardUpdate',
      board: this._board,
    });
  }

  public openTaskInView(taskId: string) {
    this._panel.reveal(vscode.ViewColumn.One);
    this._postOpenTask(taskId);
  }

  private _postOpenTask(taskId: string) {
    this._panel.webview.postMessage({
      type: 'openTaskDetails',
      taskId,
    });
  }

  public dispose() {
    KanbanPanel.panels.delete(this._fileUri.toString());
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) { d.dispose(); }
    }
  }
}

function isArchiveBoardFile(uri: vscode.Uri): boolean {
  return uri.path.split('/').pop()?.toLowerCase() === 'archive.kanban.md';
}
