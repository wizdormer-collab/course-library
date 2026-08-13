import http from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { extractPdfText } from "./lib/pdftext.js";
import { buildZip } from "./lib/zip.js";
import { sendMail, smtpConfigured } from "./lib/mailer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, "data.json");
const BACKUP_FILE = path.join(DATA_DIR, "data.json.bak");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const PUBLIC_DIR = path.join(__dirname, "public");
const SECRET = process.env.SECRET || crypto.randomBytes(32).toString("hex");
const PORT = process.env.PORT || 3000;
const MAX_UPLOAD = 25 * 1024 * 1024;
const ADMIN_INVITE_CODE = process.env.ADMIN_INVITE_CODE || "admin2026";
const ALLOWED_EMAIL_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS || "")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);
const EMAIL_ENABLED = smtpConfigured();
const VERIFY_TTL = 15 * 60 * 1000;

function genVerifyCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function deliverVerifyCode(user, code) {
  const subject = "Course Library - verify your email";
  const text =
    "Hi " + user.username + ",\n\n" +
    "Your Course Library verification code is: " + code + "\n\n" +
    "Enter this code to activate your account. It expires in 15 minutes.\n\n" +
    "If you did not create this account, you can ignore this message.";
  if (!EMAIL_ENABLED) return { dev: true };
  try {
    await sendMail({ to: user.email, subject, text });
    return { sent: true };
  } catch (err) {
    return { sent: false, error: err.message };
  }
}

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

if (!fs.existsSync(DATA_FILE)) {
  const SEED_FILE = path.join(__dirname, "seed-data.json");
  if (fs.existsSync(SEED_FILE)) {
    fs.copyFileSync(SEED_FILE, DATA_FILE);
  } else {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ users: [], courses: [], files: [] }, null, 2));
  }
}
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

let db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

function saveDb() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  try {
    fs.copyFileSync(DATA_FILE, BACKUP_FILE);
  } catch {}
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(pw), salt, 32).toString("hex");
  return salt + ":" + hash;
}
function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(pw), salt, 32).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(test, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function signToken(user) {
  const payload = Buffer.from(
    JSON.stringify({ uid: user.id, exp: Date.now() + 7 * 24 * 3600 * 1000 })
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  return payload + "." + sig;
}
function verifyToken(token) {
  const [payload, sig] = String(token || "").split(".");
  if (!payload || !sig) return null;
  const expect = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (data.exp < Date.now()) return null;
    return db.users.find((u) => u.id === data.uid) || null;
  } catch {
    return null;
  }
}

await seed();
async function seed() {
  let changed = false;
  for (const user of db.users) {
    if (!user.hash && user.defaultPassword) {
      user.hash = hashPassword(user.defaultPassword);
      delete user.defaultPassword;
      changed = true;
    }
    if (!user.securityQuestion && user.defaultSecurityQuestion) {
      user.securityQuestion = user.defaultSecurityQuestion;
      user.securityAnswerHash = hashPassword(String(user.defaultSecurityAnswer).toLowerCase());
      delete user.defaultSecurityQuestion;
      delete user.defaultSecurityAnswer;
      changed = true;
    }
    if (!user.email) {
      user.email = user.username.toLowerCase() + "@student.edu.ng";
      changed = true;
    }
    if (!Array.isArray(user.notifications)) {
      user.notifications = [];
      changed = true;
    }
    if (user.verified === undefined) {
      user.verified = true;
      delete user.verification;
      changed = true;
    }
  }
  for (const c of db.courses) {
    if (c.category === undefined) {
      c.category = "";
      c.semester = "";
      changed = true;
    }
  }
  if (changed) saveDb();
}

function publicUser(u) {
  return { id: u.id, username: u.username, email: u.email || "", role: u.role, verified: !!u.verified };
}

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req, limit = MAX_UPLOAD) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error("File is too large (max 25MB)"), { status: 400 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function getAuthUser(req) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return null;
  return verifyToken(h.slice(7));
}

function notify(userId, text) {
  const user = db.users.find((u) => u.id === userId);
  if (!user) return;
  if (!Array.isArray(user.notifications)) user.notifications = [];
  user.notifications.unshift({ id: "n" + Date.now() + Math.random().toString(16).slice(2, 6), text, at: new Date().toISOString(), read: false });
  if (user.notifications.length > 100) user.notifications.length = 100;
}

