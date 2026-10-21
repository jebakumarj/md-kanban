export type Priority = 'critical' | 'high' | 'medium' | 'low';
export type Workload = 'easy' | 'normal' | 'hard' | 'extreme';

export type IssueType = 'epic' | 'story' | 'task' | 'bug' | 'subtask' | 'substory';
export const ISSUE_TYPES: IssueType[] = ['epic', 'story', 'task', 'bug', 'subtask', 'substory'];

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
  source: string;
  group: string;
  issueType: IssueType;
  parentId: string;
}

export interface KanbanColumn {
  name: string;
  tasks: KanbanTask[];
}

export interface KanbanBoard {
  title: string;
  columns: KanbanColumn[];
}

export type BoardTemplateId = 'blank' | 'basic' | 'sprint' | 'bug-tracker' | 'release-checklist' | 'personal';

export interface BoardTemplate {
  id: BoardTemplateId;
  label: string;
  description: string;
  columns: string[];
}

export const BOARD_TEMPLATES: BoardTemplate[] = [
  {
    id: 'blank',
    label: 'Blank',
    description: 'Empty board with no columns',
    columns: [],
  },
  {
    id: 'basic',
    label: 'Basic',
    description: 'Simple To Do, In Progress, Done board',
    columns: ['To Do', 'In Progress', 'Done'],
  },
  {
    id: 'sprint',
    label: 'Sprint',
    description: 'Backlog through review for iteration work',
    columns: ['Backlog', 'Ready', 'In Progress', 'Review', 'Done'],
  },
  {
    id: 'bug-tracker',
    label: 'Bug Tracker',
    description: 'Triage, fix, verify, and close bugs',
    columns: ['Triage', 'Confirmed', 'In Progress', 'Verify', 'Closed'],
  },
  {
    id: 'release-checklist',
    label: 'Release Checklist',
    description: 'Track release preparation through shipment',
    columns: ['Planned', 'In Progress', 'Blocked', 'Ready', 'Shipped'],
  },
  {
    id: 'personal',
    label: 'Personal',
    description: 'Lightweight personal planning board',
    columns: ['Today', 'This Week', 'Waiting', 'Done'],
  },
];

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
  let keepEmptyBoard = false;

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
    if (/^<!--\s*empty-board:\s*true\s*-->$/i.test(line)) {
      keepEmptyBoard = true;
      continue;
    }

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
        source: '',
        group: currentGroup,
        issueType: 'task',
        parentId: '',
      };
      continue;
    }

    if (currentTask) {
      // Metadata lines: <!-- key: value -->
      const metaMatch = line.match(/^<!--\s*(\w+):\s*(.*?)\s*-->$/);
      if (metaMatch) {
        const key = metaMatch[1].toLowerCase();
        const val = metaMatch[2].trim();
        if (key === 'id' && val) {
          currentTask.id = val;
        } else if (key === 'priority' && ['critical','high','medium','low'].includes(val)) {
          currentTask.priority = val as Priority;
        } else if (key === 'workload' && ['easy','normal','hard','extreme'].includes(val)) {
          currentTask.workload = val as Workload;
        } else if (key === 'due') {
          currentTask.dueDate = val;
        } else if (key === 'assignee') {
          currentTask.assignee = val;
        } else if (key === 'source') {
          currentTask.source = val;
        } else if (key === 'group') {
          currentTask.group = val;
        } else if (key === 'type' && (ISSUE_TYPES as string[]).includes(val)) {
          currentTask.issueType = val as IssueType;
        } else if (key === 'parent') {
          currentTask.parentId = val;
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

  // Older empty files opened with starter columns. Blank-template boards opt out.
  if (board.columns.length === 0 && !keepEmptyBoard) {
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
  if (!task.id) {
    task.id = generateId();
  }
  lines.push(`<!-- id: ${task.id} -->`);
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
  if (task.source) {
    lines.push(`<!-- source: ${task.source} -->`);
  }
  if (task.issueType && task.issueType !== 'task') {
    lines.push(`<!-- type: ${task.issueType} -->`);
  }
  if (task.parentId) {
    lines.push(`<!-- parent: ${task.parentId} -->`);
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
  if (board.columns.length === 0) {
    lines.push('<!-- empty-board: true -->');
  }
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
  return createBoardFromTemplate(title, 'basic');
}

export function createBoardFromTemplate(title: string = 'Kanban Board', templateId: BoardTemplateId = 'basic'): string {
  const template = BOARD_TEMPLATES.find(t => t.id === templateId) ?? BOARD_TEMPLATES.find(t => t.id === 'basic')!;
  const board: KanbanBoard = {
    title,
    columns: template.columns.map(name => ({ name, tasks: [] })),
  };
  return serializeToMarkdown(board);
}
