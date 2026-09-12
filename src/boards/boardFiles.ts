import * as vscode from 'vscode';
import { getBoardExcludeGlob } from '../util/settings';

/**
 * Locating and identifying `*.kanban.md` board files in the workspace.
 */

export async function findKanbanBoards(limit?: number): Promise<vscode.Uri[]> {
  const excludeGlob = getBoardExcludeGlob();
  const matches = await Promise.all([
    vscode.workspace.findFiles('**/*.kanban.md', excludeGlob),
    vscode.workspace.findFiles('**/kanban.md', excludeGlob),
    vscode.workspace.findFiles('**/.kanban.md', excludeGlob),
  ]);
  const unique = new Map<string, vscode.Uri>();
  for (const uri of matches.flat()) {
    if (isKanbanBoardUri(uri)) {
      unique.set(uri.toString(), uri);
    }
  }
  const boards = Array.from(unique.values());
  return typeof limit === 'number' ? boards.slice(0, limit) : boards;
}

export function isKanbanBoardUri(uri: vscode.Uri): boolean {
  const fileName = uri.path.split('/').pop()?.toLowerCase();
  return fileName === 'kanban.md' || fileName?.endsWith('.kanban.md') || false;
}

export function isArchiveBoardUri(uri: vscode.Uri): boolean {
  return uri.path.split('/').pop()?.toLowerCase() === 'archive.kanban.md';
}

export function getActiveBoardUri(): vscode.Uri | undefined {
  const uri = vscode.window.activeTextEditor?.document.uri;
  return uri && isKanbanBoardUri(uri) ? uri : undefined;
}

export async function readBoardContent(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const data = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(data).toString('utf-8');
  } catch {
    return undefined;
  }
}