function trackActivity(f, type) {
  if (!Array.isArray(f.activity)) f.activity = [];
  f.activity.push({ t: Date.now(), k: type });
  if (f.activity.length > 300) f.activity = f.activity.slice(-300);
}

function weeklyScore(f) {
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  let score = 0;
  for (const a of f.activity || []) {
    if (a.t >= weekAgo) score += a.k === "download" ? 3 : 1;
  }
  return score;
}

function courseLabel(id) {
  const c = db.courses.find((x) => x.id === id);
  return c ? c.code + " - " + c.name : id;
}

function fileInfo(f, user) {
  const info = {
    id: f.id,
    name: f.name,
    originalName: f.originalName,
    courseId: f.courseId,
    courseLabel: courseLabel(f.courseId),
    uploadedByName: f.uploadedByName,
    role: f.role,
    approved: f.approved,
    size: f.size,
    uploadedAt: f.uploadedAt,
    downloads: f.downloads || 0,
    views: f.views || 0,
    commentCount: (f.comments || []).length
  };
  if (user && (user.role === "admin" || f.uploadedBy === user.id)) info.uploadedBy = f.uploadedBy;
  if (user) {
    info.saved = (f.savedBy || []).includes(user.id);
    info.viewed = (f.viewedBy || []).includes(user.id);
  }
  return info;
}

function canSeeFile(f, user) {
  return user.role === "admin" || f.approved || f.uploadedBy === user.id;
}

function matchRoute(method, pathname) {
  const segs = pathname.split("/").filter(Boolean);
  for (const r of routes) {
    if (r.method !== method) continue;
    const rsegs = r.path.split("/").filter(Boolean);
    if (rsegs.length !== segs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < rsegs.length; i++) {
      if (rsegs[i].startsWith(":")) params[rsegs[i].slice(1)] = decodeURIComponent(segs[i]);
      else if (rsegs[i] !== segs[i]) { ok = false; break; }
    }
    if (ok) return { handler: r.handler, params };
  }
  return null;
}

const routes = [];

async function handleApi(req, res, pathname) {
  const m = matchRoute(req.method, pathname);
  if (!m) return send(res, 404, { error: "Not found" });
  try {
    await m.handler(req, res, m.params);
  } catch (err) {
    if (!res.headersSent) send(res, err.status || 500, { error: err.message || "Server error" });
  }
}

const ok = (res) => send(res, 200, { ok: true });

/* ---------- auth ---------- */

routes.push({ method: "GET", path: "/api/health", handler: (_req, res) => send(res, 200, { ok: true }) });

routes.push({
  method: "POST", path: "/api/auth/register",
  handler: async (req, res) => {
    const body = JSON.parse((await readBody(req, 1024 * 16)).toString() || "{}");
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return send(res, 400, { error: "Enter a valid student email" });
    }
    if (password.length < 4) return send(res, 400, { error: "Password must be at least 4 characters" });
    if (db.users.some((u) => u.email && u.email === email)) {
      return send(res, 409, { error: "An account with this email already exists" });
    }
    if (ALLOWED_EMAIL_DOMAINS.length) {
      const domain = email.split("@")[1];
      if (!ALLOWED_EMAIL_DOMAINS.includes(domain)) {
        return send(res, 403, {
          error: "Only student emails from " + ALLOWED_EMAIL_DOMAINS.join(", ") + " are allowed"
        });
      }
    }
    let username = String(body.username || "").trim() || email.split("@")[0];
    if (username.length < 3) return send(res, 400, { error: "Username must be at least 3 characters" });
    const taken = (base) =>
      db.users.some((u) => u.username.toLowerCase() === base.toLowerCase());
    if (taken(username)) {
      let n = 2;
      while (taken(username + n)) n++;
      username = username + n;
    }
    let role = "student";
    const inviteCode = String(body.inviteCode || "").trim();
    if (inviteCode) {
      if (inviteCode !== ADMIN_INVITE_CODE) return send(res, 403, { error: "Invalid admin invite code" });
      role = "admin";
    }
    const user = {
      id: "u" + Date.now(),
      username,
      email,
      hash: hashPassword(password),
      role,
      notifications: [],
      verified: false,
      verification: { code: genVerifyCode(), expires: Date.now() + VERIFY_TTL },
      securityQuestion: String(body.securityQuestion || "").trim() || null,
      securityAnswerHash: String(body.securityAnswer || "").trim()
        ? hashPassword(String(body.securityAnswer).trim().toLowerCase())
        : null
    };
    db.users.push(user);
    saveDb();
    const delivery = await deliverVerifyCode(user, user.verification.code);
    send(res, 201, {
      pending: true,
      message: EMAIL_ENABLED && delivery.sent
        ? "Account created. A verification code was sent to " + email
        : "Account created. Enter the verification code to activate your account.",
      devCode: delivery.dev ? user.verification.code : undefined
    });
  }
});

