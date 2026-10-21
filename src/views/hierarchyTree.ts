import * as vscode from 'vscode';
import { IssueType } from '../kanbanParser';
import { ISSUE_TYPE_LABELS, IssueNode, buildIssueForest, getChildProgress } from '../hierarchy/issueTree';
import { WorkspaceIssue, scanWorkspaceIssues } from '../hierarchy/issues';

export type HierarchyTreeNode = IssueTreeItem | UnparentedGroupItem;

const TYPE_ICONS: Record<IssueType, [string, string]> = {
  epic: ['zap', 'charts.purple'],
  story: ['bookmark', 'charts.green'],
  task: ['pass', 'charts.blue'],
  bug: ['bug', 'charts.red'],
  subtask: ['list-tree', 'charts.blue'],
  substory: ['list-tree', 'charts.green'],
};

export class IssueTreeItem extends vscode.TreeItem {
  constructor(public readonly node: IssueNode<WorkspaceIssue>) {
    const issue = node.issue;
    super(
      issue.title,
      node.children.length > 0
        ? issue.issueType === 'epic'
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );
    this.id = `${issue.boardUri}::${issue.id}`;
    const [icon, color] = TYPE_ICONS[issue.issueType];
    this.iconPath = new vscode.ThemeIcon(icon, new vscode.ThemeColor(color));

    const progress = getChildProgress(node);
    this.description = [
      issue.done ? `✓ ${issue.column}` : issue.column,
      progress.total > 0 ? `${progress.done}/${progress.total}` : '',
      issue.boardTitle,
    ]
      .filter(Boolean)
      .join(' • ');
    this.tooltip = [
      `${ISSUE_TYPE_LABELS[issue.issueType]}: ${issue.title}`,
      `Status: ${issue.column}`,
      `Board: ${issue.boardTitle} (${issue.boardPath})`,
      progress.total > 0 ? `Children done: ${progress.done}/${progress.total}` : '',
      issue.assignee ? `Assignee: ${issue.assignee}` : '',
      issue.dueDate ? `Due: ${issue.dueDate}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    this.contextValue = 'hierarchyIssue';
    this.command = {
      command: 'md-kanban.openHierarchy',
      title: 'Show in Issue Hierarchy',
      arguments: [{ focusId: issue.id }],
    };
  }
}

export class UnparentedGroupItem extends vscode.TreeItem {
  constructor(public readonly nodes: IssueNode<WorkspaceIssue>[]) {
    super('Not in an epic', vscode.TreeItemCollapsibleState.Collapsed);
    this.id = 'hierarchy::unparented';
    this.iconPath = new vscode.ThemeIcon('inbox');
    this.description = `${nodes.length} issue${nodes.length === 1 ? '' : 's'}`;
    this.tooltip = 'Stories, tasks, bugs, sub-tasks, and sub-stories that have no parent';
    this.contextValue = 'hierarchyUnparented';
  }
}

export class HierarchyTreeProvider implements vscode.TreeDataProvider<HierarchyTreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<HierarchyTreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private roots: HierarchyTreeNode[] | undefined;

  refresh(): void {
    this.roots = undefined;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: HierarchyTreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: HierarchyTreeNode): Promise<HierarchyTreeNode[]> {
    if (!element) {
      if (!this.roots) {
        this.roots = await buildRoots();
      }
      return this.roots;
    }

    if (element instanceof UnparentedGroupItem) {
      return element.nodes.map(node => new IssueTreeItem(node));
    }

    return element.node.children.map(child => new IssueTreeItem(child));
  }
}

async function buildRoots(): Promise<HierarchyTreeNode[]> {
  const { issues } = await scanWorkspaceIssues();
  const forest = buildIssueForest(issues);
  if (forest.epics.length === 0 && !issues.some(issue => issue.issueType !== 'task' || issue.parentId)) {
    return [];
  }

  const roots: HierarchyTreeNode[] = forest.epics.map(node => new IssueTreeItem(node));
  if (forest.unparented.length > 0) {
    roots.push(new UnparentedGroupItem(forest.unparented));
  }
  return roots;
}
