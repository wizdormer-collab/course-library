const app = document.getElementById("app");
const navLinks = document.getElementById("nav-links");

const state = {
  user: null,
  toast: "",
  courses: [],
  theme: localStorage.getItem("theme") || "light"
};

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
}
applyTheme();

function token() {
  return localStorage.getItem("token");
}
function storeAuth(data) {
  localStorage.setItem("token", data.token);
  localStorage.setItem("user", JSON.stringify(data.user));
  state.user = data.user;
}
function clearAuth() {
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

/* ---------- shared helpers ---------- */

function fileRow(f, opts = {}) {
  const isAdmin = state.user && state.user.role === "admin";
  return `
    <div class="file-row">
      <span class="file-icon">&#128196;</span>
      <div class="file-info">
        <button class="file-name" data-preview="${f.id}">${esc(f.name)}</button>
        <span class="muted">
          ${opts.showCourse ? esc(f.courseLabel) + " &middot; " : ""}by ${esc(f.uploadedByName)} &middot;
          ${fmtSize(f.size)} &middot; ${fmtDate(f.uploadedAt)}
          ${f.role === "student" ? '<span class="badge">student upload</span>' : ""}
          ${!f.approved ? '<span class="badge badge-pending">pending</span>' : ""}
        </span>
        ${opts.showCounts ? `
          <span class="muted">
            <span class="stat" title="Views">&#128065; ${fmtCount(f.views || 0)}</span>
            <span class="stat" title="Downloads">&#11015; ${fmtCount(f.downloads || 0)}</span>
            <span class="stat" title="Comments">&#128172; ${f.commentCount || 0}</span>
          </span>` : ""}
      </div>
      <div class="file-actions">
        <button class="icon-btn star ${f.saved ? "on" : ""}" data-save="${f.id}" title="Save for later">&#11088;</button>
        <a class="btn btn-outline btn-sm" href="/api/files/${f.id}/download">Download</a>
        ${isAdmin ? `<button class="btn btn-danger btn-sm" data-del="${f.id}">Delete</button>` : ""}
      </div>
    </div>`;
}

function listSection(title, rows, empty) {
  return `
    <h2 class="section-title">${title}</h2>
    ${rows ? `<div class="file-list">${rows}</div>` : `<p class="muted">${empty}</p>`}`;
}

async function bindRowActions({ showCourse = false, counts = false } = {}) {
  document.querySelectorAll("[data-preview]").forEach((btn) =>
    btn.addEventListener("click", () => openPdf(btn.dataset.preview, showCourse)));
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
  frame.src = "/api/files/" + fileId + "/inline";
  const titleEl = document.getElementById("pdf-title");
  titleEl.textContent = "Loading...";

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
            ? `<button class="comment-del" data-cid="${c.id}" title="Delete">&#10005;</button>` : ""}
          <p>${esc(c.text)}</p>
        </div>`).join("") : `<p class="muted">No discussion yet. Start one!</p>`}
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
        <button class="icon-btn" id="notif-btn" title="Notifications">&#128276;</button>
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
      <button class="icon-btn" id="theme-btn" title="Toggle theme">${state.theme === "dark" ? "&#9788;" : "&#9790;"}</button>
      <span class="nav-user">${esc(state.user.username)} <small>(${esc(state.user.role)})</small></span>
      <button class="btn btn-outline" id="logout-btn">Log out</button>`
    : `
      <a href="#/login" class="nav-link">Log in</a>
      <a href="#/register" class="btn btn-primary">Sign up</a>`;

  const bottomNav = document.getElementById("bottom-nav");
  if (bottomNav) {
    const items = state.user
      ? [
          { path: "/", label: "Courses", icon: "&#128218;" },
          { path: "/saved", label: "Saved", icon: "&#11088;" },
          { path: "/settings", label: "Settings", icon: "&#9881;" },
          ...(state.user.role === "admin" ? [{ path: "/admin", label: "Admin", icon: "&#128737;" }] : []),
          { path: "/logout", label: "Log out", icon: "&#128682;" }
        ]
      : [
          { path: "/login", label: "Log in", icon: "&#128273;" },
          { path: "/register", label: "Sign up", icon: "&#9997;" }
        ];
    const cur = location.hash.replace(/^#/, "") || "/";
    bottomNav.innerHTML = items
      .map((it) => {
        const active = cur.split("/").filter(Boolean)[0] === it.path.split("/").filter(Boolean)[0] || (cur === "/" && it.path === "/");
        return `<a href="#${it.path}" class="bn-item${active ? " active" : ""}" data-path="${it.path}"><span class="bn-icon">${it.icon}</span><span>${it.label}</span></a>`;
      })
      .join("");
    bottomNav.querySelector('[data-path="/logout"]')?.addEventListener("click", (e) => {
      e.preventDefault();
      clearAuth();
      location.hash = "#/login";
    });
  }

  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) logoutBtn.addEventListener("click", () => {
    clearAuth();
    location.hash = "#/login";
  });

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
  return inner + (state.toast ? `<p class="toast">${esc(state.toast)}</p>` : "");
}

