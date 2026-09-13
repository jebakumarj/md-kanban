import * as vscode from 'vscode';
import { KanbanBoard } from './kanbanParser';

export interface WebviewBoardConfig {
  canArchiveCards: boolean;
}

export function getWebviewContent(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  board: KanbanBoard,
  config: WebviewBoardConfig
): string {
  const boardJson = JSON.stringify(board).replace(/</g, '\\u003c');
  const configJson = JSON.stringify(config).replace(/</g, '\\u003c');
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'board.js').with({ query: String(Date.now()) })
  );

  return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src ${webview.cspSource};" />
  <title>Kanban Board</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --col-bg: var(--vscode-sideBar-background, #1e1e1e);
      --card-bg: var(--vscode-editorWidget-background, #252526);
      --card-border: var(--vscode-editorWidget-border, #3c3c3c);
      --accent: var(--vscode-button-background, #0e639c);
      --accent-hover: var(--vscode-button-hoverBackground, #1177bb);
      --input-bg: var(--vscode-input-background, #3c3c3c);
      --input-border: var(--vscode-input-border, #3c3c3c);
      --input-fg: var(--vscode-input-foreground, #ccc);
      --badge-bg: var(--vscode-badge-background, #4d4d4d);
      --badge-fg: var(--vscode-badge-foreground, #fff);
      --danger: #c74e4e;
      --danger-hover: #d65c5c;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      background: var(--bg);
      color: var(--fg);
      overflow-x: auto;
      min-height: 100vh;
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 20px;
      border-bottom: 1px solid var(--card-border);
      flex-wrap: wrap;
    }

    .toolbar h1 {
      font-size: 18px;
      font-weight: 600;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 3px;
    }

    .toolbar h1:hover { background: var(--input-bg); }

    .toolbar-actions {
      display: flex;
      gap: 8px;
      margin-left: auto;
    }

    .filter-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 20px;
      border-bottom: 1px solid var(--card-border);
      flex-wrap: wrap;
    }

    .filter-search {
      min-width: 220px;
      flex: 1 1 260px;
      max-width: 420px;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: 3px;
      padding: 6px 8px;
      font-size: 13px;
      font-family: inherit;
    }

    .filter-select {
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: 3px;
      padding: 5px 8px;
      font-size: 12px;
      font-family: inherit;
      max-width: 180px;
    }

    .quick-filters {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      align-items: center;
    }

    .filter-chip {
      background: var(--input-bg);
      color: var(--fg);
      border: 1px solid var(--card-border);
      padding: 4px 8px;
      border-radius: 12px;
      font-size: 11px;
      line-height: 1.2;
    }

    .filter-chip:hover,
    .filter-chip.active {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
    }

    .filter-empty {
      color: var(--fg);
      opacity: 0.65;
      font-size: 12px;
      padding: 16px 6px;
      text-align: center;
    }

    .stats-bar {
      display: flex;
      align-items: stretch;
      gap: 8px;
      padding: 10px 20px;
      border-bottom: 1px solid var(--card-border);
      overflow-x: auto;
    }

    .stat-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 92px;
      max-width: 280px;
      padding: 7px 9px;
      border: 1px solid var(--card-border);
      border-radius: 4px;
      background: var(--col-bg);
      flex: 0 0 auto;
    }

    .stat-item.danger {
      border-color: var(--danger);
    }

    .stat-columns {
      min-width: 240px;
      max-width: 560px;
    }

    .stat-label {
      font-size: 10px;
      line-height: 1.2;
      text-transform: uppercase;
      opacity: 0.65;
      font-weight: 600;
    }

    .stat-value {
      font-size: 12px;
      line-height: 1.3;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .stat-item.danger .stat-value {
      color: var(--danger-hover);
    }

    .stat-column-chips {
      display: flex;
      gap: 5px;
      flex-wrap: wrap;
      align-items: center;
    }

    .stat-column-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      max-width: 180px;
      border: 1px solid var(--card-border);
      border-radius: 3px;
      padding: 2px 5px;
      background: var(--card-bg);
      line-height: 1.2;
    }

    .stat-column-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 11px;
      font-weight: 600;
    }

    .stat-column-count {
      flex-shrink: 0;
      font-size: 11px;
      font-weight: 700;
      color: var(--badge-fg);
      background: var(--badge-bg);
      border-radius: 8px;
      padding: 0 5px;
    }

    button {
      background: var(--accent);
      color: #fff;
      border: none;
      padding: 5px 12px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
      font-family: inherit;
    }

    button:hover { background: var(--accent-hover); }

    button.secondary {
      background: var(--input-bg);
      color: var(--fg);
    }

    button.secondary:hover { background: var(--card-border); }

    button.danger { background: var(--danger); }
    button.danger:hover { background: var(--danger-hover); }

    button.archive-action {
      background: #b86f25;
      color: #fff;
    }

    button.archive-action:hover {
      background: #d9822b;
    }

    .board {
      display: flex;
      gap: 16px;
      padding: 20px;
      align-items: flex-start;
      min-height: calc(100vh - 60px);
    }

    .column {
      min-width: 280px;
      max-width: 320px;
      background: var(--col-bg);
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }

    .column.dragging {
      opacity: 0.45;
    }

    .column-drop-indicator {
      align-self: stretch;
      width: 14px;
      border: 2px dashed var(--accent);
      border-radius: 5px;
      background: rgba(14, 99, 156, 0.12);
      flex-shrink: 0;
    }

    .column-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px 8px;
      gap: 8px;
    }

    .column-title {
      font-weight: 600;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 3px;
      flex: 1;
    }

    .column-title:hover { background: var(--input-bg); }

    .column-drag-handle {
      background: transparent;
      color: var(--fg);
      border: 1px solid transparent;
      cursor: grab;
      flex-shrink: 0;
      font-size: 12px;
      line-height: 1;
      opacity: 0.65;
      padding: 1px 4px;
    }

    .column-drag-handle:hover {
      background: var(--input-bg);
      border-color: var(--card-border);
      opacity: 1;
    }

    .column-count {
      background: var(--badge-bg);
      color: var(--badge-fg);
      border-radius: 10px;
      padding: 1px 8px;
      font-size: 11px;
      font-weight: 600;
    }

    .column-actions {
      display: flex;
      gap: 4px;
    }

    .column-actions button {
      padding: 2px 6px;
      font-size: 14px;
      background: transparent;
      color: var(--fg);
      opacity: 0.5;
    }

    .column-actions button:hover {
      opacity: 1;
      background: var(--input-bg);
    }

    .column-body {
      flex: 1;
      padding: 4px 10px 10px;
      min-height: 60px;
    }

    .column-body.drag-over {
      background: rgba(14, 99, 156, 0.1);
      border-radius: 4px;
    }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 5px;
      padding: 10px 12px;
      margin-bottom: 8px;
      cursor: grab;
      transition: box-shadow 0.15s, transform 0.15s;
      position: relative;
    }

    .card:hover {
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }

    .card.dragging {
      opacity: 0.4;
      transform: rotate(2deg);
    }

    .card-title {
      font-weight: 600;
      margin-bottom: 4px;
      font-size: 13px;
      word-break: break-word;
    }

    .card-desc {
      font-size: 12px;
      opacity: 0.8;
      margin-bottom: 6px;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .card-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .tag {
      background: var(--badge-bg);
      color: var(--badge-fg);
      padding: 1px 7px;
      border-radius: 3px;
      font-size: 11px;
    }

    /* Priority colors */
    .priority-badge, .workload-badge {
      display: inline-block;
      padding: 1px 7px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .priority-critical { background: #d32f2f; color: #fff; }
    .priority-high { background: #f57c00; color: #fff; }
    .priority-medium { background: #5c6bc0; color: #fff; }
    .priority-low { background: #66bb6a; color: #fff; }

    .workload-easy { background: #4caf50; color: #fff; }
    .workload-normal { background: #2196f3; color: #fff; }
    .workload-hard { background: #ff9800; color: #fff; }
    .workload-extreme { background: #e53935; color: #fff; }

    .card-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 6px;
      align-items: center;
    }

    .card-due {
      font-size: 11px;
      opacity: 0.7;
      margin-bottom: 4px;
    }
    .card-due.overdue { color: #e53935; opacity: 1; }

    .card-subtasks {
      font-size: 11px;
      margin-bottom: 6px;
    }

    .card-subtasks .subtask-item {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 1px 0;
      opacity: 0.85;
    }

    .card-subtasks .subtask-item.done {
      text-decoration: line-through;
      opacity: 0.5;
    }

    .subtask-progress {
      font-size: 10px;
      opacity: 0.6;
      margin-bottom: 3px;
    }

    .card-assignee {
      font-size: 11px;
      opacity: 0.7;
      margin-bottom: 4px;
    }

    .card-source {
      font-size: 11px;
      opacity: 0.75;
      margin-bottom: 4px;
      word-break: break-word;
    }

    .card-group-badge {
      display: inline-block;
      background: #6a1b9a;
      color: #fff;
      padding: 1px 7px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 600;
    }

    /* Task groups */
    .task-group {
      margin-bottom: 6px;
      border: 1px solid transparent;
      border-radius: 5px;
      padding: 2px;
      transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
    }

    .task-group.group-drop-target {
      background: rgba(106, 27, 154, 0.12);
      border-color: var(--accent);
      box-shadow: 0 0 0 1px var(--accent) inset;
    }

    .task-group.dragging {
      opacity: 0.45;
    }

    .group-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 8px;
      background: rgba(106, 27, 154, 0.15);
      border: 1px solid rgba(106, 27, 154, 0.3);
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 4px;
      user-select: none;
    }

    .group-header:hover {
      background: rgba(106, 27, 154, 0.25);
    }

    .group-chevron {
      font-size: 10px;
      transition: transform 0.15s;
    }

    .group-drag-handle {
      background: transparent;
      color: var(--fg);
      border: 1px solid transparent;
      cursor: grab;
      flex-shrink: 0;
      font-size: 12px;
      line-height: 1;
      opacity: 0.65;
      padding: 1px 4px;
    }

    .group-drag-handle:hover {
      background: var(--input-bg);
      border-color: var(--card-border);
      opacity: 1;
    }

    .group-chevron.collapsed {
      transform: rotate(-90deg);
    }

    .group-count {
      background: var(--badge-bg);
      color: var(--badge-fg);
      border-radius: 10px;
      padding: 0 6px;
      font-size: 10px;
      margin-left: auto;
    }

    .group-edit-btn {
      padding: 0 5px;
      font-size: 12px;
      background: transparent;
      color: var(--fg);
      opacity: 0.4;
      border: none;
      cursor: pointer;
      flex-shrink: 0;
    }
    .group-edit-btn:hover {
      opacity: 1;
      background: var(--input-bg);
    }

    .group-body {
      padding-left: 4px;
    }

    .group-body.collapsed {
      display: none;
    }

    .group-body.drag-over {
      background: rgba(106, 27, 154, 0.08);
      border-radius: 4px;
    }

    .ungrouped-zone {
      min-height: 42px;
      padding-top: 2px;
    }

    .ungrouped-zone.drag-over {
      background: rgba(14, 99, 156, 0.1);
      border-radius: 4px;
    }

    .column-end-drop-zone {
      min-height: 34px;
      margin-top: 2px;
    }

    .column-end-drop-zone.drag-over {
      background: rgba(14, 99, 156, 0.1);
      border-radius: 4px;
    }

    /* Modal enhancements */
    .modal select {
      width: 100%;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: 3px;
      padding: 6px 8px;
      font-size: 13px;
      font-family: inherit;
      margin-bottom: 12px;
    }

    .form-row {
      display: flex;
      gap: 12px;
    }
    .form-row .form-col {
      flex: 1;
    }

    .subtasks-list {
      margin-bottom: 8px;
    }

    .subtask-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 4px;
    }

    .subtask-row input[type="checkbox"] {
      width: auto;
      margin: 0;
    }

    .subtask-row input[type="text"] {
      flex: 1;
      margin: 0;
    }

    .subtask-row button {
      padding: 2px 6px;
      font-size: 12px;
      background: var(--danger);
      flex-shrink: 0;
    }

    .add-subtask-btn {
      background: transparent;
      color: var(--fg);
      border: 1px dashed var(--card-border);
      padding: 4px 10px;
      font-size: 12px;
      opacity: 0.7;
      margin-bottom: 12px;
    }
    .add-subtask-btn:hover {
      opacity: 1;
      border-color: var(--accent);
      color: var(--accent);
      background: transparent;
    }

    .priority-dot {
      width: 4px;
      border-radius: 3px 0 0 3px;
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
    }
    .priority-dot-critical { background: #d32f2f; }
    .priority-dot-high { background: #f57c00; }
    .priority-dot-medium { background: #5c6bc0; }
    .priority-dot-low { background: #66bb6a; }

    .card-overlay {
      position: absolute;
      top: 6px;
      right: 6px;
      display: none;
      gap: 2px;
    }

    .card:hover .card-overlay { display: flex; }

    .card-overlay button {
      padding: 1px 5px;
      font-size: 12px;
      background: var(--input-bg);
      color: var(--fg);
      border-radius: 3px;
    }

    .card-overlay button.action-source {
      color: var(--accent);
    }

    .card-overlay button.action-archive {
      color: #d9822b;
    }

    .card-overlay button.action-archive:hover {
      background: rgba(217, 130, 43, 0.14);
    }

    .card-overlay button.action-delete {
      color: var(--danger);
    }

    .card-overlay button.action-delete:hover {
      background: rgba(199, 78, 78, 0.14);
    }

    .add-card-btn {
      width: 100%;
      background: transparent;
      color: var(--fg);
      border: 1px dashed var(--card-border);
      padding: 8px;
      border-radius: 5px;
      cursor: pointer;
      opacity: 0.6;
      margin-top: 4px;
    }

    .add-card-btn:hover {
      opacity: 1;
      border-color: var(--accent);
      color: var(--accent);
      background: transparent;
    }

    .add-column-placeholder {
      min-width: 280px;
      display: flex;
      align-items: flex-start;
      padding-top: 12px;
      flex-shrink: 0;
    }

    .add-column-placeholder button {
      width: 100%;
      background: transparent;
      color: var(--fg);
      border: 2px dashed var(--card-border);
      padding: 14px;
      border-radius: 6px;
      cursor: pointer;
      opacity: 0.5;
      font-size: 13px;
    }

    .add-column-placeholder button:hover {
      opacity: 1;
      border-color: var(--accent);
      color: var(--accent);
      background: transparent;
    }

    /* Modal */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }

    .modal {
      background: var(--col-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 20px;
      width: 400px;
      max-width: 90vw;
      max-height: 80vh;
      overflow-y: auto;
    }

    .modal-header {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin-bottom: 16px;
    }

    .modal-header h2 {
      flex: 1;
      margin: 0;
      padding-right: 8px;
      word-break: break-word;
    }

    .modal-icon-btn {
      background: transparent;
      color: var(--fg);
      border: 1px solid var(--card-border);
      border-radius: 3px;
      padding: 3px 7px;
      font-size: 13px;
      line-height: 1.2;
      flex-shrink: 0;
    }

    .modal-icon-btn:hover {
      background: var(--input-bg);
      border-color: var(--accent);
      color: var(--accent);
    }

    .modal-icon-btn.danger {
      color: var(--danger);
      background: transparent;
    }

    .modal-icon-btn.danger:hover {
      background: rgba(199, 78, 78, 0.12);
      border-color: var(--danger);
      color: var(--danger-hover);
    }

    .detail-section {
      margin-bottom: 14px;
    }

    .detail-label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      opacity: 0.7;
      margin-bottom: 5px;
      text-transform: uppercase;
    }

    .detail-text {
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.4;
    }

    .detail-empty {
      opacity: 0.55;
    }

    .detail-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .detail-subtasks {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .detail-subtask {
      display: flex;
      gap: 6px;
      align-items: flex-start;
    }

    .detail-subtask.done {
      opacity: 0.6;
      text-decoration: line-through;
    }

    .modal h2 {
      margin-bottom: 16px;
      font-size: 16px;
    }

    .modal .modal-header h2 {
      margin-bottom: 0;
    }

    .confirm-modal {
      width: 360px;
    }

    .confirm-message {
      line-height: 1.45;
      margin-bottom: 14px;
      word-break: break-word;
    }

    .modal label {
      display: block;
      margin-bottom: 4px;
      font-size: 12px;
      font-weight: 600;
    }

    .modal input, .modal textarea {
      width: 100%;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: 3px;
      padding: 6px 8px;
      font-size: 13px;
      font-family: inherit;
      margin-bottom: 12px;
    }

    .modal textarea {
      resize: vertical;
      min-height: 60px;
    }

    .tag-suggestions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: -6px 0 12px;
    }

    .tag-suggestion {
      background: var(--input-bg);
      color: var(--fg);
      border: 1px solid var(--card-border);
      padding: 3px 8px;
      border-radius: 12px;
      font-size: 11px;
      line-height: 1.2;
      cursor: pointer;
    }

    .tag-suggestion:hover {
      border-color: var(--accent);
    }

    .tag-suggestion.active {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
    }

    .modal .remember-row {
      display: flex;
      align-items: center;
      gap: 7px;
      margin-bottom: 14px;
      font-size: 12px;
      font-weight: 400;
      opacity: 0.9;
    }

    .modal .remember-row input {
      width: auto;
      margin: 0;
    }

    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 8px;
    }

    /* Drop indicator */
    .drop-indicator {
      min-height: 58px;
      border: 2px dashed var(--accent);
      border-radius: 5px;
      background: rgba(14, 99, 156, 0.12);
      box-shadow: 0 0 0 1px rgba(14, 99, 156, 0.18) inset;
      margin-bottom: 8px;
      pointer-events: none;
      transition: opacity 0.15s;
    }

    .board-notice {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 1100;
      max-width: min(420px, calc(100vw - 32px));
      background: var(--accent);
      color: #fff;
      border-radius: 4px;
      padding: 9px 12px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
      font-size: 12px;
      line-height: 1.35;
    }

    .board-notice.error {
      background: var(--danger);
    }
  </style>
</head>
<body>

<div id="app">
  <div style="padding: 20px; color: var(--fg);">Loading Kanban board...</div>
</div>

<script type="application/json" id="board-data">${boardJson}</script>
<script type="application/json" id="board-config">${configJson}</script>
<script src="${scriptUri}"></script>
</body>
</html>`;
}