routes.push({
  method: "POST", path: "/api/auth/login",
  handler: async (req, res) => {
    const body = JSON.parse((await readBody(req, 1024 * 16)).toString() || "{}");
    const id = String(body.email || body.username || "").trim().toLowerCase();
    const user = db.users.find(
      (u) =>
        u.email === id ||
        u.username.toLowerCase() === id
    );
    if (!user || !verifyPassword(body.password || "", user.hash)) {
      return send(res, 401, { error: "Invalid email or password" });
    }
    if (user.verified === false) {
      return send(res, 403, { error: "Please verify your email first" });
    }
    send(res, 200, { token: signToken(user), user: publicUser(user) });
  }
});

routes.push({
  method: "POST", path: "/api/auth/verify",
  handler: async (req, res) => {
    const body = JSON.parse((await readBody(req, 1024 * 16)).toString() || "{}");
    const email = String(body.email || "").trim().toLowerCase();
    const user = db.users.find((u) => u.email === email);
    if (!user || user.verified) {
      return send(res, 400, { error: "No pending verification for this email" });
    }
    const v = user.verification;
    if (!v) {
      return send(res, 400, { error: "No verification code found. Request a new one." });
    }
    if (Date.now() > v.expires) {
      return send(res, 410, { error: "Code expired. Request a new one." });
    }
    if (String(body.code || "") !== v.code) {
      return send(res, 401, { error: "Incorrect code. Try again." });
    }
    user.verified = true;
    delete user.verification;
    saveDb();
    send(res, 200, { token: signToken(user), user: publicUser(user) });
  }
});

routes.push({
  method: "POST", path: "/api/auth/resend",
  handler: async (req, res) => {
    const body = JSON.parse((await readBody(req, 1024 * 16)).toString() || "{}");
    const email = String(body.email || "").trim().toLowerCase();
    const user = db.users.find((u) => u.email === email);
    if (!user) return send(res, 404, { error: "No account found with this email" });
    if (user.verified) return send(res, 400, { error: "This account is already verified" });
    user.verification = { code: genVerifyCode(), expires: Date.now() + VERIFY_TTL };
    saveDb();
    const delivery = await deliverVerifyCode(user, user.verification.code);
    send(res, 200, {
      ok: true,
      message: EMAIL_ENABLED && delivery.sent
        ? "A new verification code was sent to " + email
        : "A new verification code has been generated.",
      devCode: delivery.dev ? user.verification.code : undefined
    });
  }
});

routes.push({
  method: "GET", path: "/api/me",
  handler: (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    send(res, 200, { user: { ...publicUser(user), hasSecurityQuestion: !!user.securityQuestion } });
  }
});

routes.push({
  method: "POST", path: "/api/auth/forgot/start",
  handler: async (req, res) => {
    const body = JSON.parse((await readBody(req, 1024 * 16)).toString() || "{}");
    const id = String(body.email || body.username || "").trim().toLowerCase();
    const user = db.users.find(
      (u) => u.email === id || u.username.toLowerCase() === id
    );
    send(res, 200, { ok: true, question: user ? user.securityQuestion || null : null });
  }
});

