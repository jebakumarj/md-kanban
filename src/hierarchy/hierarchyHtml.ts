import * as vscode from 'vscode';

export interface HierarchyWebviewConfig {
  viewState?: unknown;
}

export function getHierarchyHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  config: HierarchyWebviewConfig
): string {
  const configJson = JSON.stringify(config).replace(/</g, '\\u003c');
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'hierarchy.js').with({ query: String(Date.now()) })
  );

  return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src ${webview.cspSource};" />
  <title>Issue Hierarchy</title>
  <style>
${HIERARCHY_STYLES}
  </style>
</head>
<body>
<div id="app">
  <div class="loading">Loading issues...</div>
</div>
<script type="application/json" id="hierarchy-config">${configJson}</script>
<script src="${scriptUri}"></script>
</body>
</html>`;
}

const HIERARCHY_STYLES = `
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --muted: var(--vscode-descriptionForeground, rgba(204, 204, 204, 0.7));
      --row-hover: var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.05));
      --row-focus: var(--vscode-list-activeSelectionBackground, rgba(14, 99, 156, 0.35));
      --card-bg: var(--vscode-editorWidget-background, #252526);
      --card-border: var(--vscode-editorWidget-border, #3c3c3c);
      --accent: var(--vscode-button-background, #0e639c);
      --accent-hover: var(--vscode-button-hoverBackground, #1177bb);
      --input-bg: var(--vscode-input-background, #3c3c3c);
      --input-border: var(--vscode-input-border, #3c3c3c);
      --input-fg: var(--vscode-input-foreground, #ccc);
      --danger: #c74e4e;
      --danger-hover: #d65c5c;
      --type-epic: #904ee2;
      --type-story: #63ba3c;
      --type-task: #4bade8;
      --type-bug: #e5493a;
      --type-subtask: #4bade8;
      --type-substory: #63ba3c;
      --done: #4caf50;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      background: var(--bg);
      color: var(--fg);
      min-height: 100vh;
    }

    .loading, .empty {
      padding: 24px 20px;
      color: var(--muted);
    }

    .empty button { margin-top: 12px; }

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
    button.secondary { background: var(--input-bg); color: var(--fg); }
    button.secondary:hover { background: var(--card-border); }
    button.danger { background: var(--danger); }
    button.danger:hover { background: var(--danger-hover); }

    input, select, textarea {
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: 3px;
      padding: 5px 8px;
      font-size: 12px;
      font-family: inherit;
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 20px;
      border-bottom: 1px solid var(--card-border);
      flex-wrap: wrap;
    }

    .toolbar h1 {
      font-size: 18px;
      font-weight: 600;
      margin-right: 8px;
    }

    .toolbar .search { min-width: 200px; flex: 1 1 220px; max-width: 360px; }
    .toolbar select { max-width: 220px; }
    .toolbar-actions { display: flex; gap: 6px; margin-left: auto; flex-wrap: wrap; }

    .chip {
      background: var(--input-bg);
      color: var(--fg);
      border: 1px solid var(--card-border);
      padding: 4px 9px;
      border-radius: 12px;
      font-size: 11px;
    }
    .chip:hover, .chip.active { background: var(--accent); border-color: var(--accent); color: #fff; }

    .summary {
      display: flex;
      gap: 18px;
      padding: 8px 20px;
      border-bottom: 1px solid var(--card-border);
      color: var(--muted);
      font-size: 12px;
      flex-wrap: wrap;
    }
    .summary strong { color: var(--fg); font-weight: 600; }

    .table { padding: 0 12px 40px; }

    .row {
      display: grid;
      grid-template-columns: minmax(260px, 1fr) 150px 120px 84px 96px 120px 150px;
      align-items: center;
      gap: 8px;
      min-height: 34px;
      padding: 2px 8px;
      border-bottom: 1px solid rgba(128, 128, 128, 0.12);
    }

    .row.header {
      position: sticky;
      top: 0;
      z-index: 2;
      background: var(--bg);
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      min-height: 30px;
      border-bottom: 1px solid var(--card-border);
    }

    .issue-row:hover { background: var(--row-hover); }
    .issue-row.done .issue-title { opacity: 0.6; text-decoration: line-through; }
    .issue-row.context { opacity: 0.55; }
    .issue-row.flash { animation: flash 1.6s ease-out; }
    .issue-row.drop-target { outline: 2px dashed var(--accent); outline-offset: -2px; background: rgba(14, 99, 156, 0.14); }
    .issue-row.dragging { opacity: 0.4; }
    @keyframes flash { 0%, 40% { background: var(--row-focus); } 100% { background: transparent; } }

    .title-cell {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }

    .chevron {
      width: 18px;
      height: 18px;
      flex-shrink: 0;
      background: transparent;
      color: var(--muted);
      padding: 0;
      font-size: 11px;
      line-height: 18px;
      text-align: center;
    }
    .chevron:hover { background: var(--input-bg); color: var(--fg); }
    .chevron.placeholder { visibility: hidden; }

    .type-icon {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      border-radius: 3px;
      color: #fff;
      font-size: 10px;
      font-weight: 700;
      line-height: 16px;
      text-align: center;
    }
    .type-epic { background: var(--type-epic); }
    .type-story { background: var(--type-story); }
    .type-task { background: var(--type-task); }
    .type-bug { background: var(--type-bug); }
    .type-subtask { background: transparent; color: var(--type-subtask); border: 1.5px solid var(--type-subtask); line-height: 13px; }
    .type-substory { background: transparent; color: var(--type-substory); border: 1.5px solid var(--type-substory); line-height: 13px; }

    .issue-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: pointer;
    }
    .issue-title:hover { text-decoration: underline; }
    .epic-row .issue-title { font-weight: 600; }

    .board-chip {
      flex-shrink: 0;
      font-size: 10px;
      color: var(--muted);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 0 6px;
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .status-select { width: 100%; padding: 3px 6px; }
    .status-select.done { color: var(--done); }

    .muted { color: var(--muted); }
    .cell-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
    .overdue { color: #e57373; }

    .priority { font-size: 11px; padding: 1px 6px; border-radius: 3px; text-transform: capitalize; }
    .priority-critical { background: #d32f2f; color: #fff; }
    .priority-high { background: #f57c00; color: #fff; }
    .priority-medium { color: var(--muted); }
    .priority-low { background: #66bb6a; color: #fff; }

    .progress { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--muted); }
    .progress-track { flex: 1; height: 6px; border-radius: 3px; background: var(--input-bg); overflow: hidden; }
    .progress-fill { height: 100%; background: var(--done); }

    .row-actions { display: flex; gap: 3px; justify-content: flex-end; visibility: hidden; }
    .issue-row:hover .row-actions, .issue-row:focus-within .row-actions { visibility: visible; }
    .row-actions button { padding: 2px 6px; font-size: 12px; background: var(--input-bg); color: var(--fg); }
    .row-actions button:hover { background: var(--accent); color: #fff; }
    .row-actions button.danger-action:hover { background: var(--danger); }

    .section-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 14px 8px 6px;
      font-size: 12px;
      font-weight: 600;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      user-select: none;
    }
    .section-header.drop-target { outline: 2px dashed var(--accent); outline-offset: -2px; border-radius: 4px; }
    .section-header .count { font-weight: 400; }
    .section-hint { font-weight: 400; text-transform: none; letter-spacing: 0; opacity: 0.8; }

    .add-child-row {
      display: flex;
      align-items: center;
      gap: 6px;
      min-height: 28px;
      padding: 2px 8px;
      color: var(--muted);
      font-size: 12px;
    }
    .add-child-row button { background: transparent; color: var(--muted); padding: 2px 6px; }
    .add-child-row button:hover { background: var(--input-bg); color: var(--fg); }

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
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 6px;
      padding: 20px;
      width: 520px;
      max-width: 92vw;
      max-height: 88vh;
      overflow-y: auto;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    }
    .modal h2 { font-size: 16px; margin-bottom: 14px; }
    .modal label { display: block; font-size: 12px; margin-bottom: 4px; opacity: 0.8; }
    .modal input, .modal select, .modal textarea { width: 100%; font-size: 13px; padding: 6px 8px; margin-bottom: 12px; }
    .modal textarea { min-height: 80px; resize: vertical; }
    .modal p { margin-bottom: 14px; line-height: 1.4; }
    .form-row { display: flex; gap: 12px; }
    .form-row > div { flex: 1; min-width: 0; }
    .modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
    .field-hint { font-size: 11px; color: var(--muted); margin: -8px 0 12px; }

    .picker-list { max-height: 320px; overflow-y: auto; border: 1px solid var(--card-border); border-radius: 4px; margin-bottom: 12px; }
    .picker-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 10px;
      cursor: pointer;
      border-bottom: 1px solid rgba(128, 128, 128, 0.12);
    }
    .picker-item:last-child { border-bottom: none; }
    .picker-item:hover { background: var(--row-hover); }
    .picker-item .issue-title { flex: 1; }
    .picker-empty { padding: 14px; color: var(--muted); text-align: center; }

    .notice {
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
    }
    .notice.error { background: var(--danger); }

    @media (max-width: 900px) {
      .row { grid-template-columns: minmax(200px, 1fr) 130px 84px 120px; }
      .col-assignee, .col-due, .col-progress { display: none; }
    }
`;
