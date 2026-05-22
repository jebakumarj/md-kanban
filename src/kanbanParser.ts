export type Priority = 'critical' | 'high' | 'medium' | 'low';
export type Workload = 'easy' | 'normal' | 'hard' | 'extreme';

export interface SubTask {
  title: string;
  done: boolean;
}

export interface KanbanTask {
  id: string;
  title: string;
  description: string;
  tags: string[];
  priority: Priority;
  workload: Workload;
  dueDate: string;
  subtasks: SubTask[];
  assignee: string;
  group: string;
}

export interface KanbanColumn {
  name: string;
  tasks: KanbanTask[];
}

export interface KanbanBoard {
  title: string;
  columns: KanbanColumn[];
}

/**
 * Parse a Markdown string into a KanbanBoard structure.
 *
 * Expected format:
 * # Board Title
 * ## Column Name
 * ### Group Name (optional)
 * #### Task Title
 * Description text
 * `tag1` `tag2`
 */
export function parseMarkdown(content: string): KanbanBoard {
  const lines = content.split(/\r?\n/);
  const board: KanbanBoard = { title: 'Kanban Board', columns: [] };

  let currentColumn: KanbanColumn | null = null;
  let currentTask: KanbanTask | null = null;
  let descriptionLines: string[] = [];
  let currentGroup = '';

  function flushTask() {
    if (currentTask && currentColumn) {
      currentTask.description = descriptionLines.join('\n').trim();
      currentColumn.tasks.push(currentTask);
      currentTask = null;
      descriptionLines = [];
    }
  }

  function flushColumn() {
    flushTask();
    if (currentColumn) {
      board.columns.push(currentColumn);
      currentColumn = null;
    }
  }

  for (const line of lines) {
    const h1Match = line.match(/^#\s+(.+)$/);
    if (h1Match) {
      board.title = h1Match[1].trim();
      continue;
    }

    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      flushColumn();
      currentColumn = { name: h2Match[1].trim(), tasks: [] };
      currentGroup = '';
      continue;
    }

    const h3Match = line.match(/^###\s+(.+)$/);
    if (h3Match) {
      flushTask();
      currentGroup = h3Match[1].trim();
      continue;
    }

    const h4Match = line.match(/^####\s+(.+)$/);
    if (h4Match) {
      flushTask();
      currentTask = {
        id: generateId(),
        title: h4Match[1].trim(),
        description: '',
        tags: [],
        priority: 'medium',
        workload: 'normal',
        dueDate: '',
        subtasks: [],
        assignee: '',
        group: currentGroup,
      };
      continue;
    }

    if (currentTask) {
      // Metadata lines: <!-- key: value -->
      const metaMatch = line.match(/^<!--\s*(\w+):\s*(.*?)\s*-->$/);
      if (metaMatch) {
        const key = metaMatch[1].toLowerCase();
        const val = metaMatch[2].trim();
        if (key === 'priority' && ['critical','high','medium','low'].includes(val)) {
          currentTask.priority = val as Priority;
        } else if (key === 'workload' && ['easy','normal','hard','extreme'].includes(val)) {
          currentTask.workload = val as Workload;
        } else if (key === 'due') {
          currentTask.dueDate = val;
        } else if (key === 'assignee') {
          currentTask.assignee = val;
        } else if (key === 'group') {
          currentTask.group = val;
        }
        continue;
      }

      // Subtask lines: - [x] or - [ ]
      const subtaskMatch = line.match(/^- \[([ xX])\]\s+(.+)$/);
      if (subtaskMatch) {
        currentTask.subtasks.push({
          done: subtaskMatch[1].toLowerCase() === 'x',
          title: subtaskMatch[2].trim(),
        });
        continue;
      }

      // Check for tag line (backtick-wrapped tags)
      const tagMatches = line.match(/`([^`]+)`/g);
      if (tagMatches && line.trim().replace(/^Tags:\s*/i, '').replace(/`[^`]+`/g, '').trim() === '') {
        currentTask.tags = tagMatches.map(t => t.replace(/`/g, ''));
        continue;
      }
      descriptionLines.push(line);
    }
  }

  flushColumn();

  // If empty board, create default columns
  if (board.columns.length === 0) {
    board.columns = [
      { name: 'To Do', tasks: [] },
      { name: 'In Progress', tasks: [] },
      { name: 'Done', tasks: [] },
    ];
  }

  return board;
}

function serializeTask(lines: string[], task: KanbanTask, needsGroupOverride = false): void {
  lines.push(`#### ${task.title}`);
  if (needsGroupOverride) {
    lines.push(`<!-- group: ${task.group} -->`);
  }
  if (task.description) {
    lines.push(task.description);
  }
  if (task.subtasks && task.subtasks.length > 0) {
    for (const st of task.subtasks) {
      lines.push(`- [${st.done ? 'x' : ' '}] ${st.title}`);
    }
  }
  if (task.tags.length > 0) {
    lines.push(`Tags: ${task.tags.map(t => `\`${t}\``).join(' ')}`);
  }
  if (task.priority && task.priority !== 'medium') {
    lines.push(`<!-- priority: ${task.priority} -->`);
  }
  if (task.workload && task.workload !== 'normal') {
    lines.push(`<!-- workload: ${task.workload} -->`);
  }
  if (task.dueDate) {
    lines.push(`<!-- due: ${task.dueDate} -->`);
  }
  if (task.assignee) {
    lines.push(`<!-- assignee: ${task.assignee} -->`);
  }
  lines.push('');
}

/**
 * Serialize a KanbanBoard structure back to Markdown.
 */
export function serializeToMarkdown(board: KanbanBoard): string {
  const lines: string[] = [];
  lines.push('<!-- This is a Kanban Board file created with MD Kanban extension -->');
  lines.push('<!-- GitHub: https://github.com/jebakumarj/md-kanban -->');
  lines.push('<!-- VS Code Extension: Search "MD Kanban" in the extension store (ID: jeddak.md-kanban) -->');
  lines.push('');
  lines.push(`# ${board.title}`);
  lines.push('');

  for (const column of board.columns) {
    lines.push(`## ${column.name}`);
    lines.push('');

    let currentMarkdownGroup = '';
    for (const task of column.tasks) {
      if (task.group) {
        if (task.group !== currentMarkdownGroup) {
          lines.push(`### ${task.group}`);
          lines.push('');
          currentMarkdownGroup = task.group;
        }
        serializeTask(lines, task);
      } else {
        serializeTask(lines, task, currentMarkdownGroup !== '');
      }
    }
  }

  return lines.join('\n');
}

let _counter = 0;
export function generateId(): string {
  return `task-${Date.now()}-${_counter++}`;
}

/**
 * Create a default empty board markdown string.
 */
export function createDefaultBoard(title: string = 'Kanban Board'): string {
  const board: KanbanBoard = {
    title,
    columns: [
      { name: 'To Do', tasks: [] },
      { name: 'In Progress', tasks: [] },
      { name: 'Done', tasks: [] },
    ],
  };
  return serializeToMarkdown(board);
}