routes.push({
  method: "POST", path: "/api/auth/forgot/complete",
  handler: async (req, res) => {
    const body = JSON.parse((await readBody(req, 1024 * 16)).toString() || "{}");
    const id = String(body.email || body.username || "").trim().toLowerCase();
    const user = db.users.find(
      (u) => u.email === id || u.username.toLowerCase() === id
    );
    if (!user || !user.securityAnswerHash) {
      return send(res, 400, { error: "This account has no recovery question set" });
    }
    const answer = String(body.answer || "").trim().toLowerCase();
    if (!verifyPassword(answer, user.securityAnswerHash)) {
      return send(res, 401, { error: "Incorrect answer" });
    }
    const password = String(body.newPassword || "");
    if (password.length < 4) return send(res, 400, { error: "Password must be at least 4 characters" });
    user.hash = hashPassword(password);
    saveDb();
    send(res, 200, { ok: true });
  }
});

routes.push({
  method: "POST", path: "/api/auth/change-password",
  handler: async (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const body = JSON.parse((await readBody(req, 1024 * 16)).toString() || "{}");
    if (!verifyPassword(body.oldPassword || "", user.hash)) {
      return send(res, 401, { error: "Current password is incorrect" });
    }
    const password = String(body.newPassword || "");
    if (password.length < 4) return send(res, 400, { error: "Password must be at least 4 characters" });
    user.hash = hashPassword(password);
    saveDb();
    send(res, 200, { ok: true });
  }
});

routes.push({
  method: "POST", path: "/api/auth/security-question",
  handler: async (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const body = JSON.parse((await readBody(req, 1024 * 16)).toString() || "{}");
    const question = String(body.question || "").trim();
    const answer = String(body.answer || "").trim();
    if (!question || !answer) return send(res, 400, { error: "Question and answer are required" });
    user.securityQuestion = question;
    user.securityAnswerHash = hashPassword(answer.toLowerCase());
    saveDb();
    send(res, 200, { ok: true });
  }
});

/* ---------- admin: user management ---------- */

routes.push({
  method: "GET", path: "/api/users",
  handler: (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    if (user.role !== "admin") return send(res, 403, { error: "Admins only" });
    send(res, 200, { users: db.users.map(publicUser) });
  }
});

routes.push({
  method: "POST", path: "/api/users/:id/role",
  handler: async (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    if (user.role !== "admin") return send(res, 403, { error: "Admins only" });
    const target = db.users.find((u) => u.id === params.id);
    if (!target) return send(res, 404, { error: "User not found" });
    const body = JSON.parse((await readBody(req, 1024 * 16)).toString() || "{}");
    const role = body.role === "admin" ? "admin" : "student";
    if (target.id === user.id && role !== "admin") {
      return send(res, 400, { error: "You cannot demote yourself" });
    }
    target.role = role;
    saveDb();
    send(res, 200, { user: publicUser(target) });
  }
});

routes.push({
  method: "POST", path: "/api/users/:id/reset-password",
  handler: async (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    if (user.role !== "admin") return send(res, 403, { error: "Admins only" });
    const target = db.users.find((u) => u.id === params.id);
    if (!target) return send(res, 404, { error: "User not found" });
    const body = JSON.parse((await readBody(req, 1024 * 16)).toString() || "{}");
    const password = String(body.newPassword || "");
    if (password.length < 4) return send(res, 400, { error: "Password must be at least 4 characters" });
    target.hash = hashPassword(password);
    saveDb();
    send(res, 200, { ok: true });
  }
});

routes.push({
  method: "DELETE", path: "/api/users/:id",
  handler: (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    if (user.role !== "admin") return send(res, 403, { error: "Admins only" });
    if (user.id === params.id) return send(res, 400, { error: "You cannot delete yourself" });
    const idx = db.users.findIndex((u) => u.id === params.id);
    if (idx === -1) return send(res, 404, { error: "User not found" });
    const [removed] = db.users.splice(idx, 1);
    for (const f of db.files.filter((f) => f.uploadedBy === removed.id)) {
      fs.rm(path.join(UPLOAD_DIR, f.storedName), { force: true }, () => {});
    }
    db.files = db.files.filter((f) => f.uploadedBy !== removed.id);
    for (const f of db.files) {
      if (f.savedBy) f.savedBy = f.savedBy.filter((id) => id !== removed.id);
      if (f.viewedBy) f.viewedBy = f.viewedBy.filter((id) => id !== removed.id);
      if (f.comments) f.comments = f.comments.filter((c) => c.userId !== removed.id);
    }
    saveDb();
    ok(res);
  }
});

