# Changelog

All notable changes to the **MD Kanban** extension will be documented in this file.

## [0.4.1] - 2026-08-22

### Fixed

- Added TODO scanner support for `#`, `!`, `;`, `;;`, `--`, `REM`, `'`, `%`, and `<!-- -->` comment styles across all configured keywords.
- Added TODO matcher coverage for inline comment forms such as `code // TODO`, `value # TODO`, and `SQL -- TODO`.
- Skipped very large and likely binary files during TODO scanning to keep the side panel responsive.
- Improved the empty TODO side-panel message with settings and refresh guidance.
- Added no-dependency TODO matcher coverage for supported comment styles.

## [0.4.0] - 2026-06-21

### Added

- Added board search and filters for text, assignee, tag, priority, workload, and due date.
- Added a board statistics bar for card counts, per-column counts, overdue cards, workload points, and subtask completion.
- Added quick filter chips for overdue, high-priority, and hard-workload cards.
- Added filtered card counts and empty states for columns with no matching cards.
- Added a card details view that opens from clicking a board card.
- Added per-card archiving from the card details view into `archive.kanban.md`.
- Archived cards are grouped in `archive.kanban.md` by source board filename.
- Added stable hidden task IDs in Markdown metadata for more reliable board actions across reloads.
- Added an **Add TODO to Board** action for turning TODO side-panel items into Kanban cards with source backlinks.
- Added `<!-- source: path:line -->` task metadata and a card source button for file/line navigation.
- Added card-level archive/delete actions and reusable archive/delete confirmation prompts with remembered choices.
- Added TODO scanner settings for include globs, exclude globs, and comment keywords.
- Added TODO scanner support for `FIXME`, `BUG`, `HACK`, and `NOTE`.
- Added board templates for Blank, Basic, Sprint, Bug Tracker, Release Checklist, and Personal boards.
- Blank boards now use `<!-- empty-board: true -->` so they stay empty when reopened.
- Added task templates for quickly prefilled bug, feature, release, and personal cards.
- Added an **Overdue Tasks** side-panel view and **Kanban: Show Overdue Tasks** command.
- Added configurable completed-column globs for overdue task scanning.
- Added timeline mode for upcoming due cards inside the Calendar side-panel view.
- Added a compact **Calendar** side-panel month grid and **Kanban: Show Calendar** command for dated cards.
- Calendar date cells now show only the date, status dot, and task count.
- Calendar mode now uses an icon-only Today header button and a view-title Calendar/Timeline switcher.
- Calendar/Timeline switcher icons now change with the target mode.
- Timeline mode now shows upcoming cards in compact collapsible tree groups instead of card-style sections.
- Overdue Tasks are now grouped by due date.
- Timeline, Calendar, and Overdue Tasks items now open the board and show the selected card details.

### Fixed

- Fixed the board search field losing focus after typing a single character.
- Fixed existing `kanban.md` and `.kanban.md` board files not appearing in the board picker or side panel.
- Improved board opening when the command is run from an already-open board file.
- Added Explorer/editor context actions for opening board files as Kanban boards.
- Moved board webview startup into an external `media/board.js` script to avoid blocked inline script execution.
- Removed blocking webview dialogs from card archiving so archive actions run consistently.
- Hid the archive button when viewing `archive.kanban.md`.

### Changed

- Show per-column board statistics as readable chips instead of one compressed text value.
- Removed the duplicate card count from the filter bar; card counts now live in the statistics bar.
- Kept **Add TODO to Board** as a TODO side-panel action instead of a Command Palette command.

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
