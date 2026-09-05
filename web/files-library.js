export function installFilesLibrary({ request, native, currentProject }) {
  const opener = document.querySelector("#filesLibraryOpen");
  if (!opener) return;
  const dialog = document.createElement("dialog");
  dialog.className = "files-library-dialog";
  dialog.setAttribute("aria-labelledby", "filesLibraryTitle");
  dialog.innerHTML = `<header><button type="button" data-back>‹ Back</button><h2 id="filesLibraryTitle">Files</h2><button type="button" data-refresh>Refresh</button></header>
    <p class="files-library-help">Your finished documents live on this Mac. Open Files on your paired iPhone to download a copy.</p>
    <div class="files-library-controls"><input type="search" placeholder="Find a document" aria-label="Search files" data-search><select aria-label="Project" data-project><option value="">All projects</option></select><select aria-label="File type" data-format><option value="">All types</option></select><label><input type="checkbox" data-archive> Archive</label></div>
    <div class="files-library-controls"><button type="button" data-add>Add files…</button><button type="button" data-import>Import older deliverables…</button><button type="button" data-instructions>Copy agent instructions</button></div>
    <p role="status" data-status></p><div class="files-library-list" data-list></div><button type="button" data-more hidden>Load more</button>`;
  document.body.append(dialog);
  const find = (selector) => dialog.querySelector(selector);
  const status = (value) => { find("[data-status]").textContent = value; };
  const button = (label, action) => { const result = document.createElement("button"); result.type = "button"; result.textContent = label; result.addEventListener("click", action); return result; };
  let entries = [], cursor = null, generation = 0, searchTimer, busy = false;
  const post = (url, body) => request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const close = () => { generation += 1; dialog.close(); opener.focus(); };
  find("[data-back]").addEventListener("click", close);
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  dialog.addEventListener("click", (event) => { if (event.target === dialog) close(); });

  function render() {
    const list = find("[data-list]"); list.replaceChildren();
    if (!entries.length) {
      const empty = document.createElement("p"); empty.className = "files-library-empty";
      empty.textContent = "No documents here yet. Add a finished file, or copy the instructions for your agent. Source edits stay in their projects.";
      list.append(empty);
    }
    for (const item of entries) {
      const card = document.createElement("article"); card.className = "files-library-card";
      const title = document.createElement("h3"); title.textContent = `${item.pinned ? "📌 " : ""}${item.title}`;
      const meta = document.createElement("p"); meta.className = "files-library-meta";
      meta.textContent = `${item.project ? item.project.split("/").filter(Boolean).pop() : "Personal"} • ${item.versions.length} version${item.versions.length === 1 ? "" : "s"}`;
      card.append(title, meta);
      const actions = document.createElement("div"); actions.className = "files-library-controls";
      actions.append(button(item.pinned ? "Unpin" : "Pin", () => update(item, { pinned: !item.pinned })),
        button(item.archived ? "Restore" : "Archive", () => update(item, { archived: !item.archived })));
      const versions = document.createElement("details"); const summary = document.createElement("summary");
      summary.textContent = "Previous versions"; versions.append(summary);
      const seen = new Set();
      for (const version of [...item.versions].reverse()) {
        const row = document.createElement("div"); row.className = "files-library-version";
        const label = document.createElement("span"); label.textContent = `${version.fileName} · ${new Intl.NumberFormat().format(version.size)} bytes · ${version.createdAt.slice(0, 10)}`;
        const parameters = new URLSearchParams({ id: item.id, versionId: version.id });
        const download = document.createElement("a"); download.href = `/v1/files/download?${parameters}`; download.textContent = "Download"; download.download = version.fileName;
        row.append(label, download);
        if (native.isAvailable()) row.append(button("Show in Finder", async () => {
          try {
            await native.call("revealLibraryFile", { id: item.id, versionId: version.id, fileName: version.fileName });
            status("Opened a copy of this saved version in Finder. The library snapshot is preserved.");
          } catch (error) { status(error.message); }
        }));
        if (["pdf", "txt", "md", "csv", "json", "png", "jpg", "jpeg", "webp"].includes(version.format)) {
          row.append(button("Preview", () => preview(version, parameters)));
        }
        if (seen.has(version.format)) versions.append(row); else { card.append(row); seen.add(version.format); }
      }
      if (versions.children.length > 1) card.append(versions);
      card.append(actions); list.append(card);
    }
    find("[data-more]").hidden = cursor === null;
  }

  async function load(more = false) {
    const current = ++generation;
    status("Loading local files…");
    try {
      const parameters = new URLSearchParams({ query: find("[data-search]").value, project: find("[data-project]").value, format: find("[data-format]").value, archived: String(find("[data-archive]").checked), cursor: String(more ? cursor || 0 : 0) });
      const page = await request(`/v1/files/library?${parameters}`);
      if (current !== generation || !dialog.open) return;
      entries = more ? entries.filter((item) => !page.items.some((next) => next.id === item.id)).concat(page.items) : page.items;
      cursor = page.nextCursor;
      const select = find("[data-format]");
      for (const format of page.formats || []) {
        if (![...select.options].some((option) => option.value === format)) { const option = new Option(format.toUpperCase() || "Other", format); select.add(option); }
      }
      const projectSelect = find("[data-project]");
      for (const project of page.projects || []) {
        const value = project || "__personal__";
        if (![...projectSelect.options].some((option) => option.value === value)) projectSelect.add(new Option(project.split("/").filter(Boolean).pop() || "Personal", value));
      }
      status(`${page.total} document${page.total === 1 ? "" : "s"} · ${(page.bytesUsed / 1024 / 1024).toFixed(1)} MB stored on this Mac`);
      render();
    } catch (error) { if (current === generation) status(error.message); }
  }

  async function update(item, patch) {
    if (busy) return; busy = true;
    try { await post("/v1/files/update", { id: item.id, ...patch }); await load(); }
    catch (error) { status(error.message); }
    finally { busy = false; }
  }

  async function preview(version, parameters) {
    const previewDialog = document.createElement("dialog"); previewDialog.className = "files-library-dialog files-library-preview";
    const title = document.createElement("h3"); title.textContent = version.fileName;
    const back = button("‹ Back to Files", () => previewDialog.close());
    const content = document.createElement("div"); content.className = "files-library-preview-content";
    content.textContent = "Opening the saved file…";
    previewDialog.append(back, title, content); document.body.append(previewDialog);
    const prior = document.activeElement;
    const abort = new AbortController(); let objectURL;
    previewDialog.addEventListener("close", () => { abort.abort(); if (objectURL) URL.revokeObjectURL(objectURL); previewDialog.remove(); prior?.focus(); }, { once: true });
    previewDialog.showModal(); back.focus();
    try {
      const textFile = ["txt", "md", "csv", "json"].includes(version.format);
      if (version.size > (textFile ? 2 : 25) * 1024 * 1024) throw new Error("This file is too large for an inline preview. Use Download or Show in Finder to open the saved file.");
      const response = await fetch(`/v1/files/preview?${parameters}`, { credentials: "same-origin", signal: abort.signal });
      if (!response.ok) throw new Error("The saved file could not be previewed. Refresh Files and try again.");
      if (textFile) {
        const text = document.createElement("pre"); text.textContent = await response.text();
        content.replaceChildren(text);
      } else {
        objectURL = URL.createObjectURL(await response.blob());
        if (version.format === "pdf") {
          const document = window.document.createElement("object"); document.type = "application/pdf"; document.data = objectURL;
          document.setAttribute("aria-label", version.fileName);
          document.textContent = "Use Download or Show in Finder to open this PDF.";
          content.replaceChildren(document);
        } else {
          const picture = document.createElement("img"); picture.src = objectURL; picture.alt = version.fileName;
          content.replaceChildren(picture);
        }
      }
    } catch (error) { if (!abort.signal.aborted) content.textContent = error.message; }
  }

  find("[data-add]").addEventListener("click", async () => {
    if (busy) return;
    if (!native.isAvailable()) { status("Open the Mac app to choose files, or use the copied agent instructions."); return; }
    busy = true;
    try {
      const selection = await native.call("chooseLibraryFiles");
      for (const sourcePath of selection.paths || []) {
        status(`Saving ${sourcePath.split("/").pop()} locally…`);
        await post("/v1/files/add", { sourcePath, project: currentProject()?.path || "" });
      }
      await load();
    } catch (error) { status(error.message); }
    finally { busy = false; }
  });
  find("[data-instructions]").addEventListener("click", async () => {
    try {
      const result = await request("/v1/files/instructions");
      await navigator.clipboard.writeText(result.instructions);
      status("Agent instructions copied. Paste them into your agent conversation.");
    } catch (error) { status(error.message); }
  });
  find("[data-import]").addEventListener("click", async () => {
    const project = currentProject()?.path;
    if (!project) { status("Choose a project in ClawDad first, then import its older deliverables."); return; }
    try {
      const result = await request(`/v1/files/legacy?project=${encodeURIComponent(project)}`);
      const preview = document.createElement("dialog"); preview.className = "files-library-dialog";
      const title = document.createElement("h3"); title.textContent = "Choose older deliverables";
      const help = document.createElement("p"); help.textContent = "Selected files get a local library snapshot. Their originals stay in the project.";
      preview.append(button("‹ Back to Files", () => preview.close()), title, help);
      const choices = [];
      for (const file of result.artifacts) {
        const label = document.createElement("label"); label.className = "files-library-import-row";
        const input = document.createElement("input"); input.type = "checkbox";
        label.append(input, document.createTextNode(file.relativePath)); preview.append(label); choices.push({ input, file });
      }
      if (!choices.length) help.textContent = "This project has no older deliverables to import.";
      preview.append(button("Add selected files", async () => {
        try {
          for (const { input, file } of choices.filter(({ input }) => input.checked)) {
            input.disabled = true;
            await post("/v1/files/import", { project, relativePath: file.relativePath });
          }
          preview.close(); await load();
        } catch (error) { help.textContent = error.message; }
      }));
      preview.addEventListener("close", () => { preview.remove(); find("[data-import]").focus(); }, { once: true });
      document.body.append(preview); preview.showModal();
    } catch (error) { status(error.message); }
  });
  find("[data-refresh]").addEventListener("click", () => load());
  find("[data-more]").addEventListener("click", () => load(true));
  find("[data-search]").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => load(), 200); });
  for (const selector of ["[data-project]", "[data-format]", "[data-archive]"]) find(selector).addEventListener("change", () => load());
  opener.addEventListener("click", () => { dialog.showModal(); find("[data-search]").focus(); load(); });
}
