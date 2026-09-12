import * as vscode from 'vscode';
import { combineGlobPatterns, uniqueStrings } from './globs';

export const BOARD_DEFAULT_EXCLUDE = ['**/node_modules/**', '**/.direnv/**', '**/.git/**'];
export const TODO_DEFAULT_INCLUDE = ['**/*'];
export const TODO_DEFAULT_EXCLUDE = ['**/node_modules/**', '**/out/**', '**/dist/**', '**/build/**', '**/coverage/**'];
export const TODO_REQUIRED_EXCLUDE = ['**/.git/**', '**/*.kanban.md', '**/kanban.md', '**/.kanban.md'];
export const TODO_DEFAULT_KEYWORDS = ['TODO', 'FIXME', 'BUG', 'HACK', 'NOTE'];
export const COMPLETED_COLUMN_DEFAULT_GLOBS = ['Done', 'Closed', 'Shipped', 'Archived'];

export interface TodoScanSettings {
  include: string[];
  exclude: string[];
  keywords: string[];
}

export function getTodoScanSettings(): TodoScanSettings {
  const config = vscode.workspace.getConfiguration('mdKanban');
  const include = getStringArraySetting(config, 'todoInclude', TODO_DEFAULT_INCLUDE);
  const exclude = [
    ...TODO_REQUIRED_EXCLUDE,
    ...getStringArraySetting(config, 'todoExclude', TODO_DEFAULT_EXCLUDE),
  ];
  const keywords = getStringArraySetting(config, 'todoKeywords', TODO_DEFAULT_KEYWORDS);

  return {
    include: uniqueStrings(include),
    exclude: uniqueStrings(exclude),
    keywords: uniqueStrings(keywords.map(keyword => keyword.toUpperCase())),
  };
}

export function getBoardExcludeGlob(): string | undefined {
  const config = vscode.workspace.getConfiguration('mdKanban');
  const exclude = uniqueStrings(getStringArraySetting(config, 'boardExclude', BOARD_DEFAULT_EXCLUDE));
  return combineGlobPatterns(exclude);
}

export function getCompletedColumnGlobs(): string[] {
  const config = vscode.workspace.getConfiguration('mdKanban');
  return uniqueStrings(getStringArraySetting(config, 'completedColumnGlobs', COMPLETED_COLUMN_DEFAULT_GLOBS));
}

export function getStringArraySetting(
  config: vscode.WorkspaceConfiguration,
  key: string,
  fallback: string[]
): string[] {
  const value = config.get<unknown>(key);
  if (!Array.isArray(value)) {
    return fallback;
  }

  const entries = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map(entry => entry.trim())
    .filter(Boolean);

  return entries.length > 0 ? entries : fallback;
}
