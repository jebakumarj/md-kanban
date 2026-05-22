import * as vscode from 'vscode';
import { KanbanPanel } from './kanbanPanel';
import { createDefaultBoard } from './kanbanParser';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('md-kanban.openBoard', async () => {
      const files = await vscode.workspace.findFiles('**/*.kanban.md', '**/node_modules/**', 20);

      if (files.length === 0) {
        const create = await vscode.window.showInformationMessage(
          'No .kanban.md files found. Create one?',
          'Create'
        );
        if (create === 'Create') {
          await createNewBoard(context);
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
    vscode.commands.registerCommand('md-kanban.createBoard', () => createNewBoard(context))
  );
}

async function createNewBoard(context: vscode.ExtensionContext) {
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
    return;
  }

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showErrorMessage('Please open a folder first.');
    return;
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
}

export function deactivate() {}
