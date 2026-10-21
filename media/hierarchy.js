(function () {
  const vscode = acquireVsCodeApi();
  const config = JSON.parse(document.getElementById('hierarchy-config')?.textContent || '{}');

  const TYPE_LABELS = {
    epic: 'Epic',
    story: 'Story',
    task: 'Task',
    bug: 'Bug',
    subtask: 'Sub-task',
    substory: 'Sub-story',
  };
  const TYPE_GLYPHS = { epic: '⚡', story: 'S', task: '✓', bug: '●', subtask: '↳', substory: '↳' };
  const ALL_TYPES = ['epic', 'story', 'task', 'bug', 'subtask', 'substory'];

  let boards = [];
  let issues = [];
  let loaded = false;
  let dragId = null;
  let viewStateTimer = 0;
  let textFilterTimer = 0;
  let flashId = '';

  const savedState = vscode.getState() || config.viewState || {};
  let collapsed = savedState.collapsed || {};
  let sectionCollapsed = savedState.sectionCollapsed || {};
  let filters = { text: '', board: '', hideDone: false, ...(savedState.filters || {}) };

  function getLevel(type) {
    if (type === 'epic') return 0;
    if (type === 'subtask' || type === 'substory') return 2;
    return 1;
  }

  function canBeParentOf(parentType, childType) {
    return getLevel(parentType) + 1 === getLevel(childType);
  }

  function getChildTypes(parentType) {
    if (parentType === 'epic') return ['story', 'task', 'bug'];
    if (getLevel(parentType) === 2) return [];
    return ['subtask', 'substory'];
  }

  function findIssue(id) {
    return issues.find(issue => issue.id === id);
  }

  function findBoard(uri) {
    return boards.find(board => board.uri === uri);
  }

  function buildForest() {
    const nodes = new Map();
    for (const issue of issues) {
      if (!nodes.has(issue.id)) nodes.set(issue.id, { issue, children: [], parent: null });
    }
    const epics = [];
    const unparented = [];
    for (const node of nodes.values()) {
      const parent =
        node.issue.parentId && node.issue.parentId !== node.issue.id ? nodes.get(node.issue.parentId) : undefined;
      if (parent && canBeParentOf(parent.issue.issueType, node.issue.issueType)) {
        node.parent = parent;
        parent.children.push(node);
      } else if (node.issue.issueType === 'epic') {
        epics.push(node);
      } else {
        unparented.push(node);
      }
    }
    return { epics, unparented, nodes };
  }

  function selfMatches(issue) {
    if (filters.board && issue.boardUri !== filters.board) return false;
    if (filters.hideDone && issue.done) return false;
    const text = filters.text.trim().toLowerCase();
    if (!text) return true;
    return [
      issue.title,
      issue.assignee,
      issue.description,
      issue.column,
      issue.boardTitle,
      (issue.tags || []).join(' '),
    ]
      .join('\n')
      .toLowerCase()
      .includes(text);
  }

  function markVisibility(node) {
    let childVisible = false;
    for (const child of node.children) {
      if (markVisibility(child)) childVisible = true;
    }
    const matches = selfMatches(node.issue);
    node.visible = matches || childVisible;
    node.context = !matches && childVisible;
    node.hasVisibleChildren = childVisible;
    return node.visible;
  }

  function hasActiveFilters() {
    return !!(filters.text.trim() || filters.board || filters.hideDone);
  }

  function isExpanded(node) {
    if (filters.text.trim() && node.hasVisibleChildren) return true;
    return !collapsed[node.issue.id];
  }

  function persistState() {
    const state = { collapsed, sectionCollapsed, filters };
    vscode.setState(state);
    window.clearTimeout(viewStateTimer);
    viewStateTimer = window.setTimeout(() => vscode.postMessage({ type: 'saveViewState', state }), 250);
  }

  function render() {
    const app = document.getElementById('app');
    const scrollY = window.scrollY;
    app.innerHTML = '';

    if (!loaded) {
      const loading = el('div', 'loading');
      loading.textContent = 'Loading issues...';
      app.appendChild(loading);
      return;
    }

    app.appendChild(renderToolbar());

    if (boards.length === 0) {
      const empty = el('div', 'empty');
      empty.textContent =
        'No Kanban boards found in this workspace. Create a board to start adding epics, stories, and tasks.';
      app.appendChild(empty);
      return;
    }

    const forest = buildForest();
    forest.epics.forEach(markVisibility);
    forest.unparented.forEach(markVisibility);

    app.appendChild(renderSummary(forest));

    const table = el('div', 'table');
    table.appendChild(renderHeaderRow());

    const visibleEpics = forest.epics.filter(node => node.visible);
    table.appendChild(renderSectionHeader('epics', 'Epics', visibleEpics.length, forest.epics.length, null));
    if (!sectionCollapsed.epics) {
      for (const node of visibleEpics) renderNode(table, node, 0);
      if (forest.epics.length === 0) {
        const empty = el('div', 'add-child-row');
        const btn = el('button');
        btn.textContent = '+ Create your first epic';
        btn.onclick = () => openIssueModal({ issueType: 'epic' });
        empty.appendChild(btn);
        table.appendChild(empty);
      } else if (visibleEpics.length === 0) {
        table.appendChild(renderFilteredOut());
      }
    }

    const visibleUnparented = forest.unparented.filter(node => node.visible);
    table.appendChild(
      renderSectionHeader(
        'unparented',
        'Not in an epic',
        visibleUnparented.length,
        forest.unparented.length,
        'Drag a row onto an epic to link it, or drop a linked row here to unlink it.'
      )
    );
    if (!sectionCollapsed.unparented) {
      for (const node of visibleUnparented) renderNode(table, node, 0);
      if (forest.unparented.length > 0 && visibleUnparented.length === 0) {
        table.appendChild(renderFilteredOut());
      }
    }

    app.appendChild(table);
    window.scrollTo(0, scrollY);
  }

  function renderFilteredOut() {
    const row = el('div', 'add-child-row');
    row.textContent = 'No issues match the current filters.';
    return row;
  }

  function renderToolbar() {
    const toolbar = el('div', 'toolbar');
    const h1 = el('h1');
    h1.textContent = 'Issue Hierarchy';
    toolbar.appendChild(h1);

    const search = el('input', 'search');
    search.type = 'search';
    search.placeholder = 'Search issues...';
    search.value = filters.text;
    search.oninput = () => {
      filters.text = search.value;
      window.clearTimeout(textFilterTimer);
      textFilterTimer = window.setTimeout(() => {
        persistState();
        render();
        const next = document.querySelector('.toolbar .search');
        if (next) {
          next.focus();
          next.setSelectionRange(next.value.length, next.value.length);
        }
      }, 150);
    };
    toolbar.appendChild(search);

    if (boards.length > 1) {
      const boardSelect = el('select');
      boardSelect.title = 'Show issues from one board';
      boardSelect.appendChild(option('', 'All boards'));
      for (const board of boards) boardSelect.appendChild(option(board.uri, board.title + ' (' + board.path + ')'));
      boardSelect.value = filters.board;
      boardSelect.onchange = () => {
        filters.board = boardSelect.value;
        persistState();
        render();
      };
      toolbar.appendChild(boardSelect);
    }

    const doneChip = el('button', 'chip' + (filters.hideDone ? ' active' : ''));
    doneChip.textContent = 'Hide done';
    doneChip.title = 'Hide issues in completed columns';
    doneChip.onclick = () => {
      filters.hideDone = !filters.hideDone;
      persistState();
      render();
    };
    toolbar.appendChild(doneChip);

    if (hasActiveFilters()) {
      const clear = el('button', 'chip');
      clear.textContent = 'Clear filters';
      clear.onclick = () => {
        filters = { text: '', board: '', hideDone: false };
        persistState();
        render();
      };
      toolbar.appendChild(clear);
    }

    const actions = el('div', 'toolbar-actions');
    const expandBtn = el('button', 'secondary');
    expandBtn.textContent = 'Expand all';
    expandBtn.onclick = () => {
      collapsed = {};
      sectionCollapsed = {};
      persistState();
      render();
    };
    actions.appendChild(expandBtn);

    const collapseBtn = el('button', 'secondary');
    collapseBtn.textContent = 'Collapse all';
    collapseBtn.onclick = () => {
      for (const issue of issues) collapsed[issue.id] = true;
      persistState();
      render();
    };
    actions.appendChild(collapseBtn);

    if (boards.length > 0) {
      const issueBtn = el('button', 'secondary');
      issueBtn.textContent = '+ Create Issue';
      issueBtn.onclick = () => openIssueModal({ issueType: 'story' });
      actions.appendChild(issueBtn);

      const epicBtn = el('button');
      epicBtn.textContent = '+ Create Epic';
      epicBtn.onclick = () => openIssueModal({ issueType: 'epic' });
      actions.appendChild(epicBtn);
    }
    toolbar.appendChild(actions);
    return toolbar;
  }

  function renderSummary(forest) {
    const scoped = issues.filter(issue => !filters.board || issue.boardUri === filters.board);
    const doneCount = scoped.filter(issue => issue.done).length;
    const pct = scoped.length ? Math.round((doneCount / scoped.length) * 100) : 0;
    const summary = el('div', 'summary');
    const stats = [
      ['Epics', forest.epics.filter(node => !filters.board || node.issue.boardUri === filters.board).length],
      ['Issues', scoped.length],
      ['Done', doneCount + ' (' + pct + '%)'],
      [
        'Not in an epic',
        forest.unparented.filter(node => !filters.board || node.issue.boardUri === filters.board).length,
      ],
    ];
    for (const [label, value] of stats) {
      const item = el('span');
      item.appendChild(document.createTextNode(label + ': '));
      const strong = el('strong');
      strong.textContent = String(value);
      item.appendChild(strong);
      summary.appendChild(item);
    }
    return summary;
  }

  function renderHeaderRow() {
    const row = el('div', 'row header');
    const cells = [
      ['Issue', ''],
      ['Status', ''],
      ['Assignee', 'col-assignee'],
      ['Priority', ''],
      ['Due', 'col-due'],
      ['Progress', 'col-progress'],
      ['', ''],
    ];
    for (const [label, className] of cells) {
      const cell = el('div', className);
      cell.textContent = label;
      row.appendChild(cell);
    }
    return row;
  }

  function renderSectionHeader(key, label, visibleCount, totalCount, hint) {
    const header = el('div', 'section-header');
    const chevron = el('button', 'chevron');
    chevron.textContent = sectionCollapsed[key] ? '▸' : '▾';
    chevron.title = sectionCollapsed[key] ? 'Expand section' : 'Collapse section';
    chevron.onclick = () => {
      sectionCollapsed[key] = !sectionCollapsed[key];
      persistState();
      render();
    };
    header.appendChild(chevron);

    const title = el('span');
    title.textContent = label;
    header.appendChild(title);

    const count = el('span', 'count');
    count.textContent =
      visibleCount === totalCount ? '(' + totalCount + ')' : '(' + visibleCount + ' of ' + totalCount + ')';
    header.appendChild(count);

    if (hint) {
      const hintEl = el('span', 'section-hint');
      hintEl.textContent = '— ' + hint;
      header.appendChild(hintEl);
    }

    if (key === 'unparented') {
      header.addEventListener('dragover', e => {
        const dragged = dragId && findIssue(dragId);
        if (!dragged || !dragged.parentId) return;
        e.preventDefault();
        header.classList.add('drop-target');
      });
      header.addEventListener('dragleave', () => header.classList.remove('drop-target'));
      header.addEventListener('drop', e => {
        e.preventDefault();
        header.classList.remove('drop-target');
        const dragged = dragId && findIssue(dragId);
        if (dragged && dragged.parentId) setParent(dragged, '');
      });
    }
    return header;
  }

  function renderNode(container, node, depth) {
    if (!node.visible) return;
    container.appendChild(renderIssueRow(node, depth));
    if (node.children.length === 0 || !isExpanded(node)) return;
    for (const child of node.children) renderNode(container, child, depth + 1);
    if (node.issue.issueType === 'epic' && !hasActiveFilters()) {
      container.appendChild(renderAddChildRow(node, depth + 1));
    }
  }

  function renderAddChildRow(node, depth) {
    const row = el('div', 'add-child-row');
    row.style.paddingLeft = 8 + depth * 22 + 24 + 'px';
    const addBtn = el('button');
    addBtn.textContent = '+ Create issue in this epic';
    addBtn.onclick = () => openIssueModal({ issueType: 'story', parent: node.issue });
    row.appendChild(addBtn);
    const linkBtn = el('button');
    linkBtn.textContent = '🔗 Link existing card';
    linkBtn.onclick = () => openLinkPicker(node.issue);
    row.appendChild(linkBtn);
    return row;
  }

  function renderIssueRow(node, depth) {
    const issue = node.issue;
    const row = el('div', 'row issue-row');
    if (issue.issueType === 'epic') row.classList.add('epic-row');
    if (issue.done) row.classList.add('done');
    if (node.context) row.classList.add('context');
    if (flashId && flashId === issue.id) row.classList.add('flash');
    row.dataset.issueId = issue.id;
    row.draggable = true;

    row.addEventListener('dragstart', e => {
      dragId = issue.id;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', issue.id);
    });
    row.addEventListener('dragend', () => {
      dragId = null;
      row.classList.remove('dragging');
      document.querySelectorAll('.drop-target').forEach(target => target.classList.remove('drop-target'));
    });
    row.addEventListener('dragover', e => {
      const dragged = dragId && findIssue(dragId);
      if (!dragged || dragged.id === issue.id || dragged.parentId === issue.id) return;
      if (!canBeParentOf(issue.issueType, dragged.issueType)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.classList.add('drop-target');
    });
    row.addEventListener('dragleave', e => {
      if (!row.contains(e.relatedTarget)) row.classList.remove('drop-target');
    });
    row.addEventListener('drop', e => {
      e.preventDefault();
      row.classList.remove('drop-target');
      const dragged = dragId && findIssue(dragId);
      if (dragged && canBeParentOf(issue.issueType, dragged.issueType)) setParent(dragged, issue.id);
    });

    const titleCell = el('div', 'title-cell');
    titleCell.style.paddingLeft = depth * 22 + 'px';
    const chevron = el('button', 'chevron' + (node.children.length === 0 ? ' placeholder' : ''));
    if (node.children.length > 0) {
      const expanded = isExpanded(node);
      chevron.textContent = expanded ? '▾' : '▸';
      chevron.title = expanded ? 'Collapse' : 'Expand';
      chevron.onclick = () => {
        if (expanded) collapsed[issue.id] = true;
        else delete collapsed[issue.id];
        persistState();
        render();
      };
    }
    titleCell.appendChild(chevron);
    titleCell.appendChild(typeIcon(issue.issueType));

    const title = el('span', 'issue-title');
    title.textContent = issue.title;
    title.title =
      issue.title +
      '\n' +
      TYPE_LABELS[issue.issueType] +
      ' · ' +
      issue.boardTitle +
      ' · ' +
      issue.column +
      '\nClick to edit';
    title.onclick = () => openIssueModal({ existing: issue, node });
    titleCell.appendChild(title);

    if (boards.length > 1 && (!filters.board || issue.boardUri !== filters.board)) {
      const boardChip = el('span', 'board-chip');
      boardChip.textContent = issue.boardTitle;
      boardChip.title = issue.boardPath;
      titleCell.appendChild(boardChip);
    }
    row.appendChild(titleCell);

    const statusCell = el('div');
    const board = findBoard(issue.boardUri);
    const statusSelect = el('select', 'status-select' + (issue.done ? ' done' : ''));
    statusSelect.title = 'Move to another column on ' + issue.boardTitle;
    for (const column of board ? board.columns : [{ name: issue.column }]) {
      statusSelect.appendChild(option(column.name, column.name));
    }
    statusSelect.value = issue.column;
    statusSelect.onchange = () =>
      vscode.postMessage({
        type: 'setStatus',
        boardUri: issue.boardUri,
        id: issue.id,
        column: statusSelect.value,
      });
    statusCell.appendChild(statusSelect);
    row.appendChild(statusCell);

    const assignee = el('div', 'cell-text col-assignee' + (issue.assignee ? '' : ' muted'));
    assignee.textContent = issue.assignee || '—';
    row.appendChild(assignee);

    const priorityCell = el('div');
    const priority = el('span', 'priority priority-' + (issue.priority || 'medium'));
    priority.textContent = issue.priority || 'medium';
    priorityCell.appendChild(priority);
    row.appendChild(priorityCell);

    const due = el('div', 'cell-text col-due' + (issue.dueDate ? '' : ' muted'));
    due.textContent = issue.dueDate || '—';
    if (issue.dueDate && !issue.done && issue.dueDate < getTodayIso()) {
      due.classList.add('overdue');
      due.title = 'Overdue';
    }
    row.appendChild(due);

    row.appendChild(renderProgress(node));

    const actions = el('div', 'row-actions');
    if (getChildTypes(issue.issueType).length > 0) {
      actions.appendChild(
        actionButton('+', 'Create child issue', () =>
          openIssueModal({
            issueType: getChildTypes(issue.issueType)[0],
            parent: issue,
          })
        )
      );
      actions.appendChild(actionButton('🔗', 'Link existing card as child', () => openLinkPicker(issue)));
    }
    if (issue.parentId && node.parent) {
      actions.appendChild(actionButton('⤴', 'Unlink from ' + node.parent.issue.title, () => setParent(issue, '')));
    }
    actions.appendChild(actionButton('✎', 'Edit', () => openIssueModal({ existing: issue, node })));
    actions.appendChild(
      actionButton('↗', 'Open in board', () =>
        vscode.postMessage({
          type: 'openInBoard',
          boardUri: issue.boardUri,
          id: issue.id,
        })
      )
    );
    const deleteBtn = actionButton('🗑', 'Delete', () => confirmDelete(node));
    deleteBtn.classList.add('danger-action');
    actions.appendChild(deleteBtn);
    row.appendChild(actions);

    return row;
  }

  function renderProgress(node) {
    const cell = el('div', 'progress col-progress');
    let done = 0;
    let total = 0;
    let label = '';
    if (node.children.length > 0) {
      done = node.children.filter(child => child.issue.done).length;
      total = node.children.length;
      label = done + '/' + total;
      cell.title = done + ' of ' + total + ' child issues done';
    } else if (node.issue.checklistTotal > 0) {
      done = node.issue.checklistDone;
      total = node.issue.checklistTotal;
      label = '☑ ' + done + '/' + total;
      cell.title = done + ' of ' + total + ' checklist items done';
    } else {
      return cell;
    }
    const track = el('div', 'progress-track');
    const fill = el('div', 'progress-fill');
    fill.style.width = Math.round((done / total) * 100) + '%';
    track.appendChild(fill);
    cell.appendChild(track);
    const text = el('span');
    text.textContent = label;
    cell.appendChild(text);
    return cell;
  }

  function setParent(issue, parentId) {
    vscode.postMessage({ type: 'setParent', boardUri: issue.boardUri, id: issue.id, parentId });
  }

  function getParentCandidates(childType, excludeId) {
    return issues.filter(issue => issue.id !== excludeId && canBeParentOf(issue.issueType, childType));
  }

  function openIssueModal(options) {
    const existing = options.existing;
    const parentContext = options.parent;
    const overlay = el('div', 'modal-overlay');
    const modal = el('div', 'modal');

    const heading = el('h2');
    heading.textContent = existing
      ? 'Edit ' + TYPE_LABELS[existing.issueType]
      : parentContext
        ? 'Create issue in "' + parentContext.title + '"'
        : 'Create ' + (options.issueType === 'epic' ? 'Epic' : 'Issue');
    modal.appendChild(heading);

    const typeOptions = parentContext ? getChildTypes(parentContext.issueType) : ALL_TYPES;
    const row1 = el('div', 'form-row');
    const typeCol = el('div');
    typeCol.appendChild(labelEl('Type'));
    const typeSelect = el('select');
    for (const type of typeOptions) typeSelect.appendChild(option(type, TYPE_LABELS[type]));
    typeSelect.value = existing
      ? existing.issueType
      : typeOptions.includes(options.issueType)
        ? options.issueType
        : typeOptions[0];
    typeCol.appendChild(typeSelect);
    row1.appendChild(typeCol);

    const priorityCol = el('div');
    priorityCol.appendChild(labelEl('Priority'));
    const prioritySelect = el('select');
    [
      ['critical', '🔴 Critical'],
      ['high', '🟠 High'],
      ['medium', '🔵 Medium'],
      ['low', '🟢 Low'],
    ].forEach(([value, label]) => prioritySelect.appendChild(option(value, label)));
    prioritySelect.value = existing ? existing.priority || 'medium' : 'medium';
    priorityCol.appendChild(prioritySelect);
    row1.appendChild(priorityCol);
    modal.appendChild(row1);

    modal.appendChild(labelEl('Title'));
    const titleInput = el('input');
    titleInput.type = 'text';
    titleInput.placeholder = 'Summary...';
    titleInput.value = existing ? existing.title : '';
    modal.appendChild(titleInput);

    const row2 = el('div', 'form-row');
    const boardCol = el('div');
    boardCol.appendChild(labelEl('Board'));
    const boardSelect = el('select');
    for (const board of boards) boardSelect.appendChild(option(board.uri, board.title + ' (' + board.path + ')'));
    boardSelect.value = existing
      ? existing.boardUri
      : (parentContext && parentContext.boardUri) || filters.board || (boards[0] && boards[0].uri);
    boardSelect.disabled = !!existing;
    boardCol.appendChild(boardSelect);
    row2.appendChild(boardCol);

    const statusCol = el('div');
    statusCol.appendChild(labelEl('Status (column)'));
    const statusSelect = el('select');
    statusCol.appendChild(statusSelect);
    row2.appendChild(statusCol);
    modal.appendChild(row2);

    function fillStatusOptions() {
      const board = findBoard(boardSelect.value);
      statusSelect.innerHTML = '';
      for (const column of board ? board.columns : []) statusSelect.appendChild(option(column.name, column.name));
      if (existing) {
        statusSelect.value = existing.column;
      } else if (board && board.columns.length > 0) {
        statusSelect.value = board.columns[0].name;
      }
    }
    boardSelect.onchange = fillStatusOptions;
    fillStatusOptions();

    modal.appendChild(labelEl('Parent'));
    const parentSelect = el('select');
    modal.appendChild(parentSelect);
    const parentHint = el('div', 'field-hint');
    modal.appendChild(parentHint);

    function fillParentOptions() {
      const type = typeSelect.value;
      const current = parentSelect.value || (existing ? existing.parentId : parentContext ? parentContext.id : '');
      parentSelect.innerHTML = '';
      parentSelect.appendChild(option('', type === 'epic' ? 'Epics have no parent' : '(none)'));
      for (const candidate of getParentCandidates(type, existing && existing.id)) {
        parentSelect.appendChild(
          option(
            candidate.id,
            TYPE_LABELS[candidate.issueType] +
              ': ' +
              candidate.title +
              (boards.length > 1 ? ' — ' + candidate.boardTitle : '')
          )
        );
      }
      parentSelect.value = current;
      if (parentSelect.value !== current) parentSelect.value = '';
      parentSelect.disabled = type === 'epic';

      const hints = [];
      if (type === 'epic') hints.push('Epics sit at the top of the hierarchy.');
      else if (getLevel(type) === 2)
        hints.push('A ' + TYPE_LABELS[type].toLowerCase() + ' belongs to a story, task, or bug.');
      else hints.push('A story, task, or bug can belong to an epic.');
      const children = options.node ? options.node.children : [];
      const brokenChildren = children.filter(child => !canBeParentOf(type, child.issue.issueType)).length;
      if (brokenChildren > 0) {
        hints.push(
          brokenChildren +
            ' child issue' +
            (brokenChildren === 1 ? '' : 's') +
            ' cannot stay under a ' +
            TYPE_LABELS[type].toLowerCase() +
            ' and will move to "Not in an epic".'
        );
      }
      parentHint.textContent = hints.join(' ');
    }
    typeSelect.onchange = fillParentOptions;
    fillParentOptions();

    const row3 = el('div', 'form-row');
    const assigneeCol = el('div');
    assigneeCol.appendChild(labelEl('Assignee'));
    const assigneeInput = el('input');
    assigneeInput.type = 'text';
    assigneeInput.placeholder = 'Username...';
    assigneeInput.value = existing ? existing.assignee || '' : '';
    assigneeCol.appendChild(assigneeInput);
    row3.appendChild(assigneeCol);

    const dueCol = el('div');
    dueCol.appendChild(labelEl('Due Date'));
    const dueInput = el('input');
    dueInput.type = 'date';
    dueInput.value = existing ? existing.dueDate || '' : '';
    dueCol.appendChild(dueInput);
    row3.appendChild(dueCol);
    modal.appendChild(row3);

    modal.appendChild(labelEl('Description'));
    const descInput = el('textarea');
    descInput.placeholder = 'Optional description...';
    descInput.value = existing ? existing.description || '' : '';
    modal.appendChild(descInput);

    const actions = el('div', 'modal-actions');
    if (existing) {
      const openBtn = el('button', 'secondary');
      openBtn.textContent = 'Open in Board';
      openBtn.onclick = () => {
        overlay.remove();
        vscode.postMessage({ type: 'openInBoard', boardUri: existing.boardUri, id: existing.id });
      };
      actions.appendChild(openBtn);
    }
    const cancelBtn = el('button', 'secondary');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => overlay.remove();
    actions.appendChild(cancelBtn);

    const saveBtn = el('button');
    saveBtn.textContent = existing ? 'Save' : 'Create';
    saveBtn.onclick = () => {
      const title = titleInput.value.trim();
      if (!title) {
        titleInput.focus();
        return;
      }
      if (!boardSelect.value) return;
      const payload = {
        boardUri: boardSelect.value,
        column: statusSelect.value,
        issueType: typeSelect.value,
        parentId: typeSelect.value === 'epic' ? '' : parentSelect.value,
        title,
        description: descInput.value.trim(),
        priority: prioritySelect.value,
        assignee: assigneeInput.value.trim(),
        dueDate: dueInput.value,
      };
      if (existing) {
        vscode.postMessage({ type: 'updateIssue', id: existing.id, ...payload });
      } else {
        if (payload.parentId) delete collapsed[payload.parentId];
        persistState();
        vscode.postMessage({ type: 'createIssue', ...payload });
      }
      overlay.remove();
    };
    actions.appendChild(saveBtn);
    modal.appendChild(actions);

    titleInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') saveBtn.click();
    });

    showModal(overlay, modal);
    setTimeout(() => titleInput.focus(), 50);
  }

  function openLinkPicker(parent) {
    const overlay = el('div', 'modal-overlay');
    const modal = el('div', 'modal');
    const heading = el('h2');
    heading.textContent = 'Link a card to "' + parent.title + '"';
    modal.appendChild(heading);

    const hint = el('p', 'muted');
    hint.textContent =
      parent.issueType === 'epic'
        ? 'Pick a story, task, or bug from any board. Cards already in another epic move to this one.'
        : "Pick a sub-task or sub-story from any board. Change a card's type to Sub-task or Sub-story in its edit dialog to list it here.";
    modal.appendChild(hint);

    const search = el('input');
    search.type = 'search';
    search.placeholder = 'Search cards...';
    modal.appendChild(search);

    const list = el('div', 'picker-list');
    modal.appendChild(list);

    const forest = buildForest();
    const candidates = issues.filter(
      issue =>
        issue.id !== parent.id && issue.parentId !== parent.id && canBeParentOf(parent.issueType, issue.issueType)
    );

    function fillList() {
      const text = search.value.trim().toLowerCase();
      list.innerHTML = '';
      const matches = candidates.filter(
        issue => !text || (issue.title + ' ' + issue.boardTitle + ' ' + issue.column).toLowerCase().includes(text)
      );
      if (matches.length === 0) {
        const empty = el('div', 'picker-empty');
        empty.textContent = candidates.length === 0 ? 'No cards can be linked here.' : 'No cards match.';
        list.appendChild(empty);
        return;
      }
      for (const issue of matches) {
        const item = el('div', 'picker-item');
        item.appendChild(typeIcon(issue.issueType));
        const title = el('span', 'issue-title');
        title.textContent = issue.title;
        item.appendChild(title);
        const where = el('span', 'board-chip');
        const currentParent = forest.nodes.get(issue.id) && forest.nodes.get(issue.id).parent;
        where.textContent =
          (currentParent ? 'in ' + currentParent.issue.title + ' · ' : '') + issue.boardTitle + ' · ' + issue.column;
        item.appendChild(where);
        item.onclick = () => {
          delete collapsed[parent.id];
          persistState();
          setParent(issue, parent.id);
          overlay.remove();
        };
        list.appendChild(item);
      }
    }
    search.oninput = fillList;
    fillList();

    const actions = el('div', 'modal-actions');
    const newBtn = el('button', 'secondary');
    newBtn.textContent = '+ Create new instead';
    newBtn.onclick = () => {
      overlay.remove();
      openIssueModal({ issueType: getChildTypes(parent.issueType)[0], parent });
    };
    actions.appendChild(newBtn);
    const closeBtn = el('button', 'secondary');
    closeBtn.textContent = 'Close';
    closeBtn.onclick = () => overlay.remove();
    actions.appendChild(closeBtn);
    modal.appendChild(actions);

    showModal(overlay, modal);
    setTimeout(() => search.focus(), 50);
  }

  function confirmDelete(node) {
    const issue = node.issue;
    const overlay = el('div', 'modal-overlay');
    const modal = el('div', 'modal');
    const heading = el('h2');
    heading.textContent = 'Delete ' + TYPE_LABELS[issue.issueType];
    modal.appendChild(heading);
    const text = el('p');
    const childCount = node.children.length;
    text.textContent =
      'Delete "' +
      issue.title +
      '" from ' +
      issue.boardTitle +
      '?' +
      (childCount > 0
        ? ' Its ' + childCount + ' child issue' + (childCount === 1 ? ' is' : 's are') + ' kept and unlinked.'
        : '');
    modal.appendChild(text);

    const actions = el('div', 'modal-actions');
    const cancelBtn = el('button', 'secondary');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => overlay.remove();
    actions.appendChild(cancelBtn);
    const deleteBtn = el('button', 'danger');
    deleteBtn.textContent = 'Delete';
    deleteBtn.onclick = () => {
      vscode.postMessage({ type: 'deleteIssue', boardUri: issue.boardUri, id: issue.id });
      overlay.remove();
    };
    actions.appendChild(deleteBtn);
    modal.appendChild(actions);
    showModal(overlay, modal);
    setTimeout(() => deleteBtn.focus(), 50);
  }

  function showModal(overlay, modal) {
    overlay.onclick = e => {
      if (e.target === overlay) overlay.remove();
    };
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  function focusIssue(id) {
    const issue = findIssue(id);
    if (!issue) {
      showNotice('That issue was not found.', false);
      return;
    }
    if (!selfMatches(issue)) {
      filters = {
        text: '',
        board: filters.board === issue.boardUri ? filters.board : '',
        hideDone: issue.done ? false : filters.hideDone,
      };
    }
    const forest = buildForest();
    const node = forest.nodes.get(id);
    sectionCollapsed = {};
    for (let parent = node && node.parent; parent; parent = parent.parent) delete collapsed[parent.issue.id];
    persistState();
    flashId = id;
    render();
    flashId = '';
    const row = document.querySelector('[data-issue-id="' + cssEscape(id) + '"]');
    if (row) row.scrollIntoView({ block: 'center' });
  }

  function typeIcon(type) {
    const icon = el('span', 'type-icon type-' + type);
    icon.textContent = TYPE_GLYPHS[type] || '?';
    icon.title = TYPE_LABELS[type] || type;
    return icon;
  }

  function actionButton(text, title, onClick) {
    const btn = el('button');
    btn.textContent = text;
    btn.title = title;
    btn.onclick = e => {
      e.stopPropagation();
      onClick();
    };
    return btn;
  }

  function option(value, label) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    return opt;
  }

  function getTodayIso() {
    const now = new Date();
    return (
      now.getFullYear() +
      '-' +
      String(now.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(now.getDate()).padStart(2, '0')
    );
  }

  function el(tag, className) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    return e;
  }

  function labelEl(text) {
    const l = el('label');
    l.textContent = text;
    return l;
  }

  function showNotice(message, ok) {
    const existing = document.querySelector('.notice');
    if (existing) existing.remove();
    const notice = el('div', 'notice' + (ok ? '' : ' error'));
    notice.textContent = message;
    document.body.appendChild(notice);
    window.setTimeout(() => notice.remove(), 3500);
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
  }

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const overlays = document.querySelectorAll('.modal-overlay');
    if (overlays.length === 0) return;
    e.preventDefault();
    overlays[overlays.length - 1].remove();
  });

  window.addEventListener('message', event => {
    const msg = event.data;
    if (msg.type === 'data') {
      boards = msg.boards || [];
      issues = msg.issues || [];
      loaded = true;
      if (filters.board && !findBoard(filters.board)) filters.board = '';
      render();
    } else if (msg.type === 'show') {
      if (msg.boardUri && findBoard(msg.boardUri)) {
        filters.board = msg.boardUri;
        persistState();
        render();
      }
      if (msg.focusId) focusIssue(msg.focusId);
    } else if (msg.type === 'notice') {
      showNotice(msg.message, msg.ok);
    }
  });

  render();
  vscode.postMessage({ type: 'ready' });
})();
