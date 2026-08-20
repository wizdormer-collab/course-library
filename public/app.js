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
        <button class="icon-btn star ${f.saved ? "on" : ""}" data-save="${f.id}" title="Save for later">${icon("star")}</button>
        <button class="icon-btn" data-collect="${f.id}" title="Add to collection">${icon("folder")}</button>
        ${isAdmin || (state.user && f.uploadedBy === state.user.id) ? `<button class="icon-btn" data-edit-tags="${f.id}" data-etags="${esc(JSON.stringify(f.tags || []))}" title="Edit tags">${icon("tag")}</button>` : ""}
        ${isAdmin || (state.user && f.uploadedBy === state.user.id) ? `<button class="icon-btn" data-rename="${f.id}" data-rname="${esc(f.name)}" title="Rename">${icon("edit")}</button>` : ""}
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
          <button class="btn btn-outline" id="pdf-close">Close</button>
        </div>
        <div class="pdf-body">
          <iframe class="pdf-frame" id="pdf-frame" title="PDF preview"></iframe>
          <div class="comments" id="comments"></div>
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

  (async () => {
    try {
      const blob = await fetchBlob("/api/files/" + fileId + "/inline");
      frame.src = URL.createObjectURL(blob);
    } catch (err) {
      titleEl.textContent = "Preview unavailable";
    }
  })();

  try {
    const list = await api("/api/files");
    const found = list.files.find((x) => x.id === fileId);
    if (found) titleEl.textContent = found.name;
  } catch {}

  await loadComments(fileId);
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
    <form id="comment-form">
      <input id="comment-input" placeholder="Ask about this material..." maxlength="2000" />
      <button class="btn btn-primary btn-sm">Post</button>
    </form>
    <div class="comment-list">
      ${comments.length ? comments.map((c) => `
        <div class="comment">
          <strong>${esc(c.username)}</strong>
          <span class="muted">${fmtDate(c.at)}</span>
          ${isAdmin || (state.user && c.userId === state.user.id)
            ? `<button class="comment-del" data-cid="${c.id}" title="Delete">${icon("close")}</button>` : ""}
          <p>${esc(c.text)}</p>
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
      <div class="notif-wrap">
        <button class="icon-btn" id="notif-btn" title="Notifications">${icon("bell")}</button>
        ${unread ? `<span class="notif-dot">${unread > 9 ? "9+" : unread}</span>` : ""}
        <div class="notif-drop hidden" id="notif-drop">
          <div class="notif-head">
            <strong>Notifications</strong>
            ${unread ? '<button class="link-btn" id="notif-read">Mark all read</button>' : ""}
          </div>
          ${notifications.length ? notifications.slice(0, 15).map((n) => `
            <div class="notif-item ${n.read ? "read" : ""}">${esc(n.text)}
              <div class="muted small">${fmtDate(n.at)}</div>
            </div>`).join("") : '<div class="notif-item muted">No notifications</div>'}
        </div>
      </div>`;
  }

  navLinks.innerHTML = state.user
    ? `
      <a href="#/" class="nav-link">Courses</a>
      <a href="#/saved" class="nav-link">Saved</a>
      <a href="#/settings" class="nav-link">Settings</a>
      ${state.user.role === "admin" ? '<a href="#/admin" class="nav-link">Admin</a>' : ""}
      ${notifHtml}
      <button class="icon-btn" id="theme-btn" title="Toggle theme">${state.theme === "dark" ? icon("sun") : icon("moon")}</button>
      <span class="nav-user">${esc(state.user.username)} <small>(${esc(state.user.role)})</small></span>`
    : `
      <a href="#/login" class="nav-link">Log in</a>
      <a href="#/register" class="btn btn-primary">Sign up</a>`;

  const bottomNav = document.getElementById("bottom-nav");
  if (bottomNav) {
    const cur = location.hash.replace(/^#/, "") || "/";
    const isAuthPage = !state.user && ["/login", "/register", "/verify", "/forgot"].includes(cur);
    document.body.classList.toggle("auth-page", isAuthPage);
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
            { path: "/register", label: "Sign up", icon: "edit" }
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

  const notifBtn = document.getElementById("notif-btn");
  const notifDrop = document.getElementById("notif-drop");
  if (notifBtn && notifDrop) {
    notifBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      notifDrop.classList.toggle("hidden");
    });
    const readBtn = document.getElementById("notif-read");
    if (readBtn) readBtn.addEventListener("click", async () => {
      await api("/api/notifications/read", { method: "POST" });
      renderNav();
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".notif-wrap")) notifDrop.classList.add("hidden");
    });
  }
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
    if (hash === "/register") { renderRegister(); return; }
    if (hash === "/verify") { renderVerify(); return; }
    if (hash === "/forgot") { renderForgot(); return; }
    else if (hash.startsWith("/profile/")) { await renderProfile(hash); }
    else if (hash.startsWith("/collection/")) { await renderCollectionDetail(hash); }
    else if (hash === "/saved") { await renderSaved(); }
    else if (hash === "/settings") { await renderSettings(); }
    else if (hash === "/admin") { await renderAdmin(); }
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
  document.getElementById("signup-btn").addEventListener("click", () => (location.hash = "#/register"));
}