/* ---------- notifications ---------- */

routes.push({
  method: "GET", path: "/api/notifications",
  handler: (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    send(res, 200, { notifications: user.notifications || [] });
  }
});

routes.push({
  method: "POST", path: "/api/notifications/read",
  handler: (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    for (const n of user.notifications || []) n.read = true;
    saveDb();
    ok(res);
  }
});

/* ---------- courses ---------- */

routes.push({
  method: "GET", path: "/api/courses",
  handler: (req, res) => {
    if (!getAuthUser(req)) return send(res, 401, { error: "Not authenticated" });
    send(res, 200, { courses: db.courses });
  }
});

routes.push({
  method: "POST", path: "/api/courses",
  handler: async (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    if (user.role !== "admin") return send(res, 403, { error: "Admins only" });
    const body = JSON.parse((await readBody(req, 1024 * 16)).toString() || "{}");
    if (!body.name || !body.code) return send(res, 400, { error: "Name and code are required" });
    const course = {
      id: "c" + Date.now(),
      name: String(body.name).trim(),
      code: String(body.code).trim(),
      description: String(body.description || "").trim(),
      category: String(body.category || "").trim(),
      semester: String(body.semester || "").trim()
    };
    db.courses.push(course);
    saveDb();
    send(res, 201, { course });
  }
});

routes.push({
  method: "DELETE", path: "/api/courses/:id",
  handler: (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    if (user.role !== "admin") return send(res, 403, { error: "Admins only" });
    const idx = db.courses.findIndex((c) => c.id === params.id);
    if (idx === -1) return send(res, 404, { error: "Course not found" });
    db.courses.splice(idx, 1);
    for (const f of db.files.filter((f) => f.courseId === params.id)) {
      fs.rm(path.join(UPLOAD_DIR, f.storedName), { force: true }, () => {});
    }
    db.files = db.files.filter((f) => f.courseId !== params.id);
    saveDb();
    ok(res);
  }
});

routes.push({
  method: "GET", path: "/api/courses/:id/progress",
  handler: (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const files = db.files.filter(
      (f) => f.courseId === params.id && (user.role === "admin" || f.approved)
    );
    const viewed = files.filter((f) => (f.viewedBy || []).includes(user.id)).length;
    const total = files.length;
    send(res, 200, { total, viewed, pct: total ? Math.round((viewed / total) * 100) : 0 });
  }
});

routes.push({
  method: "GET", path: "/api/courses/:id/zip",
  handler: (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const course = db.courses.find((c) => c.id === params.id);
    if (!course) return send(res, 404, { error: "Course not found" });
    const files = db.files.filter((f) => f.courseId === params.id && canSeeFile(f, user));
    const entries = [];
    const used = new Set();
    for (const f of files) {
      const fp = path.join(UPLOAD_DIR, f.storedName);
      if (!fs.existsSync(fp)) continue;
      let name = f.originalName || f.name;
      if (used.has(name)) {
        const dot = name.lastIndexOf(".");
        name = dot > 0 ? name.slice(0, dot) + "-" + used.size + name.slice(dot) : name + "-" + used.size;
      }
      used.add(name);
      entries.push({ name, buffer: fs.readFileSync(fp) });
    }
    const zip = buildZip(entries);
    const filename = `${course.code || course.name}.zip`;
    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Content-Length": zip.length
    });
    res.end(zip);
  }
});

/* ---------- files ---------- */

routes.push({
  method: "GET", path: "/api/files",
  handler: (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const url = new URL(req.url, "http://localhost");
    const courseId = url.searchParams.get("courseId");
    let files = db.files;
    if (courseId) files = files.filter((f) => f.courseId === courseId);
    files = files.filter((f) => canSeeFile(f, user));
    files = [...files].sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    send(res, 200, { files: files.map((f) => fileInfo(f, user)) });
  }
});

routes.push({
  method: "GET", path: "/api/files/pending",
  handler: (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    if (user.role !== "admin") return send(res, 403, { error: "Admins only" });
    const files = db.files
      .filter((f) => !f.approved)
      .sort((a, b) => new Date(a.uploadedAt) - new Date(b.uploadedAt))
      .map((f) => fileInfo(f, user));
    send(res, 200, { files });
  }
});

