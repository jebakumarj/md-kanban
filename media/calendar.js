(function() {
  const vscode = acquireVsCodeApi();
  const data = JSON.parse(document.getElementById('calendar-data').textContent || '{}');

  if (data.mode === 'timeline') {
    renderTimeline();
  } else {
    renderCalendar();
  }

  function renderTimeline() {
    const timeline = document.getElementById('timeline');
    const visibleBuckets = (data.buckets || []).filter(bucket => bucket.tasks.length > 0);
    if (visibleBuckets.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No upcoming dated cards.';
      timeline.appendChild(empty);
    }

    for (const bucket of visibleBuckets) {
      const section = document.createElement('details');
      section.className = 'bucket';
      section.open = true;

      const summary = document.createElement('summary');

      const label = document.createElement('span');
      label.className = 'bucket-label';
      label.textContent = bucket.label;
      summary.appendChild(label);

      const count = document.createElement('span');
      count.className = 'bucket-count';
      count.textContent = String(bucket.tasks.length);
      summary.appendChild(count);
      section.appendChild(summary);

      const list = document.createElement('ul');
      list.className = 'task-list';

      for (const task of bucket.tasks) {
        const row = document.createElement('li');
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'task-row';
        item.title = task.title + '\n' + task.boardTitle + '\n' + task.dueDate;
        item.addEventListener('click', () => {
          vscode.postMessage({ type: 'openTask', taskId: task.taskId });
        });

        const icon = document.createElement('span');
        icon.className = 'task-icon';
        icon.textContent = '-';
        item.appendChild(icon);

        const content = document.createElement('span');
        content.className = 'task-content';

        const taskTitle = document.createElement('div');
        taskTitle.className = 'task-title';
        taskTitle.textContent = task.title;
        content.appendChild(taskTitle);

        const meta = document.createElement('div');
        meta.className = 'task-meta';
        meta.textContent = task.dueDate + ' • ' + task.columnName + ' • ' + task.boardTitle;
        content.appendChild(meta);

        item.appendChild(content);
        row.appendChild(item);
        list.appendChild(row);
      }

      section.appendChild(list);
      timeline.appendChild(section);
    }
  }

  function renderCalendar() {
    document.getElementById('month-title').textContent = data.monthLabel;
    const grid = document.getElementById('calendar-grid');
    const cells = data.cells || [];
    const hasVisibleTasks = cells.some(cell => cell.inMonth && cell.count > 0);
    document.getElementById('empty-state').hidden = hasVisibleTasks;

    for (const cell of cells) {
      const day = document.createElement('button');
      day.type = 'button';
      day.className = 'day' + (cell.inMonth ? '' : ' other-month') + (cell.isToday ? ' today' : '') + (cell.count > 0 ? ' has-tasks' : '');
      day.title = cell.tooltip || cell.date;
      day.disabled = cell.count === 0;
      day.addEventListener('click', () => {
        if (cell.count > 0) {
          vscode.postMessage({ type: 'openDate', date: cell.date });
        }
      });

      const number = document.createElement('div');
      number.className = 'day-number';
      number.textContent = String(cell.day);
      day.appendChild(number);

      if (cell.count > 0) {
        const dot = document.createElement('span');
        dot.className = 'task-dot' + (cell.overdueCount > 0 ? ' overdue' : '');
        day.appendChild(dot);

        const count = document.createElement('span');
        count.className = 'task-count';
        count.textContent = String(cell.count);
        day.appendChild(count);
      }

      grid.appendChild(day);
    }

    document.querySelectorAll('[data-action]').forEach(button => {
      button.addEventListener('click', () => {
        vscode.postMessage({ type: button.dataset.action });
      });
    });
  }
}());
