(() => {
  const state = {
    all: [],
    filtered: [],
    page: 1,
    pageSize: 48,
    viewerIndex: 0,
  };

  const $ = (id) => document.getElementById(id);

  const gallery = $("gallery");
  const search = $("search");
  const folderFilter = $("folder-filter");
  const tagFilter = $("tag-filter");
  const pageSize = $("page-size");

  function uniqueSorted(values) {
    return [...new Set(values.filter(Boolean))].sort((a,b) => a.localeCompare(b));
  }

  function fillSelect(select, values) {
    for (const value of values) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = value;
      select.appendChild(opt);
    }
  }

  function searchable(fig) {
    return [
      fig.name,
      fig.relative_path,
      fig.folder,
      ...(fig.tags || [])
    ].join(" ").toLowerCase();
  }

  function applyFilters(resetPage = true) {
    const q = search.value.trim().toLowerCase();
    const folder = folderFilter.value;
    const tag = tagFilter.value;

    state.filtered = state.all.filter(fig => {
      const okQ = !q || searchable(fig).includes(q);
      const okFolder = !folder || fig.folder === folder;
      const okTag = !tag || (fig.tags || []).includes(tag);
      return okQ && okFolder && okTag;
    });

    if (resetPage) state.page = 1;
    render();
  }

  function render() {
    gallery.replaceChildren();

    const total = state.filtered.length;
    const pages = Math.max(1, Math.ceil(total / state.pageSize));
    state.page = Math.min(state.page, pages);

    const start = (state.page - 1) * state.pageSize;
    const current = state.filtered.slice(start, start + state.pageSize);

    $("result-count").textContent = `${total} figures`;
    $("page-label").textContent = `Page ${state.page} / ${pages}`;
    $("page-label-bottom").textContent = `Page ${state.page} / ${pages}`;

    for (const id of ["prev-page", "prev-page-bottom"]) $(id).disabled = state.page <= 1;
    for (const id of ["next-page", "next-page-bottom"]) $(id).disabled = state.page >= pages;

    if (!current.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No figures match the current filters.";
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

      const path = document.createElement("div");
      path.className = "figure-path";
      path.textContent = fig.relative_path;

      info.appendChild(name);
      info.appendChild(path);

      if (fig.tags?.length) {
        const tags = document.createElement("div");
        tags.className = "tags";
        for (const t of fig.tags.slice(0, 5)) {
          const chip = document.createElement("span");
          chip.className = "tag";
          chip.textContent = t;
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
    render();
    window.scrollTo({top: 0, behavior: "smooth"});
  }

  function openViewer() {
    const fig = state.filtered[state.viewerIndex];
    if (!fig) return;
    $("viewer-name").textContent = fig.name;
    $("viewer-path").textContent = fig.relative_path;
    $("viewer-image").src = fig.url;
    $("viewer-image").alt = fig.name;
    $("viewer").showModal();
  }

  function moveViewer(delta) {
    if (!state.filtered.length) return;
    state.viewerIndex = (state.viewerIndex + delta + state.filtered.length) % state.filtered.length;
    openViewer();
  }

  search.addEventListener("input", () => applyFilters(true));
  folderFilter.addEventListener("change", () => applyFilters(true));
  tagFilter.addEventListener("change", () => applyFilters(true));
  pageSize.addEventListener("change", () => {
    state.pageSize = Number(pageSize.value);
    applyFilters(true);
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

  fetch("gallery_index.json")
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(data => {
      state.all = data.figures || [];
      state.filtered = [...state.all];

      $("gallery-summary").textContent =
        `${data.figure_count} figures · updated ${new Date(data.generated_at_utc).toLocaleString()}`;

      fillSelect(folderFilter, uniqueSorted(state.all.map(x => x.folder)));
      fillSelect(tagFilter, uniqueSorted(state.all.flatMap(x => x.tags || [])));

      render();
    })
    .catch(err => {
      gallery.innerHTML = `<div class="empty">Could not load gallery_index.json: ${err.message}</div>`;
      $("gallery-summary").textContent = "Gallery index unavailable.";
    });
})();
