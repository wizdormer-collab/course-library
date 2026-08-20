const app = document.getElementById("app");
const navLinks = document.getElementById("nav-links");

const state = {
  user: null,
  toast: "",
  courses: [],
  theme: localStorage.getItem("theme") || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
  themeSchedule: null
};

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
}
applyTheme();

function applyThemeSchedule() {
  const sched = state.themeSchedule;
  if (!sched || !sched.enabled || !sched.darkStart || !sched.darkEnd) return;
  const now = new Date();
  const [sh, sm] = sched.darkStart.split(":").map(Number);
  const [eh, em] = sched.darkEnd.split(":").map(Number);
  const mins = now.getHours() * 60 + now.getMinutes();
  const startMins = sh * 60 + sm;
  const endMins = eh * 60 + em;
  let shouldBeDark;
  if (startMins <= endMins) {
    shouldBeDark = mins >= startMins && mins < endMins;
  } else {
    shouldBeDark = mins >= startMins || mins < endMins;
  }
  const newTheme = shouldBeDark ? "dark" : "light";
  if (state.theme !== newTheme) {
    state.theme = newTheme;
    localStorage.setItem("theme", state.theme);
    applyTheme();
    renderNav();
  }
}

setInterval(applyThemeSchedule, 60000);

function token() {
  return localStorage.getItem("token");
}
function storeAuth(data) {
  localStorage.setItem("token", data.token);
  localStorage.setItem("user", JSON.stringify(data.user));
  state.user = data.user;
}
function clearAuth() {
  try { fetch("/api/auth/logout", { method: "POST", headers: { Authorization: "Bearer " + localStorage.getItem("token") } }); } catch {}
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  state.user = null;
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const t = token();
  if (t) headers["Authorization"] = "Bearer " + t;
  const res = await fetch(path, { ...options, headers });
  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    clearAuth();
    location.hash = "#/login";
    throw new Error("Session expired");
  }
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

const ICONS = {
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  chat: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
  edit: '<path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
  close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  chevronLeft: '<polyline points="15 18 9 12 15 6"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  pdf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13h6M9 17h6M9 9h1"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  grad: '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
  mail: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  eyeOff: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
  more: '<circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>',
  chevronRight: '<polyline points="9 18 15 12 9 6"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  play: '<polygon points="5 3 19 12 5 21 5 3"/>',
  tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'
};

