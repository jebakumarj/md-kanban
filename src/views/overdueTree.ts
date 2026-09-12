import * as vscode from 'vscode';
import { OverdueTask, scanDatedTasks, selectOverdueTasks } from '../boards/datedTasks';

export type OverdueTaskNode = OverdueDateItem | OverdueTaskItem;

export class OverdueDateItem extends vscode.TreeItem {
  readonly tasks: OverdueTask[] = [];

  constructor(public readonly dueDate: string) {
    super(dueDate, vscode.TreeItemCollapsibleState.Expanded);
    this.tooltip = dueDate;
    this.iconPath = new vscode.ThemeIcon('calendar');
    this.contextValue = 'overdueDate';
  }
}

export class OverdueTaskItem extends vscode.TreeItem {
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

export class OverdueTasksProvider implements vscode.TreeDataProvider<OverdueTaskNode> {
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
      this.roots = buildOverdueTaskTree(selectOverdueTasks(await scanDatedTasks()));
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