function render() {
  renderNav();
  const hash = location.hash.replace(/^#/, "") || "/";
  if (hash === "/login") return renderLogin();
  if (hash === "/register") return renderRegister();
  if (hash === "/verify") return renderVerify();
  if (hash === "/forgot") return renderForgot();
  if (hash === "/saved") return renderSaved();
  if (hash === "/settings") return renderSettings();
  if (hash === "/admin") return renderAdmin();
  if (hash.startsWith("/course/")) return renderCourseDetail(hash);
  return renderHome();
}

/* ---------- auth views ---------- */

function renderLogin() {
  if (state.user) return (location.hash = "#/");
  app.innerHTML = `
    <div class="auth-wrap">
      <form class="auth-card" id="login-form">
        <h1>Welcome back</h1>
        <p class="muted">Log in to access your course materials.</p>
        <label>Student email or username <input id="login-email" autofocus /></label>
        <label>Password <input id="login-pass" type="password" /></label>
        <p class="error" id="login-error"></p>
        <button class="btn btn-primary btn-block">Log in</button>
        <p class="muted"><a href="#/forgot">Forgot password?</a></p>
        <p class="muted">No account? <a href="#/register">Sign up</a></p>
      </form>
    </div>`;
  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
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
      if (err.message.includes("verify your email")) {
        localStorage.setItem("pendingEmail", document.getElementById("login-email").value);
        location.hash = "#/verify";
        return;
      }
      document.getElementById("login-error").textContent = err.message;
    }
  });
}

function renderRegister() {
  if (state.user) return (location.hash = "#/");
  app.innerHTML = `
    <div class="auth-wrap">
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
        <button class="btn btn-primary btn-block">Sign up</button>
        <p class="muted">Already registered? <a href="#/login">Log in</a></p>
      </form>
    </div>`;
  document.getElementById("reg-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = document.getElementById("reg-pass").value;
    if (pw !== document.getElementById("reg-pass2").value) {
      return (document.getElementById("reg-error").textContent = "Passwords do not match");
    }
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
      localStorage.setItem("pendingEmail", document.getElementById("reg-email").value);
      if (d.devCode) localStorage.setItem("devCode", d.devCode);
      showToast(d.message || "Check your inbox for a verification code.");
      location.hash = "#/verify";
    } catch (err) {
      document.getElementById("reg-error").textContent = err.message;
    }
  });
}