function icon(name, cls) {
  return `<svg class="ic${cls ? " " + cls : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}

function fmtSize(b) {
  if (b < 1024) return b + " B";
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
  return (b / (1024 * 1024)).toFixed(1) + " MB";
}
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function fmtCount(n) {
  return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
}

async function fetchBlob(path) {
  const headers = {};
  const t = token();
  if (t) headers["Authorization"] = "Bearer " + t;
  const res = await fetch(path, { headers });
  if (!res.ok) {
    let msg = "Request failed";
    try {
      const j = await res.json();
      msg = j.error || msg;
    } catch {}
    throw new Error(msg);
  }
  return await res.blob();
}

function triggerDownload(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 4000);
}

async function downloadPath(path, filename) {
  try {
    const blob = await fetchBlob(path);
    triggerDownload(blob, filename);
  } catch (err) {
    alert(err.message);
  }
}

let toastTimer;
function showToast(msg) {
  state.toast = msg;
  render();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    state.toast = "";
    render();
  }, 4000);
}

function btnLoading(btn, label) {
  if (!btn) return () => {};
  btn.disabled = true;
  const orig = btn.innerHTML;
  btn.innerHTML = '<span class="spinner"></span> ' + (label || "...");
  return () => { btn.disabled = false; btn.innerHTML = orig; };
}

/* ---------- shared helpers ---------- */

function fileRow(f, opts = {}) {
  const isAdmin = state.user && state.user.role === "admin";
  const tagsHtml = (f.tags || []).length
    ? `<div class="file-tags">${f.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>`
    : "";
  const rp = state.readProgress && state.readProgress[f.id];
  const progressHtml = rp ? `<div class="file-progress"><div class="progress-bar" style="height:3px"><div class="progress-fill" style="width:${rp.pct}%"></div></div><span class="muted small">${rp.pct}% read</span></div>` : "";
  return `
    <div class="file-row" data-fid="${f.id}">
      ${opts.showCheckboxes ? `<label class="file-check"><input type="checkbox" data-bulk-check="${f.id}" /></label>` : ""}
      <span class="file-icon">${icon("pdf")}</span>
      <div class="file-info">
        <button class="file-name" data-preview="${f.id}">${esc(f.name)}</button>
        <span class="muted">
          ${opts.showCourse ? esc(f.courseLabel) + " &middot; " : ""}by ${esc(f.uploadedByName)} &middot;
          ${fmtSize(f.size)} &middot; ${fmtDate(f.uploadedAt)}
          ${f.role === "student" ? '<span class="badge">student upload</span>' : ""}
          ${!f.approved ? '<span class="badge badge-pending">pending</span>' : ""}
        </span>
        ${tagsHtml}
        ${progressHtml}
        ${opts.showCounts ? `
          <span class="muted">
            <span class="stat" title="Views">${icon("eye")} ${fmtCount(f.views || 0)}</span>
            <span class="stat" title="Downloads">${icon("download")} ${fmtCount(f.downloads || 0)}</span>
            <span class="stat" title="Comments">${icon("chat")} ${f.commentCount || 0}</span>
          </span>` : ""}
      </div>
      <div class="file-actions">
        <button class="icon-btn heart ${f.liked ? "on" : ""}" data-like="${f.id}" title="Like">${icon("heart")} <span class="like-count">${f.likes || 0}</span></button>
        <div class="star-rating" data-rate-file="${f.id}">
          ${[1,2,3,4,5].map(n => `<button class="star ${(f.myRating || 0) >= n ? "on" : ""}" data-star="${n}" title="${n} star${n > 1 ? "s" : ""}">&#9733;</button>`).join("")}
          ${f.ratingCount ? `<span class="rating-info">${f.avgRating} (${f.ratingCount})</span>` : ""}
        </div>
        <button class="icon-btn star ${f.saved ? "on" : ""}" data-save="${f.id}" title="Save for later" aria-label="Save for later">${icon("star")}</button>
        <button class="icon-btn" data-collect="${f.id}" title="Add to collection" aria-label="Add to collection">${icon("folder")}</button>
        ${isAdmin || (state.user && f.uploadedBy === state.user.id) ? `<button class="icon-btn" data-edit-tags="${f.id}" data-etags="${esc(JSON.stringify(f.tags || []))}" title="Edit tags" aria-label="Edit tags">${icon("tag")}</button>` : ""}
        ${isAdmin || (state.user && f.uploadedBy === state.user.id) ? `<button class="icon-btn" data-rename="${f.id}" data-rname="${esc(f.name)}" title="Rename" aria-label="Rename">${icon("edit")}</button>` : ""}
        ${isAdmin || (state.user && f.uploadedBy === state.user.id) ? `<button class="icon-btn" data-new-version="${f.id}" title="Upload new version" aria-label="Upload new version">${icon("clock")}</button>` : ""}
        <button class="btn btn-outline btn-sm" data-download="${f.id}" data-name="${esc(f.originalName || f.name)}">${icon("download")} Download</button>
        ${isAdmin ? `<button class="btn btn-danger btn-sm" data-del="${f.id}">${icon("trash")} Delete</button>` : ""}
      </div>
    </div>`;
}

function bulkActionBarHTML() {
  return `
    <div class="bulk-bar hidden" id="bulk-bar">
      <label class="bulk-select-all"><input type="checkbox" id="bulk-select-all" /> Select all</label>
      <span class="bulk-count" id="bulk-count">0 selected</span>
      <div class="bulk-actions">
        <button class="btn btn-outline btn-sm" id="bulk-download">${icon("download")} Download</button>
        ${state.user && state.user.role === "admin" ? `<button class="btn btn-danger btn-sm" id="bulk-delete">${icon("trash")} Delete</button>` : ""}
      </div>
    </div>`;
}

function bindBulkActions() {
  const bar = document.getElementById("bulk-bar");
  const countEl = document.getElementById("bulk-count");
  const selectAll = document.getElementById("bulk-select-all");
  if (!bar) return;
  const checkboxes = document.querySelectorAll("[data-bulk-check]");
  function updateBar() {
    const checked = document.querySelectorAll("[data-bulk-check]:checked");
    if (checked.length > 0) {
      bar.classList.remove("hidden");
      countEl.textContent = checked.length + " selected";
    } else {
      bar.classList.add("hidden");
    }
    if (selectAll) selectAll.checked = checked.length === checkboxes.length && checkboxes.length > 0;
  }
  checkboxes.forEach((cb) => cb.addEventListener("change", updateBar));
  if (selectAll) selectAll.addEventListener("change", () => {
    checkboxes.forEach((cb) => { cb.checked = selectAll.checked; });
    updateBar();
  });
  const dlBtn = document.getElementById("bulk-download");
  if (dlBtn) dlBtn.addEventListener("click", async () => {
    const ids = [...document.querySelectorAll("[data-bulk-check]:checked")].map((cb) => cb.dataset.bulkCheck);
    if (!ids.length) return;
    try {
      const blob = await fetchBlob("/api/files/bulk-action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileIds: ids, action: "download" }) });
      triggerDownload(blob, "files.zip");
      showToast("Downloaded " + ids.length + " files");
    } catch (err) { alert(err.message); }
  });
  const delBtn = document.getElementById("bulk-delete");
  if (delBtn) delBtn.addEventListener("click", async () => {
    const ids = [...document.querySelectorAll("[data-bulk-check]:checked")].map((cb) => cb.dataset.bulkCheck);
    if (!ids.length) return;
    if (!confirm("Delete " + ids.length + " files permanently?")) return;
    try {
      const d = await api("/api/files/bulk-action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileIds: ids, action: "delete" }) });
      showToast("Deleted " + d.count + " files");
      render();
    } catch (err) { alert(err.message); }
  });
}

function emptyState(iconName, title, description, ctaHtml) {
  return `
    <div class="empty-state">
      <div class="empty-icon">${icon(iconName)}</div>
      <h3>${esc(title)}</h3>
      <p>${esc(description)}</p>
      ${ctaHtml ? `<div class="empty-cta">${ctaHtml}</div>` : ""}
    </div>`;
}

function listSection(title, rows, empty) {
  return `
    <h2 class="section-title">${title}</h2>
    ${rows ? `<div class="file-list">${rows}</div>` : emptyState("file", title, empty || "Nothing here yet.")}`;
}

function paginationNav(pagination, baseHash) {
  if (!pagination || pagination.pages <= 1) return "";
  const { page, pages } = pagination;
  const sep = baseHash.includes("?") ? "&" : "?";
  const prev = page > 1 ? `${baseHash}${sep}page=${page - 1}` : null;
  const next = page < pages ? `${baseHash}${sep}page=${page + 1}` : null;
  return `<div class="pagination">
    ${prev ? `<a href="${prev}" class="btn btn-outline btn-sm">${icon("chevronLeft")} Prev</a>` : '<span></span>'}
    <span class="muted">Page ${page} of ${pages}</span>
    ${next ? `<a href="${next}" class="btn btn-outline btn-sm">Next ${icon("chevronRight")}</a>` : '<span></span>'}
  </div>`;
}

async function openCollectPicker(fileId) {
  try {
    const d = await api("/api/collections");
    const cols = d.collections;
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal">
      <div class="modal-actions"><h2>Add to collection</h2><button class="btn btn-outline" id="cp-close">Close</button></div>
      <div class="modal-col-list">
        ${cols.length ? cols.map((c) => `
          <div class="modal-col-item ${c.fileIds.includes(fileId) ? "in-col" : ""}" data-cid="${c.id}">
            <span>${icon("folder")} ${esc(c.name)} (${c.files.length})</span>
            <span>${c.fileIds.includes(fileId) ? icon("check") : icon("plus")}</span>
          </div>`).join("") : '<p class="muted" style="text-align:center;padding:20px">No collections yet. Create one from the homepage.</p>'}
      </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.getElementById("cp-close").addEventListener("click", () => overlay.remove());
    overlay.querySelectorAll(".modal-col-item").forEach((el) =>
      el.addEventListener("click", async () => {
        const cid = el.dataset.cid;
        const inCol = el.classList.contains("in-col");
        try {
          await api("/api/collections/" + cid + (inCol ? "/remove" : "/add"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileId })
          });
          el.classList.toggle("in-col");
          showToast(inCol ? "Removed from collection" : "Added to collection");
        } catch (err) { alert(err.message); }
      }));
  } catch (err) { alert(err.message); }
}

async function bindRowActions({ showCourse = false, counts = false } = {}) {
  document.querySelectorAll("[data-preview]").forEach((btn) =>
    btn.addEventListener("click", () => openPdf(btn.dataset.preview, showCourse)));
  document.querySelectorAll("[data-like]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        const isLiked = btn.classList.contains("on");
        const d = await api("/api/files/" + btn.dataset.like + "/like", { method: isLiked ? "DELETE" : "POST" });
        btn.classList.toggle("on", !isLiked);
        const countEl = btn.querySelector(".like-count");
        if (countEl) countEl.textContent = d.likes;
      } catch (err) {
        alert(err.message);
      }
    }));
  document.querySelectorAll("[data-save]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        if (btn.classList.contains("on")) {
          await api("/api/files/" + btn.dataset.save + "/save", { method: "DELETE" });
          showToast("Removed from saved");
        } else {
          await api("/api/files/" + btn.dataset.save + "/save", { method: "POST" });
          showToast("Saved for later");
        }
      } catch (err) {
        alert(err.message);
      }
    }));
  document.querySelectorAll("[data-rate-file]").forEach((wrap) => {
    wrap.addEventListener("click", async (e) => {
      const star = e.target.closest("[data-star]");
      if (!star || !state.user) return;
      const fid = wrap.dataset.rateFile;
      const score = parseInt(star.dataset.star);
      try {
        const current = star.classList.contains("on") && wrap.querySelectorAll(".star.on").length === score;
        if (current) {
          await api("/api/files/" + fid + "/rating", { method: "DELETE" });
        } else {
          await api("/api/files/" + fid + "/rating", { method: "POST", body: { score } });
        }
        const stars = wrap.querySelectorAll(".star");
        stars.forEach((s, i) => s.classList.toggle("on", !current && i < score));
        let infoEl = wrap.querySelector(".rating-info");
        if (current) {
          if (infoEl) infoEl.remove();
        } else {
          if (!infoEl) { infoEl = document.createElement("span"); infoEl.className = "rating-info"; wrap.appendChild(infoEl); }
          infoEl.textContent = "Rated!";
        }
      } catch (err) {
        alert(err.message);
      }
    });
  });
  document.querySelectorAll("[data-download]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        await downloadPath("/api/files/" + btn.dataset.download + "/download", btn.dataset.name || "file.pdf");
      } catch (err) {
        alert(err.message);
      }
    }));
  document.querySelectorAll("[data-rename]").forEach((btn) =>
    btn.addEventListener("click", () => openRenameFile(btn.dataset.rename, btn.dataset.rname)));
  document.querySelectorAll("[data-edit-tags]").forEach((btn) =>
    btn.addEventListener("click", () => {
      let tags = [];
      try { tags = JSON.parse(btn.dataset.etags || "[]"); } catch {}
      openTagFile(btn.dataset.editTags, tags);
    }));
  document.querySelectorAll("[data-collect]").forEach((btn) =>
    btn.addEventListener("click", () => openCollectPicker(btn.dataset.collect)));
  document.querySelectorAll("[data-new-version]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const fid = btn.dataset.newVersion;
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/pdf";
      input.addEventListener("change", async () => {
        const f = input.files[0];
        if (!f) return;
        if (!f.type.includes("pdf") && !/\.pdf$/i.test(f.name)) return alert("Only PDF files allowed");
        try {
          const buf = await f.arrayBuffer();
          await api("/api/files/" + fid + "/version", {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(f.name), "X-Original-Name": encodeURIComponent(f.name) },
            body: buf
          });
          showToast("New version uploaded");
          render();
        } catch (err) {
          alert(err.message);
        }
      });
      input.click();
    });
  });
  document.querySelectorAll("[data-download-zip]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        await downloadPath("/api/courses/" + btn.dataset.downloadZip + "/zip", btn.dataset.name || "course.zip");
      } catch (err) {
        alert(err.message);
      }
    }));
  document.querySelectorAll("[data-del]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this file permanently?")) return;
      try {
        await api("/api/files/" + btn.dataset.del, { method: "DELETE" });
        showToast("File deleted");
        render();
      } catch (err) {
        alert(err.message);
      }
    }));
  if (counts) void counts;
}

/* ---------- PDF viewer with comments ---------- */

async function openPdf(fileId, showCourse) {
  void showCourse;
  const title = "";
  app.innerHTML += `
    <div class="modal-overlay" id="pdf-overlay">
      <div class="modal modal-wide">
        <div class="modal-actions pdf-head">
          <h2 class="pdf-title" id="pdf-title">${esc(title || "Loading...")}</h2>
          <div class="pdf-progress-wrap" id="pdf-progress-wrap" style="display:none">
            <div class="progress-bar" style="height:4px;flex:1"><div class="progress-fill" id="pdf-progress-bar" style="width:0%"></div></div>
            <span class="muted small" id="pdf-progress-pct">0%</span>
          </div>
          <button class="btn btn-outline btn-sm" id="bm-toggle">${icon("edit")} Notes</button>
          <button class="btn btn-outline btn-sm" id="ver-toggle">${icon("clock")} Versions</button>
          <button class="btn btn-outline btn-sm" id="flash-toggle">${icon("book")} Flashcards</button>
          <button class="btn btn-outline" id="pdf-close">Close</button>
        </div>
        <div class="pdf-body">
          <iframe class="pdf-frame" id="pdf-frame" title="PDF preview"></iframe>
          <div class="comments" id="comments"></div>
          <div class="bm-panel hidden" id="bm-panel">
            <h3>Notes</h3>
            <form id="bm-form" class="bm-add">
              <input id="bm-page" type="number" min="1" placeholder="Page" style="width:60px" />
              <input id="bm-text" placeholder="Add a note..." maxlength="500" style="flex:1" />
              <button class="btn btn-primary btn-sm">Add</button>
            </form>
            <div id="bm-list" class="bm-list"></div>
          </div>
          <div class="bm-panel hidden" id="ver-panel">
            <h3>Version History</h3>
            <div id="ver-list" class="bm-list"></div>
          </div>
          <div class="bm-panel hidden" id="flash-panel">
            <h3>Flashcards</h3>
            <p class="muted small">Auto-generated from file content</p>
            <div id="flash-container"></div>
          </div>
        </div>
      </div>
    </div>`;

  const overlay = document.getElementById("pdf-overlay");
  document.getElementById("pdf-close").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  const frame = document.getElementById("pdf-frame");
  const titleEl = document.getElementById("pdf-title");
  titleEl.textContent = "Loading...";
  frame.src = "";

  let saveTimer = null;
  const saveProgress = (pct) => {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      api("/api/files/" + fileId + "/progress", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pct }) }).catch(() => {});
    }, 2000);
  };

  frame.addEventListener("load", () => {
    const wrap = document.getElementById("pdf-progress-wrap");
    if (wrap) wrap.style.display = "flex";
    try {
      const iDoc = frame.contentDocument || frame.contentWindow.document;
      const scrollEl = iDoc.documentElement || iDoc.body;
      if (scrollEl) {
        scrollEl.addEventListener("scroll", () => {
          const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
          if (maxScroll > 0) {
            const pct = Math.round((scrollEl.scrollTop / maxScroll) * 100);
            const bar = document.getElementById("pdf-progress-bar");
            const pctEl = document.getElementById("pdf-progress-pct");
            if (bar) bar.style.width = pct + "%";
            if (pctEl) pctEl.textContent = pct + "%";
            saveProgress(pct);
          }
        });
      }
    } catch {}
  });

  try {
    const list = await api("/api/files");
    const found = list.files.find((x) => x.id === fileId);
    if (found) titleEl.textContent = found.name;
  } catch {}

  try {
    const blob = await fetchBlob("/api/files/" + fileId + "/inline");
    frame.src = URL.createObjectURL(blob);
  } catch (err) {
    titleEl.textContent = "Preview unavailable";
  }

  const bmToggle = document.getElementById("bm-toggle");
  const bmPanel = document.getElementById("bm-panel");
  const bmList = document.getElementById("bm-list");

  async function loadBookmarks() {
    try {
      const d = await api("/api/files/" + fileId + "/bookmarks");
      const bms = d.bookmarks || [];
      if (bmList) {
        bmList.innerHTML = bms.length ? bms.map((b) => `
          <div class="bm-item">
            <span class="bm-page-badge">p.${b.page}</span>
            <span class="bm-text">${esc(b.text)}</span>
            <span class="muted small">${fmtDate(b.createdAt)}</span>
            <button class="icon-btn bm-del" data-bid="${b.id}" title="Delete">${icon("close")}</button>
          </div>`).join("") : '<p class="muted small" style="text-align:center;padding:12px 0">No notes yet</p>';
        bmList.querySelectorAll(".bm-del").forEach((btn) => {
          btn.addEventListener("click", async () => {
            await api("/api/files/" + fileId + "/bookmarks/" + btn.dataset.bid, { method: "DELETE" });
            loadBookmarks();
          });
        });
      }
    } catch {}
  }

  if (bmToggle && bmPanel) {
    bmToggle.addEventListener("click", () => {
      bmPanel.classList.toggle("hidden");
      if (!bmPanel.classList.contains("hidden")) loadBookmarks();
    });
  }

  const verToggle = document.getElementById("ver-toggle");
  const verPanel = document.getElementById("ver-panel");
  const verList = document.getElementById("ver-list");

  async function loadVersions() {
    try {
      const d = await api("/api/files/" + fileId + "/versions");
      const vers = d.versions || [];
      if (verList) {
        verList.innerHTML = vers.length ? vers.reverse().map((v) => `
          <div class="bm-item">
            <span class="bm-page-badge">v${v.version}</span>
            <span class="bm-text">${fmtSize(v.size)} &middot; ${fmtDate(v.uploadedAt)}</span>
          </div>`).join("") : '<p class="muted small" style="text-align:center;padding:12px 0">No previous versions</p>';
      }
    } catch {}
  }

  if (verToggle && verPanel) {
    verToggle.addEventListener("click", () => {
      verPanel.classList.toggle("hidden");
      if (!verPanel.classList.contains("hidden")) loadVersions();
    });
  }

  const flashToggle = document.getElementById("flash-toggle");
  const flashPanel = document.getElementById("flash-panel");
  const flashContainer = document.getElementById("flash-container");

  if (flashToggle && flashPanel) {
    flashToggle.addEventListener("click", async () => {
      flashPanel.classList.toggle("hidden");
      if (!flashPanel.classList.contains("hidden") && flashContainer && !flashContainer.dataset.loaded) {
        flashContainer.innerHTML = '<p class="muted small">Generating flashcards...</p>';
        try {
          const d = await api("/api/files/" + fileId + "/flashcards");
          const cards = d.cards || [];
          if (!cards.length) {
            flashContainer.innerHTML = '<p class="muted small" style="text-align:center;padding:16px 0">No flashcards could be generated from this file. Try a file with definitions or key concepts.</p>';
          } else {
            let currentIdx = 0;
            function renderFlashcard() {
              const c = cards[currentIdx];
              flashContainer.innerHTML = `
                <div class="flashcard" id="flashcard">
                  <div class="flashcard-inner" id="flashcard-inner">
                    <div class="flashcard-front">
                      <p class="flashcard-label">Q${currentIdx + 1}/${cards.length}</p>
                      <p class="flashcard-text">${esc(c.front)}</p>
                      <p class="muted small" style="margin-top:auto">Tap to reveal</p>
                    </div>
                    <div class="flashcard-back">
                      <p class="flashcard-label">A${currentIdx + 1}/${cards.length}</p>
                      <p class="flashcard-text">${esc(c.back)}</p>
                      <p class="muted small" style="margin-top:auto">Tap to flip</p>
                    </div>
                  </div>
                </div>
                <div class="flashcard-nav">
                  <button class="btn btn-outline btn-sm" id="fc-prev" ${currentIdx === 0 ? "disabled" : ""}>Prev</button>
                  <span class="muted small">${currentIdx + 1} / ${cards.length}</span>
                  <button class="btn btn-outline btn-sm" id="fc-next" ${currentIdx === cards.length - 1 ? "disabled" : ""}>Next</button>
                </div>`;
              document.getElementById("flashcard").addEventListener("click", () => {
                document.getElementById("flashcard-inner").classList.toggle("flipped");
              });
              document.getElementById("fc-prev")?.addEventListener("click", (e) => { e.stopPropagation(); if (currentIdx > 0) { currentIdx--; renderFlashcard(); } });
              document.getElementById("fc-next")?.addEventListener("click", (e) => { e.stopPropagation(); if (currentIdx < cards.length - 1) { currentIdx++; renderFlashcard(); } });
            }
            renderFlashcard();
          }
          flashContainer.dataset.loaded = "1";
        } catch {
          flashContainer.innerHTML = '<p class="muted small">Failed to generate flashcards.</p>';
        }
      }
    });
  }

  const bmForm = document.getElementById("bm-form");
  if (bmForm) {
    bmForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = document.getElementById("bm-text").value.trim();
      if (!text) return;
      try {
        await api("/api/files/" + fileId + "/bookmarks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, page: document.getElementById("bm-page").value || 1 })
        });
        document.getElementById("bm-text").value = "";
        loadBookmarks();
      } catch (err) {
        alert(err.message);
      }
    });
  }

  await loadComments(fileId);
}

function renderMentionText(text) {
  return esc(text).replace(/@(\w+)/g, '<a class="mention" href="#/profile/$1" data-mention="$1">@$1</a>');
}

async function loadComments(fileId) {
  const box = document.getElementById("comments");
  if (!box) return;
  let comments = [];
  try {
    comments = (await api("/api/files/" + fileId + "/comments")).comments;
  } catch {}
  const isAdmin = state.user && state.user.role === "admin";
  box.innerHTML = `
    <h3>Discussion (${comments.length})</h3>
    <div class="comment-input-wrap">
      <form id="comment-form">
        <input id="comment-input" placeholder="Ask about this material... Use @ to mention" maxlength="2000" autocomplete="off" />
        <button class="btn btn-primary btn-sm">Post</button>
      </form>
      <div class="mention-dropdown hidden" id="mention-dropdown"></div>
    </div>
    <div class="comment-list">
      ${comments.length ? comments.map((c) => `
        <div class="comment">
          <a class="comment-author" href="#/profile/${c.userId}">${esc(c.username)}</a>
          <span class="muted">${fmtDate(c.at)}</span>
          ${isAdmin || (state.user && c.userId === state.user.id)
            ? `<button class="comment-del" data-cid="${c.id}" title="Delete">${icon("close")}</button>` : ""}
          <p>${renderMentionText(c.text)}</p>
          </div>`).join("") : `<div class="empty-state"><div class="empty-icon">${icon("chat")}</div><h3>No discussion yet</h3><p>Start a conversation about this material.</p></div>`}
    </div>`;

  document.getElementById("comment-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("comment-input");
    const text = input.value.trim();
    if (!text) return;
    try {
      await api("/api/files/" + fileId + "/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });
      await loadComments(fileId);
    } catch (err) {
      alert(err.message);
    }
  });

  const input = document.getElementById("comment-input");
  const dropdown = document.getElementById("mention-dropdown");
  let mentionQuery = null;
  let mentionStart = -1;

  if (input && dropdown) {
    input.addEventListener("input", async () => {
      const val = input.value;
      const pos = input.selectionStart;
      const before = val.slice(0, pos);
      const atMatch = before.match(/@(\w*)$/);
      if (atMatch) {
        mentionQuery = atMatch[1];
        mentionStart = pos - atMatch[0].length;
        try {
          const d = await api("/api/users/search?q=" + encodeURIComponent(mentionQuery));
          if (d.users && d.users.length) {
            dropdown.innerHTML = d.users.map((u) =>
              `<div class="mention-item" data-username="${esc(u.username)}">@${esc(u.username)} <span class="muted small">${esc(u.role)}</span></div>`
            ).join("");
            dropdown.classList.remove("hidden");
          } else {
            dropdown.classList.add("hidden");
          }
        } catch {}
      } else {
        dropdown.classList.add("hidden");
        mentionQuery = null;
        mentionStart = -1;
      }
    });

    dropdown.addEventListener("mousedown", (e) => {
      const item = e.target.closest(".mention-item");
      if (!item) return;
      e.preventDefault();
      const username = item.dataset.username;
      const before = input.value.slice(0, mentionStart);
      const after = input.value.slice(input.selectionStart);
      input.value = before + "@" + username + " " + after;
      dropdown.classList.add("hidden");
      mentionQuery = null;
      input.focus();
    });

    input.addEventListener("blur", () => {
      setTimeout(() => dropdown.classList.add("hidden"), 200);
    });
  }

  document.querySelectorAll(".comment-del").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this comment?")) return;
      try {
        await api("/api/files/" + fileId + "/comments/" + btn.dataset.cid, { method: "DELETE" });
        await loadComments(fileId);
      } catch (err) {
        alert(err.message);
      }
    }));
}

/* ---------- navigation ---------- */

async function renderNav() {
  let notifHtml = "";
  if (state.user) {
    let notifications = [];
    try {
      notifications = (await api("/api/notifications")).notifications;
    } catch {}
    const unread = notifications.filter((n) => !n.read).length;
    notifHtml = `
      <a href="#/notifications" class="notif-link" title="Notifications" aria-label="Notifications">
        ${icon("bell")}
        ${unread ? `<span class="notif-dot">${unread > 9 ? "9+" : unread}</span>` : ""}
      </a>`;
  }

  navLinks.innerHTML = state.user
    ? `
      <a href="#/" class="nav-link">Courses</a>
      <a href="#/saved" class="nav-link">Saved</a>
      <a href="#/groups" class="nav-link">Groups</a>
      <a href="#/settings" class="nav-link">Settings</a>
      ${state.user.role === "admin" ? '<a href="#/admin" class="nav-link">Admin</a>' : ""}
      ${notifHtml}
      <button class="icon-btn" id="theme-btn" title="Toggle theme" aria-label="Toggle theme">${state.theme === "dark" ? icon("sun") : icon("moon")}</button>
      <span class="nav-user">${esc(state.user.username)} <small>(${esc(state.user.role)})</small></span>`
    : `
      <a href="#/login" class="nav-link">Log in</a>
      <a href="#/onboard" class="btn btn-primary">Sign up</a>`;

  const bottomNav = document.getElementById("bottom-nav");
  if (bottomNav) {
    const cur = location.hash.replace(/^#/, "") || "/";
    const isAuthPage = !state.user && ["/login", "/register", "/verify", "/forgot", "/onboard"].includes(cur);
    const isOnboard = !state.user && cur === "/onboard";
    document.body.classList.toggle("auth-page", isAuthPage);
    document.body.classList.toggle("onboard-page", isOnboard);
    if (isAuthPage) {
      bottomNav.style.display = "none";
      bottomNav.innerHTML = "";
    } else {
      bottomNav.style.display = "";
      const items = state.user
        ? [
            { path: "/", label: "Home", icon: "home" },
            { path: "/courses", label: "Courses", icon: "book" },
            { path: "/saved", label: "Saved", icon: "star" },
            { path: "/settings", label: "Profile", icon: "user" }
          ]
        : [
            { path: "/login", label: "Log in", icon: "key" },
            { path: "/onboard", label: "Sign up", icon: "edit" }
          ];
      bottomNav.innerHTML = items
        .map((it) => {
          const seg = cur.split("?")[0].split("/").filter(Boolean)[0];
          const itSeg = it.path.split("/").filter(Boolean)[0];
          const active = seg === itSeg || (cur.split("?")[0] === "/" && it.path === "/");
          return `<a href="#${it.path}" class="bn-item${active ? " active" : ""}" data-path="${it.path}"><span class="bn-icon">${icon(it.icon)}</span><span>${it.label}</span></a>`;
        })
        .join("");
    }
  }

  const themeBtn = document.getElementById("theme-btn");
  if (themeBtn) themeBtn.addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    localStorage.setItem("theme", state.theme);
    applyTheme();
    renderNav();
  });
}

function shell(inner) {
  return inner + (state.toast
    ? `<div class="toast" role="status" aria-live="polite">${esc(state.toast)}</div>`
    : `<div aria-live="polite" class="sr-only" id="toast-region"></div>`);
}

async function render() {
  try { renderNav(); } catch {}
  const hash = location.hash.replace(/^#/, "") || "/";
  try {
    if (hash === "/login") { renderLogin(); return; }
    if (hash === "/onboard") { renderOnboard(); return; }
    if (hash.startsWith("/register")) { renderRegister(); return; }
    if (hash === "/verify") { renderVerify(); return; }
    if (hash === "/forgot") { renderForgot(); return; }
    else if (hash.startsWith("/profile/")) { await renderProfile(hash); }
    else if (hash.startsWith("/collection/")) { await renderCollectionDetail(hash); }
    else if (hash === "/groups") { await renderGroups(); }
    else if (hash.startsWith("/group/")) { await renderGroupDetail(hash); }
    else if (hash === "/saved") { await renderSaved(); }
    else if (hash === "/settings") { await renderSettings(); }
    else if (hash === "/admin") { await renderAdmin(); }
    else if (hash === "/notifications") { await renderNotifications(); }
    else if (hash.startsWith("/courses")) { await renderCourses(hash); }
    else if (hash.startsWith("/course/")) { await renderCourseDetail(hash); }
    else if (hash.startsWith("/tag/")) { await renderTagFiles(hash); }
    else { await renderHome(); }
    window.scrollTo({ top: 0 });
  } catch (err) {
    console.error("render error:", err);
    app.innerHTML = `<div style="padding:40px 20px;text-align:center">
      <h2>Something went wrong</h2>
      <p style="color:var(--muted)">${esc(err.message)}</p>
      <button class="btn btn-primary" onclick="location.reload()" style="margin-top:12px">Retry</button>
    </div>`;
    window.scrollTo({ top: 0 });
  }
}

/* ---------- auth views ---------- */

function authShell(card) {
  return `
    <div class="auth-wrap">
      <div class="auth-brand">
        <span class="auth-logo">${icon("grad")}</span>
        <span class="auth-name"><span class="n-course">Course</span> <span class="n-lib">Library</span></span>
        <p class="auth-tag">Learn smarter. Everything you need in one place.</p>
      </div>
      ${card}
      <p class="auth-secure">${icon("shield")}<span>Your data is secure and encrypted</span></p>
    </div>`;
}

function renderLogin() {
  if (state.user) return (location.hash = "#/");
  app.innerHTML = authShell(`
    <form class="auth-card" id="login-form">
      <h1>Welcome back <span class="wave">&#128075;</span></h1>
      <p class="muted">Log in to continue your learning journey.</p>
      <div class="field">
        <label for="login-email">Email / Username</label>
        <div class="input-wrap">
          <span class="input-icon">${icon("mail")}</span>
          <input id="login-email" placeholder="Enter your email or username" autocomplete="username" autofocus />
        </div>
      </div>
      <div class="field">
        <label for="login-pass">Password</label>
        <div class="input-wrap has-toggle">
          <span class="input-icon">${icon("lock")}</span>
          <input id="login-pass" type="password" placeholder="Enter your password" autocomplete="current-password" />
          <button type="button" class="pass-toggle" id="pass-toggle" aria-label="Show password">${icon("eye")}</button>
        </div>
      </div>
      <div class="auth-row"><a href="#/forgot">Forgot password?</a></div>
      <p class="error" id="login-error"></p>
      <button class="btn btn-primary btn-block btn-lg" id="login-btn">Log in</button>
      <div class="auth-or"><span></span><em>or</em><span></span></div>
      <p class="auth-switch">Don't have an account?</p>
      <button type="button" class="btn btn-ghost btn-block btn-lg" id="signup-btn">Sign up</button>
    </form>`);
  document.getElementById("pass-toggle").addEventListener("click", () => {
    const input = document.getElementById("login-pass");
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    document.getElementById("pass-toggle").innerHTML = icon(show ? "eyeOff" : "eye");
  });
  const loginBtn = document.getElementById("login-btn");
  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = document.getElementById("login-error");
    errEl.textContent = "";
    const done = btnLoading(loginBtn, "Logging in");
    try {
      const d = await api("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: document.getElementById("login-email").value,
          password: document.getElementById("login-pass").value
        })
      });
      storeAuth(d);
      location.hash = "#/";
    } catch (err) {
      errEl.textContent = err.message;
    } finally {
      done();
    }
  });
  document.getElementById("signup-btn").addEventListener("click", () => (location.hash = "#/onboard"));
}

function renderOnboard() {
  if (state.user) return (location.hash = "#/");
  const step = state.onboardStep || 1;
  const steps = [onboardStep1, onboardStep2, onboardStep3, onboardStep4, onboardStep5, onboardStep6];
  const fn = steps[step - 1];
  if (fn) fn();
}

function onboardProgress(current, total) {
  const pct = (current / total) * 100;
  return `<div class="onboard-progress"><div class="onboard-progress-bar"><div class="onboard-progress-fill" style="width:${pct}%"></div></div><span class="onboard-step-label">Step ${current} of ${total}</span></div>`;
}

function onboardBack() {
  if (state.onboardStep > 1) {
    state.onboardStep--;
    renderOnboard();
  } else {
    location.hash = "#/";
  }
}

function onboardNext(data) {
  Object.assign(state.onboardData, data);
  state.onboardStep = (state.onboardStep || 1) + 1;
  renderOnboard();
}

function onboardFinish(data) {
  Object.assign(state.onboardData, data);
}

function onboardCard(content) {
  return authShell(`
    <div class="auth-card">
      ${content}
    </div>`);
}

/* Screen 1 — Welcome */
function onboardStep1() {
  state.onboardData = {};
  app.innerHTML = onboardCard(`
    <div class="onboard-welcome">
      <h1>Welcome to Course Library</h1>
      <p class="muted">Your university. Your courses. Everything you need to learn.</p>
      <div class="onboard-cards">
        <button class="onboard-card" data-role="student">
          <div class="onboard-ico">${icon("book")}</div>
          <h3>I'm a Student</h3>
          <p class="muted small">Find courses, access materials, and keep learning.</p>
        </button>
        <button class="onboard-card" data-role="lecturer">
          <div class="onboard-ico">${icon("grad")}</div>
          <h3>Lecturer / Admin</h3>
          <p class="muted small">Manage courses, materials, and announcements.</p>
        </button>
      </div>
    </div>
    <p class="auth-switch">Already have an account? <a href="#/login">Log in</a></p>
  `);
  document.querySelectorAll(".onboard-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      const role = btn.dataset.role;
      if (role === "student") {
        state.onboardData = { role: "student" };
        state.onboardStep = 2;
        renderOnboard();
      } else {
        location.hash = "#/register?role=lecturer";
      }
    });
  });
}

/* Screen 2 — Create Student Account */
function onboardStep2() {
  app.innerHTML = onboardCard(`
    ${onboardProgress(1, 4)}
    <button class="onboard-back-btn" id="onboard-back">${icon("chevronLeft")} Back</button>
    <h1>Create your student account</h1>
    <p class="muted">Create an account to build your personalized Course Library.</p>
    <label>Email <input id="ob-email" type="email" placeholder="you@example.com" /></label>
    <label>Nickname (optional) <input id="ob-user" placeholder="shown to classmates" /></label>
    <label>Password <div class="input-wrap"><input id="ob-pass" type="password" /><button type="button" class="pass-toggle" id="ob-pass-toggle">${icon("eye")}</button></div></label>
    <label>Confirm Password <div class="input-wrap"><input id="ob-pass2" type="password" /><button type="button" class="pass-toggle" id="ob-pass2-toggle">${icon("eye")}</button></div></label>
    <div class="opt-fields">
      <p class="muted small">Optional recovery info — helps you reset your password if you forget it.</p>
      <label>Recovery question <input id="ob-q" placeholder="e.g. What city were you born in?" /></label>
      <label>Answer <input id="ob-a" placeholder="your answer" /></label>
    </div>
    <p class="error" id="ob-error"></p>
    <button class="btn btn-primary btn-block btn-lg" id="ob-next">Continue</button>
    <p class="auth-switch">Already have an account? <a href="#/login">Log in</a></p>
  `);
  document.getElementById("onboard-back").addEventListener("click", onboardBack);
  setupPassToggle("ob-pass", "ob-pass-toggle");
  setupPassToggle("ob-pass2", "ob-pass2-toggle");
  document.getElementById("ob-next").addEventListener("click", () => {
    const email = document.getElementById("ob-email").value.trim();
    const pw = document.getElementById("ob-pass").value;
    const pw2 = document.getElementById("ob-pass2").value;
    const errEl = document.getElementById("ob-error");
    errEl.textContent = "";
    if (!email) return (errEl.textContent = "Email is required");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !/^[^\s@]+$/.test(email)) return (errEl.textContent = "Please enter a valid email or username");
    if (pw !== pw2) return (errEl.textContent = "Passwords do not match");
    if (pw.length < 8) return (errEl.textContent = "Password must be at least 8 characters");
    if (!/[a-zA-Z]/.test(pw)) return (errEl.textContent = "Password must contain at least one letter");
    if (!/[0-9]/.test(pw)) return (errEl.textContent = "Password must contain at least one number");
    onboardNext({
      email,
      username: document.getElementById("ob-user").value,
      password: pw,
      securityQuestion: document.getElementById("ob-q").value,
      securityAnswer: document.getElementById("ob-a").value
    });
  });
}

/* Screen 3 — Select University */
async function onboardStep3() {
  app.innerHTML = onboardCard(`
    ${onboardProgress(2, 4)}
    <button class="onboard-back-btn" id="onboard-back">${icon("chevronLeft")} Back</button>
    <h1>Where do you study?</h1>
    <p class="muted">Select your university to personalize your Course Library.</p>
    <div class="onboard-search-wrap">
      <input id="ob-school-search" type="text" placeholder="Search your university..." class="onboard-search" />
    </div>
    <div class="onboard-school-list" id="ob-schools">
      <div class="onboard-loading">Loading universities...</div>
    </div>
    <p class="muted small onboard-cant-find" id="ob-cant-find">Can't find your university? <button class="link-btn" id="ob-request-uni">Request your university</button></p>
    <div id="ob-request-form" style="display:none">
      <label>University name <input id="ob-req-name" placeholder="e.g. University of Lagos" /></label>
      <label>Your email (optional) <input id="ob-req-email" type="email" placeholder="so we can notify you" /></label>
      <button class="btn btn-primary btn-block" id="ob-req-submit">Submit request</button>
      <p class="muted small" id="ob-req-msg"></p>
    </div>
  `);
  document.getElementById("onboard-back").addEventListener("click", onboardBack);
  let schoolsData = [];
  try {
    const d = await api("/api/schools");
    schoolsData = d.schools || [];
  } catch {}
  const listEl = document.getElementById("ob-schools");
  const savedUni = state.onboardData.university || "";
  function renderSchools(filter) {
    const q = (filter || "").toLowerCase();
    const filtered = q ? schoolsData.filter((s) => s.name.toLowerCase().includes(q)) : schoolsData;
    if (!filtered.length) {
      listEl.innerHTML = `<div class="onboard-empty">No universities found</div>`;
      return;
    }
    listEl.innerHTML = filtered.map((s) =>
      `<button class="onboard-school-item${s.id === savedUni ? " selected" : ""}" data-id="${s.id}">${s.name}</button>`
    ).join("");
    listEl.querySelectorAll(".onboard-school-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        listEl.querySelectorAll(".onboard-school-item").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        onboardNext({ university: btn.dataset.id, universityName: btn.textContent });
      });
    });
  }
  renderSchools("");
  document.getElementById("ob-school-search").addEventListener("input", (e) => renderSchools(e.target.value));
  document.getElementById("ob-request-uni").addEventListener("click", () => {
    document.getElementById("ob-request-form").style.display = "block";
    document.getElementById("ob-cant-find").style.display = "none";
  });
  document.getElementById("ob-req-submit").addEventListener("click", async () => {
    const name = document.getElementById("ob-req-name").value.trim();
    const email = document.getElementById("ob-req-email").value.trim();
    const msg = document.getElementById("ob-req-msg");
    if (!name) return (msg.textContent = "Please enter a university name");
    try {
      await api("/api/university-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email })
      });
      msg.textContent = "Request submitted! We'll add it soon.";
      msg.style.color = "var(--success)";
    } catch (err) {
      msg.textContent = err.message || "Request submitted!";
      msg.style.color = "var(--success)";
    }
  });
}

/* Screen 4 — Academic Profile */
async function onboardStep4() {
  app.innerHTML = onboardCard(`
    ${onboardProgress(3, 4)}
    <button class="onboard-back-btn" id="onboard-back">${icon("chevronLeft")} Back</button>
    <h1>What do you study?</h1>
    <p class="muted">Tell us about your programme to find the right courses.</p>
    <label>Faculty / School
      <select id="ob-faculty"><option value="">Select faculty</option></select>
    </label>
    <label>Department
      <select id="ob-dept" disabled><option value="">Select faculty first</option></select>
    </label>
    <label>Current Level
      <select id="ob-level"><option value="">Select level</option><option value="100">100 Level</option><option value="200">200 Level</option><option value="300">300 Level</option><option value="400">400 Level</option><option value="500">500 Level</option><option value="600">600 Level</option></select>
    </label>
    <label>Matric number (optional) <input id="ob-matric" placeholder="e.g. UNILAG/2024/001" /></label>
    <p class="error" id="ob-error"></p>
    <button class="btn btn-primary btn-block btn-lg" id="ob-next">Continue</button>
  `);
  document.getElementById("onboard-back").addEventListener("click", onboardBack);
  let schoolsData = [];
  try {
    const d = await api("/api/schools");
    schoolsData = d.schools || [];
  } catch {}
  const school = schoolsData.find((s) => s.id === state.onboardData.university);
  const facSel = document.getElementById("ob-faculty");
  const deptSel = document.getElementById("ob-dept");
  const levelSel = document.getElementById("ob-level");
  if (school) {
    school.faculties.forEach((f) => {
      const opt = document.createElement("option");
      opt.value = f.name;
      opt.textContent = f.name;
      facSel.appendChild(opt);
    });
  }
  facSel.addEventListener("change", () => {
    deptSel.innerHTML = '<option value="">Select department</option>';
    const fac = school && school.faculties.find((f) => f.name === facSel.value);
    if (!fac) { deptSel.disabled = true; return; }
    deptSel.disabled = false;
    fac.departments.forEach((d) => {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = d;
      deptSel.appendChild(opt);
    });
  });
  document.getElementById("ob-next").addEventListener("click", () => {
    const errEl = document.getElementById("ob-error");
    errEl.textContent = "";
    if (!facSel.value) return (errEl.textContent = "Please select your faculty");
    if (!deptSel.value) return (errEl.textContent = "Please select your department");
    if (!levelSel.value) return (errEl.textContent = "Please select your level");
    const fac = school && school.faculties.find((f) => f.name === facSel.value);
    onboardNext({
      faculty: facSel.value,
      department: deptSel.value,
      level: levelSel.value,
      matricNumber: document.getElementById("ob-matric").value,
      studentType: fac ? fac.type : ""
    });
  });
}

/* Screen 5 — Course Discovery */
function onboardStep5() {
  const demoCourses = generateDemoCourses();
  state.onboardData.selectedCourses = demoCourses.map((c) => c.code);
  app.innerHTML = onboardCard(`
    ${onboardProgress(4, 4)}
    <button class="onboard-back-btn" id="onboard-back">${icon("chevronLeft")} Back</button>
    <h1>We found your courses 🎉</h1>
    <p class="muted">These are the courses available for your programme and level.</p>
    <div class="onboard-course-list" id="ob-courses">
      ${demoCourses.map((c) => `
        <label class="onboard-course-item">
          <input type="checkbox" value="${c.code}" checked class="ob-course-check" />
          <div class="onboard-course-info">
            <span class="onboard-course-code">${c.code}</span>
            <span class="onboard-course-title">${c.title}</span>
          </div>
        </label>
      `).join("")}
    </div>
    <div class="onboard-course-actions">
      <button class="btn btn-ghost btn-block" id="ob-select-all">Select All</button>
    </div>
    <button class="btn btn-primary btn-block btn-lg" id="ob-next">Continue to Course Library</button>
  `);
  document.getElementById("onboard-back").addEventListener("click", onboardBack);
  document.getElementById("ob-select-all").addEventListener("click", () => {
    const checks = document.querySelectorAll(".ob-course-check");
    const allChecked = Array.from(checks).every((c) => c.checked);
    checks.forEach((c) => (c.checked = !allChecked));
    document.getElementById("ob-select-all").textContent = allChecked ? "Select All" : "Deselect All";
  });
  document.getElementById("ob-next").addEventListener("click", () => {
    const selected = Array.from(document.querySelectorAll(".ob-course-check:checked")).map((c) => c.value);
    state.onboardData.selectedCourses = selected;
    state.onboardStep = 6;
    renderOnboard();
  });
}

function generateDemoCourses() {
  const dept = state.onboardData.department || "";
  const level = state.onboardData.level || "100";
  const prefix = level.charAt(0);
  const baseCourses = [
    { code: `GST${prefix}01`, title: "Communication in English" },
    { code: `GST${prefix}02`, title: "Nigerian Peoples and Culture" },
    { code: `CSC${prefix}01`, title: "Introduction to Computer Science" },
    { code: `CSC${prefix}02`, title: "Computer Programming I" },
    { code: `MTH${prefix}01`, title: "Elementary Mathematics I" },
    { code: `PHY${prefix}01`, title: "General Physics I" },
    { code: `CHM${prefix}01`, title: "General Chemistry I" },
    { code: `BIO${prefix}01`, title: "General Biology I" },
    { code: `STA${prefix}01`, title: "Introduction to Statistics" },
    { code: `ECN${prefix}01`, title: "Principles of Economics" }
  ];
  if (dept.toLowerCase().includes("computer")) {
    return baseCourses.filter((c) => c.code.startsWith("CSC") || c.code.startsWith("GST") || c.code.startsWith("MTH"));
  }
  return baseCourses.slice(0, 6);
}

/* Screen 6 — Complete */
function onboardStep6() {
  const data = state.onboardData;
  app.innerHTML = onboardCard(`
    <div class="onboard-complete">
      <div class="onboard-complete-icon">${icon("check")}</div>
      <h1>You're all set!</h1>
      <p class="muted">Welcome to Course Library. Your academic space is ready.</p>
      <div class="onboard-summary">
        <div class="onboard-summary-row"><span class="muted">University</span><strong>${esc(data.universityName || "")}</strong></div>
        <div class="onboard-summary-row"><span class="muted">Faculty</span><strong>${esc(data.faculty || "")}</strong></div>
        <div class="onboard-summary-row"><span class="muted">Department</span><strong>${esc(data.department || "")}</strong></div>
        <div class="onboard-summary-row"><span class="muted">Level</span><strong>${esc(data.level || "")} Level</strong></div>
        <div class="onboard-summary-row"><span class="muted">Courses</span><strong>${(data.selectedCourses || []).length} selected</strong></div>
      </div>
      <button class="btn btn-primary btn-block btn-lg" id="ob-finish">Continue to Course Library</button>
    </div>
  `);
  document.getElementById("ob-finish").addEventListener("click", async () => {
    const btn = document.getElementById("ob-finish");
    const done = btnLoading(btn, "Setting up");
    try {
      const d = await api("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: data.email,
          username: data.username,
          password: data.password,
          school: data.university,
          faculty: data.faculty,
          department: data.department,
          level: data.level,
          matricNumber: data.matricNumber || "",
          studentType: data.studentType || "",
          securityQuestion: data.securityQuestion || "",
          securityAnswer: data.securityAnswer || ""
        })
      });
      storeAuth(d);
      state.onboardStep = 1;
      state.onboardData = {};
      showToast(d.message || "Welcome to Course Library!");
      location.hash = "#/";
    } catch (err) {
      showToast(err.message, true);
    } finally {
      done();
    }
  });
}

function setupPassToggle(inputId, toggleId) {
  const input = document.getElementById(inputId);
  const btn = document.getElementById(toggleId);
  if (!input || !btn) return;
  btn.addEventListener("click", () => {
    const isPass = input.type === "password";
    input.type = isPass ? "text" : "password";
    btn.innerHTML = isPass ? icon("eyeOff") : icon("eye");
  });
}

function renderRegister() {
  if (state.user) return (location.hash = "#/");
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const roleParam = params.get("role") || "student";
  if (roleParam === "student") {
    state.onboardStep = 1;
    return renderOnboard();
  }
  app.innerHTML = authShell(`
    <form class="auth-card" id="reg-form">
      <h1>Create lecturer/admin account</h1>
      <p class="muted">Enter the admin invite code to join as an administrator.</p>
      <label>Email <input id="reg-email" type="email" placeholder="you@university.edu.ng" /></label>
      <label>Nickname (optional) <input id="reg-user" placeholder="shown to colleagues" /></label>
      <label>Password <div class="input-wrap"><input id="reg-pass" type="password" /><button type="button" class="pass-toggle" id="reg-pass-toggle">${icon("eye")}</button></div></label>
      <label>Confirm password <div class="input-wrap"><input id="reg-pass2" type="password" /><button type="button" class="pass-toggle" id="reg-pass2-toggle">${icon("eye")}</button></div></label>
      <label>Admin invite code <input id="reg-invite" placeholder="enter invite code" /></label>
      <div class="opt-fields">
        <p class="muted small">Optional recovery info — lets you reset your password if you forget it.</p>
        <label>Recovery question <input id="reg-q" placeholder="e.g. What city were you born in?" /></label>
        <label>Answer <input id="reg-a" placeholder="your answer" /></label>
      </div>
      <p class="error" id="reg-error"></p>
      <button class="btn btn-primary btn-block btn-lg" type="submit">Sign up</button>
      <p class="auth-switch">Already registered? <a href="#/login">Log in</a></p>
    </form>`);
  initLecturerRegForm();
  setupPassToggle("reg-pass", "reg-pass-toggle");
  setupPassToggle("reg-pass2", "reg-pass2-toggle");
}

async function initStudentRegForm() {
  let schoolsData = [];
  try {
    const d = await api("/api/schools");
    schoolsData = d.schools || [];
  } catch {}

  const schoolSel = document.getElementById("reg-school");
  const facSel = document.getElementById("reg-faculty");
  const deptSel = document.getElementById("reg-dept");
  const levelSel = document.getElementById("reg-level");

  schoolsData.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.name;
    schoolSel.appendChild(opt);
  });

  schoolSel.addEventListener("change", () => {
    facSel.innerHTML = '<option value="">Select faculty</option>';
    deptSel.innerHTML = '<option value="">Select faculty first</option>';
    deptSel.disabled = true;
    const school = schoolsData.find((s) => s.id === schoolSel.value);
    if (!school) { facSel.disabled = true; return; }
    facSel.disabled = false;
    school.faculties.forEach((f) => {
      const opt = document.createElement("option");
      opt.value = f.name;
      opt.textContent = f.name;
      facSel.appendChild(opt);
    });
  });

  facSel.addEventListener("change", () => {
    deptSel.innerHTML = '<option value="">Select department</option>';
    const school = schoolsData.find((s) => s.id === schoolSel.value);
    const fac = school && school.faculties.find((f) => f.name === facSel.value);
    if (!fac) { deptSel.disabled = true; return; }
    deptSel.disabled = false;
    fac.departments.forEach((d) => {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = d;
      deptSel.appendChild(opt);
    });
  });

  document.getElementById("reg-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = document.getElementById("reg-pass").value;
    if (pw !== document.getElementById("reg-pass2").value) {
      return (document.getElementById("reg-error").textContent = "Passwords do not match");
    }
    if (pw.length < 8) {
      return (document.getElementById("reg-error").textContent = "Password must be at least 8 characters");
    }
    if (!/[a-zA-Z]/.test(pw)) {
      return (document.getElementById("reg-error").textContent = "Password must contain at least one letter");
    }
    if (!/[0-9]/.test(pw)) {
      return (document.getElementById("reg-error").textContent = "Password must contain at least one number");
    }
    if (!schoolSel.value) {
      return (document.getElementById("reg-error").textContent = "Please select your school");
    }
    if (!facSel.value) {
      return (document.getElementById("reg-error").textContent = "Please select your faculty");
    }
    if (!levelSel.value) {
      return (document.getElementById("reg-error").textContent = "Please select your level");
    }
    const school = schoolsData.find((s) => s.id === schoolSel.value);
    const fac = school && school.faculties.find((f) => f.name === facSel.value);
    const studentType = fac ? fac.type : "";
    const submitBtn = document.querySelector("#reg-form button[type=submit]");
    const done = btnLoading(submitBtn, "Creating account");
    try {
      const d = await api("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: document.getElementById("reg-email").value,
          username: document.getElementById("reg-user").value,
          password: pw,
          school: schoolSel.value,
          faculty: facSel.value,
          department: deptSel.value,
          level: levelSel.value,
          matricNumber: document.getElementById("reg-matric").value,
          studentType,
          securityQuestion: document.getElementById("reg-q").value,
          securityAnswer: document.getElementById("reg-a").value
        })
      });
      storeAuth(d);
      showToast(d.message || "Account created! Welcome.");
      location.hash = "#/";
    } catch (err) {
      document.getElementById("reg-error").textContent = err.message;
    } finally {
      done();
    }
  });
}

function initLecturerRegForm() {
  document.getElementById("reg-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = document.getElementById("reg-pass").value;
    if (pw !== document.getElementById("reg-pass2").value) {
      return (document.getElementById("reg-error").textContent = "Passwords do not match");
    }
    if (pw.length < 8) {
      return (document.getElementById("reg-error").textContent = "Password must be at least 8 characters");
    }
    if (!/[a-zA-Z]/.test(pw)) {
      return (document.getElementById("reg-error").textContent = "Password must contain at least one letter");
    }
    if (!/[0-9]/.test(pw)) {
      return (document.getElementById("reg-error").textContent = "Password must contain at least one number");
    }
    const invite = document.getElementById("reg-invite").value.trim();
    if (!invite) {
      return (document.getElementById("reg-error").textContent = "Admin invite code is required");
    }
    const submitBtn = document.querySelector("#reg-form button[type=submit]");
    const done = btnLoading(submitBtn, "Creating account");
    try {
      const d = await api("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: document.getElementById("reg-email").value,
          username: document.getElementById("reg-user").value,
          password: pw,
          inviteCode: invite,
          securityQuestion: document.getElementById("reg-q").value,
          securityAnswer: document.getElementById("reg-a").value
        })
      });
      storeAuth(d);
      showToast(d.message || "Account created! Welcome.");
      location.hash = "#/";
    } catch (err) {
      document.getElementById("reg-error").textContent = err.message;
    } finally {
      done();
    }
  });
}

function renderVerify() {
  if (state.user) return (location.hash = "#/");
  const email = localStorage.getItem("pendingEmail") || "";
  let devCode = localStorage.getItem("devCode") || "";
  app.innerHTML = authShell(`
      <div class="auth-card">
        <h1>Verify your email</h1>
        <p class="muted">Enter the 6-digit code we sent to your email to activate your account.</p>
        <label>Student email <input id="vf-email" value="${esc(email)}" /></label>
        <label>Verification code <input id="vf-code" maxlength="6" placeholder="000000" autofocus /></label>
        <p class="dev-code ${devCode ? "" : "hidden"}" id="vf-dev">
          Dev mode — no email server configured. Your code is <strong>${esc(devCode)}</strong>.
        </p>
        <p class="error" id="vf-error"></p>
        <button class="btn btn-primary btn-block btn-lg" id="vf-btn">Verify &amp; continue</button>
        <p class="auth-switch"><a href="#" id="vf-resend">Resend code</a> &middot; <a href="#/login">Log in</a></p>
      </div>`);
  const errEl = document.getElementById("vf-error");
  const devEl = document.getElementById("vf-dev");
  document.getElementById("vf-btn").addEventListener("click", async () => {
    errEl.textContent = "";
    try {
      const d = await api("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: document.getElementById("vf-email").value,
          code: document.getElementById("vf-code").value
        })
      });
      storeAuth(d);
      localStorage.removeItem("pendingEmail");
      localStorage.removeItem("devCode");
      showToast("Email verified. Welcome!");
      location.hash = "#/";
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
  document.getElementById("vf-resend").addEventListener("click", async (e) => {
    e.preventDefault();
    errEl.textContent = "";
    try {
      const d = await api("/api/auth/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: document.getElementById("vf-email").value })
      });
      if (d.devCode) {
        localStorage.setItem("devCode", d.devCode);
        devEl.innerHTML = "Dev mode — no email server configured. Your code is <strong>" + esc(d.devCode) + "</strong>.";
        devEl.classList.remove("hidden");
      }
      showToast(d.message || "Code sent.");
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}

/* ---------- forgot password ---------- */

function renderForgot() {
  if (state.user) return (location.hash = "#/");
  app.innerHTML = authShell(`
      <form class="auth-card" id="forgot-form">
        <h1>Reset password</h1>
        <p class="muted">Enter your email or username and answer your recovery question to set a new password.</p>
        <label>Student email or username <input id="fg-user" autofocus /></label>
        <div class="hidden" id="fg-q-wrap">
          <label id="fg-q-label">Recovery question</label>
          <label>Answer <input id="fg-a" /></label>
          <label>New password <input id="fg-pass" type="password" /></label>
          <label>Confirm new password <input id="fg-pass2" type="password" /></label>
        </div>
        <p class="error" id="fg-error"></p>
        <button class="btn btn-primary btn-block btn-lg" id="fg-btn">Continue</button>
        <p class="auth-switch">Remembered it? <a href="#/login">Log in</a></p>
      </form>`);

  let question = null;
  const btn = document.getElementById("fg-btn");
  const error = document.getElementById("fg-error");

  btn.addEventListener("click", async () => {
    error.textContent = "";
    if (!question) {
      try {
        const d = await api("/api/auth/forgot/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: document.getElementById("fg-user").value })
        });
        if (!d.question) {
          error.textContent = "This account has no recovery question set. Contact an admin.";
          return;
        }
        question = d.question;
        document.getElementById("fg-q-label").innerHTML = "Recovery question: <strong>" + esc(question) + "</strong>";
        document.getElementById("fg-q-wrap").classList.remove("hidden");
        btn.textContent = "Reset password";
      } catch (err) {
        error.textContent = err.message;
      }
      return;
    }
    const pw = document.getElementById("fg-pass").value;
    if (pw !== document.getElementById("fg-pass2").value) {
      return (error.textContent = "Passwords do not match");
    }
    if (pw.length < 8) {
      return (error.textContent = "Password must be at least 8 characters");
    }
    if (!/[a-zA-Z]/.test(pw)) {
      return (error.textContent = "Password must contain at least one letter");
    }
    if (!/[0-9]/.test(pw)) {
      return (error.textContent = "Password must contain at least one number");
    }
    try {
      await api("/api/auth/forgot/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: document.getElementById("fg-user").value,
          answer: document.getElementById("fg-a").value,
          newPassword: pw
        })
      });
      showToast("Password reset. Log in with your new password.");
      location.hash = "#/login";
    } catch (err) {
      error.textContent = err.message;
    }
  });
}

/* ---------- settings ---------- */

async function renderSettings() {
  if (!state.user) return (location.hash = "#/login");
  let hasQuestion = state.user.hasSecurityQuestion;
  try {
    const me = await api("/api/me");
    state.user.hasSecurityQuestion = me.user.hasSecurityQuestion;
    hasQuestion = me.user.hasSecurityQuestion;
  } catch {}
  app.innerHTML = shell(`
    <div class="page-head">
      <div>
        <h1>Settings</h1>
        <p class="muted">Logged in as ${esc(state.user.username)} &middot; ${esc(state.user.email || "")}</p>
      </div>
    </div>
    <div class="settings-grid">
      <div class="card">
        <h3>Display name</h3>
        <p class="muted small">This is how others see you on the platform.</p>
        <form id="username-form" class="stack">
          <label>Display name <input id="username-input" value="${esc(state.user.username || "")}" /></label>
          <p class="error" id="username-error"></p>
          <button class="btn btn-primary">Update display name</button>
        </form>
      </div>
      <div class="card">
        <h3>Bio</h3>
        <p class="muted small">Tell others about yourself (shown on your profile).</p>
        <form id="bio-form" class="stack">
          <label>Bio <textarea id="bio-input" rows="3" maxlength="500" placeholder="Tell the community about yourself...">${esc(state.user.bio || "")}</textarea></label>
          <button class="btn btn-primary">Save bio</button>
        </form>
      </div>
      <div class="card">
        <h3>Change password</h3>
        <form id="pw-form" class="stack">
          <label>Current password <input id="pw-old" type="password" /></label>
          <label>New password <input id="pw-new" type="password" /></label>
          <label>Confirm new password <input id="pw-new2" type="password" /></label>
          <p class="error" id="pw-error"></p>
          <button class="btn btn-primary">Update password</button>
        </form>
      </div>
      <div class="card">
        <h3>Recovery question</h3>
        <p class="muted small">${hasQuestion ? "Set. Used to reset your password if you forget it." : "Not set yet. Add one to enable self-service password reset."}</p>
        <form id="sq-form" class="stack">
          <label>Question <input id="sq-q" placeholder="e.g. What city were you born in?" /></label>
          <label>Answer <input id="sq-a" placeholder="your answer" /></label>
          <p class="error" id="sq-error"></p>
          <button class="btn btn-primary">Save recovery question</button>
        </form>
      </div>
      <div class="card">
        <h3>Account</h3>
        <p class="muted small">Signed in as ${esc(state.user.username)}${state.user.role === "admin" ? " (admin)" : ""}</p>
        ${state.user.role === "admin" ? '<p class="muted small"><a href="#/admin" class="view-all">Open admin panel</a></p>' : ""}
        <button class="btn btn-danger" id="settings-logout">${icon("logout")} Log out</button>
      </div>
      <div class="card">
        <h3>Dark mode schedule</h3>
        <p class="muted small">Automatically switch between light and dark mode at set times.</p>
        <form id="theme-schedule-form" class="stack">
          <label class="inline-label"><input type="checkbox" id="ts-enabled" ${state.themeSchedule?.enabled ? "checked" : ""} /> Enable schedule</label>
          <label>Dark mode starts at <input type="time" id="ts-dark-start" value="${state.themeSchedule?.darkStart || '20:00'}" /></label>
          <label>Light mode starts at <input type="time" id="ts-dark-end" value="${state.themeSchedule?.darkEnd || '07:00'}" /></label>
          <button class="btn btn-primary">Save schedule</button>
        </form>
      </div>
      <div class="card">
        <h3>Notification preferences</h3>
        <p class="muted small">Choose which notifications you want to receive.</p>
        <form id="notif-prefs-form" class="stack">
          <label class="inline-label"><input type="checkbox" id="np-upload" ${state.notifPrefs?.upload !== false ? "checked" : ""} /> New uploads in my courses</label>
          <label class="inline-label"><input type="checkbox" id="np-approval" ${state.notifPrefs?.approval !== false ? "checked" : ""} /> File approval/rejection</label>
          <label class="inline-label"><input type="checkbox" id="np-comment" ${state.notifPrefs?.comment !== false ? "checked" : ""} /> Comments on my files</label>
          <label class="inline-label"><input type="checkbox" id="np-mention" ${state.notifPrefs?.mention !== false ? "checked" : ""} /> @mentions in comments</label>
          <label class="inline-label"><input type="checkbox" id="np-follow" ${state.notifPrefs?.follow !== false ? "checked" : ""} /> New followers</label>
          <label class="inline-label"><input type="checkbox" id="np-group" ${state.notifPrefs?.group !== false ? "checked" : ""} /> Study group activity</label>
          <button class="btn btn-primary">Save preferences</button>
        </form>
      </div>
    </div>`);

  document.getElementById("pw-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nw = document.getElementById("pw-new").value;
    if (nw !== document.getElementById("pw-new2").value) {
      return (document.getElementById("pw-error").textContent = "New passwords do not match");
    }
    if (nw.length < 8) {
      return (document.getElementById("pw-error").textContent = "Password must be at least 8 characters");
    }
    if (!/[a-zA-Z]/.test(nw)) {
      return (document.getElementById("pw-error").textContent = "Password must contain at least one letter");
    }
    if (!/[0-9]/.test(nw)) {
      return (document.getElementById("pw-error").textContent = "Password must contain at least one number");
    }
    try {
      await api("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPassword: document.getElementById("pw-old").value, newPassword: nw })
      });
      showToast("Password updated");
      renderSettings();
    } catch (err) {
      document.getElementById("pw-error").textContent = err.message;
    }
  });

  document.getElementById("username-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const d = await api("/api/auth/change-username", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: document.getElementById("username-input").value })
      });
      state.user.username = d.user.username;
      localStorage.setItem("auth", JSON.stringify(state));
      showToast("Display name updated");
      renderNav();
      renderSettings();
    } catch (err) {
      document.getElementById("username-error").textContent = err.message;
    }
  });

  document.getElementById("bio-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const d = await api("/api/profile/bio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bio: document.getElementById("bio-input").value })
      });
      state.user.bio = d.bio;
      localStorage.setItem("auth", JSON.stringify(state));
      showToast("Bio updated");
      renderSettings();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById("sq-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/api/auth/security-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: document.getElementById("sq-q").value,
          answer: document.getElementById("sq-a").value
        })
      });
      showToast("Recovery question saved");
      renderSettings();
    } catch (err) {
      document.getElementById("sq-error").textContent = err.message;
    }
  });

  document.getElementById("theme-schedule-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const d = await api("/api/auth/theme-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: document.getElementById("ts-enabled").checked,
          darkStart: document.getElementById("ts-dark-start").value,
          darkEnd: document.getElementById("ts-dark-end").value
        })
      });
      state.themeSchedule = d.themeSchedule;
      localStorage.setItem("auth", JSON.stringify(state));
      applyThemeSchedule();
      showToast("Theme schedule saved");
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById("notif-prefs-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const d = await api("/api/auth/notif-prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          upload: document.getElementById("np-upload").checked,
          approval: document.getElementById("np-approval").checked,
          comment: document.getElementById("np-comment").checked,
          mention: document.getElementById("np-mention").checked,
          follow: document.getElementById("np-follow").checked,
          group: document.getElementById("np-group").checked
        })
      });
      state.notifPrefs = d.notifPrefs;
      localStorage.setItem("auth", JSON.stringify(state));
      showToast("Notification preferences saved");
    } catch (err) {
      alert(err.message);
    }
  });

  const so = document.getElementById("settings-logout");
  if (so) so.addEventListener("click", () => {
    clearAuth();
    location.hash = "#/login";
  });
}

/* ---------- home ---------- */

async function loadCourses() {
  try {
    state.courses = (await api("/api/courses")).courses;
  } catch {}
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Working late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function relTime(iso) {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return days + " days ago";
  return fmtDate(iso);
}

function qaTile(href, cls, ic, label) {
  return `
    <a href="${href}" class="qa-tile ${cls}">
      <span class="qa-ico">${icon(ic)}</span>
      <span>${label}</span>
      <span class="qa-arrow">${icon("chevronRight")}</span>
    </a>`;
}

function continueCardHTML(c, prog) {
  if (!c) return `
    <div class="continue-card">
      ${emptyState("grad", "No courses yet", "Start building your library.", '<a class="btn btn-primary" href="#/courses">Browse courses</a>')}
    </div>`;
  const p = prog || { viewed: 0, total: 0, pct: 0 };
  const lv = state.user && state.user.lastViewed || {};
  let lastViewedText = "";
  let latestTime = 0;
  for (const [fid, ts] of Object.entries(lv)) {
    const t = new Date(ts).getTime();
    if (t > latestTime) latestTime = t;
  }
  if (latestTime > 0) lastViewedText = "Last viewed " + relTime(new Date(latestTime).toISOString());
  const label = p.viewed > 0
    ? esc(c.description || "Keep going — you're making great progress.")
    : "No progress yet. Open this course to start learning.";
  return `
    <div class="continue-card">
      <div class="continue-icon">${icon("grad")}</div>
      <div class="continue-main">
        <span class="continue-code">${esc(c.code)}</span>
        <h3>${esc(c.name)}</h3>
        <p class="muted">${label}</p>
        <div class="progress-row">
          <span class="muted small">${p.viewed}/${p.total} files viewed</span>
          <span class="muted small">${p.pct}% complete</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${p.pct}%"></div></div>
        ${lastViewedText ? `<span class="muted small" style="margin-top:6px;display:block">${lastViewedText}</span>` : ""}
        <a class="btn btn-primary continue-btn" href="#/course/${c.id}">Continue &rarr;</a>
      </div>
    </div>`;
}

function ycardHTML(c, meta, prog) {
  const m = meta || { materials: 0, pdfs: 0, lastUpdated: "" };
  const p = prog || { viewed: 0, total: 0, pct: 0 };
  return `
    <div class="ycard">
      <div class="ycard-top">
        <span class="course-code">${esc(c.code)}</span>
        <button class="icon-btn ymenu" data-menu="${c.id}" aria-label="Course menu">${icon("more")}</button>
      </div>
      <div class="ycard-icon">${icon("grad")}</div>
      <h3>${esc(c.name)}</h3>
      <p class="muted small">${m.materials} materials &middot; ${m.pdfs} PDFs</p>
      <div class="progress-row">
        <span class="muted small">${p.viewed}/${p.total} viewed</span>
        <span class="muted small">${p.pct}%</span>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${p.pct}%"></div></div>
      <p class="muted small">${m.lastUpdated ? "Last updated " + relTime(m.lastUpdated) : "No materials yet"}</p>
      <div class="ycard-menu hidden" id="ymenu-${c.id}">
        <a href="#/course/${c.id}">${icon("book")} Open course</a>
        <button data-zip="${c.id}" data-name="${esc(c.code || c.name)}.zip">${icon("download")} Download all (.zip)</button>
        ${state.user && state.user.role === "admin" ? `<button data-edit-course="${c.id}">${icon("edit")} Edit course</button>` : ""}
      </div>
    </div>`;
}

let courseMenuDocBound = false;
function bindCourseMenus() {
  document.querySelectorAll(".ymenu").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const menu = document.getElementById("ymenu-" + btn.dataset.menu);
      document.querySelectorAll(".ycard-menu:not(.hidden)").forEach((m) => {
        if (m !== menu) m.classList.add("hidden");
      });
      if (menu) menu.classList.toggle("hidden");
    }));
  document.querySelectorAll("[data-zip]").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.getElementById("ymenu-" + btn.dataset.zip)?.classList.add("hidden");
      downloadPath("/api/courses/" + btn.dataset.zip + "/zip", btn.dataset.name || "course.zip");
    }));
  document.querySelectorAll("[data-edit-course]").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.getElementById("ymenu-" + btn.dataset.editCourse)?.classList.add("hidden");
      openEditCourse(btn.dataset.editCourse);
    }));
  if (!courseMenuDocBound) {
    courseMenuDocBound = true;
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".ycard")) {
        document.querySelectorAll(".ycard-menu").forEach((m) => m.classList.add("hidden"));
      }
    });
  }
}

async function renderHome() {
  if (!state.user) return (location.hash = "#/login");
  try {
  const isAdmin = state.user.role === "admin";
  const first = (state.user.username || "friend");

  app.innerHTML = shell(`
    <div class="welcome">
      <h1>${greeting()}, ${esc(first)} <span class="wave">&#128075;</span></h1>
      <p>Find the materials you need and keep learning.</p>
    </div>
    <div class="search-bar">
      <span class="search-icon">${icon("search")}</span>
      <input id="search-input" type="search" placeholder="Search courses & PDFs..." autocomplete="off" />
      <button class="icon-btn search-filter" id="filter-toggle" aria-label="Filters">${icon("settings")}</button>
    </div>
    <div class="filters filters-panel hidden" id="filters-panel">
      <select id="filter-cat"><option value="">All categories</option></select>
      <select id="filter-sem"><option value="">All semesters</option></select>
    </div>
    <div id="search-results"></div>
    <div class="skeleton" style="margin-top:20px"><div class="skel" style="height:80px;border-radius:18px"></div><div class="skel" style="height:120px;border-radius:18px"></div></div>`);

  bindSearch();
  bindFilterToggle();

  const [courses, feedData, savedData, annData, lbData, colData, followingData] = await Promise.allSettled([
    api("/api/courses"),
    api("/api/feed"),
    api("/api/files/saved"),
    api("/api/announcements"),
    api("/api/leaderboard"),
    api("/api/collections"),
    api("/api/feed?following=1")
  ]);

  state.courses = (courses.status === "fulfilled" && courses.value.courses) || [];

  const feed = (feedData.status === "fulfilled" && feedData.value.files) || [];
  const saved = (savedData.status === "fulfilled" && savedData.value.files) || [];
  const announcements = (annData.status === "fulfilled" && annData.value.announcements) || [];
  const leaderboard = (lbData.status === "fulfilled" && lbData.value.leaderboard) || [];
  const collections = (colData.status === "fulfilled" && colData.value.collections) || [];
  const followingFeed = (followingData.status === "fulfilled" && followingData.value.files) || [];
  const followingActivity = (followingData.status === "fulfilled" && followingData.value.activity) || [];

  state.progressMap = {};
  state.courseMeta = {};
  await Promise.allSettled(state.courses.slice(0, 12).map(async (c) => {
    const pr = await api("/api/courses/" + c.id + "/progress").catch(() => null);
    const fl = await api("/api/files?courseId=" + encodeURIComponent(c.id)).catch(() => null);
    const files = (fl && fl.files) || [];
    state.progressMap[c.id] = {
      viewed: (pr && pr.viewed) || 0,
      total: (pr && pr.total) || files.length,
      pct: (pr && pr.pct) || 0
    };
    state.courseMeta[c.id] = {
      materials: files.length,
      pdfs: files.filter((f) => /\.pdf$/i.test(f.originalName || f.name)).length,
      lastUpdated: files.length
        ? files.reduce((m, f) => (new Date(f.uploadedAt) > new Date(m) ? f.uploadedAt : m), files[0].uploadedAt)
        : ""
    };
  }));

  const materialsTotal = state.courses.reduce((s, c) => s + (state.progressMap[c.id]?.total || 0), 0);

  let cont = state.courses[0] || null;
  for (const c of state.courses) {
    if ((state.progressMap[c.id]?.viewed || 0) > (state.progressMap[cont.id]?.viewed || 0)) cont = c;
  }

  const cats = [...new Set(state.courses.map((c) => c.category).filter(Boolean))];
  const sems = [...new Set(state.courses.map((c) => c.semester).filter(Boolean))];

  app.innerHTML = shell(`
    <div class="welcome">
      <h1>${greeting()}, ${esc(first)} <span class="wave">&#128075;</span></h1>
      <p>Find the materials you need and keep learning.</p>
    </div>

    <div class="search-bar">
      <span class="search-icon">${icon("search")}</span>
      <input id="search-input" type="search" placeholder="Search courses & PDFs..." autocomplete="off" />
      <button class="icon-btn search-filter" id="filter-toggle" aria-label="Filters">${icon("settings")}</button>
    </div>
    <div class="filters filters-panel hidden" id="filters-panel">
      <select id="filter-cat"><option value="">All categories</option>${cats.map((c) => `<option>${esc(c)}</option>`).join("")}</select>
      <select id="filter-sem"><option value="">All semesters</option>${sems.map((s) => `<option>${esc(s)}</option>`).join("")}</select>
    </div>
    <div id="search-results"></div>

    <div class="stats-card">
      <div class="stat-item"><span class="stat-ico ico-book">${icon("book")}</span><span class="stat-num">${state.courses.length}</span><span class="stat-lab">Courses</span></div>
      <div class="stat-item"><span class="stat-ico ico-files">${icon("pdf")}</span><span class="stat-num">${materialsTotal}</span><span class="stat-lab">Materials</span></div>
      <div class="stat-item"><span class="stat-ico ico-saved">${icon("star")}</span><span class="stat-num">${saved.length}</span><span class="stat-lab">Saved</span></div>
      <div class="stat-item"><span class="stat-ico ico-recent">${icon("clock")}</span><span class="stat-num">${feed.length}</span><span class="stat-lab">Recent</span></div>
    </div>

    <section class="home-section">
      <div class="section-head">
        <h2>Continue learning</h2>
        <a href="#/courses" class="view-all">View all</a>
      </div>
      ${continueCardHTML(cont, state.progressMap[cont ? cont.id : ""])}
    </section>

    ${followingFeed.length || followingActivity.length ? `
    <section class="home-section">
      <h2 class="section-title">${icon("users")} Following</h2>
      ${followingActivity.length ? `<div class="following-activity">
        ${followingActivity.slice(0, 8).map((a) => `
          <div class="following-item">
            <a href="#/profile/${a.userId}" class="comment-author">${esc(a.username)}</a>
            <span>commented on <a href="#/course/${a.courseId}" style="color:var(--primary)">${esc(a.fileName)}</a></span>
            <span class="muted small">${fmtDate(a.at)}</span>
          </div>`).join("")}
      </div>` : ""}
      ${followingFeed.length ? `<div class="file-list" style="margin-top:10px">
        ${followingFeed.slice(0, 5).map((f) => fileRow(f, { showCourse: true })).join("")}
      </div>` : ""}
    </section>` : ""}

    <section class="home-section">
      <div class="section-head">
        <h2>Your courses</h2>
        <div class="section-head-actions">
          ${isAdmin ? '<button class="btn btn-primary btn-sm" id="new-course-btn">+ New course</button>' : ""}
          <a href="#/courses" class="view-all">View all</a>
        </div>
      </div>
      <div class="course-scroll" id="course-scroll">
        ${state.courses.length
          ? state.courses.map((c) => ycardHTML(c, state.courseMeta[c.id], state.progressMap[c.id])).join("")
          : emptyState("book", "No courses yet", "Create a course to get started.", isAdmin ? '<button class="btn btn-primary btn-sm" id="new-course-btn-empty">+ New course</button>' : "")}
      </div>
    </section>

    <section class="home-section">
      <h2 class="section-title">Quick access</h2>
      <div class="qa-grid">
        ${qaTile("#/courses", "t-all", "book", "All Materials")}
        ${qaTile("#/tag/notes", "t-notes", "edit", "Notes")}
        ${qaTile("#/tag/past-question", "t-past", "archive", "Past Questions")}
        ${qaTile("#/tag/textbook", "t-textbook", "book", "Textbooks")}
      </div>
    </section>

    ${announcements.length || isAdmin ? `
    <section class="home-section">
      <h2 class="section-title">${icon("bell")} Announcements</h2>
      ${isAdmin ? `<div class="ann-compose card" style="margin-bottom:12px">
        <textarea id="ann-input" class="ann-textarea" rows="2" placeholder="Post an announcement to all students..." style="width:100%;border:1px solid var(--border);border-radius:10px;padding:10px 12px;resize:none;font:inherit;background:var(--card-2);color:var(--text);margin-bottom:8px"></textarea>
        <div style="display:flex;justify-content:flex-end;gap:8px">
          <button class="btn btn-primary btn-sm" id="ann-post-btn">Post</button>
        </div>
      </div>` : ""}
      <div class="ann-list">
        ${announcements.length
          ? announcements.slice(0, 3).map((a) => `
          <div class="ann-card">
            <div class="ann-head">
              <span class="ann-author">${esc(a.authorName)}</span>
              <span class="ann-date">${fmtDate(a.createdAt)}</span>
            </div>
            <div class="ann-text">${esc(a.text)}</div>
            ${isAdmin ? `<button class="link-btn" style="margin-top:6px;font-size:0.8rem" data-del-ann="${a.id}">Delete</button>` : ""}
          </div>`).join("")
          : emptyState("bell", "No announcements yet", "Announcements from admins will appear here.", "")}
      </div>
    </section>` : ""}

    ${collections.length || isAdmin ? `
    <section class="home-section">
      <div class="section-head">
        <h2>${icon("folder")} Collections</h2>
        <button class="btn btn-primary btn-sm" id="new-col-btn">+ New</button>
      </div>
      <div class="col-grid" id="col-grid">
        ${collections.length
          ? collections.map((col) => `
            <div class="col-card" data-col-id="${col.id}">
              <div class="col-icon">${icon("folder")}</div>
              <div class="col-info">
                <h3>${esc(col.name)}</h3>
                <p>${col.files.length} file${col.files.length !== 1 ? "s" : ""}${col.description ? " · " + esc(col.description) : ""}</p>
              </div>
              <button class="btn btn-outline btn-sm" data-col-zip="${col.id}" data-col-name="${esc(col.name)}" title="Export as ZIP">${icon("download")}</button>
            </div>`).join("")
          : emptyState("folder", "No collections yet", "Create a collection to organize files across courses.", "")}
      </div>
    </section>` : ""}

    ${leaderboard.length ? `
    <section class="home-section">
      <h2 class="section-title">${icon("trophy")} Top Contributors</h2>
      <div class="lb-list">
        ${leaderboard.slice(0, 5).map((u, i) => `
          <div class="lb-row" data-profile="${u.id}" style="cursor:pointer">
            <div class="lb-rank ${i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "normal"}">${i + 1}</div>
            <div class="lb-info">
              <h4>${esc(u.username)}</h4>
              <p>${u.uploads} uploads · ${fmtCount(u.views)} views</p>
            </div>
            <span class="lb-score">${fmtCount(u.views + u.downloads + u.likes * 2)} pts</span>
          </div>`).join("")}
      </div>
    </section>` : ""}

    ${courseModalHTML()}
    ${editCourseModalHTML()}
    ${renameFileModalHTML()}
    ${tagFileModalHTML()}`);

  bindSearch();
  bindFilters("course-scroll");
  bindFilterToggle();
  bindRowActions({ showCourse: true, counts: true });
  bindCourseMenus();
  bindCourseModal();
  bindEditCourseModal();
  bindRenameFileModal();
  bindTagFileModal();

  const newBtn = document.getElementById("new-course-btn");
  if (newBtn) newBtn.addEventListener("click", () => showModal("course-modal"));
  const newBtnEmpty = document.getElementById("new-course-btn-empty");
  if (newBtnEmpty) newBtnEmpty.addEventListener("click", () => showModal("course-modal"));

  document.querySelectorAll("[data-del-ann]").forEach((btn) =>
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await api("/api/announcements/" + btn.dataset.delAnn, { method: "DELETE" });
        renderHome();
      } catch (err) { alert(err.message); }
    }));

  const annPostBtn = document.getElementById("ann-post-btn");
  if (annPostBtn) annPostBtn.addEventListener("click", async () => {
    const input = document.getElementById("ann-input");
    const text = input.value.trim();
    if (!text) return;
    try {
      await api("/api/announcements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      showToast("Announcement posted");
      renderHome();
    } catch (err) { alert(err.message); }
  });

  document.querySelectorAll("[data-profile]").forEach((el) =>
    el.addEventListener("click", () => { location.hash = "#/profile/" + el.dataset.profile; }));

  document.querySelectorAll("[data-col-id]").forEach((el) =>
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-col-zip]")) return;
      location.hash = "#/collection/" + el.dataset.colId;
    }));

  document.querySelectorAll("[data-col-zip]").forEach((btn) =>
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await downloadPath("/api/collections/" + btn.dataset.colZip + "/zip", (btn.dataset.colName || "collection") + ".zip");
      } catch (err) { alert(err.message); }
    }));

  const newColBtn = document.getElementById("new-col-btn");
  if (newColBtn) newColBtn.addEventListener("click", async () => {
    const name = prompt("Collection name:");
    if (!name) return;
    try {
      await api("/api/collections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      showToast("Collection created");
      renderHome();
    } catch (err) { alert(err.message); }
  });
  } catch (err) {
    console.error("renderHome error:", err);
    app.innerHTML = `<div style="padding:40px 20px;text-align:center">
      <h2>Something went wrong</h2>
      <p style="color:var(--muted)">${esc(err.message)}</p>
      <button class="btn btn-primary" onclick="location.reload()" style="margin-top:12px">Retry</button>
    </div>`;
  }
}

async function renderCourses(hash) {
  if (!state.user) return (location.hash = "#/login");
  await loadCourses();
  const q = new URLSearchParams((hash.split("?")[1] || "")).get("q") || "";
  const cats = [...new Set(state.courses.map((c) => c.category).filter(Boolean))];
  const sems = [...new Set(state.courses.map((c) => c.semester).filter(Boolean))];
  const isAdmin = state.user.role === "admin";

  app.innerHTML = shell(`
    <div class="page-head">
      <div>
        <h1>Courses</h1>
        <p class="muted">Every course and every material in one place.</p>
      </div>
      ${isAdmin ? '<button class="btn btn-primary" id="new-course-btn">+ New course</button>' : ""}
    </div>

    <div class="search-bar">
      <span class="search-icon">${icon("search")}</span>
      <input id="search-input" type="search" value="${esc(q)}" placeholder="Search courses & PDFs..." autocomplete="off" />
      <button class="icon-btn search-filter" id="filter-toggle" aria-label="Filters">${icon("settings")}</button>
    </div>
    <div class="filters filters-panel hidden" id="filters-panel">
      <select id="filter-cat"><option value="">All categories</option>${cats.map((c) => `<option>${esc(c)}</option>`).join("")}</select>
      <select id="filter-sem"><option value="">All semesters</option>${sems.map((s) => `<option>${esc(s)}</option>`).join("")}</select>
    </div>
    <div id="search-results"></div>

    <h2 class="section-title">All courses</h2>
    <div class="grid" id="course-grid">
      ${state.courses.length
        ? state.courses.map((c) => courseCard(c)).join("")
        : emptyState("book", "No courses yet", "Create a course to start organizing materials.", isAdmin ? '<button class="btn btn-primary" id="new-course-btn-empty">+ New course</button>' : "")}
    </div>

    ${courseModalHTML()}
    ${editCourseModalHTML()}
    ${renameFileModalHTML()}
    ${tagFileModalHTML()}`);

  bindSearch();
  bindFilters("course-grid");
  bindFilterToggle();
  bindRowActions({ showCourse: true, counts: true });
  bindCourseMenus();
  bindCourseModal();
  bindEditCourseModal();
  bindRenameFileModal();
  bindTagFileModal();

  const newBtn = document.getElementById("new-course-btn");
  if (newBtn) newBtn.addEventListener("click", () => showModal("course-modal"));
  const newBtnEmpty2 = document.getElementById("new-course-btn-empty");
  if (newBtnEmpty2) newBtnEmpty2.addEventListener("click", () => showModal("course-modal"));

  if (q) document.getElementById("search-input").dispatchEvent(new Event("input"));
}

function courseCard(c) {
  return `
    <a href="#/course/${c.id}" class="card course-card">
      <div class="course-code">${esc(c.code)}</div>
      <h3>${esc(c.name)}</h3>
      <p class="muted">${esc(c.description || "No description")}</p>
      <div class="course-meta">
        ${c.category ? `<span class="tag">${esc(c.category)}</span>` : ""}
        ${c.semester ? `<span class="tag tag-outline">${esc(c.semester)}</span>` : ""}
      </div>
      <span class="card-link">Open materials &rarr;</span>
    </a>`;
}

function bindFilterToggle() {
  const btn = document.getElementById("filter-toggle");
  const panel = document.getElementById("filters-panel");
  if (btn && panel) btn.addEventListener("click", () => panel.classList.toggle("hidden"));
}

function bindFilters(targetId) {
  const cat = document.getElementById("filter-cat");
  const sem = document.getElementById("filter-sem");
  if (!cat || !sem) return;
  const apply = () => {
    const grid = document.getElementById(targetId || "course-grid");
    if (!grid) return;
    const list = state.courses.filter(
      (c) => (!cat.value || c.category === cat.value) && (!sem.value || c.semester === sem.value)
    );
    if (targetId === "course-scroll") {
      grid.innerHTML = list.length
        ? list.map((c) => ycardHTML(c, state.courseMeta[c.id], state.progressMap[c.id])).join("")
        : emptyState("search", "No matches", "Try adjusting your filters.");
      bindCourseMenus();
    } else {
      grid.innerHTML = list.length ? list.map(courseCard).join("") : emptyState("search", "No matches", "Try adjusting your filters.");
    }
  };
  cat.addEventListener("change", apply);
  sem.addEventListener("change", apply);
}

let searchTimer;
function bindSearch() {
  const input = document.getElementById("search-input");
  if (!input) return;
  input.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      const q = input.value.trim();
      const box = document.getElementById("search-results");
      if (!q) {
        box.innerHTML = "";
        return;
      }
      box.innerHTML = '<p class="muted">Searching...</p>';
      try {
        const d = await api("/api/search?q=" + encodeURIComponent(q));
        if (d.files.length) {
          const rows = d.files.map((f) => {
            const base = fileRow(f, { showCourse: true, counts: true });
            if (f.snippet) {
              const snippetHtml = `<div class="search-snippet"><span class="search-match-count">${f.matchCount} match${f.matchCount !== 1 ? "es" : ""}</span> <span class="search-snippet-text">${esc(f.snippet)}</span></div>`;
              return base.replace("</div>\n    </div>", snippetHtml + "\n      </div>\n    </div>");
            }
            return base;
          }).join("");
          box.innerHTML = listSection("Search results (" + d.files.length + ")", rows, "");
        } else {
          box.innerHTML = emptyState("search", "No matches found", "Try a different search term.");
        }
        bindRowActions({ showCourse: true, counts: true });
      } catch {
        box.innerHTML = '<p class="error">Search failed.</p>';
      }
    }, 350);
  });
}

function courseModalHTML() {
  return `
    <div class="modal-overlay hidden" id="course-modal">
      <div class="modal">
        <h2>New course</h2>
        <form id="course-form">
          <label>Course name <input id="c-name" placeholder="e.g. Data Structures" /></label>
          <label>Course code <input id="c-code" placeholder="e.g. CS201" /></label>
          <label>Category <input id="c-cat" placeholder="e.g. Computer Science" /></label>
          <label>Semester <input id="c-sem" placeholder="e.g. Fall 2026" /></label>
          <label>Description (optional) <textarea id="c-desc" rows="3"></textarea></label>
          <p class="error" id="course-error"></p>
          <div class="modal-actions">
            <button type="button" class="btn btn-outline" id="course-cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">Create</button>
          </div>
        </form>
      </div>
    </div>`;
}

function editCourseModalHTML() {
  return `
    <div class="modal-overlay hidden" id="edit-course-modal">
      <div class="modal">
        <h2>Edit course</h2>
        <form id="edit-course-form">
          <input type="hidden" id="ec-id" />
          <label>Course name <input id="ec-name" /></label>
          <label>Course code <input id="ec-code" /></label>
          <label>Category <input id="ec-cat" /></label>
          <label>Semester <input id="ec-sem" /></label>
          <label>Description <textarea id="ec-desc" rows="3"></textarea></label>
          <p class="error" id="ec-error"></p>
          <div class="modal-actions">
            <button type="button" class="btn btn-outline" id="ec-cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">Save changes</button>
          </div>
        </form>
      </div>
    </div>`;
}

function renameFileModalHTML() {
  return `
    <div class="modal-overlay hidden" id="rename-file-modal">
      <div class="modal">
        <h2>Rename file</h2>
        <form id="rename-file-form">
          <input type="hidden" id="rf-id" />
          <label>File name <input id="rf-name" /></label>
          <p class="error" id="rf-error"></p>
          <div class="modal-actions">
            <button type="button" class="btn btn-outline" id="rf-cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">Rename</button>
          </div>
        </form>
      </div>
    </div>`;
}

function showModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.remove("hidden");
  m.setAttribute("role", "dialog");
  m.setAttribute("aria-modal", "true");
  const heading = m.querySelector("h2, h3");
  if (heading) { const hid = "modal-title-" + id; heading.id = hid; m.setAttribute("aria-labelledby", hid); }
  const focusable = m.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (focusable.length) focusable[0].focus();
  m._trapHandler = (e) => {
    if (e.key !== "Tab") return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  m.addEventListener("keydown", m._trapHandler);
}

function hideModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.add("hidden");
  if (m._trapHandler) { m.removeEventListener("keydown", m._trapHandler); m._trapHandler = null; }
}

function bindCourseModal() {
  const modal = document.getElementById("course-modal");
  if (!modal) return;
  const close = () => modal.classList.add("hidden");
  document.getElementById("course-cancel").addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });
  document.getElementById("course-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/api/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: document.getElementById("c-name").value,
          code: document.getElementById("c-code").value,
          category: document.getElementById("c-cat").value,
          semester: document.getElementById("c-sem").value,
          description: document.getElementById("c-desc").value
        })
      });
      close();
      showToast("Course created");
      render();
    } catch (err) {
      document.getElementById("course-error").textContent = err.message;
    }
  });
}

function bindEditCourseModal() {
  const modal = document.getElementById("edit-course-modal");
  if (!modal) return;
  const close = () => modal.classList.add("hidden");
  document.getElementById("ec-cancel").addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });
  document.getElementById("edit-course-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("ec-id").value;
    try {
      await api("/api/courses/" + id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: document.getElementById("ec-name").value,
          code: document.getElementById("ec-code").value,
          category: document.getElementById("ec-cat").value,
          semester: document.getElementById("ec-sem").value,
          description: document.getElementById("ec-desc").value
        })
      });
      close();
      showToast("Course updated");
      render();
    } catch (err) {
      document.getElementById("ec-error").textContent = err.message;
    }
  });
}

function openEditCourse(id) {
  const c = state.courses.find((x) => x.id === id);
  if (!c) return;
  document.getElementById("ec-id").value = c.id;
  document.getElementById("ec-name").value = c.name || "";
  document.getElementById("ec-code").value = c.code || "";
  document.getElementById("ec-cat").value = c.category || "";
  document.getElementById("ec-sem").value = c.semester || "";
  document.getElementById("ec-desc").value = c.description || "";
  showModal("edit-course-modal");
}

function bindRenameFileModal() {
  const modal = document.getElementById("rename-file-modal");
  if (!modal) return;
  const close = () => modal.classList.add("hidden");
  document.getElementById("rf-cancel").addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });
  document.getElementById("rename-file-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("rf-id").value;
    const name = document.getElementById("rf-name").value.trim();
    if (!name) return (document.getElementById("rf-error").textContent = "Name is required");
    try {
      await api("/api/files/" + id + "/rename", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
      });
      close();
      showToast("File renamed");
      render();
    } catch (err) {
      document.getElementById("rf-error").textContent = err.message;
    }
  });
}

function openRenameFile(id, currentName) {
  document.getElementById("rf-id").value = id;
  document.getElementById("rf-name").value = currentName || "";
  document.getElementById("rf-error").textContent = "";
  showModal("rename-file-modal");
}

function tagFileModalHTML() {
  return `
    <div class="modal-overlay hidden" id="tag-file-modal">
      <div class="modal">
        <h2>Edit tags</h2>
        <form id="tag-file-form">
          <input type="hidden" id="tf-id" />
          <label>Tags (comma-separated)
            <input id="tf-tags" placeholder="e.g. past-question, notes, textbook" autocomplete="off" />
          </label>
          <div class="tag-autocomplete-wrap">
            <div class="tag-autocomplete hidden" id="tf-suggested"></div>
          </div>
          <p class="error" id="tf-error"></p>
          <div class="modal-actions">
            <button type="button" class="btn btn-outline" id="tf-cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">Save</button>
          </div>
        </form>
      </div>
    </div>`;
}

async function bindTagFileModal() {
  const modal = document.getElementById("tag-file-modal");
  if (!modal) return;
  const close = () => modal.classList.add("hidden");
  document.getElementById("tf-cancel").addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  let allTags = [];
  try {
    const { tags } = await api("/api/tags");
    allTags = tags || [];
  } catch {}
  const inp = document.getElementById("tf-tags");
  const acBox = document.getElementById("tf-suggested");
  function updateAC() {
    if (!acBox || !allTags.length) return;
    const val = inp.value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const current = val[val.length - 1] || "";
    const already = new Set(val.slice(0, -1));
    if (!current) { acBox.classList.add("hidden"); return; }
    const matches = allTags.filter((t) => t.includes(current) && !already.has(t)).slice(0, 8);
    if (!matches.length) { acBox.classList.add("hidden"); return; }
    acBox.classList.remove("hidden");
    acBox.innerHTML = matches.map((t) => `<button type="button" class="tag-ac-item" data-stag="${esc(t)}">${esc(t)}</button>`).join("");
    acBox.querySelectorAll(".tag-ac-item").forEach((btn) => {
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const parts = inp.value.split(",").map((s) => s.trim());
        parts[parts.length - 1] = btn.dataset.stag;
        inp.value = parts.join(", ") + ", ";
        acBox.classList.add("hidden");
        inp.focus();
      });
    });
  }
  if (inp) {
    inp.addEventListener("input", updateAC);
    inp.addEventListener("focus", updateAC);
    inp.addEventListener("blur", () => { setTimeout(() => acBox.classList.add("hidden"), 150); });
  }
  document.getElementById("tag-file-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("tf-id").value;
    const raw = document.getElementById("tf-tags").value;
    const tags = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 10);
    try {
      await api("/api/files/" + id + "/tags", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags })
      });
      close();
      showToast("Tags updated");
      render();
    } catch (err) {
      document.getElementById("tf-error").textContent = err.message;
    }
  });
}

function openTagFile(id, tags) {
  document.getElementById("tf-id").value = id;
  document.getElementById("tf-tags").value = (tags || []).join(", ");
  document.getElementById("tf-error").textContent = "";
  showModal("tag-file-modal");
}

/* ---------- course detail ---------- */

async function renderCourseDetail(hash) {
  if (!state.user) return (location.hash = "#/login");
  const id = hash.split("/")[2];
  const course = state.courses.find((c) => c.id === id);
  let files = [];
  let pagination = null;
  let progress = null;
  const qs = new URLSearchParams((hash.split("?")[1] || ""));
  const sortParam = qs.get("sort") || "date";
  const orderParam = qs.get("order") || "desc";
  const pageParam = parseInt(qs.get("page")) || 1;
  try {
    const res = await api("/api/files?courseId=" + encodeURIComponent(id) + "&sort=" + sortParam + "&order=" + orderParam + "&page=" + pageParam);
    files = res.files;
    pagination = { page: res.page, pages: res.pages, total: res.total };
  } catch {}
  try {
    progress = await api("/api/courses/" + id + "/progress");
  } catch {}
  const isAdmin = state.user.role === "admin";

  const rows = files.length
    ? files.map((f) => fileRow(f, { counts: true, showCheckboxes: true })).join("")
    : "";
  const baseHash = "#/course/" + id + "?sort=" + sortParam + "&order=" + orderParam;

  app.innerHTML = shell(`
    <a href="#/" class="back-link">${icon("chevronLeft")} All courses</a>
    ${course ? `
      <div class="page-head">
        <div>
          <h1>${esc(course.name)}</h1>
          <p class="muted">${esc(course.code)} &middot; ${esc(course.description || "No description")}
            ${course.category ? ` &middot; ${esc(course.category)}` : ""}
            ${course.semester ? ` &middot; ${esc(course.semester)}` : ""}
          </p>
        </div>
        <div class="head-actions">
          <button class="btn btn-outline" data-download-zip="${id}" data-name="${esc(course.code || "course")}.zip">${icon("archive")} Download all (ZIP)</button>
          <button class="btn btn-primary" id="upload-btn">${icon("plus")} Upload PDF</button>
        </div>
      </div>

      ${progress && progress.total ? `
        <div class="progress-card">
          <div class="progress-row">
            <span>Your progress</span>
            <span class="muted">${progress.viewed}/${progress.total} files (${progress.pct}%)</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${progress.pct}%"></div></div>
        </div>` : ""}

      ${files.length ? `
        <div class="sort-bar">
          <label class="sort-label">Sort by</label>
          <select id="file-sort" class="sort-select">
            <option value="date" ${sortParam === "date" ? "selected" : ""}>Newest first</option>
            <option value="name" ${sortParam === "name" ? "selected" : ""}>Name</option>
            <option value="size" ${sortParam === "size" ? "selected" : ""}>Size</option>
            <option value="views" ${sortParam === "views" ? "selected" : ""}>Views</option>
            <option value="downloads" ${sortParam === "downloads" ? "selected" : ""}>Downloads</option>
          </select>
          <button class="icon-btn" id="sort-order-btn" title="Toggle order">${icon(orderParam === "asc" ? "chevronRight" : "chevronLeft")}</button>
        </div>
        ${bulkActionBarHTML()}
        <div class="file-list">${rows}</div>
        ${paginationNav(pagination, baseHash)}` : emptyState("pdf", "No materials uploaded yet", "Be the first to add a resource!", '<button class="btn btn-primary btn-sm" id="upload-btn-empty">+ Upload PDF</button>')}

      ${renameFileModalHTML()}
      ${tagFileModalHTML()}

      <div class="modal-overlay hidden" id="upload-modal">
        <div class="modal">
          <h2>Upload PDFs</h2>
          <form id="upload-form">
            <div class="drop-zone" id="drop-zone">
              <span class="drop-icon">${icon("plus")}</span>
              <p class="drop-text">Drag &amp; drop PDFs here, or click to browse</p>
              <input type="file" id="up-file" accept="application/pdf" class="drop-input" multiple />
            </div>
            <div class="drop-preview hidden" id="drop-preview">
              <span class="file-icon">${icon("pdf")}</span>
              <span class="drop-fname" id="drop-fname"></span>
              <button type="button" class="icon-btn" id="drop-clear">${icon("close")}</button>
            </div>
            <div class="multi-upload-list hidden" id="multi-upload-list"></div>
            <div class="upload-progress hidden" id="upload-progress">
              <div class="progress-bar"><div class="progress-fill" id="upload-pbar" style="width:0%"></div></div>
              <span class="muted small" id="upload-ptxt">0%</span>
            </div>
            <p class="error" id="up-error"></p>
            <div class="modal-actions">
              <button type="button" class="btn btn-outline" id="up-cancel">Cancel</button>
              <button type="submit" class="btn btn-primary" id="up-submit">Upload</button>
            </div>
          </form>
        </div>
      </div>` : emptyState("book", "Course not found", "This course may have been removed.")}`);

  if (!course) return;

  bindRowActions({ counts: true });
  bindBulkActions();
  bindRenameFileModal();
  bindTagFileModal();

  const sortSel = document.getElementById("file-sort");
  const orderBtn = document.getElementById("sort-order-btn");
  if (sortSel) sortSel.addEventListener("change", () => {
    const hashBase = "#/course/" + id;
    location.hash = hashBase + "?sort=" + sortSel.value + "&order=" + orderParam;
  });
  if (orderBtn) orderBtn.addEventListener("click", () => {
    const hashBase = "#/course/" + id;
    location.hash = hashBase + "?sort=" + sortParam + "&order=" + (orderParam === "asc" ? "desc" : "asc");
  });

  document.getElementById("upload-btn").addEventListener("click", () => showModal("upload-modal"));
  const uploadEmpty = document.getElementById("upload-btn-empty");
  if (uploadEmpty) uploadEmpty.addEventListener("click", () => showModal("upload-modal"));
  document.getElementById("up-cancel").addEventListener("click", () =>
    document.getElementById("upload-modal").classList.add("hidden"));
  const upModal = document.getElementById("upload-modal");
  upModal.addEventListener("click", (e) => {
    if (e.target === upModal) upModal.classList.add("hidden");
  });

  document.getElementById("upload-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("up-file");
    const files = [...input.files];
    if (!files.length) return (document.getElementById("up-error").textContent = "Choose at least one PDF file");
    const pdfs = files.filter((f) => f.type.includes("pdf") || /\.pdf$/i.test(f.name));
    if (!pdfs.length) return (document.getElementById("up-error").textContent = "Only PDF files are allowed");
    const progress = document.getElementById("upload-progress");
    const pbar = document.getElementById("upload-pbar");
    const ptxt = document.getElementById("upload-ptxt");
    const submitBtn = document.getElementById("up-submit");
    const multiList = document.getElementById("multi-upload-list");
    submitBtn.disabled = true;
    progress.classList.remove("hidden");
    if (pdfs.length > 1 && multiList) {
      multiList.classList.remove("hidden");
      multiList.innerHTML = pdfs.map((f, i) => `<div class="multi-upload-item" data-mui="${i}"><span>${esc(f.name)}</span><span class="muted small multi-status">Waiting...</span></div>`).join("");
    }
    let successCount = 0;
    let failCount = 0;
    for (let i = 0; i < pdfs.length; i++) {
      const f = pdfs[i];
      const statusEl = multiList ? multiList.querySelector(`[data-mui="${i}"] .multi-status`) : null;
      if (statusEl) statusEl.textContent = "Uploading...";
      pbar.style.width = Math.round(((i) / pdfs.length) * 100) + "%";
      ptxt.textContent = (i + 1) + "/" + pdfs.length;
      try {
        const buf = await f.arrayBuffer();
        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.upload.addEventListener("progress", (ev) => {
            if (ev.lengthComputable) {
              const filePct = Math.round((ev.loaded / ev.total) * 100);
              const totalPct = Math.round(((i + ev.loaded / ev.total) / pdfs.length) * 100);
              pbar.style.width = totalPct + "%";
              ptxt.textContent = (i + 1) + "/" + pdfs.length + " (" + filePct + "%)";
            }
          });
          xhr.onload = () => {
            try { const d = JSON.parse(xhr.responseText); if (xhr.status >= 400) reject(new Error(d.error)); else resolve(d); }
            catch { reject(new Error("Upload failed")); }
          };
          xhr.onerror = () => reject(new Error("Network error"));
          xhr.open("POST", "/api/files");
          const t = token();
          if (t) xhr.setRequestHeader("Authorization", "Bearer " + t);
          xhr.setRequestHeader("Content-Type", "application/octet-stream");
          xhr.setRequestHeader("X-File-Name", encodeURIComponent(f.name));
          xhr.setRequestHeader("X-Original-Name", encodeURIComponent(f.name));
          xhr.setRequestHeader("X-Course-Id", id);
          xhr.send(buf);
        });
        successCount++;
        if (statusEl) { statusEl.textContent = "Done"; statusEl.style.color = "var(--success)"; }
      } catch (err) {
        failCount++;
        if (statusEl) { statusEl.textContent = "Failed: " + err.message; statusEl.style.color = "var(--danger)"; }
      }
    }
    pbar.style.width = "100%";
    ptxt.textContent = successCount + " uploaded" + (failCount ? ", " + failCount + " failed" : "");
    if (successCount > 0) {
      showToast(successCount + " file" + (successCount > 1 ? "s" : "") + " uploaded");
      setTimeout(() => {
        document.getElementById("upload-modal").classList.add("hidden");
        renderCourseDetail(hash);
      }, 800);
    } else {
      submitBtn.disabled = false;
    }
  });

  const dropZone = document.getElementById("drop-zone");
  const dropFile = document.getElementById("up-file");
  const dropPreview = document.getElementById("drop-preview");
  const dropName = document.getElementById("drop-fname");
  const dropClear = document.getElementById("drop-clear");
  if (dropZone && dropFile) {
    dropZone.addEventListener("click", () => dropFile.click());
    dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("drag-over"); });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.classList.remove("drag-over");
      if (e.dataTransfer.files.length) {
        dropFile.files = e.dataTransfer.files;
        showDropPreview(e.dataTransfer.files);
      }
    });
    dropFile.addEventListener("change", () => {
      if (dropFile.files.length) showDropPreview(dropFile.files);
    });
  }
  function showDropPreview(files) {
    if (!files || !dropPreview || !files.length) return;
    dropPreview.classList.remove("hidden");
    dropDropZone && dropDropZone.classList.add("hidden");
    if (dropName) {
      const total = files.length;
      const totalSize = [...files].reduce((s, f) => s + f.size, 0);
      dropName.textContent = total + " file" + (total > 1 ? "s" : "") + " (" + fmtSize(totalSize) + ")";
    }
  }
  const dropDropZone = dropZone;
  if (dropClear) dropClear.addEventListener("click", () => {
    dropFile.value = "";
    dropPreview.classList.add("hidden");
    if (dropDropZone) dropDropZone.classList.remove("hidden");
  });
}

/* ---------- saved ---------- */

async function renderSaved() {
  if (!state.user) return (location.hash = "#/login");
  let files = [];
  try {
    files = (await api("/api/files/saved")).files;
  } catch {}
  app.innerHTML = shell(`
    <div class="page-head">
      <div>
        <h1>Saved for later</h1>
        <p class="muted">Your bookmarked materials, ready when you are.</p>
      </div>
    </div>
    ${listSection("Saved files", files.map((f) => fileRow(f, { showCourse: true, counts: true })).join(""), "Nothing saved yet. Tap the star on any file to bookmark it.")}`);
  bindRowActions({ showCourse: true, counts: true });
}

/* ---------- tag files ---------- */

async function renderTagFiles(hash) {
  if (!state.user) return (location.hash = "#/login");
  const tag = decodeURIComponent(hash.split("/")[2] || "").toLowerCase();
  const qs = new URLSearchParams((hash.split("?")[1] || ""));
  const pageParam = parseInt(qs.get("page")) || 1;
  let files = [];
  let pagination = null;
  try {
    const res = await api("/api/files?tag=" + encodeURIComponent(tag) + "&page=" + pageParam);
    files = res.files;
    pagination = { page: res.page, pages: res.pages, total: res.total };
  } catch {}
  const baseHash = "#/tag/" + encodeURIComponent(tag);
  app.innerHTML = shell(`
    <a href="#/" class="back-link">${icon("chevronLeft")} Home</a>
    <div class="page-head">
      <div>
        <h1>${esc(tag)}</h1>
        <p class="muted">${pagination ? pagination.total : files.length} file${(pagination ? pagination.total : files.length) !== 1 ? "s" : ""} tagged with "${esc(tag)}"</p>
      </div>
    </div>
    ${listSection("Tagged files", files.map((f) => fileRow(f, { showCourse: true, counts: true })).join(""), "No files with this tag yet.")}
    ${paginationNav(pagination, baseHash)}
    ${tagFileModalHTML()}`);
  bindRowActions({ showCourse: true, counts: true });
  bindTagFileModal();
}

/* ---------- admin ---------- */

async function renderAdmin() {
  if (!state.user) return (location.hash = "#/login");
  if (state.user.role !== "admin") return (location.hash = "#/");
  let pending = [];
  let stats = null;
  let topFiles = [];
  let uploadTrend = [];
  let topUsers = [];
  let courseStats = [];
  let users = [];
  try {
    pending = (await api("/api/files/pending")).files;
  } catch {}
  try {
    const d = await api("/api/stats");
    stats = d.stats;
    topFiles = d.topFiles || [];
    uploadTrend = d.uploadTrend || [];
    topUsers = d.topUsers || [];
    courseStats = d.courseStats || [];
  } catch {}
  try {
    users = (await api("/api/users")).users;
  } catch {}

  const maxTrend = Math.max(1, ...uploadTrend.map((d) => d.count));
  const statCards = stats
    ? `
      <div class="stat-grid">
        ${[["Files", stats.totalFiles], ["Downloads", stats.totalDownloads], ["Views", stats.totalViews],
          ["Courses", stats.totalCourses], ["Users", stats.totalUsers], ["Pending", stats.pending],
          ["Comments", stats.totalComments || 0], ["Ratings", stats.totalRatings || 0]]
          .map(([label, val]) => `<div class="stat-card"><div class="stat-num">${val}</div><div class="muted">${label}</div></div>`).join("")}
      </div>
      <section class="home-section">
        <h2 class="section-title">Upload trend (30 days)</h2>
        <div class="analytics-chart">
          ${uploadTrend.map((d) => `<div class="chart-bar" style="height:${Math.max(2, (d.count / maxTrend) * 100)}%" title="${d.date}: ${d.count} uploads"><span class="chart-label">${d.count}</span></div>`).join("")}
        </div>
      </section>
      <div class="analytics-row">
        ${topUsers.length ? `
          <section class="home-section" style="flex:1;min-width:0">
            <h2 class="section-title">Top contributors</h2>
            <div class="lb-list">
              ${topUsers.map((u, i) => `
                <div class="lb-row" data-profile="${u.id}" style="cursor:pointer">
                  <div class="lb-rank ${i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "normal"}">${i + 1}</div>
                  <div class="lb-info">
                    <h4>${esc(u.username)}</h4>
                    <p>${u.uploads} uploads · ${fmtCount(u.views)} views · ${u.comments} comments</p>
                  </div>
                  <span class="lb-score">${fmtCount(u.score)} pts</span>
                </div>`).join("")}
            </div>
          </section>` : ""}
        ${courseStats.length ? `
          <section class="home-section" style="flex:1;min-width:0">
            <h2 class="section-title">Popular courses</h2>
            <div class="lb-list">
              ${courseStats.map((c, i) => `
                <div class="lb-row">
                  <div class="lb-rank ${i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "normal"}">${i + 1}</div>
                  <div class="lb-info">
                    <h4>${esc(c.name)}</h4>
                    <p>${c.fileCount} files · ${fmtCount(c.totalViews)} views · ${fmtCount(c.totalDownloads)} downloads</p>
                  </div>
                </div>`).join("")}
            </div>
          </section>` : ""}
      </div>
      ${topFiles.length ? `
        <section class="home-section">
          <h2 class="section-title">Top files</h2>
          <div class="file-list">
            ${topFiles.map((f) => `
              <div class="file-row">
                <span class="file-icon">${icon("file")}</span>
                <div class="file-info">
                  <div class="file-name">${esc(f.name)}</div>
                  <span class="muted">${esc(f.courseLabel)} &middot; ${f.views} views &middot; ${f.downloads} downloads</span>
                </div>
              </div>`).join("")}
          </div>
        </section>` : ""}`
    : "";

  app.innerHTML = shell(`
    <div class="page-head">
      <div>
        <h1>${icon("shield")} Admin</h1>
        <p class="muted">Review uploads and keep the library healthy.</p>
      </div>
    </div>
    ${statCards}
    <h2 class="section-title">Pending approvals (${pending.length})</h2>
    ${pending.length === 0 ? '<p class="muted">Nothing waiting for review. Nice and clean.</p>' : `
      <div class="bulk-bar" id="bulk-bar" style="display:none">
        <span id="bulk-count">0 selected</span>
        <button class="btn btn-primary btn-sm" id="bulk-approve">${icon("check")} Approve selected</button>
        <button class="btn btn-danger btn-sm" id="bulk-reject">${icon("trash")} Reject selected</button>
        <button class="btn btn-outline btn-sm" id="bulk-clear">Clear</button>
      </div>
      <div class="file-list">
        <div class="file-row bulk-header">
          <label class="bulk-check"><input type="checkbox" id="bulk-all" /></label>
        </div>
        ${pending.map((f) => `
          <div class="file-row">
            <label class="bulk-check"><input type="checkbox" class="bulk-cb" data-bid="${f.id}" /></label>
            <span class="file-icon">${icon("pdf")}</span>
            <div class="file-info">
              <div class="file-name">${esc(f.name)}</div>
              <span class="muted">${esc(f.courseLabel)} &middot; by ${esc(f.uploadedByName)} &middot; ${fmtSize(f.size)}</span>
            </div>
            <div class="file-actions">
              <button class="btn btn-outline btn-sm" data-preview="${f.id}">${icon("eye")} Preview</button>
              <button class="btn btn-primary btn-sm" data-approve="${f.id}">${icon("check")} Approve</button>
              <button class="btn btn-danger btn-sm" data-reject="${f.id}">${icon("trash")} Reject</button>
            </div>
          </div>`).join("")}
      </div>`}

    <h2 class="section-title">Users (${users.length})</h2>
    <div class="file-list">
      ${users.map((u) => `
        <div class="file-row">
          <span class="file-icon">${u.role === "admin" ? icon("shield") : icon("user")}</span>
          <div class="file-info">
            <div class="file-name">${esc(u.username)} ${u.id === state.user.id ? '<span class="badge">you</span>' : ""}</div>
            <span class="muted">${esc(u.email || "")} &middot; Role: ${esc(u.role)}</span>
          </div>
          <div class="file-actions">
            <select class="role-select" data-user="${u.id}" ${u.id === state.user.id ? "disabled" : ""}>
              <option value="student" ${u.role === "student" ? "selected" : ""}>student</option>
              <option value="admin" ${u.role === "admin" ? "selected" : ""}>admin</option>
            </select>
            <button class="btn btn-outline btn-sm" data-resetpw="${u.id}">Reset password</button>
            ${u.id !== state.user.id ? `<button class="btn btn-danger btn-sm" data-deluser="${u.id}">${icon("trash")} Delete</button>` : ""}
          </div>
        </div>`).join("")}
    </div>`);

  bindRowActions();

  document.querySelectorAll("[data-approve]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        await api("/api/files/" + btn.dataset.approve + "/approve", { method: "POST" });
        showToast("File approved");
        renderAdmin();
      } catch (err) {
        alert(err.message);
      }
    }));
  document.querySelectorAll("[data-reject]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("Reject and delete this upload?")) return;
      try {
        await api("/api/files/" + btn.dataset.reject, { method: "DELETE" });
        showToast("File rejected");
        renderAdmin();
      } catch (err) {
        alert(err.message);
      }
    }));

  document.querySelectorAll("[data-user]").forEach((sel) =>
    sel.addEventListener("change", async () => {
      try {
        await api("/api/users/" + sel.dataset.user + "/role", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: sel.value })
        });
        showToast("Role updated");
        renderAdmin();
      } catch (err) {
        alert(err.message);
      }
    }));

  document.querySelectorAll("[data-resetpw]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const np = prompt("Enter a new password for this user (min 4 characters):");
      if (np === null || !np.trim()) return;
      try {
        await api("/api/users/" + btn.dataset.resetpw + "/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newPassword: np })
        });
        showToast("Password reset");
      } catch (err) {
        alert(err.message);
      }
    }));

  document.querySelectorAll("[data-deluser]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this user? Their uploads will also be removed.")) return;
      try {
        await api("/api/users/" + btn.dataset.deluser, { method: "DELETE" });
        showToast("User deleted");
        renderAdmin();
      } catch (err) {
        alert(err.message);
      }
    }));

  const bulkBar = document.getElementById("bulk-bar");
  const bulkAll = document.getElementById("bulk-all");
  function updateBulk() {
    const cbs = document.querySelectorAll(".bulk-cb");
    const checked = [...cbs].filter((cb) => cb.checked);
    if (bulkBar) bulkBar.style.display = checked.length ? "" : "none";
    const cnt = document.getElementById("bulk-count");
    if (cnt) cnt.textContent = checked.length + " selected";
    if (bulkAll) bulkAll.checked = cbs.length > 0 && checked.length === cbs.length;
  }
  document.querySelectorAll(".bulk-cb").forEach((cb) =>
    cb.addEventListener("change", updateBulk));
  if (bulkAll) bulkAll.addEventListener("change", () => {
    document.querySelectorAll(".bulk-cb").forEach((cb) => { cb.checked = bulkAll.checked; });
    updateBulk();
  });
  const bulkApprove = document.getElementById("bulk-approve");
  const bulkReject = document.getElementById("bulk-reject");
  const bulkClear = document.getElementById("bulk-clear");
  async function bulkAction(action) {
    const ids = [...document.querySelectorAll(".bulk-cb:checked")].map((cb) => cb.dataset.bid);
    if (!ids.length) return;
    if (!confirm(action === "approve" ? "Approve " + ids.length + " file(s)?" : "Reject " + ids.length + " file(s)?")) return;
    try {
      const d = await api("/api/files/bulk-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds: ids, action })
      });
      showToast(d.count + " file(s) " + (action === "approve" ? "approved" : "rejected"));
      renderAdmin();
    } catch (err) {
      alert(err.message);
    }
  }
  if (bulkApprove) bulkApprove.addEventListener("click", () => bulkAction("approve"));
  if (bulkReject) bulkReject.addEventListener("click", () => bulkAction("reject"));
  if (bulkClear) bulkClear.addEventListener("click", () => {
    document.querySelectorAll(".bulk-cb").forEach((cb) => { cb.checked = false; });
    if (bulkAll) bulkAll.checked = false;
    updateBulk();
  });
}

/* ---------- profile page ---------- */

async function renderProfile(hash) {
  if (!state.user) return (location.hash = "#/login");
  const userId = hash.split("/profile/")[1];
  try {
    const d = await api("/api/profile/" + userId);
    const p = d.profile;
    const isSelf = state.user.id === p.id;
    app.innerHTML = shell(`
      <a href="#/" class="back-link">${icon("chevronLeft")} Back</a>
      <div class="card" style="text-align:center;padding:32px 22px">
        <div style="width:72px;height:72px;border-radius:20px;display:grid;place-items:center;margin:0 auto 14px;background:linear-gradient(135deg,var(--primary),var(--primary-2));color:#fff;font-size:2rem">${icon("user")}</div>
        <h1 style="margin:0;font-size:1.4rem;letter-spacing:-0.02em">${esc(p.username)}</h1>
        <p class="muted" style="margin:4px 0 0">${p.role === "admin" ? "Admin" : "Student"}${p.joinedAt ? " &middot; Joined " + fmtDate(p.joinedAt) : ""}</p>
        ${p.bio ? `<p style="margin:10px auto 0;max-width:400px;color:var(--text-secondary)">${esc(p.bio)}</p>` : ""}
        ${!isSelf ? `<button class="btn ${p.isFollowing ? "btn-outline" : "btn-primary"} btn-sm" id="follow-btn" style="margin-top:14px" data-uid="${p.id}">${p.isFollowing ? "Following" : "Follow"}</button>` : ""}
        <div class="profile-social-row" style="margin-top:14px;display:flex;gap:20px;justify-content:center">
          <span class="muted small clickable" data-show-followers="${p.id}" style="cursor:pointer"><strong>${p.followerCount}</strong> followers</span>
          <span class="muted small clickable" data-show-following="${p.id}" style="cursor:pointer"><strong>${p.followingCount}</strong> following</span>
        </div>
        <div class="stat-grid" style="margin-top:20px">
          <div class="stat-card"><div class="stat-num">${p.uploadCount}</div><div class="stat-lab">Uploads</div></div>
          <div class="stat-card"><div class="stat-num">${fmtCount(p.totalViews)}</div><div class="stat-lab">Views</div></div>
          <div class="stat-card"><div class="stat-num">${fmtCount(p.totalDownloads)}</div><div class="stat-lab">Downloads</div></div>
          <div class="stat-card"><div class="stat-num">${fmtCount(p.totalLikes)}</div><div class="stat-lab">Likes</div></div>
        </div>
      </div>
      ${p.recentUploads.length ? `
        <section class="home-section">
          <h2 class="section-title">Recent uploads</h2>
          <div class="file-list">
            ${p.recentUploads.map((f) => fileRow(f, { showCourse: true, showCounts: true })).join("")}
          </div>
        </section>` : ""}
      ${p.activity && p.activity.length ? `
        <section class="home-section">
          <h2 class="section-title">Activity</h2>
          <div class="activity-timeline">
            ${p.activity.map((a) => {
              const iconMap = { upload: "upload", comment: "chat", like: "heart" };
              const labelMap = { upload: "Uploaded", comment: "Commented on", like: "Liked" };
              return `<div class="activity-item">
                <span class="activity-icon">${icon(iconMap[a.k] || "star")}</span>
                <span>${labelMap[a.k] || a.k} <strong>${esc(a.d || "")}</strong></span>
                <span class="muted small">${fmtDate(new Date(a.t).toISOString())}</span>
              </div>`;
            }).join("")}
          </div>
        </section>` : ""}`);
    bindRowActions({ showCourse: true, counts: true });

    const followBtn = document.getElementById("follow-btn");
    if (followBtn) {
      followBtn.addEventListener("click", async () => {
        const uid = followBtn.dataset.uid;
        const isFollowing = followBtn.classList.contains("btn-outline");
        try {
          if (isFollowing) {
            await api("/api/users/" + uid + "/follow", { method: "DELETE" });
            followBtn.textContent = "Follow";
            followBtn.classList.remove("btn-outline");
            followBtn.classList.add("btn-primary");
          } else {
            await api("/api/users/" + uid + "/follow", { method: "POST" });
            followBtn.textContent = "Following";
            followBtn.classList.remove("btn-primary");
            followBtn.classList.add("btn-outline");
          }
          renderProfile(hash);
        } catch (err) {
          alert(err.message);
        }
      });
    }

    document.querySelectorAll("[data-show-followers]").forEach((el) => {
      el.addEventListener("click", async () => {
        const d = await api("/api/users/" + el.dataset.showFollowers + "/followers");
        showUserListModal("Followers", d.followers);
      });
    });
    document.querySelectorAll("[data-show-following]").forEach((el) => {
      el.addEventListener("click", async () => {
        const d = await api("/api/users/" + el.dataset.showFollowing + "/following");
        showUserListModal("Following", d.following);
      });
    });
  } catch (err) {
    app.innerHTML = shell(`<div style="padding:40px 20px;text-align:center">
      <h2>Profile not found</h2>
      <p class="muted">${esc(err.message)}</p>
      <a href="#/" class="btn btn-primary" style="margin-top:12px">Go home</a>
    </div>`);
  }
}

function showUserListModal(title, users) {
  const existing = document.getElementById("user-list-modal");
  if (existing) existing.remove();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "user-list-modal";
  overlay.innerHTML = `
    <div class="modal">
      <h2>${esc(title)}</h2>
      ${users.length ? `<div class="user-list">${users.map((u) =>
        `<a href="#/profile/${u.id}" class="user-list-item" onclick="this.closest('.modal-overlay').remove()">
          <div style="width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:linear-gradient(135deg,var(--primary),var(--primary-2));color:#fff;font-size:0.85rem;flex-shrink:0">${icon("user")}</div>
          <div><strong>${esc(u.username)}</strong><br><span class="muted small">${esc(u.role)}</span></div>
        </a>`
      ).join("")}</div>` : `<p class="muted" style="text-align:center;padding:20px 0">No users yet</p>`}
      <div class="modal-actions"><button class="btn btn-outline" id="ul-close">Close</button></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector("#ul-close").addEventListener("click", () => overlay.remove());
}

/* ---------- collection detail ---------- */

async function renderCollectionDetail(hash) {
  if (!state.user) return (location.hash = "#/login");
  const colId = hash.split("/collection/")[1];
  try {
    const d = await api("/api/collections");
    const col = d.collections.find((c) => c.id === colId);
    if (!col) throw new Error("Collection not found");
    app.innerHTML = shell(`
      <a href="#/" class="back-link">${icon("chevronLeft")} Back</a>
      <div class="page-head">
        <div>
          <h1>${icon("folder")} ${esc(col.name)}</h1>
          <p class="muted">${col.files.length} file${col.files.length !== 1 ? "s" : ""}${col.description ? " · " + esc(col.description) : ""}</p>
        </div>
        <button class="btn btn-danger btn-sm" id="del-col-btn">${icon("trash")} Delete collection</button>
      </div>
      <div class="file-list">
        ${col.files.length
          ? col.files.map((f) => fileRow(f, { showCourse: true, showCounts: true })).join("")
          : emptyState("folder", "No files yet", "Add files to this collection from any file row.")}
      </div>`);
    bindRowActions({ showCourse: true, counts: true });
    document.getElementById("del-col-btn").addEventListener("click", async () => {
      if (!confirm("Delete this collection?")) return;
      try {
        await api("/api/collections/" + colId, { method: "DELETE" });
        showToast("Collection deleted");
        location.hash = "#/";
      } catch (err) { alert(err.message); }
    });
  } catch (err) {
    app.innerHTML = shell(`<div style="padding:40px 20px;text-align:center">
      <h2>Collection not found</h2>
      <p class="muted">${esc(err.message)}</p>
      <a href="#/" class="btn btn-primary" style="margin-top:12px">Go home</a>
    </div>`);
  }
}

/* ---------- notifications page ---------- */

async function renderNotifications() {
  if (!state.user) return (location.hash = "#/login");
  let notifications = [];
  try { notifications = (await api("/api/notifications")).notifications || []; } catch {}
  const unread = notifications.filter((n) => !n.read).length;

  app.innerHTML = shell(`
    <div class="notif-page">
      <div class="notif-page-head">
        <h1>Notifications</h1>
        ${unread ? '<button class="btn btn-primary btn-sm" id="notif-mark-all">Mark all read</button>' : ""}
      </div>
      ${notifications.length ? `<div class="notif-page-list">
        ${notifications.map((n) => `
          <div class="notif-page-item ${n.read ? "read" : ""}" data-nid="${n.id}" ${n.link ? 'data-link="' + esc(n.link) + '" style="cursor:pointer"' : ""}>
            <div class="notif-page-text">${esc(n.text)}</div>
            <div class="notif-page-meta">
              <span class="muted small">${fmtDate(n.at)}</span>
              ${n.link ? '<span class="notif-page-arrow">' + icon("chevronRight") + "</span>" : ""}
            </div>
          </div>`).join("")}
      </div>` : emptyState("bell", "No notifications yet", "Notifications from courses and classmates will appear here.", "")}
    </div>`);

  const markAllBtn = document.getElementById("notif-mark-all");
  if (markAllBtn) markAllBtn.addEventListener("click", async () => {
    try {
      await api("/api/notifications/read", { method: "POST" });
      renderNotifications();
    } catch {}
  });

  document.querySelectorAll(".notif-page-item[data-link]").forEach((el) => {
    el.addEventListener("click", async () => {
      const link = el.dataset.link;
      const nid = el.dataset.nid;
      if (nid) try { await api("/api/notifications/" + nid + "/read", { method: "POST" }); } catch {}
      if (link) location.hash = "#" + link;
    });
  });
}

/* ---------- study groups ---------- */

async function renderGroups() {
  if (!state.user) return (location.hash = "#/login");
  let groups = [];
  try { groups = (await api("/api/groups")).groups; } catch {}
  app.innerHTML = shell(`
    <div class="page-head">
      <div>
        <h1>${icon("users")} Study Groups</h1>
        <p class="muted">Collaborate and share collections with classmates</p>
      </div>
      <button class="btn btn-primary" id="new-group-btn">+ New group</button>
    </div>
    ${groups.length ? `<div class="group-grid">${groups.map((g) => `
      <a href="#/group/${g.id}" class="col-card">
        <div class="col-icon">${icon("users")}</div>
        <div class="col-info">
          <h3>${esc(g.name)}</h3>
          <p>${g.memberCount} member${g.memberCount !== 1 ? "s" : ""} · ${g.collectionCount} collection${g.collectionCount !== 1 ? "s" : ""}</p>
          ${g.description ? `<p class="muted small">${esc(g.description)}</p>` : ""}
        </div>
      </a>`).join("")}</div>` : emptyState("users", "No study groups yet", "Create a group to share collections with classmates.")}
    <div class="modal-overlay hidden" id="group-modal">
      <div class="modal">
        <h2>Create Study Group</h2>
        <form id="group-form" class="stack">
          <label>Group name <input id="grp-name" placeholder="e.g. CS101 Study Group" maxlength="60" /></label>
          <label>Description (optional) <input id="grp-desc" placeholder="What's this group for?" maxlength="200" /></label>
          <p class="error" id="grp-error"></p>
          <div class="modal-actions">
            <button type="button" class="btn btn-outline" id="grp-cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">Create</button>
          </div>
        </form>
      </div>
    </div>`);

  const newBtn = document.getElementById("new-group-btn");
  const modal = document.getElementById("group-modal");
  const close = () => modal.classList.add("hidden");
  if (newBtn) newBtn.addEventListener("click", () => modal.classList.remove("hidden"));
  if (modal) {
    document.getElementById("grp-cancel").addEventListener("click", close);
    modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  }
  document.getElementById("group-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const d = await api("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: document.getElementById("grp-name").value, description: document.getElementById("grp-desc").value })
      });
      showToast("Group created");
      location.hash = "#/group/" + d.group.id;
    } catch (err) {
      document.getElementById("grp-error").textContent = err.message;
    }
  });
}

