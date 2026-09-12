import * as vscode from 'vscode';
import { getTodoMatch } from '../todoMatcher';
import { combineGlobPatterns } from '../util/globs';
import { getTodoScanSettings } from '../util/settings';

const TODO_MAX_FILE_BYTES = 1024 * 1024;
const TODO_BINARY_SAMPLE_BYTES = 8000;

export interface CodeTodo {
  uri: vscode.Uri;
  relativePath: string;
  line: number;
  keyword: string;
  title: string;
  text: string;
}

export async function scanCodeTodos(): Promise<CodeTodo[]> {
  if (!vscode.workspace.workspaceFolders) {
    return [];
  }

  const settings = getTodoScanSettings();
  const files = await findTodoScanFiles(settings.include, settings.exclude, 2000);
  const todos: CodeTodo[] = [];

  for (const uri of files) {
    let content: string;
    try {
      const data = await vscode.workspace.fs.readFile(uri);
      if (shouldSkipTodoScanData(data)) {
        continue;
      }
      content = Buffer.from(data).toString('utf-8');
    } catch {
      continue;
    }

    const relativePath = vscode.workspace.asRelativePath(uri, false);
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const todoMatch = getTodoMatch(lines[i], settings.keywords);
      if (!todoMatch) {
        continue;
      }

      todos.push({
        uri,
        relativePath,
        line: i + 1,
        keyword: todoMatch.keyword,
        title: todoMatch.title || todoMatch.keyword,
        text: lines[i].trim(),
      });
    }
  }

  return todos.sort((a, b) => {
    const fileCompare = a.relativePath.localeCompare(b.relativePath);
    return fileCompare || a.line - b.line;
  });
}

async function findTodoScanFiles(include: string[], exclude: string[], maxResults: number): Promise<vscode.Uri[]> {
  const excludeGlob = combineGlobPatterns(exclude);
  const files = new Map<string, vscode.Uri>();

  for (const includeGlob of include) {
    if (files.size >= maxResults) {
      break;
    }

    const found = await vscode.workspace.findFiles(includeGlob, excludeGlob, maxResults - files.size);
    for (const uri of found) {
      files.set(uri.fsPath.toLowerCase(), uri);
    }
  }

  return Array.from(files.values());
}

/** Skip very large and likely binary files so the side panel stays responsive. */
function shouldSkipTodoScanData(data: Uint8Array): boolean {
  if (data.byteLength > TODO_MAX_FILE_BYTES) {
    return true;
  }

  const sampleLength = Math.min(data.byteLength, TODO_BINARY_SAMPLE_BYTES);
  for (let i = 0; i < sampleLength; i++) {
    if (data[i] === 0) {
      return true;
    }
  }

  return false;
}
