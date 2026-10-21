const assert = require('assert');
const { parseMarkdown, serializeToMarkdown } = require('../out/kanbanParser');
const { buildIssueForest, canBeParentOf, getChildProgress, getChildTypes } = require('../out/hierarchy/issueTree');

const markdown = `# Board

## To Do

#### Checkout epic
<!-- id: epic-1 -->
<!-- type: epic -->

#### Pay with card
<!-- id: story-1 -->
<!-- type: story -->
<!-- parent: epic-1 -->

#### Plain card
<!-- id: task-1 -->

## Done

#### Wire the API
<!-- id: sub-1 -->
<!-- type: subtask -->
<!-- parent: story-1 -->

#### Guest checkout
<!-- id: sub-2 -->
<!-- type: substory -->
<!-- parent: story-1 -->

#### Unknown type is ignored
<!-- id: task-2 -->
<!-- type: initiative -->
`;

const board = parseMarkdown(markdown);
const tasks = board.columns.flatMap(column => column.tasks);
assert.deepStrictEqual(
  tasks.map(task => [task.id, task.issueType, task.parentId]),
  [
    ['epic-1', 'epic', ''],
    ['story-1', 'story', 'epic-1'],
    ['task-1', 'task', ''],
    ['sub-1', 'subtask', 'story-1'],
    ['sub-2', 'substory', 'story-1'],
    ['task-2', 'task', ''],
  ]
);

const serialized = serializeToMarkdown(board);
assert.ok(serialized.includes('<!-- type: epic -->'));
assert.ok(serialized.includes('<!-- parent: epic-1 -->'));
assert.ok(!/#### Plain card\n<!-- id: task-1 -->\n<!-- type/.test(serialized), 'plain tasks get no type comment');
assert.deepStrictEqual(parseMarkdown(serialized).columns, board.columns);

assert.strictEqual(canBeParentOf('epic', 'story'), true);
assert.strictEqual(canBeParentOf('epic', 'bug'), true);
assert.strictEqual(canBeParentOf('story', 'subtask'), true);
assert.strictEqual(canBeParentOf('epic', 'subtask'), false);
assert.strictEqual(canBeParentOf('story', 'task'), false);
assert.strictEqual(canBeParentOf('subtask', 'subtask'), false);
assert.strictEqual(canBeParentOf('story', 'substory'), true);
assert.strictEqual(canBeParentOf('bug', 'substory'), true);
assert.strictEqual(canBeParentOf('epic', 'substory'), false);
assert.strictEqual(canBeParentOf('substory', 'subtask'), false);
assert.deepStrictEqual(getChildTypes('story'), ['subtask', 'substory']);
assert.deepStrictEqual(getChildTypes('epic'), ['story', 'task', 'bug']);
assert.deepStrictEqual(getChildTypes('subtask'), []);
assert.deepStrictEqual(getChildTypes('substory'), []);

const issue = (id, issueType, parentId = '', done = false) => ({ id, issueType, parentId, done });
const forest = buildIssueForest([
  issue('e1', 'epic'),
  issue('s1', 'story', 'e1'),
  issue('b1', 'bug', 'e1', true),
  issue('st1', 'subtask', 's1', true),
  issue('ss1', 'substory', 's1'),
  issue('st2', 'subtask', 'e1'),
  issue('t1', 'task', 'missing'),
  issue('e2', 'epic', 'e1'),
  issue('self', 'story', 'self'),
]);

assert.deepStrictEqual(
  forest.epics.map(node => node.issue.id),
  ['e1', 'e2']
);
assert.deepStrictEqual(
  forest.epics[0].children.map(node => node.issue.id),
  ['s1', 'b1']
);
assert.deepStrictEqual(
  forest.epics[0].children[0].children.map(node => node.issue.id),
  ['st1', 'ss1']
);
assert.deepStrictEqual(
  forest.unparented.map(node => node.issue.id),
  ['st2', 't1', 'self']
);
assert.deepStrictEqual(getChildProgress(forest.epics[0]), { done: 1, total: 2 });

console.log('Issue hierarchy tests passed.');
