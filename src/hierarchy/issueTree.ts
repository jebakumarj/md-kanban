import { IssueType } from '../kanbanParser';

export const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  epic: 'Epic',
  story: 'Story',
  task: 'Task',
  bug: 'Bug',
  subtask: 'Sub-task',
  substory: 'Sub-story',
};

export function getIssueLevel(type: IssueType): number {
  if (type === 'epic') {
    return 0;
  }
  if (type === 'subtask' || type === 'substory') {
    return 2;
  }
  return 1;
}

export function canBeParentOf(parentType: IssueType, childType: IssueType): boolean {
  return getIssueLevel(parentType) + 1 === getIssueLevel(childType);
}

export function getChildTypes(parentType: IssueType): IssueType[] {
  if (parentType === 'epic') {
    return ['story', 'task', 'bug'];
  }
  if (getIssueLevel(parentType) === 2) {
    return [];
  }
  return ['subtask', 'substory'];
}

export interface IssueLike {
  id: string;
  issueType: IssueType;
  parentId: string;
  done: boolean;
}

export interface IssueNode<T extends IssueLike> {
  issue: T;
  children: IssueNode<T>[];
}

export interface IssueForest<T extends IssueLike> {
  epics: IssueNode<T>[];
  unparented: IssueNode<T>[];
}

export function buildIssueForest<T extends IssueLike>(issues: T[]): IssueForest<T> {
  const nodes = new Map<string, IssueNode<T>>();
  for (const issue of issues) {
    if (!nodes.has(issue.id)) {
      nodes.set(issue.id, { issue, children: [] });
    }
  }

  const forest: IssueForest<T> = { epics: [], unparented: [] };
  for (const node of nodes.values()) {
    const parent = getValidParent(node.issue, nodes);
    if (parent) {
      parent.children.push(node);
    } else if (node.issue.issueType === 'epic') {
      forest.epics.push(node);
    } else {
      forest.unparented.push(node);
    }
  }
  return forest;
}

function getValidParent<T extends IssueLike>(issue: T, nodes: Map<string, IssueNode<T>>): IssueNode<T> | undefined {
  if (!issue.parentId || issue.parentId === issue.id) {
    return undefined;
  }
  const parent = nodes.get(issue.parentId);
  return parent && canBeParentOf(parent.issue.issueType, issue.issueType) ? parent : undefined;
}

export function getChildProgress<T extends IssueLike>(node: IssueNode<T>): { done: number; total: number } {
  return {
    done: node.children.filter(child => child.issue.done).length,
    total: node.children.length,
  };
}