routes.push({
  method: "GET", path: "/api/files/saved",
  handler: (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const files = db.files
      .filter((f) => (f.savedBy || []).includes(user.id))
      .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
      .map((f) => fileInfo(f, user));
    send(res, 200, { files });
  }
});

routes.push({
  method: "POST", path: "/api/files/:id/save",
  handler: (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const f = db.files.find((x) => x.id === params.id);
    if (!f || !canSeeFile(f, user)) return send(res, 404, { error: "File not found" });
    if (!f.savedBy) f.savedBy = [];
    if (!f.savedBy.includes(user.id)) f.savedBy.push(user.id);
    saveDb();
    ok(res);
  }
});

routes.push({
  method: "DELETE", path: "/api/files/:id/save",
  handler: (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const f = db.files.find((x) => x.id === params.id);
    if (!f) return send(res, 404, { error: "File not found" });
    if (f.savedBy) f.savedBy = f.savedBy.filter((id) => id !== user.id);
    saveDb();
    ok(res);
  }
});

routes.push({
  method: "POST", path: "/api/files",
  handler: async (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const name = decodeURIComponent(req.headers["x-file-name"] || "");
    const courseId = req.headers["x-course-id"] || "";
    const originalName = decodeURIComponent(req.headers["x-original-name"] || "");
    if (!courseId || !db.courses.some((c) => c.id === courseId)) {
      return send(res, 400, { error: "Invalid course" });
    }
    if (req.headers["content-type"] !== "application/octet-stream") {
      return send(res, 400, { error: "Upload the file as a binary body" });
    }
    const buf = await readBody(req);
    if (buf.length < 5 || buf.slice(0, 5).toString("latin1") !== "%PDF-") {
      return send(res, 400, { error: "Only PDF files are allowed" });
    }
    const storedName = Date.now() + "-" + Math.round(Math.random() * 1e9) + ".pdf";
    fs.writeFileSync(path.join(UPLOAD_DIR, storedName), buf);
    const text = extractPdfText(buf).slice(0, 100000);
    const file = {
      id: "f" + Date.now(),
      name: name.trim() || originalName || "untitled.pdf",
      originalName: originalName || name.trim() || "untitled.pdf",
      storedName,
      courseId,
      uploadedBy: user.id,
      uploadedByName: user.username,
      role: user.role,
      approved: user.role === "admin",
      size: buf.length,
      uploadedAt: new Date().toISOString(),
      downloads: 0,
      views: 0,
      savedBy: [],
      viewedBy: [],
      comments: [],
      activity: [],
      text
    };
    db.files.push(file);
    saveDb();
    if (file.approved) {
      for (const u of db.users) {
        const savedCourse = (u.id !== user.id) && db.files.some(
          (x) => x.courseId === courseId && (x.savedBy || []).includes(u.id)
        );
        if (savedCourse) notify(u.id, `New material "${file.name}" added to ${courseLabel(courseId)}`);
      }
    } else {
      for (const u of db.users) {
        if (u.role === "admin" && u.id !== user.id) {
          notify(u.id, `New upload pending approval: "${file.name}" by ${user.username} in ${courseLabel(courseId)}`);
        }
      }
    }
    send(res, 201, {
      file: fileInfo(file, user),
      message: file.approved ? "File uploaded" : "File uploaded and pending admin approval"
    });
  }
});

function findFile(req, res, params, allowPendingForUploader = false) {
  const user = getAuthUser(req);
  if (!user) { send(res, 401, { error: "Not authenticated" }); return null; }
  const f = db.files.find((x) => x.id === params.id);
  if (!f) { send(res, 404, { error: "File not found" }); return null; }
  if (user.role !== "admin" && !f.approved && !(allowPendingForUploader && f.uploadedBy === user.id)) {
    send(res, 403, { error: "Not approved yet" }); return null;
  }
  return { user, f };
}