function renderVerify() {
  if (state.user) return (location.hash = "#/");
  const email = localStorage.getItem("pendingEmail") || "";
  let devCode = localStorage.getItem("devCode") || "";
  app.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <h1>Verify your email</h1>
        <p class="muted">Enter the 6-digit code we sent to your email to activate your account.</p>
        <label>Student email <input id="vf-email" value="${esc(email)}" /></label>
        <label>Verification code <input id="vf-code" maxlength="6" placeholder="000000" autofocus /></label>
        <p class="dev-code ${devCode ? "" : "hidden"}" id="vf-dev">
          Dev mode — no email server configured. Your code is <strong>${esc(devCode)}</strong>.
        </p>
        <p class="error" id="vf-error"></p>
        <button class="btn btn-primary btn-block" id="vf-btn">Verify &amp; continue</button>
        <p class="muted"><a href="#" id="vf-resend">Resend code</a> · <a href="#/login">Log in</a></p>
      </div>
    </div>`;
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
  app.innerHTML = `
    <div class="auth-wrap">
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
        <button class="btn btn-primary btn-block" id="fg-btn">Continue</button>
        <p class="muted">Remembered it? <a href="#/login">Log in</a></p>
      </form>
    </div>`;

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
    </div>`);

  document.getElementById("pw-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nw = document.getElementById("pw-new").value;
    if (nw !== document.getElementById("pw-new2").value) {
      return (document.getElementById("pw-error").textContent = "New passwords do not match");
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
}

/* ---------- home ---------- */

async function loadCourses() {
  try {
    state.courses = (await api("/api/courses")).courses;
  } catch {}
}

async function renderHome() {
  if (!state.user) return (location.hash = "#/login");
  await loadCourses();
  let feed = [];
  let popular = [];
  try {
    feed = (await api("/api/feed")).files;
  } catch {}
  try {
    popular = (await api("/api/popular")).files;
  } catch {}

  const cats = [...new Set(state.courses.map((c) => c.category).filter(Boolean))];
  const sems = [...new Set(state.courses.map((c) => c.semester).filter(Boolean))];

  app.innerHTML = shell(`
    <div class="page-head">
      <div>
        <h1>Course Library</h1>
        <p class="muted">Every course. Every PDF. One place.</p>
      </div>
      ${state.user.role === "admin" ? '<button class="btn btn-primary" id="new-course-btn">+ New course</button>' : ""}
    </div>

    <div class="search-bar">
      <span class="search-icon">&#128269;</span>
      <input id="search-input" type="search" placeholder="Search across all course PDFs..." autocomplete="off" />
    </div>
    <div id="search-results"></div>

    <h2 class="section-title">Courses</h2>
    <div class="filters">
      <select id="filter-cat"><option value="">All categories</option>${cats.map((c) => `<option>${esc(c)}</option>`).join("")}</select>
      <select id="filter-sem"><option value="">All semesters</option>${sems.map((s) => `<option>${esc(s)}</option>`).join("")}</select>
    </div>
    <div class="grid" id="course-grid">
      ${state.courses.map((c) => courseCard(c)).join("")}
    </div>

    ${feed.length ? `
      <div class="discovery">
        ${listSection("New this week", feed.map((f) => fileRow(f, { showCourse: true, counts: true })).join(""), "")}
      </div>` : ""}
    ${popular.length ? `
      <div class="discovery">
        ${listSection("Popular this week", popular.map((f) => fileRow(f, { showCourse: true, counts: true })).join(""), "")}
      </div>` : ""}

    ${courseModalHTML()}`);

  bindSearch();
  bindFilters();
  bindRowActions({ showCourse: true, counts: true });

  const newBtn = document.getElementById("new-course-btn");
  if (newBtn) newBtn.addEventListener("click", () => showModal("course-modal"));
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

function bindFilters() {
  const cat = document.getElementById("filter-cat");
  const sem = document.getElementById("filter-sem");
  if (!cat || !sem) return;
  const apply = () => {
    const grid = document.getElementById("course-grid");
    const list = state.courses.filter(
      (c) => (!cat.value || c.category === cat.value) && (!sem.value || c.semester === sem.value)
    );
    grid.innerHTML = list.length ? list.map(courseCard).join("") : '<p class="muted">No courses match.</p>';
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
          : '<p class="muted">No matches found.</p>';
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

function showModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove("hidden");
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

/* ---------- course detail ---------- */

async function renderCourseDetail(hash) {
  if (!state.user) return (location.hash = "#/login");
  const id = hash.split("/")[2];
  const course = state.courses.find((c) => c.id === id);
  let files = [];
  let progress = null;
  try {
    files = (await api("/api/files?courseId=" + encodeURIComponent(id))).files;
  } catch {}
  try {
    progress = await api("/api/courses/" + id + "/progress");
  } catch {}
  const isAdmin = state.user.role === "admin";

  const rows = files.length
    ? files.map((f) => fileRow(f, { counts: true })).join("")
    : "";

  app.innerHTML = shell(`
    <a href="#/" class="back-link">&larr; All courses</a>
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
          <a class="btn btn-outline" href="/api/courses/${id}/zip">&#128230; Download all (ZIP)</a>
          <button class="btn btn-primary" id="upload-btn">+ Upload PDF</button>
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

      ${files.length ? `<div class="file-list">${rows}</div>` : '<p class="muted">No materials uploaded yet. Be the first to add one!</p>'}

      <div class="modal-overlay hidden" id="upload-modal">
        <div class="modal">
          <h2>Upload PDF</h2>
          <form id="upload-form">
            <label>File name (optional) <input id="up-name" placeholder="e.g. Lecture 3 - Arrays.pdf" /></label>
            <label>PDF file <input id="up-file" type="file" accept="application/pdf" /></label>
            <p class="error" id="up-error"></p>
            <div class="modal-actions">
              <button type="button" class="btn btn-outline" id="up-cancel">Cancel</button>
              <button type="submit" class="btn btn-primary">Upload</button>
            </div>
          </form>
        </div>
      </div>` : '<p class="muted">Course not found.</p>'}`);

  if (!course) return;

  bindRowActions({ counts: true });

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
    const f = input.files[0];
    if (!f) return (document.getElementById("up-error").textContent = "Choose a PDF file first");
    if (!f.type.includes("pdf") && !/\.pdf$/i.test(f.name)) {
      return (document.getElementById("up-error").textContent = "Only PDF files are allowed");
    }
    const name = document.getElementById("up-name").value;
    const buf = await f.arrayBuffer();
    try {
      const d = await api("/api/files", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-File-Name": encodeURIComponent(name.trim() || f.name),
          "X-Original-Name": encodeURIComponent(f.name),
          "X-Course-Id": id
        },
        body: buf
      });
      document.getElementById("upload-modal").classList.add("hidden");
      showToast(d.message);
      renderCourseDetail(hash);
    } catch (err) {
      document.getElementById("up-error").textContent = err.message;
    }
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
              <span class="file-icon">&#128196;</span>
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
        <h1>Admin</h1>
        <p class="muted">Review uploads and keep the library healthy.</p>
      </div>
    </div>
    ${statCards}
    <h2 class="section-title">Pending approvals (${pending.length})</h2>
    ${pending.length === 0 ? '<p class="muted">Nothing waiting for review. Nice and clean.</p>' : `
      <div class="file-list">
        ${pending.map((f) => `
          <div class="file-row">
            <span class="file-icon">&#128196;</span>
            <div class="file-info">
              <div class="file-name">${esc(f.name)}</div>
              <span class="muted">${esc(f.courseLabel)} &middot; by ${esc(f.uploadedByName)} &middot; ${fmtSize(f.size)}</span>
            </div>
            <div class="file-actions">
              <a class="btn btn-outline btn-sm" href="/api/files/${f.id}/inline" target="_blank" rel="noreferrer">Preview</a>
              <button class="btn btn-primary btn-sm" data-approve="${f.id}">Approve</button>
              <button class="btn btn-danger btn-sm" data-reject="${f.id}">Reject</button>
            </div>
          </div>`).join("")}
      </div>`}

    <h2 class="section-title">Users (${users.length})</h2>
    <div class="file-list">
      ${users.map((u) => `
        <div class="file-row">
          <span class="file-icon">${u.role === "admin" ? "&#129513;" : "&#128100;"}</span>
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
            ${u.id !== state.user.id ? `<button class="btn btn-danger btn-sm" data-deluser="${u.id}">Delete</button>` : ""}
          </div>
        </div>`).join("")}
    </div>`);

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
}

/* ---------- boot ---------- */

(async function init() {
  if (token()) {
    try {
      state.user = (await api("/api/me")).user;
    } catch {}
  }
  render();
})();

window.addEventListener("hashchange", () => {
  render();
});
