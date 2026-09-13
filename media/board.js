(function() {
  const vscode = acquireVsCodeApi();
  let board = JSON.parse(document.getElementById('board-data').textContent || '{"title":"Kanban Board","columns":[]}');
  const boardConfig = JSON.parse(document.getElementById('board-config')?.textContent || '{"canArchiveCards":true}');
  let dragData = null;
  let collapsedGroups = {};
  let filters = {
    text: '',
    assignee: '',
    tag: '',
    priority: '',
    workload: '',
    due: '',
  };
  let confirmationPrefs = {
    archiveCard: false,
    deleteTask: false,
    deleteColumn: false,
    deleteSubtask: false,
  };
  let textFilterTimer = 0;
  const savedState = vscode.getState();
  if (savedState && savedState.collapsedGroups) {
    collapsedGroups = savedState.collapsedGroups;
  }
  if (savedState && savedState.filters) {
    filters = { ...filters, ...savedState.filters };
  }
  if (savedState && savedState.confirmationPrefs) {
    confirmationPrefs = { ...confirmationPrefs, ...savedState.confirmationPrefs };
  }

  function render() {
    const app = document.getElementById('app');
    app.innerHTML = '';

    // Toolbar
    const toolbar = el('div', 'toolbar');
    const h1 = el('h1');
    h1.textContent = board.title;
    h1.title = 'Click to rename board';
    h1.onclick = () => renameBoard();
    toolbar.appendChild(h1);

    const actions = el('div', 'toolbar-actions');
    const mdBtn = el('button', 'secondary');
    mdBtn.textContent = '📄 View Markdown';
    mdBtn.onclick = () => vscode.postMessage({ type: 'openMarkdown' });
    actions.appendChild(mdBtn);
    toolbar.appendChild(actions);
    app.appendChild(toolbar);
    app.appendChild(renderStatsBar());
    app.appendChild(renderFilterBar());

    // Board
    const boardEl = el('div', 'board');
    boardEl.addEventListener('dragover', (e) => {
      if (!dragData || dragData.type !== 'column') return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      updateColumnDropIndicator(boardEl, e.clientX);
    });
    boardEl.addEventListener('dragleave', (e) => {
      if (!boardEl.contains(e.relatedTarget)) {
        removeColumnDropIndicator(boardEl);
      }
    });
    boardEl.addEventListener('drop', (e) => {
      if (!dragData || dragData.type !== 'column') return;
      e.preventDefault();
      const toIndex = getColumnDropIndex(boardEl, e.clientX);
      removeColumnDropIndicator(boardEl);
      vscode.postMessage({
        type: 'moveColumn',
        name: dragData.column,
        toIndex,
      });
    });

    for (const column of board.columns) {
      boardEl.appendChild(renderColumn(column));
    }

    // Add column placeholder
    const addColDiv = el('div', 'add-column-placeholder');
    const addColBtn = el('button');
    addColBtn.textContent = '+ Add Column';
    addColBtn.onclick = (event) => addColumn(event.currentTarget);
    addColDiv.appendChild(addColBtn);
    boardEl.appendChild(addColDiv);

    app.appendChild(boardEl);
  }

  function renderFilterBar() {
    const bar = el('div', 'filter-bar');
    const options = getFilterOptions();

    const search = el('input', 'filter-search');
    search.type = 'search';
    search.placeholder = 'Search cards...';
    search.value = filters.text;
    search.oninput = () => updateTextFilter(search.value);
    bar.appendChild(search);

    bar.appendChild(renderSelectFilter('Assignee', 'assignee', options.assignees));
    bar.appendChild(renderSelectFilter('Tag', 'tag', options.tags));
    bar.appendChild(renderSelectFilter('Priority', 'priority', ['critical', 'high', 'medium', 'low']));
    bar.appendChild(renderSelectFilter('Workload', 'workload', ['easy', 'normal', 'hard', 'extreme']));
    bar.appendChild(renderSelectFilter('Due', 'due', ['overdue', 'today', 'upcoming', 'no due date', ...options.dueDates]));

    const quick = el('div', 'quick-filters');
    quick.appendChild(renderChip('Overdue', filters.due === 'overdue', () => {
      updateFilters({ due: filters.due === 'overdue' ? '' : 'overdue' });
    }));
    quick.appendChild(renderChip('High+', filters.priority === 'high+', () => {
      updateFilters({ priority: filters.priority === 'high+' ? '' : 'high+' });
    }));
    quick.appendChild(renderChip('Hard+', filters.workload === 'hard+', () => {
      updateFilters({ workload: filters.workload === 'hard+' ? '' : 'hard+' });
    }));
    bar.appendChild(quick);

    if (hasActiveFilters()) {
      const clearBtn = el('button', 'secondary');
      clearBtn.textContent = 'Clear';
      clearBtn.onclick = () => updateFilters({
        text: '',
        assignee: '',
        tag: '',
        priority: '',
        workload: '',
        due: '',
      });
      bar.appendChild(clearBtn);
    }

    return bar;
  }

  function renderStatsBar() {
    const stats = getBoardStats();
    const bar = el('div', 'stats-bar');

    const filtered = hasActiveFilters();
    bar.appendChild(renderStat(filtered ? 'Cards shown' : 'Cards', filtered ? stats.visibleCards + '/' + stats.totalCards : String(stats.totalCards)));
    bar.appendChild(renderColumnStats(filtered ? 'Cards by column shown' : 'Cards by column', stats.columnCounts));
    bar.appendChild(renderStat('Overdue', String(stats.overdueCards), stats.overdueCards > 0 ? 'danger' : ''));
    bar.appendChild(renderStat('Workload pts', String(stats.workloadTotal), '', 'Workload points: easy=1, normal=2, hard=3, extreme=5.'));
    bar.appendChild(renderStat('Subtasks', stats.completedSubtasks + '/' + stats.totalSubtasks));

    return bar;
  }

  function renderStat(label, value, modifier, title) {
    const item = el('div', 'stat-item' + (modifier ? ' ' + modifier : ''));
    if (title) item.title = title;
    const labelEl = el('span', 'stat-label');
    labelEl.textContent = label;
    item.appendChild(labelEl);

    const valueEl = el('span', 'stat-value');
    valueEl.textContent = value;
    item.appendChild(valueEl);
    return item;
  }

  function renderColumnStats(label, columnCounts) {
    const item = el('div', 'stat-item stat-columns');
    const labelEl = el('span', 'stat-label');
    labelEl.textContent = label;
    item.appendChild(labelEl);

    const chips = el('div', 'stat-column-chips');
    for (const column of columnCounts) {
      const chip = el('span', 'stat-column-chip');
      const name = el('span', 'stat-column-name');
      name.textContent = column.name;
      chip.appendChild(name);

      const count = el('span', 'stat-column-count');
      count.textContent = String(column.count);
      chip.appendChild(count);
      chips.appendChild(chip);
    }
    if (columnCounts.length === 0) {
      chips.textContent = '0';
    }
    item.appendChild(chips);
    return item;
  }

  function renderSelectFilter(label, key, values) {
    const select = document.createElement('select');
    select.className = 'filter-select';
    select.title = 'Filter by ' + label.toLowerCase();

    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = label;
    select.appendChild(empty);

    for (const value of values) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = formatFilterLabel(value);
      select.appendChild(option);
    }

    select.value = filters[key] || '';
    select.onchange = () => updateFilters({ [key]: select.value });
    return select;
  }

  function renderChip(label, isActive, onClick) {
    const chip = el('button', 'filter-chip' + (isActive ? ' active' : ''));
    chip.textContent = label;
    chip.onclick = onClick;
    return chip;
  }

  function updateFilters(next) {
    filters = { ...filters, ...next };
    persistState();
    render();
  }

  function updateTextFilter(value) {
    filters = { ...filters, text: value };
    persistState();
    window.clearTimeout(textFilterTimer);
    textFilterTimer = window.setTimeout(() => {
      render();
      const search = document.querySelector('.filter-search');
      if (search) {
        search.focus();
        search.setSelectionRange(search.value.length, search.value.length);
      }
    }, 150);
  }

  function hasActiveFilters() {
    return Boolean(
      filters.text ||
      filters.assignee ||
      filters.tag ||
      filters.priority ||
      filters.workload ||
      filters.due
    );
  }

  function persistState() {
    vscode.setState({ collapsedGroups, filters, confirmationPrefs });
  }

  function getAllTasks() {
    return board.columns.flatMap(column => column.tasks);
  }

  function getBoardStats() {
    const today = getToday();
    const allTasks = getAllTasks();
    const visibleTasks = allTasks.filter(matchesFilters);
    let overdueCards = 0;
    let workloadTotal = 0;
    let completedSubtasks = 0;
    let totalSubtasks = 0;

    for (const task of visibleTasks) {
      if (isOverdue(task.dueDate, today)) {
        overdueCards++;
      }
      workloadTotal += getWorkloadPoints(task.workload);
      for (const subtask of task.subtasks || []) {
        totalSubtasks++;
        if (subtask.done) {
          completedSubtasks++;
        }
      }
    }

    return {
      totalCards: allTasks.length,
      visibleCards: visibleTasks.length,
      columnCounts: board.columns.map(column => ({
        name: column.name,
        count: column.tasks.filter(matchesFilters).length,
      })),
      overdueCards,
      workloadTotal,
      completedSubtasks,
      totalSubtasks,
    };
  }

  // Group a dragged card should land in when it is dropped on an ungrouped area.
  // Dropping on the ungrouped area of its own column removes the card from its group,
  // which is how cards are ungrouped. Moving to a different column keeps the group, and
  // the group is recreated in the target column if it is not there yet.
  function getUngroupedDropGroup(targetColumnName) {
    if (!dragData) {
      return '';
    }
    return dragData.fromColumn === targetColumnName ? '' : (dragData.group || '');
  }

  function getGroupOptions() {
    const groups = new Set();
    for (const task of getAllTasks()) {
      if (task.group) groups.add(task.group);
    }
    return Array.from(groups).sort((a, b) => a.localeCompare(b));
  }

  function parseTagInput(value) {
    return String(value || '')
      .split(',')
      .map(tag => tag.trim())
      .filter(Boolean);
  }

  function getFilterOptions() {
    const assignees = new Set();
    const tags = new Set();
    const dueDates = new Set();
    for (const task of getAllTasks()) {
      if (task.assignee) assignees.add(task.assignee);
      if (task.dueDate) dueDates.add(task.dueDate);
      for (const tag of task.tags || []) tags.add(tag);
    }
    return {
      assignees: Array.from(assignees).sort((a, b) => a.localeCompare(b)),
      tags: Array.from(tags).sort((a, b) => a.localeCompare(b)),
      dueDates: Array.from(dueDates).sort((a, b) => a.localeCompare(b)),
    };
  }

  function matchesFilters(task) {
    if (filters.text) {
      const needle = filters.text.toLowerCase();
      const haystack = [
        task.title,
        task.description,
        task.assignee,
        task.group,
        task.priority,
        task.workload,
        task.dueDate,
        task.source,
        ...(task.tags || []),
        ...((task.subtasks || []).map(st => st.title)),
      ].join(' ').toLowerCase();
      if (!haystack.includes(needle)) return false;
    }

    if (filters.assignee && task.assignee !== filters.assignee) return false;
    if (filters.tag && !(task.tags || []).includes(filters.tag)) return false;
    if (filters.priority && !matchesPriorityFilter(task.priority, filters.priority)) return false;
    if (filters.workload && !matchesWorkloadFilter(task.workload, filters.workload)) return false;
    if (filters.due && !matchesDueFilter(task.dueDate, filters.due)) return false;

    return true;
  }

  function matchesPriorityFilter(priority, value) {
    const current = priority || 'medium';
    if (value === 'high+') return current === 'critical' || current === 'high';
    return current === value;
  }

  function matchesWorkloadFilter(workload, value) {
    const current = workload || 'normal';
    if (value === 'hard+') return current === 'extreme' || current === 'hard';
    return current === value;
  }

  function matchesDueFilter(dueDate, value) {
    if (value === 'no due date') return !dueDate;
    if (!dueDate) return false;

    const today = getToday();
    const due = new Date(dueDate + 'T00:00:00');
    if (Number.isNaN(due.getTime())) return false;

    if (value === 'overdue') return due < today;
    if (value === 'today') return due.getTime() === today.getTime();
    if (value === 'upcoming') return due > today;
    return dueDate === value;
  }

  function getToday() {
    const today = new Date();
    today.setHours(0,0,0,0);
    return today;
  }

  function isOverdue(dueDate, today) {
    if (!dueDate) return false;
    const due = new Date(dueDate + 'T00:00:00');
    return !Number.isNaN(due.getTime()) && due < today;
  }

  function getWorkloadPoints(workload) {
    switch (workload || 'normal') {
      case 'easy': return 1;
      case 'hard': return 3;
      case 'extreme': return 5;
      case 'normal':
      default:
        return 2;
    }
  }

  function formatFilterLabel(value) {
    if (value === 'high+') return 'High+';
    if (value === 'hard+') return 'Hard+';
    if (value === 'no due date') return 'No due date';
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function renderColumn(column) {
    const colEl = el('div', 'column');
    colEl.dataset.column = column.name;
    const visibleTasks = column.tasks.filter(matchesFilters);

    // Header
    const header = el('div', 'column-header');

    const columnDragHandle = el('button', 'column-drag-handle');
    columnDragHandle.textContent = '::';
    columnDragHandle.title = 'Drag column';
    columnDragHandle.draggable = true;
    columnDragHandle.addEventListener('click', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
    });
    columnDragHandle.addEventListener('dragstart', (e) => {
      dragData = { type: 'column', column: column.name };
      colEl.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    columnDragHandle.addEventListener('dragend', () => {
      colEl.classList.remove('dragging');
      clearDragState();
    });
    header.appendChild(columnDragHandle);

    const title = el('span', 'column-title');
    title.textContent = column.name;
    title.title = 'Click to rename';
    title.onclick = () => renameColumn(column.name);
    header.appendChild(title);

    const count = el('span', 'column-count');
    count.textContent = hasActiveFilters()
      ? visibleTasks.length + '/' + column.tasks.length
      : String(column.tasks.length);
    header.appendChild(count);

    const colActions = el('div', 'column-actions');
    const delColBtn = el('button');
    delColBtn.textContent = '✕';
    delColBtn.title = 'Delete column';
    delColBtn.onclick = () => {
      requestConfirmation('deleteColumn', {
        title: 'Delete Column',
        message: column.tasks.length > 0
          ? 'Delete "' + column.name + '" and all ' + column.tasks.length + ' card(s)?'
          : 'Delete "' + column.name + '"?',
        confirmText: 'Delete',
        danger: true,
      }, () => {
        vscode.postMessage({ type: 'deleteColumn', name: column.name });
      });
    };
    colActions.appendChild(delColBtn);
    header.appendChild(colActions);
    colEl.appendChild(header);

    // Body
    const body = el('div', 'column-body');
    body.dataset.column = column.name;

    body.addEventListener('dragover', (e) => {
      if (dragData && dragData.type === 'column') return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      body.classList.add('drag-over');
      if (dragData && dragData.type === 'group') {
        updateGroupDropIndicator(body, e.clientY);
      } else {
        updateDropIndicator(body, e.clientY);
      }
    });

    body.addEventListener('dragleave', (e) => {
      if (!body.contains(e.relatedTarget)) {
        body.classList.remove('drag-over');
        removeDropIndicators(body);
      }
    });

    body.addEventListener('drop', (e) => {
      if (dragData && dragData.type === 'column') return;
      e.preventDefault();
      body.classList.remove('drag-over');
      removeDropIndicators(body);

      if (!dragData) return;
      if (dragData.type === 'group') {
        moveGroupTo(body, column.name, e.clientY);
        return;
      }

      const toIndex = getDropCards(body).length > 0 ? getDropIndex(body, e.clientY) : column.tasks.length;

      vscode.postMessage({
        type: 'moveTaskToGroup',
        taskId: dragData.taskId,
        fromColumn: dragData.fromColumn,
        toColumn: column.name,
        toIndex: toIndex,
        group: getUngroupedDropGroup(column.name),
      });
    });

    // Group tasks
    const grouped = {};
    const ungrouped = [];
    for (const task of visibleTasks) {
      if (task.group) {
        if (!grouped[task.group]) grouped[task.group] = [];
        grouped[task.group].push(task);
      } else {
        ungrouped.push(task);
      }
    }

    // Render grouped tasks
    const groupNames = Object.keys(grouped);
    for (const gName of groupNames) {
      const groupEl = el('div', 'task-group');
      groupEl.dataset.group = gName;

      const gHeader = el('div', 'group-header');
      const groupDragHandle = el('button', 'group-drag-handle');
      groupDragHandle.textContent = '::';
      groupDragHandle.title = 'Drag group';
      groupDragHandle.draggable = true;
      groupDragHandle.addEventListener('click', (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
      });
      groupDragHandle.addEventListener('dragstart', (e) => {
        dragData = { type: 'group', group: gName, fromColumn: column.name };
        groupEl.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      groupDragHandle.addEventListener('dragend', () => {
        groupEl.classList.remove('dragging');
        clearDragState();
      });
      gHeader.appendChild(groupDragHandle);

      const chevron = el('span', 'group-chevron');
      chevron.textContent = '▼';
      gHeader.appendChild(chevron);

      const gLabel = el('span');
      gLabel.textContent = gName;
      gHeader.appendChild(gLabel);

      const gCount = el('span', 'group-count');
      gCount.textContent = String(grouped[gName].length);
      gHeader.appendChild(gCount);

      const gBody = el('div', 'group-body');
      gBody.dataset.group = gName;
      gBody.dataset.column = column.name;

      // Group drop target: dropping here assigns the group + handles reorder
      gBody.addEventListener('dragover', (e) => {
        if (dragData && dragData.type === 'column') return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        if (dragData && dragData.type === 'group') {
          updateGroupDropIndicator(body, e.clientY);
          return;
        }
        gBody.classList.add('drag-over');
        groupEl.classList.add('group-drop-target');
        updateDropIndicator(gBody, e.clientY);
      });
      gBody.addEventListener('dragleave', (e) => {
        if (!gBody.contains(e.relatedTarget)) {
          gBody.classList.remove('drag-over');
          groupEl.classList.remove('group-drop-target');
          removeDropIndicators(gBody);
        }
      });
      gBody.addEventListener('drop', (e) => {
        if (dragData && dragData.type === 'column') return;
        e.preventDefault();
        e.stopPropagation();
        gBody.classList.remove('drag-over');
        groupEl.classList.remove('group-drop-target');
        removeDropIndicators(gBody);
        if (!dragData) return;
        if (dragData.type === 'group') {
          moveGroupTo(body, column.name, e.clientY);
          return;
        }

        const dropIdx = getDropIndex(gBody, e.clientY);
        // Find absolute index in column.tasks for the group
        const groupTaskIds = grouped[gName]
          .filter(t => !dragData || t.id !== dragData.taskId)
          .map(t => t.id);
        const placement = getTaskPlacement(groupTaskIds, dropIdx);
        let absoluteIdx = 0;
        if (dropIdx < groupTaskIds.length) {
          absoluteIdx = column.tasks.findIndex(t => t.id === groupTaskIds[dropIdx]);
        } else if (groupTaskIds.length > 0) {
          absoluteIdx = column.tasks.findIndex(t => t.id === groupTaskIds[groupTaskIds.length - 1]) + 1;
        }
        vscode.postMessage({
          type: 'moveTaskToGroup',
          taskId: dragData.taskId,
          fromColumn: dragData.fromColumn,
          toColumn: column.name,
          toIndex: absoluteIdx,
          beforeTaskId: placement.beforeTaskId,
          afterTaskId: placement.afterTaskId,
          group: gName,
        });
      });

      // Also make the group header a drop target
      gHeader.addEventListener('dragover', (e) => {
        if (dragData && dragData.type === 'column') return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        if (dragData && dragData.type === 'group') {
          updateGroupDropIndicator(body, e.clientY);
          return;
        }
        groupEl.classList.add('group-drop-target');
      });
      gHeader.addEventListener('dragleave', (e) => {
        if (!gHeader.contains(e.relatedTarget)) {
          groupEl.classList.remove('group-drop-target');
        }
      });
      gHeader.addEventListener('drop', (e) => {
        if (dragData && dragData.type === 'column') return;
        e.preventDefault();
        e.stopPropagation();
        groupEl.classList.remove('group-drop-target');
        if (!dragData) return;
        if (dragData.type === 'group') {
          moveGroupTo(body, column.name, e.clientY);
          return;
        }

        vscode.postMessage({
          type: 'moveTaskToGroup',
          taskId: dragData.taskId,
          fromColumn: dragData.fromColumn,
          toColumn: column.name,
          toIndex: column.tasks.length,
          afterTaskId: getLastTaskId(grouped[gName], dragData.taskId),
          group: gName,
        });
      });

      for (const task of grouped[gName]) {
        gBody.appendChild(renderCard(task, column.name));
      }

      // Restore collapsed state
      const stateKey = column.name + '::' + gName;
      const isCollapsed = collapsedGroups[stateKey];
      if (isCollapsed) {
        chevron.classList.add('collapsed');
        gBody.classList.add('collapsed');
      }

      // Group edit button
      const gEditBtn = el('button', 'group-edit-btn');
      gEditBtn.textContent = '✎';
      gEditBtn.title = 'Rename group';
      gEditBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        openGroupModal(column.name, gName);
      });
      gHeader.appendChild(gEditBtn);

      gHeader.addEventListener('click', (ev) => {
        if (gEditBtn.contains(ev.target)) return;
        const nowCollapsed = !gBody.classList.contains('collapsed');
        gBody.classList.toggle('collapsed');
        chevron.classList.toggle('collapsed');
        collapsedGroups[stateKey] = nowCollapsed;
        persistState();
      });

      groupEl.appendChild(gHeader);
      groupEl.appendChild(gBody);
      body.appendChild(groupEl);
    }

    // Ungrouped drop zone: dropping here removes the group + handles reorder
    const ungroupedZone = el('div', 'ungrouped-zone');

    ungroupedZone.addEventListener('dragover', (e) => {
      if (dragData && dragData.type === 'column') return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      if (dragData && dragData.type === 'group') {
        updateGroupDropIndicator(body, e.clientY);
        return;
      }
      ungroupedZone.classList.add('drag-over');
      updateDropIndicator(ungroupedZone, e.clientY);
    });
    ungroupedZone.addEventListener('dragleave', (e) => {
      if (!ungroupedZone.contains(e.relatedTarget)) {
        ungroupedZone.classList.remove('drag-over');
        removeDropIndicators(ungroupedZone);
      }
    });
    ungroupedZone.addEventListener('drop', (e) => {
      if (dragData && dragData.type === 'column') return;
      e.preventDefault();
      e.stopPropagation();
      ungroupedZone.classList.remove('drag-over');
      removeDropIndicators(ungroupedZone);
      if (!dragData) return;
      if (dragData.type === 'group') {
        moveGroupTo(body, column.name, e.clientY);
        return;
      }

      const dropIdx = getDropIndex(ungroupedZone, e.clientY);
      // Find absolute index in column.tasks for ungrouped area
      const ungroupedIds = ungrouped
        .filter(t => !dragData || t.id !== dragData.taskId)
        .map(t => t.id);
      const placement = getTaskPlacement(ungroupedIds, dropIdx);
      let absoluteIdx = column.tasks.length;
      if (dropIdx < ungroupedIds.length) {
        absoluteIdx = column.tasks.findIndex(t => t.id === ungroupedIds[dropIdx]);
      }
      vscode.postMessage({
        type: 'moveTaskToGroup',
        taskId: dragData.taskId,
        fromColumn: dragData.fromColumn,
        toColumn: column.name,
        toIndex: absoluteIdx,
        beforeTaskId: placement.beforeTaskId,
        afterTaskId: placement.afterTaskId,
        group: getUngroupedDropGroup(column.name),
      });
    });

    for (const task of ungrouped) {
      ungroupedZone.appendChild(renderCard(task, column.name));
    }
    body.appendChild(ungroupedZone);

    if (hasActiveFilters() && visibleTasks.length === 0) {
      const empty = el('div', 'filter-empty');
      empty.textContent = 'No matching cards';
      body.appendChild(empty);
    }

    const columnEndZone = el('div', 'column-end-drop-zone');
    columnEndZone.title = 'Drop at end of column';
    columnEndZone.addEventListener('dragover', (e) => {
      if (dragData && dragData.type === 'column') return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      if (dragData && dragData.type === 'group') {
        updateGroupDropIndicator(body, e.clientY);
        return;
      }
      columnEndZone.classList.add('drag-over');
      updateEndDropIndicator(columnEndZone);
    });
    columnEndZone.addEventListener('dragleave', (e) => {
      if (!columnEndZone.contains(e.relatedTarget)) {
        columnEndZone.classList.remove('drag-over');
        removeDropIndicators(columnEndZone);
      }
    });
    columnEndZone.addEventListener('drop', (e) => {
      if (dragData && dragData.type === 'column') return;
      e.preventDefault();
      e.stopPropagation();
      columnEndZone.classList.remove('drag-over');
      removeDropIndicators(columnEndZone);
      if (!dragData) return;
      if (dragData.type === 'group') {
        moveGroupTo(body, column.name, e.clientY);
        return;
      }

      vscode.postMessage({
        type: 'moveTaskToGroup',
        taskId: dragData.taskId,
        fromColumn: dragData.fromColumn,
        toColumn: column.name,
        toIndex: column.tasks.length,
        group: getUngroupedDropGroup(column.name),
      });
    });
    body.appendChild(columnEndZone);

    // Add task button
    const addBtn = el('button', 'add-card-btn');
    addBtn.textContent = '+ Add Task';
    addBtn.onclick = () => openTaskModal(null, column.name);
    addBtn.addEventListener('dragover', (e) => {
      if (dragData && dragData.type === 'column') return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      if (dragData && dragData.type === 'group') {
        updateGroupDropIndicator(body, e.clientY);
        return;
      }
      updateEndDropIndicator(columnEndZone);
    });
    addBtn.addEventListener('drop', (e) => {
      if (dragData && dragData.type === 'column') return;
      e.preventDefault();
      e.stopPropagation();
      if (!dragData) return;
      if (dragData.type === 'group') {
        moveGroupTo(body, column.name, e.clientY);
        return;
      }

      vscode.postMessage({
        type: 'moveTaskToGroup',
        taskId: dragData.taskId,
        fromColumn: dragData.fromColumn,
        toColumn: column.name,
        toIndex: column.tasks.length,
        group: getUngroupedDropGroup(column.name),
      });
    });
    body.appendChild(addBtn);

    colEl.appendChild(body);
    return colEl;
  }

  function renderCard(task, columnName) {
    const card = el('div', 'card');
    card.draggable = true;
    card.dataset.taskId = task.id;
    card.style.position = 'relative';
    card.style.paddingLeft = '16px';
    let cardWasDragged = false;

    // Priority color strip
    const dot = el('div', 'priority-dot priority-dot-' + (task.priority || 'medium'));
    card.appendChild(dot);

    card.addEventListener('dragstart', (e) => {
      cardWasDragged = true;
      dragData = { type: 'card', taskId: task.id, fromColumn: columnName, group: task.group || '' };
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      clearDragState();
      window.setTimeout(() => {
        cardWasDragged = false;
      }, 100);
    });

    card.addEventListener('click', (e) => {
      if (cardWasDragged || e.target.closest('button')) return;
      openTaskDetailsModal(task, columnName);
    });

    const titleEl = el('div', 'card-title');
    titleEl.textContent = task.title;
    card.appendChild(titleEl);

    // Meta badges row (priority + workload)
    const meta = el('div', 'card-meta');
    if (task.priority && task.priority !== 'medium') {
      const pb = el('span', 'priority-badge priority-' + task.priority);
      pb.textContent = task.priority;
      meta.appendChild(pb);
    }
    if (task.workload && task.workload !== 'normal') {
      const wb = el('span', 'workload-badge workload-' + task.workload);
      wb.textContent = task.workload;
      meta.appendChild(wb);
    }
    if (meta.childNodes.length > 0) card.appendChild(meta);

    // Due date
    if (task.dueDate) {
      const due = el('div', 'card-due');
      const today = new Date(); today.setHours(0,0,0,0);
      const dueDate = new Date(task.dueDate + 'T00:00:00');
      const isOverdue = dueDate < today;
      if (isOverdue) due.classList.add('overdue');
      due.textContent = '📅 ' + task.dueDate + (isOverdue ? ' (overdue)' : '');
      card.appendChild(due);
    }

    if (task.description) {
      const desc = el('div', 'card-desc');
      desc.textContent = task.description;
      card.appendChild(desc);
    }

    // Assignee
    if (task.assignee) {
      const assigneeEl = el('div', 'card-assignee');
      assigneeEl.textContent = '👤 ' + task.assignee;
      card.appendChild(assigneeEl);
    }

    if (task.source) {
      const sourceEl = el('div', 'card-source');
      sourceEl.textContent = '↗ ' + task.source;
      sourceEl.title = 'Use the source button to open this file';
      card.appendChild(sourceEl);
    }

    // Subtasks - only show progress count
    if (task.subtasks && task.subtasks.length > 0) {
      const doneCount = task.subtasks.filter(s => s.done).length;
      const prog = el('div', 'subtask-progress');
      prog.textContent = '✓ ' + doneCount + '/' + task.subtasks.length + ' subtasks';
      card.appendChild(prog);
    }

    if (task.tags && task.tags.length > 0) {
      const tagsEl = el('div', 'card-tags');
      for (const tag of task.tags) {
        const tagEl = el('span', 'tag');
        tagEl.textContent = tag;
        tagsEl.appendChild(tagEl);
      }
      card.appendChild(tagsEl);
    }

    // Overlay actions
    const overlay = el('div', 'card-overlay');
    if (task.source) {
      const sourceBtn = el('button', 'card-action action-source');
      sourceBtn.textContent = '↗';
      sourceBtn.title = 'Open source';
      sourceBtn.onclick = (e) => {
        e.stopPropagation();
        openSource(task.source);
      };
      overlay.appendChild(sourceBtn);
    }

    const editBtn = el('button');
    editBtn.textContent = '✎';
    editBtn.title = 'Edit task';
    editBtn.onclick = (e) => { e.stopPropagation(); openTaskModal(task, columnName); };
    overlay.appendChild(editBtn);

    if (boardConfig.canArchiveCards !== false) {
      const archiveBtn = el('button', 'card-action action-archive');
      archiveBtn.textContent = '⇩';
      archiveBtn.title = 'Archive task';
      archiveBtn.onclick = (e) => {
        e.stopPropagation();
        archiveTask(task, columnName);
      };
      overlay.appendChild(archiveBtn);
    }

    const delBtn = el('button', 'card-action action-delete');
    delBtn.textContent = '🗑';
    delBtn.title = 'Delete task';
    delBtn.onclick = (e) => {
      e.stopPropagation();
      deleteTask(task);
    };
    overlay.appendChild(delBtn);

    card.appendChild(overlay);
    return card;
  }

  function openTaskDetailsModal(task, columnName) {
    const overlay = el('div', 'modal-overlay');
    const modal = el('div', 'modal');

    const header = el('div', 'modal-header');
    const heading = el('h2');
    heading.textContent = task.title;
    header.appendChild(heading);

    const closeBtn = el('button', 'modal-icon-btn');
    closeBtn.textContent = '×';
    closeBtn.title = 'Close';
    closeBtn.onclick = () => overlay.remove();
    header.appendChild(closeBtn);
    modal.appendChild(header);

    appendDetail(modal, 'Column', columnName);
    if (task.group) appendDetail(modal, 'Group', task.group);

    const metaValues = [];
    metaValues.push('Priority: ' + formatFilterLabel(task.priority || 'medium'));
    metaValues.push('Workload: ' + formatFilterLabel(task.workload || 'normal'));
    if (task.dueDate) metaValues.push('Due: ' + task.dueDate);
    if (task.assignee) metaValues.push('Assignee: ' + task.assignee);
    if (task.source) metaValues.push('Source: ' + task.source);
    appendDetail(modal, 'Details', metaValues.join('\n'));

    appendDetail(modal, 'Description', task.description || '', 'No description');

    if (task.tags && task.tags.length > 0) {
      const section = detailSection('Tags');
      const tags = el('div', 'detail-tags');
      for (const tag of task.tags) {
        const tagEl = el('span', 'tag');
        tagEl.textContent = tag;
        tags.appendChild(tagEl);
      }
      section.appendChild(tags);
      modal.appendChild(section);
    }

    if (task.subtasks && task.subtasks.length > 0) {
      const section = detailSection('Subtasks');
      const list = el('div', 'detail-subtasks');
      for (const subtask of task.subtasks) {
        const row = el('div', 'detail-subtask' + (subtask.done ? ' done' : ''));
        const mark = el('span');
        mark.textContent = subtask.done ? '✓' : '□';
        row.appendChild(mark);
        const title = el('span');
        title.textContent = subtask.title;
        row.appendChild(title);
        list.appendChild(row);
      }
      section.appendChild(list);
      modal.appendChild(section);
    }

    const actions = el('div', 'modal-actions');
    const editBtn = el('button', 'secondary');
    editBtn.textContent = 'Edit';
    editBtn.onclick = () => {
      overlay.remove();
      openTaskModal(task, columnName);
    };
    actions.appendChild(editBtn);

    if (task.source) {
      const sourceBtn = el('button', 'secondary');
      sourceBtn.textContent = 'Open Source';
      sourceBtn.onclick = () => openSource(task.source);
      actions.appendChild(sourceBtn);
    }

    if (boardConfig.canArchiveCards !== false) {
      const archiveBtn = el('button', 'archive-action');
      archiveBtn.textContent = 'Archive';
      archiveBtn.onclick = () => {
        archiveTask(task, columnName, () => overlay.remove());
      };
      actions.appendChild(archiveBtn);
    }

    const deleteBtn = el('button', 'danger');
    deleteBtn.textContent = 'Delete';
    deleteBtn.onclick = () => {
      deleteTask(task, () => overlay.remove());
    };
    actions.appendChild(deleteBtn);
    modal.appendChild(actions);

    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  function openTaskDetailsById(taskId) {
    const found = findTaskWithColumn(taskId);
    if (!found) {
      showNotice('Card was not found on this board.', false);
      return;
    }

    document.querySelectorAll('.modal-overlay').forEach(overlay => overlay.remove());
    render();
    const cardEl = document.querySelector('[data-task-id="' + cssEscape(taskId) + '"]');
    if (cardEl) {
      cardEl.scrollIntoView({ block: 'center', inline: 'center' });
    }
    openTaskDetailsModal(found.task, found.column.name);
  }

  function findTaskWithColumn(taskId) {
    for (const column of board.columns) {
      const task = column.tasks.find(task => task.id === taskId);
      if (task) {
        return { task, column };
      }
    }
    return undefined;
  }

  function archiveTask(task, columnName, afterArchive) {
    requestConfirmation('archiveCard', {
      title: 'Archive Card',
      message: 'Archive "' + task.title + '" to archive.kanban.md?',
      confirmText: 'Archive',
      danger: false,
    }, () => {
      vscode.postMessage({
        type: 'archiveTask',
        taskId: task.id,
        task,
        taskIndex: getTaskIndex(columnName, task.id),
        fromColumn: columnName,
      });
      if (afterArchive) afterArchive();
    });
  }

  function deleteTask(task, afterDelete) {
    requestConfirmation('deleteTask', {
      title: 'Delete Card',
      message: 'Delete "' + task.title + '"?',
      confirmText: 'Delete',
      danger: true,
    }, () => {
      vscode.postMessage({ type: 'deleteTask', taskId: task.id });
      if (afterDelete) afterDelete();
    });
  }

  function openSource(source) {
    vscode.postMessage({ type: 'openSource', source });
  }

  function requestConfirmation(kind, options, onConfirm) {
    if (confirmationPrefs[kind]) {
      onConfirm();
      return;
    }

    openConfirmationModal({
      title: options.title,
      message: options.message,
      confirmText: options.confirmText,
      danger: options.danger,
      onConfirm: (remember) => {
        if (remember) {
          confirmationPrefs[kind] = true;
          persistState();
        }
        onConfirm();
      },
    });
  }

  function openConfirmationModal(options) {
    const overlay = el('div', 'modal-overlay');
    const modal = el('div', 'modal confirm-modal');

    const title = el('h2');
    title.textContent = options.title;
    modal.appendChild(title);

    const message = el('div', 'confirm-message');
    message.textContent = options.message;
    modal.appendChild(message);

    const rememberLabel = el('label', 'remember-row');
    const rememberInput = document.createElement('input');
    rememberInput.type = 'checkbox';
    rememberLabel.appendChild(rememberInput);
    const rememberText = el('span');
    rememberText.textContent = 'Do not ask again for this action';
    rememberLabel.appendChild(rememberText);
    modal.appendChild(rememberLabel);

    const actions = el('div', 'modal-actions');
    const cancelBtn = el('button', 'secondary');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => overlay.remove();
    actions.appendChild(cancelBtn);

    const confirmBtn = el('button', options.danger ? 'danger' : '');
    confirmBtn.type = 'button';
    confirmBtn.textContent = options.confirmText;
    confirmBtn.onclick = () => {
      const remember = rememberInput.checked;
      overlay.remove();
      options.onConfirm(remember);
    };
    actions.appendChild(confirmBtn);
    modal.appendChild(actions);

    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    setTimeout(() => confirmBtn.focus(), 50);
  }

  function appendDetail(modal, label, value, emptyText) {
    const section = detailSection(label);
    const text = el('div', 'detail-text' + (value ? '' : ' detail-empty'));
    text.textContent = value || emptyText || '';
    section.appendChild(text);
    modal.appendChild(section);
  }

  function getTaskIndex(columnName, taskId) {
    const column = board.columns.find(col => col.name === columnName);
    return column ? column.tasks.findIndex(item => item.id === taskId) : -1;
  }

  function detailSection(label) {
    const section = el('div', 'detail-section');
    const labelEl = el('span', 'detail-label');
    labelEl.textContent = label;
    section.appendChild(labelEl);
    return section;
  }

  function getDropIndex(body, clientY) {
    const cards = getDropCards(body);
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        return i;
      }
    }
    return cards.length;
  }

  function updateDropIndicator(body, clientY) {
    removeDropIndicators(document);
    const cards = getDropCards(body);
    const indicator = el('div', 'drop-indicator');

    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        body.insertBefore(indicator, cards[i]);
        return;
      }
    }
    // Insert before the add button
    const endZone = body.querySelector('.column-end-drop-zone');
    if (endZone) {
      endZone.appendChild(indicator);
    } else {
      body.appendChild(indicator);
    }
  }

  function updateEndDropIndicator(container) {
    removeDropIndicators(document);
    container.appendChild(el('div', 'drop-indicator'));
  }

  function removeDropIndicators(container) {
    container.querySelectorAll('.drop-indicator').forEach(el => el.remove());
  }

  function getDropCards(container) {
    return Array.from(container.children).filter(child =>
      child.classList.contains('card') && !child.classList.contains('dragging')
    );
  }

  function getTaskPlacement(taskIds, dropIndex) {
    if (dropIndex < taskIds.length) {
      return { beforeTaskId: taskIds[dropIndex] };
    }
    if (taskIds.length > 0) {
      return { afterTaskId: taskIds[taskIds.length - 1] };
    }
    return {};
  }

  function getLastTaskId(tasks, draggedTaskId) {
    const task = [...tasks].reverse().find(t => t.id !== draggedTaskId);
    return task ? task.id : undefined;
  }

  function getGroupBlocks(container) {
    return Array.from(container.children).filter(child =>
      child.classList.contains('task-group') && !child.classList.contains('dragging')
    );
  }

  function getGroupDropIndex(body, clientY) {
    const groups = getGroupBlocks(body);
    for (let i = 0; i < groups.length; i++) {
      const rect = groups[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        return i;
      }
    }
    return groups.length;
  }

  function updateGroupDropIndicator(body, clientY) {
    removeDropIndicators(document);
    const groups = getGroupBlocks(body);
    const indicator = el('div', 'drop-indicator');

    for (let i = 0; i < groups.length; i++) {
      const rect = groups[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        body.insertBefore(indicator, groups[i]);
        return;
      }
    }

    const ungroupedZone = body.querySelector('.ungrouped-zone');
    if (ungroupedZone) {
      body.insertBefore(indicator, ungroupedZone);
    } else {
      body.appendChild(indicator);
    }
  }

  function moveGroupTo(body, columnName, clientY) {
    if (!dragData || dragData.type !== 'group') return;
    vscode.postMessage({
      type: 'moveGroup',
      group: dragData.group,
      fromColumn: dragData.fromColumn,
      toColumn: columnName,
      toGroupIndex: getGroupDropIndex(body, clientY),
    });
  }

  function clearDragState() {
    dragData = null;
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    document.querySelectorAll('.group-drop-target').forEach(el => el.classList.remove('group-drop-target'));
    document.querySelectorAll('.drop-indicator').forEach(el => el.remove());
    document.querySelectorAll('.column-drop-indicator').forEach(el => el.remove());
  }

  function getColumnBlocks(boardEl) {
    return Array.from(boardEl.children).filter(child =>
      child.classList.contains('column') && !child.classList.contains('dragging')
    );
  }

  function getColumnDropIndex(boardEl, clientX) {
    const columns = getColumnBlocks(boardEl);
    for (let i = 0; i < columns.length; i++) {
      const rect = columns[i].getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) {
        return i;
      }
    }
    return columns.length;
  }

  function updateColumnDropIndicator(boardEl, clientX) {
    removeColumnDropIndicator(boardEl);
    const columns = getColumnBlocks(boardEl);
    const indicator = el('div', 'column-drop-indicator');

    for (let i = 0; i < columns.length; i++) {
      const rect = columns[i].getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) {
        boardEl.insertBefore(indicator, columns[i]);
        return;
      }
    }

    const addColumn = boardEl.querySelector('.add-column-placeholder');
    if (addColumn) {
      boardEl.insertBefore(indicator, addColumn);
    } else {
      boardEl.appendChild(indicator);
    }
  }

  function removeColumnDropIndicator(container) {
    container.querySelectorAll('.column-drop-indicator').forEach(el => el.remove());
  }

  // --- Modals ---

  function openTaskModal(existingTask, columnName) {
    const overlay = el('div', 'modal-overlay');
    const modal = el('div', 'modal');

    const heading = el('h2');
    heading.textContent = existingTask ? 'Edit Task' : 'Add Task';
    modal.appendChild(heading);

    modal.appendChild(labelEl('Title'));
    const titleInput = el('input');
    titleInput.type = 'text';
    titleInput.value = existingTask ? existingTask.title : '';
    titleInput.placeholder = 'Task title...';
    modal.appendChild(titleInput);

    modal.appendChild(labelEl('Description'));
    const descInput = el('textarea');
    descInput.value = existingTask ? existingTask.description : '';
    descInput.placeholder = 'Optional description...';
    modal.appendChild(descInput);

    // Assignee & Group row
    const row0 = el('div', 'form-row');

    const assCol = el('div', 'form-col');
    assCol.appendChild(labelEl('Assignee'));
    const assigneeInput = el('input');
    assigneeInput.type = 'text';
    assigneeInput.value = existingTask ? (existingTask.assignee || '') : '';
    assigneeInput.placeholder = 'Username...';
    assCol.appendChild(assigneeInput);
    row0.appendChild(assCol);

    const grpCol = el('div', 'form-col');
    grpCol.appendChild(labelEl('Group'));
    const groupInput = el('input');
    groupInput.type = 'text';
    groupInput.value = existingTask ? (existingTask.group || '') : '';
    groupInput.placeholder = 'e.g. login, auth...';
    groupInput.setAttribute('list', 'group-name-options');
    grpCol.appendChild(groupInput);

    const groupOptions = document.createElement('datalist');
    groupOptions.id = 'group-name-options';
    for (const name of getGroupOptions()) {
      const option = document.createElement('option');
      option.value = name;
      groupOptions.appendChild(option);
    }
    grpCol.appendChild(groupOptions);
    row0.appendChild(grpCol);

    modal.appendChild(row0);

    // Priority & Workload row
    const row1 = el('div', 'form-row');

    const priCol = el('div', 'form-col');
    priCol.appendChild(labelEl('Priority'));
    const priSelect = document.createElement('select');
    [{v:'critical',l:'🔴 Critical'},{v:'high',l:'🟠 High'},{v:'medium',l:'🔵 Medium'},{v:'low',l:'🟢 Low'}].forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.v; opt.textContent = o.l;
      priSelect.appendChild(opt);
    });
    priSelect.value = existingTask ? (existingTask.priority || 'medium') : 'medium';
    priCol.appendChild(priSelect);
    row1.appendChild(priCol);

    const wlCol = el('div', 'form-col');
    wlCol.appendChild(labelEl('Workload'));
    const wlSelect = document.createElement('select');
    [{v:'easy',l:'🟢 Easy'},{v:'normal',l:'🔵 Normal'},{v:'hard',l:'🟠 Hard'},{v:'extreme',l:'🔴 Extreme'}].forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.v; opt.textContent = o.l;
      wlSelect.appendChild(opt);
    });
    wlSelect.value = existingTask ? (existingTask.workload || 'normal') : 'normal';
    wlCol.appendChild(wlSelect);
    row1.appendChild(wlCol);

    modal.appendChild(row1);

    // Due date
    modal.appendChild(labelEl('Due Date'));
    const dueDateInput = el('input');
    dueDateInput.type = 'date';
    dueDateInput.value = existingTask ? (existingTask.dueDate || '') : '';
    modal.appendChild(dueDateInput);

    modal.appendChild(labelEl('Source'));
    const sourceInput = el('input');
    sourceInput.type = 'text';
    sourceInput.value = existingTask ? (existingTask.source || '') : '';
    sourceInput.placeholder = 'src/foo.ts:42';
    modal.appendChild(sourceInput);

    // Subtasks
    modal.appendChild(labelEl('Subtasks'));
    const subtasksList = el('div', 'subtasks-list');
    let subtasks = existingTask ? (existingTask.subtasks || []).map(s => ({...s})) : [];

    function renderSubtasks() {
      subtasksList.innerHTML = '';
      subtasks.forEach((st, i) => {
        const row = el('div', 'subtask-row');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = st.done;
        cb.onchange = () => { subtasks[i].done = cb.checked; };
        row.appendChild(cb);

        const inp = document.createElement('input');
        inp.type = 'text';
        inp.value = st.title;
        inp.placeholder = 'Subtask...';
        inp.oninput = () => { subtasks[i].title = inp.value; };
        row.appendChild(inp);

        const delBtn = el('button', 'danger');
        delBtn.textContent = '✕';
        delBtn.onclick = () => {
          requestConfirmation('deleteSubtask', {
            title: 'Delete Subtask',
            message: 'Delete "' + st.title + '"?',
            confirmText: 'Delete',
            danger: true,
          }, () => {
            subtasks.splice(i, 1);
            renderSubtasks();
          });
        };
        row.appendChild(delBtn);

        subtasksList.appendChild(row);
      });
    }
    renderSubtasks();
    modal.appendChild(subtasksList);

    const addStBtn = el('button', 'add-subtask-btn');
    addStBtn.textContent = '+ Add Subtask';
    addStBtn.onclick = () => {
      subtasks.push({ title: '', done: false });
      renderSubtasks();
      const inputs = subtasksList.querySelectorAll('input[type="text"]');
      if (inputs.length > 0) inputs[inputs.length - 1].focus();
    };
    modal.appendChild(addStBtn);

    modal.appendChild(labelEl('Tags (comma-separated)'));
    const tagsInput = el('input');
    tagsInput.type = 'text';
    tagsInput.value = existingTask ? existingTask.tags.join(', ') : '';
    tagsInput.placeholder = 'bug, feature, urgent';
    modal.appendChild(tagsInput);

    const tagOptions = getFilterOptions().tags;
    const tagSuggestions = el('div', 'tag-suggestions');
    const tagChips = [];
    for (const tag of tagOptions) {
      const chip = el('button', 'tag-suggestion');
      chip.type = 'button';
      chip.textContent = tag;
      chip.title = 'Add or remove this tag';
      chip.onclick = () => {
        const current = parseTagInput(tagsInput.value);
        const index = current.indexOf(tag);
        if (index === -1) {
          current.push(tag);
        } else {
          current.splice(index, 1);
        }
        tagsInput.value = current.join(', ');
        syncTagChips();
      };
      tagChips.push({ tag, chip });
      tagSuggestions.appendChild(chip);
    }

    function syncTagChips() {
      const current = parseTagInput(tagsInput.value);
      for (const entry of tagChips) {
        entry.chip.classList.toggle('active', current.indexOf(entry.tag) !== -1);
      }
    }

    if (tagOptions.length > 0) {
      tagsInput.addEventListener('input', syncTagChips);
      syncTagChips();
      modal.appendChild(tagSuggestions);
    }

    const actions = el('div', 'modal-actions');
    const cancelBtn = el('button', 'secondary');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => overlay.remove();
    actions.appendChild(cancelBtn);

    const saveBtn = el('button');
    saveBtn.textContent = existingTask ? 'Save' : 'Add';
    saveBtn.onclick = () => {
      const title = titleInput.value.trim();
      if (!title) { titleInput.focus(); return; }
      const tags = tagsInput.value
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0);
      const validSubtasks = subtasks.filter(s => s.title.trim().length > 0)
        .map(s => ({ title: s.title.trim(), done: s.done }));

      if (existingTask) {
        vscode.postMessage({
          type: 'editTask',
          taskId: existingTask.id,
          title,
          description: descInput.value.trim(),
          tags,
          priority: priSelect.value,
          workload: wlSelect.value,
          dueDate: dueDateInput.value,
          subtasks: validSubtasks,
          assignee: assigneeInput.value.trim(),
          source: sourceInput.value.trim(),
          group: groupInput.value.trim(),
        });
      } else {
        vscode.postMessage({
          type: 'addTask',
          column: columnName,
          title,
          description: descInput.value.trim(),
          tags,
          priority: priSelect.value,
          workload: wlSelect.value,
          dueDate: dueDateInput.value,
          subtasks: validSubtasks,
          assignee: assigneeInput.value.trim(),
          source: sourceInput.value.trim(),
          group: groupInput.value.trim(),
        });
      }
      overlay.remove();
    };
    actions.appendChild(saveBtn);
    modal.appendChild(actions);

    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    setTimeout(() => titleInput.focus(), 50);
  }

  function renameBoard() {
    const newTitle = prompt('Board title:', board.title);
    if (newTitle && newTitle.trim()) {
      vscode.postMessage({ type: 'updateTitle', title: newTitle.trim() });
      board.title = newTitle.trim();
      render();
    }
  }

  function renameColumn(oldName) {
    const newName = prompt('Column name:', oldName);
    if (newName && newName.trim() && newName.trim() !== oldName) {
      vscode.postMessage({ type: 'renameColumn', oldName, newName: newName.trim() });
    }
  }

  function openGroupModal(columnName, oldName) {
    const overlay = el('div', 'modal-overlay');
    const modal = el('div', 'modal');
    const title = el('h2');
    title.textContent = 'Rename Group';
    modal.appendChild(title);

    modal.appendChild(labelEl('Group name'));
    const input = el('input');
    input.type = 'text';
    input.value = oldName;
    input.placeholder = 'Group name';
    modal.appendChild(input);

    const actions = el('div', 'modal-actions');
    const cancelBtn = el('button', 'secondary');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.type = 'button';
    cancelBtn.onclick = () => overlay.remove();
    actions.appendChild(cancelBtn);

    const saveBtn = el('button');
    saveBtn.textContent = 'Save';
    saveBtn.type = 'button';
    saveBtn.onclick = () => {
      const newName = input.value.trim();
      if (!newName) {
        input.focus();
        return;
      }
      if (newName !== oldName) {
        vscode.postMessage({ type: 'renameGroup', oldName, newName, column: columnName });
      }
      overlay.remove();
    };
    actions.appendChild(saveBtn);
    modal.appendChild(actions);

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveBtn.click();
      } else if (e.key === 'Escape') {
        overlay.remove();
      }
    });

    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    setTimeout(() => {
      input.focus();
      input.select();
    }, 50);
  }

  function addColumn(button) {
    const overlay = el('div', 'modal-overlay');
    const modal = el('div', 'modal');
    const title = el('h2');
    title.textContent = 'Add Column';
    modal.appendChild(title);

    const field = el('div', 'modal-field');
    const label = labelEl('Column name:');
    const input = el('input');
    input.type = 'text';
    input.placeholder = 'Enter column name';
    input.style.width = '100%';
    field.appendChild(label);
    field.appendChild(input);
    modal.appendChild(field);

    const actions = el('div', 'modal-actions');
    const cancelBtn = el('button', 'secondary');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.type = 'button';
    cancelBtn.onclick = () => overlay.remove();
    actions.appendChild(cancelBtn);

    const addBtn = el('button');
    addBtn.textContent = 'Add Column';
    addBtn.type = 'button';
    addBtn.onclick = () => {
      const name = input.value.trim();
      if (!name) {
        alert('Column name cannot be empty.');
        input.focus();
        return;
      }
      if (board.columns.some(c => c.name === name)) {
        alert('A column with that name already exists.');
        input.focus();
        return;
      }
      board.columns.push({ name, tasks: [] });
      render();
      vscode.postMessage({ type: 'addColumn', name });
      overlay.remove();
    };
    actions.appendChild(addBtn);

    modal.appendChild(actions);
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const rect = button.getBoundingClientRect();
    modal.style.position = 'absolute';
    modal.style.top = (Math.min(rect.bottom + 10, window.innerHeight - modal.offsetHeight - 10)) + 'px';
    modal.style.left = (Math.min(rect.left, window.innerWidth - modal.offsetWidth - 10)) + 'px';

    setTimeout(() => input.focus(), 50);
  }

  // --- Helpers ---

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

  // Listen for board updates from extension
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'boardUpdate') {
      board = msg.board;
      render();
    } else if (msg.type === 'openTaskDetails') {
      openTaskDetailsById(msg.taskId);
    } else if (msg.type === 'archiveResult') {
      showNotice(msg.message || (msg.ok ? 'Archived card.' : 'Could not archive card.'), msg.ok);
    }
  });

  function showNotice(message, ok) {
    const existing = document.querySelector('.board-notice');
    if (existing) existing.remove();

    const notice = el('div', 'board-notice' + (ok ? '' : ' error'));
    notice.textContent = message;
    document.body.appendChild(notice);
    window.setTimeout(() => notice.remove(), 3000);
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }
    return String(value).replace(/["\\]/g, '\\$&');
  }

  // Initial render
  render();
})();