function renderRegister() {
  if (state.user) return (location.hash = "#/");
  app.innerHTML = authShell(`
      <form class="auth-card" id="reg-form">
        <h1>Create account</h1>
        <p class="muted">Sign up with your student email. Enter the admin invite code to join as an administrator.</p>
        <label>Student email <input id="reg-email" type="email" placeholder="you@university.edu.ng" /></label>
        <label>Nickname (optional) <input id="reg-user" placeholder="shown to classmates" /></label>
        <label>Password <input id="reg-pass" type="password" /></label>
        <label>Confirm password <input id="reg-pass2" type="password" /></label>
        <label>Admin invite code (optional) <input id="reg-invite" placeholder="leave empty for student" /></label>
        <div class="opt-fields">
          <p class="muted small">Optional recovery info — lets you reset your password if you forget it.</p>
          <label>Recovery question <input id="reg-q" placeholder="e.g. What city were you born in?" /></label>
          <label>Answer <input id="reg-a" placeholder="your answer" /></label>
        </div>
        <p class="error" id="reg-error"></p>
        <button class="btn btn-primary btn-block btn-lg">Sign up</button>
        <p class="auth-switch">Already registered? <a href="#/login">Log in</a></p>
      </form>`);
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
          inviteCode: document.getElementById("reg-invite").value,
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
  const first = (state.user.username || "friend").split(/\s+/)[0];

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

  const [courses, feedData, savedData, annData, lbData, colData] = await Promise.allSettled([
    api("/api/courses"),
    api("/api/feed"),
    api("/api/files/saved"),
    api("/api/announcements"),
    api("/api/leaderboard"),
    api("/api/collections")
  ]);

  state.courses = (courses.status === "fulfilled" && courses.value.courses) || [];

  const feed = (feedData.status === "fulfilled" && feedData.value.files) || [];
  const saved = (savedData.status === "fulfilled" && savedData.value.files) || [];
  const announcements = (annData.status === "fulfilled" && annData.value.announcements) || [];
  const leaderboard = (lbData.status === "fulfilled" && lbData.value.leaderboard) || [];
  const collections = (colData.status === "fulfilled" && colData.value.collections) || [];

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
      <div class="stat-item"><span class="stat-ico ico-book">${icon("book")}</span><div><span class="stat-num">${state.courses.length}</span><span class="stat-lab">Courses</span></div></div>
      <div class="stat-item"><span class="stat-ico ico-files">${icon("pdf")}</span><div><span class="stat-num">${materialsTotal}</span><span class="stat-lab">Materials</span></div></div>
      <div class="stat-item"><span class="stat-ico ico-saved">${icon("star")}</span><div><span class="stat-num">${saved.length}</span><span class="stat-lab">Saved</span></div></div>
      <div class="stat-item"><span class="stat-ico ico-recent">${icon("clock")}</span><div><span class="stat-num">${feed.length}</span><span class="stat-lab">Recent</span></div></div>
    </div>

    <section class="home-section">
      <div class="section-head">
        <h2>Continue learning</h2>
        <a href="#/courses" class="view-all">View all</a>
      </div>
      ${continueCardHTML(cont, state.progressMap[cont ? cont.id : ""])}
    </section>

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
    el.addEventListener("click", () => { location.hash = "#/collection/" + el.dataset.colId; }));

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
        box.innerHTML = d.files.length
          ? listSection("Search results", d.files.map((f) => fileRow(f, { showCourse: true, counts: true })).join(""), "")
          : emptyState("search", "No matches found", "Try a different search term.");
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
  let users = [];
  try {
    pending = (await api("/api/files/pending")).files;
  } catch {}
  try {
    stats = (await api("/api/stats")).stats;
  } catch {}
  try {
    users = (await api("/api/users")).users;
  } catch {}

  const statCards = stats
    ? `
      <div class="stat-grid">
        ${[["Files", stats.totalFiles], ["Downloads", stats.totalDownloads], ["Views", stats.totalViews],
          ["Courses", stats.totalCourses], ["Users", stats.totalUsers], ["Pending", stats.pending]]
          .map(([label, val]) => `<div class="stat-card"><div class="stat-num">${val}</div><div class="muted">${label}</div></div>`).join("")}
      </div>
      ${stats.topFiles.length ? `
        <h2 class="section-title">Top files</h2>
        <div class="file-list">
          ${stats.topFiles.map((f) => `
            <div class="file-row">
              <span class="file-icon">${icon("file")}</span>
              <div class="file-info">
                <div class="file-name">${esc(f.name)}</div>
                <span class="muted">${esc(f.courseLabel)} &middot; ${f.views} views &middot; ${f.downloads} downloads</span>
              </div>
            </div>`).join("")}
        </div>` : ""}`
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
        <p class="muted" style="margin:4px 0 0">${p.role === "admin" ? "Admin" : "Student"}</p>
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
        </section>` : ""}`);
    bindRowActions({ showCourse: true, counts: true });
  } catch (err) {
    app.innerHTML = shell(`<div style="padding:40px 20px;text-align:center">
      <h2>Profile not found</h2>
      <p class="muted">${esc(err.message)}</p>
      <a href="#/" class="btn btn-primary" style="margin-top:12px">Go home</a>
    </div>`);
  }
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

/* ---------- boot ---------- */

(async function init() {
  if (token()) {
    try {
      const me = await api("/api/me");
      state.user = me.user;
      state.themeSchedule = me.user.themeSchedule || null;
    } catch {}
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