async function renderGroupDetail(hash) {
  if (!state.user) return (location.hash = "#/login");
  const groupId = hash.split("/group/")[1];
  try {
    const d = await api("/api/groups/" + groupId);
    const g = d.group;
    const isOwner = g.ownerId === state.user.id;
    const myCols = state.user ? (await api("/api/collections")).collections : [];
    app.innerHTML = shell(`
      <a href="#/groups" class="back-link">${icon("chevronLeft")} Back to groups</a>
      <div class="card" style="padding:24px">
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">
          <div style="width:52px;height:52px;border-radius:14px;display:grid;place-items:center;background:linear-gradient(135deg,var(--primary),var(--primary-2));color:#fff;font-size:1.4rem;flex-shrink:0">${icon("users")}</div>
          <div>
            <h1 style="margin:0;font-size:1.3rem">${esc(g.name)}</h1>
            <p class="muted small">${esc(g.description || "")} · Created by ${esc(g.ownerName || "Unknown")}</p>
          </div>
        </div>
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          ${!isOwner ? `<button class="btn btn-danger btn-sm" id="leave-group-btn">Leave group</button>` : `<button class="btn btn-danger btn-sm" id="delete-group-btn">${icon("trash")} Delete group</button>`}
        </div>
      </div>
      <div class="card" style="padding:20px">
        <h3 style="margin-top:0">Members (${g.members.length})</h3>
        <div class="user-list">
          ${g.members.map((m) => `
            <a href="#/profile/${m.id}" class="user-list-item">
              <div style="width:32px;height:32px;border-radius:8px;display:grid;place-items:center;background:linear-gradient(135deg,var(--primary),var(--primary-2));color:#fff;font-size:0.75rem;flex-shrink:0">${icon("user")}</div>
              <div><strong>${esc(m.username)}</strong> ${m.id === g.ownerId ? '<span class="muted small">(owner)</span>' : ""}</div>
            </a>`).join("")}
        </div>
      </div>
      <div class="card" style="padding:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3 style="margin:0">Shared Collections (${g.sharedCollections.length})</h3>
          <button class="btn btn-primary btn-sm" id="share-col-btn">${icon("folder")} Share a collection</button>
        </div>
        ${g.sharedCollections.length ? `<div class="col-grid">${g.sharedCollections.map((col) => `
          <div class="col-card">
            <div class="col-icon">${icon("folder")}</div>
            <div class="col-info">
              <h3>${esc(col.name)}</h3>
              <p>${col.fileCount} file${col.fileCount !== 1 ? "s" : ""} · by ${esc(col.ownerName)}</p>
            </div>
          </div>`).join("")}</div>` : `<p class="muted" style="text-align:center;padding:16px 0">No collections shared yet. Share one to get started!</p>`}
      </div>
      <div class="modal-overlay hidden" id="share-col-modal">
        <div class="modal">
          <h2>Share a Collection</h2>
          <div class="share-col-list" id="share-col-list">
            ${myCols.length ? myCols.map((c) => `
              <button class="share-col-item" data-col-id="${c.id}">
                <div style="display:flex;align-items:center;gap:10px">
                  <span>${icon("folder")}</span>
                  <div style="text-align:left">
                    <strong>${esc(c.name)}</strong><br>
                    <span class="muted small">${c.files.length} file${c.files.length !== 1 ? "s" : ""}</span>
                  </div>
                </div>
              </button>`).join("") : `<p class="muted" style="text-align:center;padding:20px 0">No collections to share</p>`}
          </div>
          <div class="modal-actions">
            <button class="btn btn-outline" id="sc-cancel">Close</button>
          </div>
        </div>
      </div>`);

    if (isOwner) {
      document.getElementById("delete-group-btn").addEventListener("click", async () => {
        if (!confirm("Delete this group?")) return;
        await api("/api/groups/" + groupId, { method: "DELETE" });
        showToast("Group deleted");
        location.hash = "#/groups";
      });
    } else {
      document.getElementById("leave-group-btn").addEventListener("click", async () => {
        if (!confirm("Leave this group?")) return;
        await api("/api/groups/" + groupId + "/leave", { method: "POST" });
        showToast("Left group");
        location.hash = "#/groups";
      });
    }

    const shareBtn = document.getElementById("share-col-btn");
    const shareModal = document.getElementById("share-col-modal");
    const shareClose = () => shareModal.classList.add("hidden");
    if (shareBtn) shareBtn.addEventListener("click", () => shareModal.classList.remove("hidden"));
    if (shareModal) {
      document.getElementById("sc-cancel").addEventListener("click", shareClose);
      shareModal.addEventListener("click", (e) => { if (e.target === shareModal) shareClose(); });
    }
    document.querySelectorAll(".share-col-item").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await api("/api/groups/" + groupId + "/share", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ collectionId: btn.dataset.colId })
          });
          showToast("Collection shared!");
          shareClose();
          renderGroupDetail(hash);
        } catch (err) {
          alert(err.message);
        }
      });
    });
  } catch (err) {
    app.innerHTML = shell(`<div style="padding:40px 20px;text-align:center">
      <h2>Group not found</h2>
      <p class="muted">${esc(err.message)}</p>
      <a href="#/groups" class="btn btn-primary" style="margin-top:12px">Back to groups</a>
    </div>`);
  }
}

