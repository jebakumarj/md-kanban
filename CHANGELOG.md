# Changelog

All notable changes to the **MD Kanban** extension will be documented in this file.

## [0.3.0] - 2026-06-14

### Added

- Added support for multiple kanban boards in a single project.
- Added TODO tracking for workspace source comments.
- Added an MD Kanban side-panel icon for opening boards and TODOs.
- Added a **Kanban Boards** side-panel section that lists all `*.kanban.md` boards in the workspace.
- Added a **TODOs** side-panel section for tracked workspace source TODO comments.
- Added Explorer-style folder and file hierarchy for TODOs.
- Added click-to-open navigation from TODO items to their source file and line.
- Added support for `// TODO`, `/* TODO */`, and JSDoc-style `* TODO` comments.
- Added custom Activity Bar and TODO checkbox icons.

### Changed

- Updated the README to document the side-panel workflow, multiple boards, and supported TODO formats.

## [0.2.0] - 2026-05-22

### Added

- Trello-style card placement with clear card-sized drop guidelines.
- Card reordering within groups and ungrouped areas.
- Drag-and-drop support for moving cards into groups, out of groups, and to the end of a column.
- Group drag handles for moving whole groups.
- Column drag handles for reordering columns.
- Group rename modal.
- Markdown `<!-- group: NAME -->` and `<!-- group: -->` metadata support for explicit group assignment.

### Changed

- Group order now follows board order instead of alphabetical sorting.
- Card moves now save placement relative to visible neighboring cards for more reliable same-column reordering.
- Tags are serialized as `Tags: \`tag\`` lines and parsed back correctly.
- Column file watching now safely handles boards opened outside a workspace folder.

### Fixed

- Fixed grouped cards snapping back or landing one position off during drag/drop.
- Fixed dropping cards out of groups.
- Fixed dropping cards after the last visible card in a column/group.
- Fixed group edit icon behavior.

## [0.1.0] - 2026-03-07

### Added

- Visual Kanban board rendered in a VS Code webview panel
- Markdown-based storage using `.kanban.md` files
- Commands: **Create New Kanban Board**, **Open Kanban Board**
- Drag-and-drop cards between columns and within columns
- Task fields: title, description, tags, priority, workload, due date, assignee, subtasks
- Priority levels (Critical, High, Medium, Low) with color-coded card strips
- Workload badges (Easy, Normal, Hard, Extreme)
- Due date picker with overdue highlighting
- Subtask checkboxes with progress count on cards
- Task groups via `###` Markdown headings with collapsible sections
- Drag-and-drop to assign/remove group membership
- Group rename via edit button
- Column management: add, rename, delete
- Board title rename
- Side-by-side raw Markdown view
- VS Code theme integration (light, dark, high contrast)
- File watcher for live sync on external changes
