(() => {
  const state = {
    all: [],
    filtered: [],
    directories: new Map(),
    currentPath: "",
    page: 1,
    pageSize: 48,
    viewerIndex: 0,
  };

  const $ = (id) => document.getElementById(id);

  const gallery = $("gallery");
  const folderGrid = $("folder-grid");
  const breadcrumb = $("breadcrumb");
  const directorySelects = $("directory-selects");
  const search = $("search");
  const tagFilter = $("tag-filter");
  const searchScope = $("search-scope");
  const pageSize = $("page-size");

  function normalizePath(path) {
    if (!path || path === ".") return "";
    return String(path).replace(/^\/+|\/+$/g, "");
  }

  function splitPath(path) {
    const normalized = normalizePath(path);
    return normalized ? normalized.split("/") : [];
  }

  function parentPath(path) {
    const parts = splitPath(path);
    parts.pop();
    return parts.join("/");
  }

  function basename(path) {
    const parts = splitPath(path);
    return parts.length ? parts[parts.length - 1] : "Figures";
  }

  function joinPath(parent, child) {
    const p = normalizePath(parent);
    return p ? `${p}/${child}` : child;
  }

  function uniqueSorted(values) {
    return [...new Set(values.filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, undefined, {numeric: true, sensitivity: "base"})
    );
  }

  function searchable(fig) {
    return [
      fig.name,
      fig.relative_path,
      fig.folder,
      ...(fig.tags || []),
    ].join(" ").toLowerCase();
  }

  function buildDirectories(figures, metadataDirectories = []) {
    const map = new Map();

    const ensure = (path) => {
      const normalized = normalizePath(path);
      if (!map.has(normalized)) {
        map.set(normalized, {
          path: normalized,
          name: basename(normalized),
          parent: normalized ? parentPath(normalized) : null,
          children: new Set(),
          directFigures: 0,
          recursiveFigures: 0,
        });
      }
      return map.get(normalized);
    };

    ensure("");

    // Use explicit directory metadata when available, but remain compatible
    // with older gallery_index.json files by reconstructing the tree from paths.
    for (const item of metadataDirectories || []) {
      const path = normalizePath(item.path);
      const dir = ensure(path);
      if (Number.isFinite(item.direct_figure_count)) {
        dir.directFigures = item.direct_figure_count;
      }
      if (Number.isFinite(item.recursive_figure_count)) {
        dir.recursiveFigures = item.recursive_figure_count;
      }
    }

    for (const fig of figures) {
      const folder = normalizePath(fig.folder);
      const parts = splitPath(folder);
      let current = "";
      ensure(current).recursiveFigures += 1;

      for (const part of parts) {
        const child = joinPath(current, part);
        ensure(current).children.add(child);
        ensure(child).recursiveFigures += 1;
        current = child;
      }
      ensure(folder).directFigures += 1;
    }

    // Explicit metadata may already contain counts. Reconstructing above is the
    // source of truth because it also includes gallery-only historical figures.
    for (const dir of map.values()) {
      dir.children = new Set();
      dir.directFigures = 0;
      dir.recursiveFigures = 0;
    }
    ensure("");

    for (const fig of figures) {
      const folder = normalizePath(fig.folder);
      const parts = splitPath(folder);
      let current = "";
      ensure(current).recursiveFigures += 1;

      for (const part of parts) {
        const child = joinPath(current, part);
        ensure(current).children.add(child);
        ensure(child).recursiveFigures += 1;
        current = child;
      }
      ensure(folder).directFigures += 1;
    }

    return map;
  }

  function childDirectories(path) {
    const dir = state.directories.get(normalizePath(path));
    if (!dir) return [];
    return [...dir.children]
      .map(child => state.directories.get(child))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: "base"}));
  }

  function pathLabel(path) {
    const normalized = normalizePath(path);
    return normalized ? `Figures / ${normalized}` : "Figures";
  }

  function readFolderFromHash() {
    const raw = window.location.hash.replace(/^#/, "");
    if (!raw) return "";
    const params = new URLSearchParams(raw);
    return normalizePath(params.get("folder") || "");
  }

  function writeFolderToHash(path) {
    const normalized = normalizePath(path);
    const nextHash = normalized ? `folder=${encodeURIComponent(normalized)}` : "";
    if (window.location.hash.replace(/^#/, "") === nextHash) return;

    const base = `${window.location.pathname}${window.location.search}`;
    history.pushState(null, "", nextHash ? `${base}#${nextHash}` : base);
  }

  function navigateTo(path, {updateHash = true} = {}) {
    const normalized = normalizePath(path);
    state.currentPath = state.directories.has(normalized) ? normalized : "";
    state.page = 1;

    if (updateHash) writeFolderToHash(state.currentPath);

    renderDirectoryNavigation();
    refreshTagOptions();
    applyFilters(true);
    window.scrollTo({top: 0, behavior: "smooth"});
  }

  function renderBreadcrumb() {
    breadcrumb.replaceChildren();

    const makeCrumb = (label, path, isCurrent = false) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `crumb${isCurrent ? " current" : ""}`;
      button.textContent = label;
      button.disabled = isCurrent;
      if (!isCurrent) button.addEventListener("click", () => navigateTo(path));
      return button;
    };

    const parts = splitPath(state.currentPath);
    breadcrumb.appendChild(makeCrumb("Figures", "", parts.length === 0));

    let current = "";
    parts.forEach((part, index) => {
      const sep = document.createElement("span");
      sep.className = "crumb-separator";
      sep.textContent = "/";
      breadcrumb.appendChild(sep);

      current = joinPath(current, part);
      breadcrumb.appendChild(makeCrumb(part, current, index === parts.length - 1));
    });
  }

  function makeDirectorySelect(parent, selectedChild, level) {
    const wrapper = document.createElement("label");
    wrapper.className = "directory-level";

    const label = document.createElement("span");
    label.textContent = `Level ${level}`;

    const select = document.createElement("select");
    select.setAttribute("aria-label", `Directory level ${level}`);

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = level === 1 ? "Choose top-level folder…" : "Choose subfolder…";
    select.appendChild(placeholder);

    for (const child of childDirectories(parent)) {
      const opt = document.createElement("option");
      opt.value = child.path;
      opt.textContent = child.name;
      opt.selected = child.path === selectedChild;
      select.appendChild(opt);
    }

    select.addEventListener("change", () => {
      if (select.value) {
        navigateTo(select.value);
      } else {
        navigateTo(parent);
      }
    });

    wrapper.appendChild(label);
    wrapper.appendChild(select);
    return wrapper;
  }

  function renderDirectorySelects() {
    directorySelects.replaceChildren();

    const parts = splitPath(state.currentPath);
    let parent = "";

    for (let i = 0; i < parts.length; i += 1) {
      const selected = joinPath(parent, parts[i]);
      directorySelects.appendChild(makeDirectorySelect(parent, selected, i + 1));
      parent = selected;
    }

    if (childDirectories(state.currentPath).length) {
      directorySelects.appendChild(
        makeDirectorySelect(state.currentPath, "", parts.length + 1)
      );
    }
  }

  function renderDirectoryNavigation() {
    renderBreadcrumb();
    renderDirectorySelects();

    const upButton = $("up-folder");
    upButton.disabled = !state.currentPath;
    $("current-directory").textContent = pathLabel(state.currentPath);
  }

  function renderFolders() {
    folderGrid.replaceChildren();
    const children = childDirectories(state.currentPath);
    $("folder-count").textContent = `${children.length} folder${children.length === 1 ? "" : "s"}`;

    if (!children.length) {
      const empty = document.createElement("div");
      empty.className = "folder-empty";
      empty.textContent = "No subfolders in this directory.";
      folderGrid.appendChild(empty);
      return;
    }

    for (const dir of children) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "folder-card";
      button.addEventListener("click", () => navigateTo(dir.path));

      const icon = document.createElement("span");
      icon.className = "folder-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "📁";

      const text = document.createElement("span");
      text.className = "folder-card-text";

      const name = document.createElement("span");
      name.className = "folder-name";
      name.textContent = dir.name;

      const meta = document.createElement("span");
      meta.className = "folder-meta";
      const subfolders = childDirectories(dir.path).length;
      meta.textContent = `${dir.recursiveFigures} figure${dir.recursiveFigures === 1 ? "" : "s"} · ${subfolders} subfolder${subfolders === 1 ? "" : "s"}`;

      text.appendChild(name);
      text.appendChild(meta);
      button.appendChild(icon);
      button.appendChild(text);
      folderGrid.appendChild(button);
    }
  }

  function figureMatchesScope(fig, scope = searchScope.value) {
    if (scope === "all") return true;

    const folder = normalizePath(fig.folder);
    const current = normalizePath(state.currentPath);

    if (scope === "current") return folder === current;
    if (!current) return true;
    return folder === current || folder.startsWith(`${current}/`);
  }

  function figuresForScope(scope = searchScope.value) {
    return state.all.filter(fig => figureMatchesScope(fig, scope));
  }

  function refreshTagOptions() {
    const previous = tagFilter.value;
    const baseFigures = figuresForScope(searchScope.value);
    const tags = uniqueSorted(baseFigures.flatMap(fig => fig.tags || []));

    tagFilter.replaceChildren();
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "All tags";
    tagFilter.appendChild(all);

    for (const value of tags) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = value;
      tagFilter.appendChild(opt);
    }

    tagFilter.value = tags.includes(previous) ? previous : "";
  }

  function applyFilters(resetPage = true) {
    const q = search.value.trim().toLowerCase();
    const tag = tagFilter.value;

    state.filtered = state.all.filter(fig => {
      const okScope = figureMatchesScope(fig);
      const okQ = !q || searchable(fig).includes(q);
      const okTag = !tag || (fig.tags || []).includes(tag);
      return okScope && okQ && okTag;
    });

    if (resetPage) state.page = 1;
    renderFolders();
    renderFigures();
  }

  function scopeText() {
    const current = pathLabel(state.currentPath);
    if (searchScope.value === "all") return "Showing figures across the entire gallery.";
    if (searchScope.value === "subtree") return `Showing figures in ${current} and all subfolders.`;
    return `Showing figures directly inside ${current}.`;
  }

  function renderFigures() {
    gallery.replaceChildren();

    const total = state.filtered.length;
    const pages = Math.max(1, Math.ceil(total / state.pageSize));
    state.page = Math.min(state.page, pages);

    const start = (state.page - 1) * state.pageSize;
    const current = state.filtered.slice(start, start + state.pageSize);

    $("result-count").textContent = `${total} figure${total === 1 ? "" : "s"}`;
    $("scope-description").textContent = scopeText();
    $("page-label").textContent = `Page ${state.page} / ${pages}`;
    $("page-label-bottom").textContent = `Page ${state.page} / ${pages}`;

    for (const id of ["prev-page", "prev-page-bottom"]) $(id).disabled = state.page <= 1;
    for (const id of ["next-page", "next-page-bottom"]) $(id).disabled = state.page >= pages;

    if (!current.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      if (searchScope.value === "current" && childDirectories(state.currentPath).length) {
        empty.textContent = "No figures directly in this folder. Open a subfolder, or change Scope to include subfolders.";
      } else {
        empty.textContent = "No figures match the current directory and filters.";
      }
      gallery.appendChild(empty);
      return;
    }

    current.forEach((fig, localIndex) => {
      const card = document.createElement("article");
      card.className = "figure-card";

      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", `Open ${fig.name}`);

      const img = document.createElement("img");
      img.loading = "lazy";
      img.src = fig.url;
      img.alt = fig.name;

      button.appendChild(img);
      button.addEventListener("click", () => {
        state.viewerIndex = start + localIndex;
        openViewer();
      });

      const info = document.createElement("div");
      info.className = "figure-info";

      const name = document.createElement("div");
      name.className = "figure-name";
      name.textContent = fig.name;
      name.title = fig.name;

      const path = document.createElement("button");
      path.type = "button";
      path.className = "figure-path path-link";
      path.textContent = fig.relative_path;
      path.title = "Open containing folder";
      path.addEventListener("click", () => navigateTo(normalizePath(fig.folder)));

      info.appendChild(name);
      info.appendChild(path);

      if (fig.tags?.length) {
        const tags = document.createElement("div");
        tags.className = "tags";
        for (const t of fig.tags.slice(0, 5)) {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = "tag";
          chip.textContent = t;
          chip.title = `Filter by ${t}`;
          chip.addEventListener("click", () => {
            if ([...tagFilter.options].some(option => option.value === t)) {
              tagFilter.value = t;
            } else {
              searchScope.value = "all";
              refreshTagOptions();
              tagFilter.value = t;
            }
            applyFilters(true);
          });
          tags.appendChild(chip);
        }
        info.appendChild(tags);
      }

      card.appendChild(button);
      card.appendChild(info);
      gallery.appendChild(card);
    });
  }

  function changePage(delta) {
    state.page += delta;
    renderFigures();
    document.querySelector(".figures-section")?.scrollIntoView({behavior: "smooth", block: "start"});
  }

  function openViewer() {
    const fig = state.filtered[state.viewerIndex];
    if (!fig) return;
    $("viewer-name").textContent = fig.name;
    $("viewer-path").textContent = fig.relative_path;
    $("viewer-image").src = fig.url;
    $("viewer-image").alt = fig.name;

    const viewer = $("viewer");
    if (!viewer.open) viewer.showModal();
  }

  function moveViewer(delta) {
    if (!state.filtered.length) return;
    state.viewerIndex = (state.viewerIndex + delta + state.filtered.length) % state.filtered.length;
    openViewer();
  }

  search.addEventListener("input", () => applyFilters(true));
  tagFilter.addEventListener("change", () => applyFilters(true));
  searchScope.addEventListener("change", () => {
    refreshTagOptions();
    applyFilters(true);
  });
  pageSize.addEventListener("change", () => {
    state.pageSize = Number(pageSize.value);
    applyFilters(true);
  });

  $("up-folder").addEventListener("click", () => {
    if (state.currentPath) navigateTo(parentPath(state.currentPath));
  });

  $("prev-page").addEventListener("click", () => changePage(-1));
  $("prev-page-bottom").addEventListener("click", () => changePage(-1));
  $("next-page").addEventListener("click", () => changePage(1));
  $("next-page-bottom").addEventListener("click", () => changePage(1));

  $("viewer-close").addEventListener("click", () => $("viewer").close());
  $("viewer-prev").addEventListener("click", () => moveViewer(-1));
  $("viewer-next").addEventListener("click", () => moveViewer(1));

  document.addEventListener("keydown", (event) => {
    if (!$("viewer").open) return;
    if (event.key === "ArrowLeft") moveViewer(-1);
    if (event.key === "ArrowRight") moveViewer(1);
  });

  window.addEventListener("popstate", () => {
    const requested = readFolderFromHash();
    navigateTo(requested, {updateHash: false});
  });

  window.addEventListener("hashchange", () => {
    const requested = readFolderFromHash();
    if (requested !== state.currentPath) navigateTo(requested, {updateHash: false});
  });

  fetch("gallery_index.json")
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(data => {
      state.all = data.figures || [];
      state.directories = buildDirectories(state.all, data.directories || []);

      $("gallery-summary").textContent =
        `${data.figure_count} figures · ${state.directories.size} folders · updated ${new Date(data.generated_at_utc).toLocaleString()}`;

      const requested = readFolderFromHash();
      state.currentPath = state.directories.has(requested) ? requested : "";

      renderDirectoryNavigation();
      refreshTagOptions();
      applyFilters(true);
    })
    .catch(err => {
      gallery.replaceChildren();
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = `Could not load gallery_index.json: ${err.message}`;
      gallery.appendChild(empty);
      $("gallery-summary").textContent = "Gallery index unavailable.";
    });
})();