/* ---------- boot ---------- */

(async function init() {
  if (token()) {
    try {
      const me = await api("/api/me");
      state.user = me.user;
      state.themeSchedule = me.user.themeSchedule || null;
      state.notifPrefs = me.user.notifPrefs || null;
    } catch {}
    try {
      state.readProgress = (await api("/api/files/progress")).progress || {};
    } catch { state.readProgress = {}; }
  }
  applyThemeSchedule();
  render();
})();

window.addEventListener("hashchange", () => {
  render();
});

let lastNotifKey = "";
async function pollNotifications() {
  if (!state.user || !token()) return;
  try {
    const d = await api("/api/notifications");
    const unread = d.notifications.filter((n) => !n.read).length;
    const key = unread + "|" + d.notifications.length + "|" + (d.notifications[0]?.at || "");
    if (key !== lastNotifKey) {
      lastNotifKey = key;
      renderNav();
    }
  } catch {}
}
setInterval(pollNotifications, 30000);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelectorAll(".modal-overlay:not(.hidden)").forEach((m) => m.classList.add("hidden"));
    const pdfOverlay = document.getElementById("pdf-overlay");
    if (pdfOverlay) pdfOverlay.remove();
  }
});

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
  if (!localStorage.getItem("theme")) {
    state.theme = e.matches ? "dark" : "light";
    applyTheme();
    renderNav();
  }
});

