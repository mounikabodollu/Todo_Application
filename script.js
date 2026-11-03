(() => {
  "use strict";

  const STORAGE_KEYS = { tasks: "taskflow.tasks.v1", lists: "taskflow.lists.v1", theme: "taskflow.theme.v1", username: "taskflow.username.v1" };
  const DEFAULT_LISTS = [
    { id: "personal", name: "Personal" },
    { id: "work", name: "Work" },
    { id: "college", name: "College" }
  ];
  const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const elements = {
    sidebar: $("#sidebar"), sidebarScrim: $("#sidebarScrim"), taskModal: $("#taskModal"), listModal: $("#listModal"), profileModal: $("#profileModal"),
    taskForm: $("#taskForm"), listForm: $("#listForm"), taskList: $("#taskList"), listNav: $("#listNav"),
    mainTaskList: $("#mainTaskList"), todayTaskList: $("#todayTaskList"), upcomingList: $("#upcomingList"),
    toastRegion: $("#toastRegion"), searchInput: $("#searchInput")
  };
  let tasks = loadArray(STORAGE_KEYS.tasks, []);
  let lists = loadArray(STORAGE_KEYS.lists, DEFAULT_LISTS);
  let theme = localStorage.getItem(STORAGE_KEYS.theme) === "dark" ? "dark" : "light";
  let username = localStorage.getItem(STORAGE_KEYS.username) || "";
  let currentView = "dashboard";
  let currentFilter = "all";
  let currentListId = null;
  let searchTerm = "";
  let sortMode = "newest";
  let toastTimer;

  function loadArray(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      return Array.isArray(value) ? value : fallback.map(item => ({ ...item }));
    } catch (error) {
      console.error(`Unable to read ${key} from localStorage.`, error);
      return fallback.map(item => ({ ...item }));
    }
  }

  function persist(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error(`Unable to save ${key} to localStorage.`, error);
      showToast("Couldn't save changes. Check your browser storage.", true);
    }
  }

  function uid() {
    return globalThis.crypto?.randomUUID?.() || `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function localDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function dateFromString(value) {
    if (!value) return null;
    const [year, month, day] = value.split("-").map(Number);
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
  }

  function formatDate(value, options = { month: "short", day: "numeric" }) {
    const date = dateFromString(value);
    return date ? new Intl.DateTimeFormat(undefined, options).format(date) : "";
  }

  function isOverdue(task) {
    if (task.completed || !task.dueDate) return false;
    const today = localDateString();
    return task.dueDate < today || (task.dueDate === today && task.dueTime && task.dueTime < new Date().toTimeString().slice(0, 5));
  }

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  function listName(id) {
    return lists.find(list => list.id === id)?.name || "Personal";
  }

  function showToast(message, isError = false) {
    const toast = document.createElement("div");
    toast.className = `toast${isError ? " error" : ""}`;
    toast.innerHTML = `<svg class="icon"><use href="#${isError ? "i-close" : "i-done"}"></use></svg><span>${escapeHtml(message)}</span>`;
    elements.toastRegion.append(toast);
    window.setTimeout(() => toast.remove(), 3200);
  }

  function applyTheme() {
    document.body.classList.toggle("dark", theme === "dark");
    const icon = theme === "dark" ? "i-sun" : "i-moon";
    ["#themeButton", "#profileThemeButton"].forEach(selector => {
      const button = $(selector);
      $("use", button).setAttribute("href", `#${icon}`);
      button.setAttribute("aria-label", `Switch to ${theme === "dark" ? "light" : "dark"} mode`);
    });
    $("#settingsThemeButton").textContent = `Switch to ${theme === "dark" ? "light" : "dark"} mode`;
    document.querySelector('meta[name="theme-color"]').content = theme === "dark" ? "#171824" : "#f5f6fb";
  }

  function toggleTheme() {
    theme = theme === "dark" ? "light" : "dark";
    localStorage.setItem(STORAGE_KEYS.theme, theme);
    applyTheme();
  }

  function renderUsername() {
    const displayName = username.trim();
    $("#profileName").textContent = displayName || "Your name";
    $("#profileAvatar").textContent = displayName ? Array.from(displayName)[0].toLocaleUpperCase() : "Y";
    $("#welcomeName").textContent = displayName || "there";
  }

  function openProfileModal() {
    $("#usernameInput").value = username;
    elements.profileModal.showModal();
    $("#usernameInput").focus();
  }

  function saveUsername(event) {
    event.preventDefault();
    const name = $("#usernameInput").value.trim();
    if (!name) {
      $("#usernameInput").focus();
      showToast("Please enter a username.", true);
      return;
    }
    username = name;
    try {
      localStorage.setItem(STORAGE_KEYS.username, username);
    } catch (error) {
      console.error("Unable to save the username to localStorage.", error);
      showToast("Couldn't save your username. Check your browser storage.", true);
      return;
    }
    renderUsername();
    elements.profileModal.close();
    showToast("Username updated.");
  }

  function renderLists() {
    elements.listNav.innerHTML = lists.map(list => {
      const count = tasks.filter(task => task.listId === list.id && !task.completed).length;
      return `<button class="nav-link list-link${currentView === "list" && currentListId === list.id ? " active" : ""}" data-list-id="${escapeHtml(list.id)}"><i class="list-color"></i><span>${escapeHtml(list.name)}</span><span class="list-number">${count}</span></button>`;
    }).join("");
    elements.taskList.innerHTML = lists.map(list => `<option value="${escapeHtml(list.id)}">${escapeHtml(list.name)}</option>`).join("");
    $("#allNavCount").textContent = tasks.filter(task => !task.completed).length;
    renderManagedLists();
  }

  function renderManagedLists() {
    const target = $("#manageListItems");
    target.innerHTML = lists.map(list => {
      const count = tasks.filter(task => task.listId === list.id).length;
      return `<div class="managed-list-row"><i class="list-color"></i><span>${escapeHtml(list.name)}</span><small>${count} task${count === 1 ? "" : "s"}</small><button type="button" class="icon-button rename-list" data-list-id="${escapeHtml(list.id)}" aria-label="Rename ${escapeHtml(list.name)}" title="Rename list"><svg class="icon"><use href="#i-edit"></use></svg></button><button type="button" class="icon-button delete-list" data-list-id="${escapeHtml(list.id)}" aria-label="Delete ${escapeHtml(list.name)}" title="Delete list"><svg class="icon"><use href="#i-trash"></use></svg></button></div>`;
    }).join("") || '<p class="welcome-subtitle">No lists yet. Create one to get started.</p>';
  }

  function taskDeadlineMarkup(task) {
    const parts = [];
    if (task.dueDate) {
      const dateLabel = formatDate(task.dueDate, { month: "short", day: "numeric", year: "numeric" });
      parts.push(`<span class="${isOverdue(task) ? "overdue" : ""}"><svg class="icon"><use href="#i-calendar"></use></svg>${escapeHtml(dateLabel)}${isOverdue(task) ? " · overdue" : ""}</span>`);
    }
    if (task.dueTime) parts.push(`<span><svg class="icon"><use href="#i-clock"></use></svg>${escapeHtml(formatTime(task.dueTime))}</span>`);
    parts.push(`<span><i class="category-chip">${escapeHtml(listName(task.listId))}</i></span>`);
    return parts.join("");
  }

  function formatTime(value) {
    const [hour, minute] = value.split(":").map(Number);
    const date = new Date();
    date.setHours(hour, minute, 0, 0);
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  }

  function taskMarkup(task) {
    const priority = ["low", "medium", "high"].includes(task.priority) ? task.priority : "medium";
    return `<article class="task-row${task.completed ? " is-completed" : ""}" data-task-id="${escapeHtml(task.id)}">
      <input class="task-check" type="checkbox" ${task.completed ? "checked" : ""} aria-label="${task.completed ? "Mark incomplete" : "Mark complete"}: ${escapeHtml(task.title)}">
      <div class="task-main"><div class="task-title-line"><span class="task-title">${escapeHtml(task.title)}</span><span class="priority ${priority}">${priority[0].toUpperCase()}${priority.slice(1)}</span>${task.important ? '<svg class="icon important-mark" title="Important" style="color:#e9a43c;width:14px;height:14px;fill:currentColor"><use href="#i-star"></use></svg>' : ""}</div>${task.description ? `<p class="task-description">${escapeHtml(task.description)}</p>` : ""}<div class="task-meta">${taskDeadlineMarkup(task)}</div></div>
      <div class="task-actions"><button class="icon-button important-action${task.important ? " selected" : ""}" data-action="important" aria-label="${task.important ? "Unmark important" : "Mark important"}" title="${task.important ? "Unmark important" : "Mark important"}"><svg class="icon"><use href="#i-star"></use></svg></button><button class="icon-button" data-action="edit" aria-label="Edit task" title="Edit task"><svg class="icon"><use href="#i-edit"></use></svg></button><button class="icon-button" data-action="delete" aria-label="Delete task" title="Delete task"><svg class="icon"><use href="#i-trash"></use></svg></button></div>
    </article>`;
  }

  function emptyMarkup(title, message, buttonText = "Add a task") {
    return `<div class="empty-state"><div class="empty-illustration"><svg class="icon"><use href="#i-checks"></use></svg></div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p><button class="button button-primary empty-add-button"><svg class="icon"><use href="#i-plus"></use></svg>${escapeHtml(buttonText)}</button></div>`;
  }

  function sortTasks(items) {
    const copy = [...items];
    if (sortMode === "oldest") return copy.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
    if (sortMode === "due") return copy.sort((a, b) => (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31") || (a.dueTime || "").localeCompare(b.dueTime || ""));
    if (sortMode === "priority") return copy.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
    return copy.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }

  function matchesSearch(task) {
    const query = searchTerm.trim().toLocaleLowerCase();
    return !query || `${task.title} ${task.description || ""}`.toLocaleLowerCase().includes(query);
  }

  function getCurrentTasks() {
    let items = tasks.filter(matchesSearch);
    if (currentView === "list") items = items.filter(task => task.listId === currentListId);
    else if (currentView === "today") items = items.filter(task => task.dueDate === localDateString());
    else if (currentView === "upcoming") items = items.filter(task => !task.completed && task.dueDate && task.dueDate > localDateString());
    else if (currentView === "completed") items = items.filter(task => task.completed);
    else if (currentView === "important") items = items.filter(task => task.important);
    else if (currentView === "overdue") items = items.filter(isOverdue);
    else if (currentView === "pending") items = items.filter(task => !task.completed);
    if (currentView === "all" || currentView === "list") {
      if (currentFilter === "pending") items = items.filter(task => !task.completed);
      if (currentFilter === "completed") items = items.filter(task => task.completed);
    }
    return sortTasks(items);
  }

  function renderTaskList(container, items, emptyTitle, emptyMessage) {
    container.innerHTML = items.length ? items.map(taskMarkup).join("") : emptyMarkup(emptyTitle, emptyMessage);
  }

  function renderDashboard() {
    const total = tasks.length;
    const completed = tasks.filter(task => task.completed).length;
    const pending = total - completed;
    const overdue = tasks.filter(isOverdue).length;
    const percent = total ? Math.round(completed / total * 100) : 0;
    $("#totalStat").textContent = total;
    $("#completedStat").textContent = completed;
    $("#pendingStat").textContent = pending;
    $("#overdueStat").textContent = overdue;
    $("#completionRate").textContent = `${percent}%`;
    $("#ringPercent").textContent = `${percent}%`;
    $("#ringProgress").style.background = `conic-gradient(var(--accent) ${percent}%, var(--line) ${percent}%)`;
    $("#legendDone").textContent = completed;
    $("#legendPending").textContent = pending;
    $("#todayDate").textContent = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date()).toUpperCase();
    const todaysTasks = tasks.filter(task => task.dueDate === localDateString());
    const todayDone = todaysTasks.filter(task => task.completed).length;
    $("#todayProgress").style.width = `${todaysTasks.length ? Math.round(todayDone / todaysTasks.length * 100) : 0}%`;
    $("#todayProgressLabel").textContent = `${todayDone} / ${todaysTasks.length} done`;
    renderTaskList(elements.todayTaskList, sortTasks(todaysTasks).slice(0, 4), "Nothing on your plate", "Add a task for today and it'll show up here.");
    const upcoming = tasks.filter(task => !task.completed && task.dueDate && task.dueDate >= localDateString()).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || (a.dueTime || "").localeCompare(b.dueTime || "")).slice(0, 3);
    elements.upcomingList.innerHTML = upcoming.length ? upcoming.map(task => {
      const date = dateFromString(task.dueDate);
      return `<div class="deadline-card"><div class="deadline-date"><strong>${date.getDate()}</strong><span>${escapeHtml(new Intl.DateTimeFormat(undefined, { month: "short" }).format(date))}</span></div><div class="deadline-info"><strong>${escapeHtml(task.title)}</strong><span>${escapeHtml(listName(task.listId))}${task.dueTime ? ` · ${escapeHtml(formatTime(task.dueTime))}` : ""}</span></div></div>`;
    }).join("") : emptyMarkup("No upcoming deadlines", "Tasks with a future due date will appear here.", "Plan a task");
  }

  const viewLabels = { dashboard: "Dashboard", all: "My Tasks", today: "Today's Tasks", upcoming: "Upcoming Tasks", completed: "Completed Tasks", important: "Important Tasks", overdue: "Overdue Tasks", pending: "Pending Tasks", settings: "Settings", list: "" };
  function showView(view, listId = null) {
    currentView = view;
    currentListId = listId;
    const isDashboard = view === "dashboard";
    const isSettings = view === "settings";
    $("#dashboardView").classList.toggle("hidden", !isDashboard);
    $("#settingsView").classList.toggle("hidden", !isSettings);
    $("#tasksView").classList.toggle("hidden", isDashboard || isSettings);
    $$(".nav-link[data-view]").forEach(link => link.classList.toggle("active", link.dataset.view === view));
    $$(".list-link").forEach(link => link.classList.toggle("active", view === "list" && link.dataset.listId === listId));
    const title = view === "list" ? listName(listId) : viewLabels[view] || "My Tasks";
    $("#breadcrumbCurrent").textContent = title;
    $("#tasksHeading").textContent = title;
    $("#listEyebrow").textContent = view === "list" ? "YOUR LIST" : "YOUR WORKSPACE";
    $("#tasksSubheading").textContent = view === "list" ? `A focused view of your ${title} tasks.` : getSubheading(view);
    $("#filterTabs").classList.toggle("hidden", !["all", "list"].includes(view));
    $("#clearCompletedButton").classList.toggle("hidden", view !== "completed" && view !== "all" && view !== "list");
    if (!["all", "list"].includes(view)) currentFilter = "all";
    $$(".filter-tab").forEach(tab => tab.classList.toggle("active", tab.dataset.filter === currentFilter));
    elements.sidebar.classList.remove("open");
    elements.sidebarScrim.classList.remove("visible");
    renderCurrentView();
  }

  function getSubheading(view) {
    return ({
      all: "All your tasks, in one place.", today: "Focus on what needs to get done today.",
      upcoming: "A clear view of what's coming up.", completed: "Look at everything you've accomplished.",
      important: "The tasks that matter most.", overdue: "Let's get these back on track.", pending: "Everything still on your plate."
    })[view] || "All your tasks, in one place.";
  }

  function renderCurrentView() {
    renderLists();
    if (currentView === "dashboard") renderDashboard();
    if (!["dashboard", "settings"].includes(currentView)) {
      const descriptions = {
        all: ["You're all caught up", "Create a task to get your day moving."],
        list: ["This list is looking fresh", "Add a task to this list when you're ready."],
        today: ["A clear day ahead", "Tasks due today will show up here."],
        upcoming: ["No deadlines on the horizon", "Add a future due date to plan ahead."],
        completed: ["Nothing completed just yet", "Finished tasks will find their way here."],
        important: ["No important tasks yet", "Mark a task with a star to find it here."],
        overdue: ["You're right on track", "There are no overdue tasks."],
        pending: ["All done for now", "New tasks you haven't finished will appear here."]
      };
      const [title, message] = descriptions[currentView] || descriptions.all;
      renderTaskList(elements.mainTaskList, getCurrentTasks(), title, message);
      $("#filterAllCount").textContent = (currentView === "list" ? tasks.filter(task => task.listId === currentListId) : tasks).length;
    }
  }

  function openTaskModal(task = null) {
    elements.taskForm.reset();
    $("#taskId").value = task?.id || "";
    $("#taskModalTitle").textContent = task ? "Edit task" : "Create a new task";
    $("#saveTaskButton").textContent = task ? "Save changes" : "Add task";
    $("#taskTitle").value = task?.title || "";
    $("#taskDescription").value = task?.description || "";
    $("#taskPriority").value = task?.priority || "medium";
    $("#taskDueDate").value = task?.dueDate || "";
    $("#taskDueTime").value = task?.dueTime || "";
    if (task) $("#taskList").value = task.listId;
    else if (currentView === "list" && currentListId) $("#taskList").value = currentListId;
    elements.taskModal.showModal();
    $("#taskTitle").focus();
  }

  function submitTask(event) {
    event.preventDefault();
    const title = $("#taskTitle").value.trim();
    if (!title) {
      $("#taskTitle").focus();
      showToast("Please enter a task title.", true);
      return;
    }
    const id = $("#taskId").value;
    const existing = tasks.find(task => task.id === id);
    const task = {
      id: id || uid(),
      title,
      description: $("#taskDescription").value.trim(),
      listId: $("#taskList").value || lists[0]?.id,
      priority: $("#taskPriority").value,
      dueDate: $("#taskDueDate").value,
      dueTime: $("#taskDueTime").value,
      completed: existing?.completed || false,
      important: existing?.important || false,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    tasks = existing ? tasks.map(item => item.id === id ? task : item) : [task, ...tasks];
    persist(STORAGE_KEYS.tasks, tasks);
    elements.taskModal.close();
    renderCurrentView();
    showToast(existing ? "Task updated." : "Task added successfully.");
  }

  function openListModal(manage = false) {
    elements.listForm.reset();
    $("#listId").value = "";
    $("#listModalTitle").textContent = manage ? "Manage your lists" : "Create a list";
    $("#saveListButton").textContent = "Create list";
    $("#listManageArea").classList.toggle("hidden", !manage);
    $('label[for="listName"]').classList.toggle("hidden", manage);
    $("#listName").classList.toggle("hidden", manage);
    if (manage) renderManagedLists();
    else $("#listName").focus();
    elements.listModal.showModal();
  }

  function submitList(event) {
    event.preventDefault();
    const name = $("#listName").value.trim();
    if (!name) return;
    if (lists.some(list => list.name.toLocaleLowerCase() === name.toLocaleLowerCase() && list.id !== $("#listId").value)) {
      showToast("A list with that name already exists.", true);
      return;
    }
    const id = $("#listId").value;
    if (id) {
      lists = lists.map(list => list.id === id ? { ...list, name } : list);
      showToast("List renamed.");
    } else {
      lists.push({ id: uid(), name });
      showToast("List created.");
    }
    persist(STORAGE_KEYS.lists, lists);
    renderCurrentView();
    if (currentView === "list") $("#tasksHeading").textContent = listName(currentListId);
    if (!$("#listManageArea").classList.contains("hidden")) {
      $("#listId").value = "";
      $("#listName").value = "";
      $("#listModalTitle").textContent = "Manage your lists";
      $("#saveListButton").textContent = "Create list";
      renderManagedLists();
    } else elements.listModal.close();
  }

  function deleteTask(id) {
    const task = tasks.find(item => item.id === id);
    if (!task || !window.confirm(`Delete "${task.title}"? This can't be undone.`)) return;
    tasks = tasks.filter(item => item.id !== id);
    persist(STORAGE_KEYS.tasks, tasks);
    renderCurrentView();
    showToast("Task deleted.");
  }

  function deleteList(id) {
    const list = lists.find(item => item.id === id);
    if (!list) return;
    if (lists.length === 1) {
      showToast("Keep at least one list in your workspace.", true);
      return;
    }
    const count = tasks.filter(task => task.listId === id).length;
    const destination = lists.find(item => item.id !== id);
    if (!window.confirm(`Delete "${list.name}"?${count ? ` Its ${count} task${count === 1 ? "" : "s"} will move to ${destination?.name || "the default list"}.` : ""}`)) return;
    if (destination) tasks = tasks.map(task => task.listId === id ? { ...task, listId: destination.id } : task);
    else tasks = tasks.filter(task => task.listId !== id);
    lists = lists.filter(item => item.id !== id);
    if (currentListId === id) showView("all");
    persist(STORAGE_KEYS.tasks, tasks);
    persist(STORAGE_KEYS.lists, lists);
    renderCurrentView();
    showToast("List deleted.");
  }

  function clearCompleted() {
    const count = tasks.filter(task => task.completed).length;
    if (!count) {
      showToast("There are no completed tasks to clear.");
      return;
    }
    if (!window.confirm(`Clear all ${count} completed task${count === 1 ? "" : "s"}? This can't be undone.`)) return;
    tasks = tasks.filter(task => !task.completed);
    persist(STORAGE_KEYS.tasks, tasks);
    renderCurrentView();
    showToast(`${count} completed task${count === 1 ? "" : "s"} cleared.`);
  }

  function handleTaskListClick(event) {
    const row = event.target.closest(".task-row");
    if (!row) {
      if (event.target.closest(".empty-add-button")) openTaskModal();
      return;
    }
    const task = tasks.find(item => item.id === row.dataset.taskId);
    if (!task) return;
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "edit") openTaskModal(task);
    if (action === "delete") deleteTask(task.id);
    if (action === "important") {
      task.important = !task.important;
      persist(STORAGE_KEYS.tasks, tasks);
      renderCurrentView();
      showToast(task.important ? "Marked as important." : "Removed from important tasks.");
    }
  }

  function handleTaskListChange(event) {
    const checkbox = event.target.closest(".task-check");
    if (!checkbox) return;
    const row = checkbox.closest(".task-row");
    const task = tasks.find(item => item.id === row?.dataset.taskId);
    if (!task) return;
    task.completed = checkbox.checked;
    task.updatedAt = new Date().toISOString();
    persist(STORAGE_KEYS.tasks, tasks);
    renderCurrentView();
    showToast(task.completed ? "Task completed. Nice work!" : "Task moved back to pending.");
  }

  function bindEvents() {
    document.addEventListener("click", event => {
      const nav = event.target.closest("[data-view]");
      if (nav) showView(nav.dataset.view);
      const listLink = event.target.closest("[data-list-id]:not(.rename-list):not(.delete-list)");
      if (listLink?.classList.contains("list-link")) showView("list", listLink.dataset.listId);
    });
    ["#topAddButton", "#welcomeAddButton", "#inlineAddButton", "#tasksAddButton"].forEach(selector => $(selector).addEventListener("click", () => openTaskModal()));
    $("#addListButton").addEventListener("click", () => openListModal());
    $("#manageListsButton").addEventListener("click", () => openListModal(true));
    $("#taskForm").addEventListener("submit", submitTask);
    $("#listForm").addEventListener("submit", submitList);
    $("#editProfileButton").addEventListener("click", openProfileModal);
    $("#profileForm").addEventListener("submit", saveUsername);
    elements.mainTaskList.addEventListener("click", handleTaskListClick);
    elements.todayTaskList.addEventListener("click", handleTaskListClick);
    elements.upcomingList.addEventListener("click", event => {
      if (event.target.closest(".empty-add-button")) openTaskModal();
    });
    elements.mainTaskList.addEventListener("change", handleTaskListChange);
    elements.todayTaskList.addEventListener("change", handleTaskListChange);
    $("#sortSelect").addEventListener("change", event => { sortMode = event.target.value; renderCurrentView(); });
    $("#filterTabs").addEventListener("click", event => {
      const tab = event.target.closest("[data-filter]");
      if (!tab) return;
      currentFilter = tab.dataset.filter;
      $$(".filter-tab").forEach(item => item.classList.toggle("active", item === tab));
      renderCurrentView();
    });
    $("#clearCompletedButton").addEventListener("click", clearCompleted);
    $("#settingsClearButton").addEventListener("click", clearCompleted);
    ["#themeButton", "#profileThemeButton", "#settingsThemeButton"].forEach(selector => $(selector).addEventListener("click", toggleTheme));
    $("#listNav").addEventListener("click", event => {
      const link = event.target.closest(".list-link");
      if (link) showView("list", link.dataset.listId);
    });
    $("#manageListItems").addEventListener("click", event => {
      const renameButton = event.target.closest(".rename-list");
      const deleteButton = event.target.closest(".delete-list");
      if (renameButton) {
        const list = lists.find(item => item.id === renameButton.dataset.listId);
        if (!list) return;
        $("#listId").value = list.id;
        $("#listName").value = list.name;
        $("#listModalTitle").textContent = "Rename list";
        $("#saveListButton").textContent = "Save changes";
        $("#listName").classList.remove("hidden");
        $('label[for="listName"]').classList.remove("hidden");
        $("#listManageArea").classList.add("hidden");
        $("#listName").focus();
      }
      if (deleteButton) deleteList(deleteButton.dataset.listId);
    });
    $$(".modal [data-close-modal]").forEach(button => button.addEventListener("click", () => button.closest("dialog").close()));
    [elements.taskModal, elements.listModal, elements.profileModal].forEach(modal => modal.addEventListener("click", event => {
      if (event.target === modal) modal.close();
    }));
    elements.searchInput.addEventListener("input", event => {
      searchTerm = event.target.value;
      if (currentView === "dashboard") showView("all");
      else renderCurrentView();
    });
    $("#menuButton").addEventListener("click", () => {
      elements.sidebar.classList.add("open");
      elements.sidebarScrim.classList.add("visible");
    });
    elements.sidebarScrim.addEventListener("click", () => {
      elements.sidebar.classList.remove("open");
      elements.sidebarScrim.classList.remove("visible");
    });
    $("#scrollTopButton").addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
    $("#profileThemeButton").title = "Toggle color theme";
    $("#searchInput").addEventListener("keydown", event => {
      if (event.key === "Escape") {
        event.target.value = "";
        searchTerm = "";
        renderCurrentView();
        event.target.blur();
      }
    });
    document.addEventListener("keydown", event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        elements.searchInput.focus();
      }
    });
    window.addEventListener("scroll", () => $("#scrollTopButton").classList.toggle("visible", window.scrollY > 350), { passive: true });
  }

  applyTheme();
  renderUsername();
  bindEvents();
  showView("dashboard");
})();
