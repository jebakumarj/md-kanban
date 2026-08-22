const assert = require('assert');
const { getTodoMatch } = require('../out/todoMatcher');

const keywords = ['TODO', 'FIXME', 'BUG', 'HACK', 'NOTE'];

const matchingCases = [
  ['// TODO Add validation', 'TODO', 'Add validation'],
  ['const value = 1; // FIXME Handle retry failures', 'FIXME', 'Handle retry failures'],
  ['# bug Wrong total after filter reset', 'BUG', 'Wrong total after filter reset'],
  ['name=value # HACK Remove temporary parser fallback', 'HACK', 'Remove temporary parser fallback'],
  ['! NOTE Document release checklist', 'NOTE', 'Document release checklist'],
  ['; TODO INI config item', 'TODO', 'INI config item'],
  [';; FIXME Lisp config item', 'FIXME', 'Lisp config item'],
  ['SELECT 1 -- BUG SQL item', 'BUG', 'SQL item'],
  ['REM TODO Batch item', 'TODO', 'Batch item'],
  ["' HACK VBA item", 'HACK', 'VBA item'],
  ['% NOTE MATLAB item', 'NOTE', 'MATLAB item'],
  ['<!-- TODO HTML item -->', 'TODO', 'HTML item'],
  ['/* FIXME Block item */', 'FIXME', 'Block item'],
  [' * TODO Doc comment item', 'TODO', 'Doc comment item'],
];

for (const [line, keyword, title] of matchingCases) {
  assert.deepStrictEqual(getTodoMatch(line, keywords), { keyword, title }, line);
}

const nonMatchingCases = [
  'TODO without a comment marker',
  'const value = "TODO inside a string";',
  'remember this FIXME later',
];

for (const line of nonMatchingCases) {
  assert.strictEqual(getTodoMatch(line, keywords), undefined, line);
}

console.log('todo matcher ok');
