import * as vscode from 'vscode';
import {
  CalendarTask,
  TimelineTask,
  scanDatedTasks,
  selectCalendarTasks,
  selectTimelineTasks,
} from '../boards/datedTasks';
import { KanbanPanel } from '../kanbanPanel';
import { getTodayStart } from '../util/dates';
import { renderCalendarHtml, renderTimelineHtml } from './calendarHtml';

export class CalendarWebviewProvider implements vscode.WebviewViewProvider {
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
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'media'),
      ],
    };
    webviewView.webview.onDidReceiveMessage(message => this.handleMessage(message));
    this.updateModeContext();
    this.refresh();
  }

  async refresh(): Promise<void> {
    const datedTasks = await scanDatedTasks();
    this.tasks = selectCalendarTasks(datedTasks);
    this.timelineTasks = selectTimelineTasks(datedTasks);
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
    const webview = this.view.webview;
    webview.html = this.mode === 'timeline'
      ? renderTimelineHtml(webview, this.extensionUri, this.timelineTasks)
      : renderCalendarHtml(webview, this.extensionUri, this.visibleMonth, this.tasks);
  }

  private updateModeContext(): void {
    vscode.commands.executeCommand('setContext', 'mdKanban.calendarModeCalendar', this.mode === 'calendar');
    vscode.commands.executeCommand('setContext', 'mdKanban.calendarModeTimeline', this.mode === 'timeline');
  }
}
