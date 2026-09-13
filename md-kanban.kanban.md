<!-- This is a Kanban Board file created with MD Kanban extension -->
<!-- GitHub: https://github.com/jebakumarj/md-kanban -->
<!-- VS Code Extension: Search "MD Kanban" in the extension store (ID: jeddak.md-kanban) -->

# Md Kanban Board

## To Do

#### Suggest Md Manager extension
<!-- id: task-1787398901636-219 -->
Check out the MD Manager to manage your tasks in Markdown files.

### Top Picks

#### Move cards with the keyboard
<!-- id: task-1789285563491-1 -->
Add a "Move to column" action on the card menu plus Alt+Left/Right shortcuts, reusing the existing moveTaskToGroup message. The board is mouse-only today, and drag-and-drop is the most fragile code in media/board.js. Additive in the webview; no parser or message-protocol change.
Tags: `ux` `accessibility`
<!-- priority: high -->
<!-- workload: hard -->

#### Add WIP limits per column
<!-- id: task-1789285563491-2 -->
Store a per-column limit as `<!-- wip: 3 -->` under the `##` heading, show `3/3` in the column header, and highlight the column when the limit is exceeded. Requires column-level metadata support in kanbanParser.ts, which currently parses task-level metadata only and silently drops column-level comments.
Tags: `kanban` `parser`
<!-- priority: high -->
<!-- workload: hard -->

#### Make links in card descriptions clickable
<!-- id: task-1789285563491-3 -->
addTodoToBoard writes `Backlink: vscode://file/...` into the description, but it renders as dead plain text. Linkify URLs and `path:line` spans in the card details view and route clicks through the existing openSource message.
Tags: `ux` `todo`
<!-- priority: high -->
<!-- workload: easy -->

### Quick Wins

#### Show overdue count in the status bar
<!-- id: task-1789285563491-4 -->
scanDatedTasks() already computes overdue cards for the side panel. Surface the count as a status bar item that focuses the Overdue Tasks view when clicked.
Tags: `ux`
<!-- priority: low -->
<!-- workload: easy -->

#### Sort a column by priority or due date
<!-- id: task-1789285563491-5 -->
Add a column header menu action that reorders column.tasks. No Markdown format change; the new order is simply serialized back.
Tags: `ux`
<!-- workload: easy -->

#### Collapse a column
<!-- id: task-1789285563491-6 -->
Mirror the existing group-collapse behavior for whole columns, persisting the collapsed set through vscode.getState() the way collapsedGroups already is.
Tags: `ux`
<!-- priority: low -->
<!-- workload: easy -->

#### Give tags deterministic colors
<!-- id: task-1789285563491-7 -->
Hash each tag name to a hue so tags are visually distinguishable. Tags currently all render with the same badge styling.
Tags: `ux`
<!-- priority: low -->
<!-- workload: easy -->

#### Accept natural due date input
<!-- id: task-1789285563491-8 -->
Let the due date field accept values like "tomorrow" or "+3d" and normalize them to the stored YYYY-MM-DD form. The picker is strict ISO today.
Tags: `ux`
<!-- priority: low -->

#### Add a bulk archive command
<!-- id: task-1789285563491-9 -->
Per-card archiving already exists. Add a command to archive every card in a completed-style column older than N days, reusing archive.ts and the completedColumnGlobs setting.
Tags: `cleanup`

### Bigger Bets

#### Render Markdown in card descriptions
<!-- id: task-1789285563491-10 -->
Descriptions display as plain text in a Markdown-native tool. Implement a small hand-rolled subset (bold, italic, code spans, links, lists). The webview CSP blocks CDN loading, so anything larger means bundling a renderer.
Tags: `markdown` `ux`
<!-- workload: hard -->

#### Move cards between boards
<!-- id: task-1789285563491-11 -->
Let a card move from one .kanban.md file to another. archive.ts already demonstrates the pattern of reading, mutating, and writing a second board file.
Tags: `workflow`
<!-- workload: hard -->

#### Sync TODO comments back to cards
<!-- id: task-1789285563491-12 -->
When a source TODO linked by `<!-- source: -->` disappears, flag or auto-complete the linked card. The most differentiating idea here and the most likely to misbehave, so prototype it behind a setting.
Tags: `todo` `experimental`
<!-- priority: low -->
<!-- workload: extreme -->

### Cleanup

#### Remove the dead moveTask handler
<!-- id: task-1789285563491-13 -->
kanbanPanel.ts handles a moveTask message that the webview never sends; every card drop goes through moveTaskToGroup. Dead code that looks live and misleads anyone debugging drag behavior.
Tags: `cleanup`
<!-- priority: low -->
<!-- workload: easy -->

## In Progress

## Done