function servePdf(req, res, params, mode) {
  const ctx = findFile(req, res, params, true);
  if (!ctx) return;
  const fp = path.join(UPLOAD_DIR, ctx.f.storedName);
  if (!fs.existsSync(fp)) return send(res, 404, { error: "File missing on disk" });
  if (ctx.user.role !== "admin") {
    if (!ctx.f.viewedBy) ctx.f.viewedBy = [];
    if (!ctx.f.viewedBy.includes(ctx.user.id)) ctx.f.viewedBy.push(ctx.user.id);
    ctx.f.views = (ctx.f.views || 0) + 1;
  }
  if (mode === "download" && ctx.user.role !== "admin") {
    ctx.f.downloads = (ctx.f.downloads || 0) + 1;
    trackActivity(ctx.f, "download");
  }
  if (mode === "inline") trackActivity(ctx.f, "view");
  saveDb();
  const disposition =
    mode === "download"
      ? `attachment; filename*=UTF-8''${encodeURIComponent(ctx.f.originalName || ctx.f.name)}`
      : `inline; filename*=UTF-8''${encodeURIComponent(ctx.f.name)}`;
  res.writeHead(200, {
    "Content-Type": mode === "download" ? "application/octet-stream" : "application/pdf",
    "Content-Disposition": disposition,
    "Content-Length": fs.statSync(fp).size
  });
  fs.createReadStream(fp).pipe(res);
}

routes.push({ method: "GET", path: "/api/files/:id/inline", handler: (req, res, params) => servePdf(req, res, params, "inline") });
routes.push({ method: "GET", path: "/api/files/:id/download", handler: (req, res, params) => servePdf(req, res, params, "download") });

routes.push({
  method: "POST", path: "/api/files/:id/approve",
  handler: (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    if (user.role !== "admin") return send(res, 403, { error: "Admins only" });
    const f = db.files.find((x) => x.id === params.id);
    if (!f) return send(res, 404, { error: "File not found" });
    f.approved = true;
    saveDb();
    notify(f.uploadedBy, `Your file "${f.name}" was approved and is now visible to everyone.`);
    for (const u of db.users) {
      const savedCourse =
        u.id !== f.uploadedBy &&
        db.files.some((x) => x.courseId === f.courseId && (x.savedBy || []).includes(u.id));
      if (savedCourse) notify(u.id, `New material "${f.name}" added to ${courseLabel(f.courseId)}`);
    }
    send(res, 200, { file: fileInfo(f, user) });
  }
});

routes.push({
  method: "DELETE", path: "/api/files/:id",
  handler: (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    if (user.role !== "admin") return send(res, 403, { error: "Admins only" });
    const idx = db.files.findIndex((x) => x.id === params.id);
    if (idx === -1) return send(res, 404, { error: "File not found" });
    const [f] = db.files.splice(idx, 1);
    if (!f.approved) notify(f.uploadedBy, `Your file "${f.name}" was rejected by an admin.`);
    fs.rm(path.join(UPLOAD_DIR, f.storedName), { force: true }, () => {});
    saveDb();
    ok(res);
  }
});

/* ---------- comments ---------- */

routes.push({
  method: "GET", path: "/api/files/:id/comments",
  handler: (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const f = db.files.find((x) => x.id === params.id);
    if (!f || !canSeeFile(f, user)) return send(res, 404, { error: "File not found" });
    send(res, 200, { comments: (f.comments || []).sort((a, b) => new Date(a.at) - new Date(b.at)) });
  }
});

routes.push({
  method: "POST", path: "/api/files/:id/comments",
  handler: async (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const f = db.files.find((x) => x.id === params.id);
    if (!f || !canSeeFile(f, user)) return send(res, 404, { error: "File not found" });
    const body = JSON.parse((await readBody(req, 1024 * 16)).toString() || "{}");
    const text = String(body.text || "").trim().slice(0, 2000);
    if (!text) return send(res, 400, { error: "Comment cannot be empty" });
    if (!f.comments) f.comments = [];
    const c = { id: "cm" + Date.now() + Math.random().toString(16).slice(2, 6), userId: user.id, username: user.username, text, at: new Date().toISOString() };
    f.comments.push(c);
    saveDb();
    if (f.uploadedBy !== user.id) {
      notify(f.uploadedBy, `${user.username} commented on your file "${f.name}"`);
    }
    send(res, 201, { comment: c });
  }
});