window.addEventListener("error", (e) => {
  console.error("Uncaught error:", e.error || e.message);
});

window.addEventListener("unhandledrejection", (e) => {
  console.error("Unhandled promise rejection:", e.reason);
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      reg.update().catch(() => {});
    }).catch(() => {});
  });
}

/* ---------- offline indicator ---------- */

const offlineBar = document.getElementById("offline-bar");
function updateOnlineStatus() {
  if (offlineBar) offlineBar.classList.toggle("hidden", navigator.onLine);
}
window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);
updateOnlineStatus();

/* ---------- PWA install prompt ---------- */

let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (!localStorage.getItem("installDismissed")) {
    const bar = document.getElementById("install-bar");
    if (bar) bar.classList.remove("hidden");
  }
});
const installBtn = document.getElementById("install-btn");
if (installBtn) {
  installBtn.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === "accepted") {
      document.getElementById("install-bar")?.classList.add("hidden");
    }
    deferredInstallPrompt = null;
  });
}
const installDismiss = document.getElementById("install-dismiss");
if (installDismiss) {
  installDismiss.addEventListener("click", () => {
    document.getElementById("install-bar")?.classList.add("hidden");
    localStorage.setItem("installDismissed", "1");
  });
}
window.addEventListener("appinstalled", () => {
  document.getElementById("install-bar")?.classList.add("hidden");
  deferredInstallPrompt = null;
});