routes.push({
  method: "DELETE", path: "/api/files/:id/comments/:cid",
  handler: (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const f = db.files.find((x) => x.id === params.id);
    if (!f) return send(res, 404, { error: "File not found" });
    const idx = (f.comments || []).findIndex((c) => c.id === params.cid);
    if (idx === -1) return send(res, 404, { error: "Comment not found" });
    const c = f.comments[idx];
    if (user.role !== "admin" && c.userId !== user.id) return send(res, 403, { error: "Not allowed" });
    f.comments.splice(idx, 1);
    saveDb();
    ok(res);
  }
});

/* ---------- discovery: search / feed / popular ---------- */

routes.push({
  method: "GET", path: "/api/search",
  handler: (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const url = new URL(req.url, "http://localhost");
    const q = String(url.searchParams.get("q") || "").toLowerCase().trim();
    if (!q) return send(res, 200, { files: [] });
    const tokens = q.split(/\s+/).filter(Boolean);
    const matches = db.files.filter((f) => {
      if (!canSeeFile(f, user)) return false;
      const course = db.courses.find((c) => c.id === f.courseId);
      const hay = [
        f.name, f.originalName, f.text || "",
        course ? course.name : "", course ? course.code : ""
      ].join(" ").toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
    const ranked = matches
      .sort((a, b) => {
        const sa = (a.views || 0) + (a.downloads || 0);
        const sb = (b.views || 0) + (b.downloads || 0);
        return sb - sa;
      })
      .slice(0, 50);
    send(res, 200, { files: ranked.map((f) => fileInfo(f, user)) });
  }
});

routes.push({
  method: "GET", path: "/api/feed",
  handler: (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const files = db.files
      .filter((f) => canSeeFile(f, user) && new Date(f.uploadedAt).getTime() >= weekAgo)
      .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
      .slice(0, 12)
      .map((f) => fileInfo(f, user));
    send(res, 200, { files });
  }
});

routes.push({
  method: "GET", path: "/api/popular",
  handler: (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const files = db.files
      .filter((f) => canSeeFile(f, user))
      .sort((a, b) => weeklyScore(b) - weeklyScore(a))
      .slice(0, 10)
      .map((f) => fileInfo(f, user));
    send(res, 200, { files });
  }
});

/* ---------- admin stats ---------- */

routes.push({
  method: "GET", path: "/api/stats",
  handler: (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    if (user.role !== "admin") return send(res, 403, { error: "Admins only" });
    const totalFiles = db.files.length;
    const totalDownloads = db.files.reduce((s, f) => s + (f.downloads || 0), 0);
    const totalViews = db.files.reduce((s, f) => s + (f.views || 0), 0);
    const totalCourses = db.courses.length;
    const totalUsers = db.users.length;
    const pending = db.files.filter((f) => !f.approved).length;
    const topFiles = [...db.files]
      .sort((a, b) => (b.views || 0) + (b.downloads || 0) - ((a.views || 0) + (a.downloads || 0)))
      .slice(0, 5)
      .map((f) => ({ name: f.name, courseLabel: courseLabel(f.courseId), views: f.views || 0, downloads: f.downloads || 0 }));
    send(res, 200, { stats: { totalFiles, totalDownloads, totalViews, totalCourses, totalUsers, pending }, topFiles });
  }
});

/* ---------- static + server ---------- */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function serveStatic(req, res, pathname) {
  let rel = pathname === "/" ? "index.html" : pathname.slice(1);
  let fp = path.join(PUBLIC_DIR, rel);
  if (!fp.startsWith(PUBLIC_DIR)) return send(res, 403, { error: "Forbidden" });
  if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    if (!path.extname(rel)) {
      fp = path.join(PUBLIC_DIR, "index.html");
    } else {
      return send(res, 404, { error: "Not found" });
    }
  }
  const ext = path.extname(fp).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Content-Length": fs.statSync(fp).size
  });
  fs.createReadStream(fp).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;
  if (pathname.startsWith("/api/")) return handleApi(req, res, pathname);
  return serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`Course Library running at http://localhost:${PORT}`);
  console.log(`Seeded logins -> admin/admin123, student1/student123`);
});
