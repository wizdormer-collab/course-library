import http from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { extractPdfText } from "./lib/pdftext.js";
import { buildZip } from "./lib/zip.js";
import { sendMail, smtpConfigured } from "./lib/mailer.js";
import { supabaseConfigured, ensureBucket, supaPut, supaGet, supaGetBuf, supaDelete } from "./lib/supabase.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, "data.json");
const BACKUP_FILE = path.join(DATA_DIR, "data.json.bak");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const PUBLIC_DIR = path.join(__dirname, "public");
const SECRET_FILE = path.join(DATA_DIR, ".secret");
let SECRET = process.env.SECRET || "";
if (!SECRET) {
  try {
    if (fs.existsSync(SECRET_FILE)) {
      SECRET = fs.readFileSync(SECRET_FILE, "utf8").trim();
    }
  } catch {}
}
if (!SECRET) {
  SECRET = crypto.randomBytes(32).toString("hex");
  try { fs.writeFileSync(SECRET_FILE, SECRET); } catch {}
}
const PORT = process.env.PORT || 3000;
const MAX_UPLOAD = 25 * 1024 * 1024;
const ADMIN_INVITE_CODE = process.env.ADMIN_INVITE_CODE || "admin2026";
const ALLOWED_EMAIL_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS || "")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);
const EMAIL_ENABLED = smtpConfigured();
const VERIFY_TTL = 15 * 60 * 1000;

function stripTags(s) { return String(s).replace(/<[^>]*>/g, ""); }

function genVerifyCode() {
  return String(crypto.randomInt(100000, 999999));
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

let db;
if (fs.existsSync(DATA_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (e) {
    console.error("WARNING: data.json is corrupted, backing up and re-seeding:", e.message);
    try { fs.copyFileSync(DATA_FILE, DATA_FILE + ".bak." + Date.now()); } catch {}
    db = seedDb();
    saveDb();
  }
} else if (supabaseConfigured()) {
  const remote = await loadDbFromSupabase();
  if (remote) {
    db = remote;
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  } else {
    db = seedDb();
    saveDb();
  }
} else {
  db = seedDb();
}

if (!db.announcements) db.announcements = [];
if (!db.groups) db.groups = [];
if (!db.materialViews) db.materialViews = [];
if (!db.recentlyViewed) db.recentlyViewed = [];
if (!db.universityRequests) db.universityRequests = [];
if (!db.loginLogs) db.loginLogs = [];

function seedDb() {
  const SEED_FILE = path.join(__dirname, "seed-data.json");
  if (fs.existsSync(SEED_FILE)) {
    fs.copyFileSync(SEED_FILE, DATA_FILE);
  } else {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ users: [], courses: [], files: [] }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

async function loadDbFromSupabase() {
  try {
    const raw = await supaGet("db.json");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.users)) return null;
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    let missing = 0;
    for (const f of parsed.files || []) {
      const fp = path.join(UPLOAD_DIR, f.storedName);
      if (!fs.existsSync(fp)) {
        const buf = await supaGetBuf("uploads/" + f.storedName);
        if (buf && buf.length) {
          fs.writeFileSync(fp, buf);
        } else {
          missing++;
        }
      }
    }
    if (missing) console.log("Supabase: " + missing + " upload(s) missing from storage");
    console.log("Supabase: loaded database (" + (parsed.users?.length || 0) + " users, " + (parsed.files?.length || 0) + " files)");
    return parsed;
  } catch (err) {
    console.log("Supabase: load failed, using seed (" + err.message + ")");
    return null;
  }
}

let _dirty = false;
let _saveTimer = null;
let _writing = false;

function _writeDb() {
  if (_writing) { _dirty = true; return; }
  _writing = true;
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    try { fs.copyFileSync(DATA_FILE, BACKUP_FILE); } catch {}
    if (supabaseConfigured()) supaPut("db.json", JSON.stringify(db)).catch(() => {});
    _dirty = false;
  } finally {
    _writing = false;
    if (_dirty) { _dirty = false; _writeDb(); }
  }
}

function saveDb() {
  _dirty = true;
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => { _saveTimer = null; if (_dirty) _writeDb(); }, 500);
}

function flushDb() {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  if (_dirty) _writeDb();
}

process.on("exit", flushDb);
process.on("SIGINT", () => { flushDb(); process.exit(0); });
process.on("SIGTERM", () => { flushDb(); process.exit(0); });

function recordLogin(user, ip, method) {
  db.loginLogs.push({
    id: "ll" + Date.now() + Math.random().toString(36).slice(2, 6),
    userId: user.id,
    username: user.username,
    email: user.email,
    role: user.role || "student",
    method: method || "login",
    ip: ip || "unknown",
    at: new Date().toISOString()
  });
  saveDb();
}

if (supabaseConfigured()) {
  await ensureBucket();
  console.log("Supabase persistence enabled");
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

function validatePassword(pw) {
  if (pw.length < 8) return "Password must be at least 8 characters";
  if (!/[a-zA-Z]/.test(pw)) return "Password must contain at least one letter";
  if (!/[0-9]/.test(pw)) return "Password must contain at least one number";
  return null;
}

const revokedTokens = new Set();

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
  if (revokedTokens.has(sig)) return null;
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

function revokeToken(req) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return;
  const token = h.slice(7);
  const [, sig] = String(token).split(".");
  if (sig) revokedTokens.add(sig);
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
  for (const f of db.files) {
    if (!Array.isArray(f.tags)) {
      f.tags = [];
      changed = true;
    }
    if (f.tags.length === 0) {
      const lower = (f.name || "").toLowerCase();
      if (/past\s*(question|exam|test)/i.test(lower)) { f.tags.push("past-question"); changed = true; }
      if (/textbook|text\s*book/i.test(lower)) { f.tags.push("textbook"); changed = true; }
      if (/note|summary|slide|lecture/i.test(lower)) { f.tags.push("notes"); changed = true; }
      if (/assignment|hw|homework/i.test(lower)) { f.tags.push("assignment"); changed = true; }
    }
  }
  if (changed) saveDb();
}

function publicUser(u) {
  const obj = { id: u.id, username: u.username, email: u.email || "", role: u.role, verified: !!u.verified };
  if (u.school) obj.school = u.school;
  if (u.faculty) obj.faculty = u.faculty;
  if (u.department) obj.department = u.department;
  if (u.level) obj.level = u.level;
  if (u.matricNumber) obj.matricNumber = u.matricNumber;
  if (u.studentType) obj.studentType = u.studentType;
  if (u.avatarUrl) obj.avatarUrl = u.avatarUrl;
  if (u.bio) obj.bio = u.bio;
  if (u.enrolledCourses) obj.enrolledCourses = u.enrolledCourses;
  return obj;
}

function send(res, status, data, contentType, extraHeaders) {
  const body = JSON.stringify(data);
  const etag = '"' + crypto.createHash("md5").update(body).digest("hex") + '"';
  const ifNoneMatch = res.req?.headers?.["if-none-match"];
  if (ifNoneMatch && ifNoneMatch === etag && status === 200) {
    res.writeHead(304);
    res.end();
    return;
  }
  const headers = {
    "Content-Type": contentType || "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "ETag": etag,
    ...extraHeaders
  };
  res.writeHead(status, headers);
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

function notify(userId, text, type, link) {
  const user = db.users.find((u) => u.id === userId);
  if (!user) return;
  const prefs = user.notifPrefs || {};
  if (type && prefs[type] === false) return;
  if (!Array.isArray(user.notifications)) user.notifications = [];
  user.notifications.unshift({ id: "n" + Date.now() + Math.random().toString(16).slice(2, 6), text, link: link || null, at: new Date().toISOString(), read: false });
  if (user.notifications.length > 100) user.notifications.length = 100;
}

function trackActivity(f, type) {
  if (!Array.isArray(f.activity)) f.activity = [];
  f.activity.push({ t: Date.now(), k: type });
  if (f.activity.length > 300) f.activity = f.activity.slice(-300);
}

function trackUserActivity(user, type, detail) {
  if (!user) return;
  if (!Array.isArray(user.activity)) user.activity = [];
  user.activity.unshift({ t: Date.now(), k: type, d: detail || "" });
  if (user.activity.length > 100) user.activity.length = 100;
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

function trackFileHistory(file, action, userId, detail) {
  if (!file.history) file.history = [];
  file.history.push({ action, userId, detail: detail || "", at: new Date().toISOString() });
  if (file.history.length > 100) file.history.length = 100;
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
    commentCount: (f.comments || []).length,
    tags: f.tags || []
  };
  if (user && (user.role === "admin" || f.uploadedBy === user.id)) info.uploadedBy = f.uploadedBy;
  if (user) {
    info.saved = (f.savedBy || []).includes(user.id);
    info.viewed = (f.viewedBy || []).includes(user.id);
    info.liked = (f.likedBy || []).includes(user.id);
  }
  info.likes = (f.likedBy || []).length;
  if (f.ratings && f.ratings.length) {
    info.avgRating = Math.round((f.ratings.reduce((s, r) => s + r.score, 0) / f.ratings.length) * 10) / 10;
    info.ratingCount = f.ratings.length;
    if (user) {
      const my = f.ratings.find((r) => r.userId === user.id);
      info.myRating = my ? my.score : 0;
    }
  } else {
    info.avgRating = 0;
    info.ratingCount = 0;
    if (user) info.myRating = 0;
  }
  if (user && user.readProgress && user.readProgress[f.id]) {
    info.readProgress = user.readProgress[f.id];
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

function rateLimiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const rec = hits.get(key);
    if (!rec || now - rec.start > windowMs) {
      hits.set(key, { start: now, count: 1 });
      return true;
    }
    rec.count++;
    if (rec.count > max) return false;
    return true;
  };
}
const loginLimiter = rateLimiter(10, 60 * 1000);
const registerLimiter = rateLimiter(10, 60 * 1000);
const forgotLimiter = rateLimiter(5, 60 * 1000);
const searchLimiter = rateLimiter(30, 60 * 1000);
const uploadLimiter = rateLimiter(10, 60 * 1000);

async function handleApi(req, res, pathname) {
  const m = matchRoute(req.method, pathname);
  if (!m) return send(res, 404, { error: "Not found" });
  try {
    await m.handler(req, res, m.params);
  } catch (err) {
    if (!res.headersSent) send(res, err.status || 500, { error: err.message || "Server error" });
  }
}

const ok = (res, data) => send(res, 200, data || { ok: true });

/* ---------- auth ---------- */

routes.push({ method: "GET", path: "/api/health", handler: (_req, res) => send(res, 200, { ok: true }) });

routes.push({
  method: "POST", path: "/api/auth/logout",
  handler: (req, res) => {
    revokeToken(req);
    send(res, 200, { ok: true });
  }
});

routes.push({
  method: "POST", path: "/api/auth/register",
  handler: async (req, res) => {
    const body = JSON.parse((await readBody(req, 1024 * 16)).toString() || "{}");
    const email = String(body.email || "").trim().toLowerCase();
    const ip = req.socket.remoteAddress || "unknown";
    if (!registerLimiter(ip)) return send(res, 429, { error: "Too many attempts. Try again in a minute." });
    const password = String(body.password || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return send(res, 400, { error: "Enter a valid student email" });
    }
    const pwError = validatePassword(password);
    if (pwError) return send(res, 400, { error: pwError });
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
    const school = String(body.school || "").trim();
    const faculty = String(body.faculty || "").trim();
    const department = String(body.department || "").trim();
    const level = String(body.level || "").trim();
    const matricNumber = String(body.matricNumber || "").trim();
    const studentType = String(body.studentType || "").trim();
    const user = {
      id: "u" + Date.now(),
      username,
      email,
      hash: hashPassword(password),
      role,
      notifications: [],
      verified: true,
      securityQuestion: String(body.securityQuestion || "").trim() || null,
      securityAnswerHash: String(body.securityAnswer || "").trim()
        ? hashPassword(String(body.securityAnswer).trim().toLowerCase())
        : null
    };
    if (school) user.school = school;
    if (faculty) user.faculty = faculty;
    if (department) user.department = department;
    if (level) user.level = level;
    if (matricNumber) user.matricNumber = matricNumber;
    if (studentType) user.studentType = studentType;
    const userCourses = [];
    if (Array.isArray(body.selectedCourses) && body.selectedCourses.length) {
      body.selectedCourses.forEach((c) => {
        const code = String(c.code || "").trim();
        const title = String(c.title || "").trim();
        if (!code) return;
        let existing = db.courses.find((x) => x.code === code);
        if (!existing) {
          existing = { id: "c" + Date.now() + Math.random().toString(36).slice(2, 6), name: title || code, code, description: "", category: "", semester: "" };
          db.courses.push(existing);
        }
        userCourses.push(existing.id);
      });
      saveDb();
    }
    if (userCourses.length) user.enrolledCourses = userCourses;
    db.users.push(user);
    saveDb();
    recordLogin(user, ip, "register");
    send(res, 201, {
      message: "Account created successfully.",
      token: signToken(user),
      user: { ...publicUser(user), lastViewed: {} }
    });
  }
});

routes.push({
  method: "POST", path: "/api/auth/login",
  handler: async (req, res) => {
    const body = JSON.parse((await readBody(req, 1024 * 16)).toString() || "{}");
    const ip = req.socket.remoteAddress || "unknown";
    if (!loginLimiter(ip)) return send(res, 429, { error: "Too many attempts. Try again in a minute." });
    const id = String(body.email || body.username || "").trim().toLowerCase();
    const user = db.users.find(
      (u) =>
        u.email === id ||
        u.username.toLowerCase() === id
    );
    if (!user || !verifyPassword(body.password || "", user.hash)) {
      return send(res, 401, { error: "Invalid email or password" });
    }
    recordLogin(user, ip, "login");
    send(res, 200, { token: signToken(user), user: { ...publicUser(user), lastViewed: user.lastViewed || {} } });
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
    recordLogin(user, req.socket.remoteAddress || "unknown", "verify");
    send(res, 200, { token: signToken(user), user: { ...publicUser(user), lastViewed: user.lastViewed || {} } });
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
    send(res, 200, { user: { ...publicUser(user), hasSecurityQuestion: !!user.securityQuestion, lastViewed: user.lastViewed || {}, themeSchedule: user.themeSchedule || { enabled: false, darkStart: "20:00", darkEnd: "07:00" }, notifPrefs: user.notifPrefs || { upload: true, approval: true, comment: true, mention: true, follow: true, group: true }, bio: user.bio || "" } });
  }
});

routes.push({
  method: "POST", path: "/api/auth/forgot/start",
  handler: async (req, res) => {
    const ip = req.socket.remoteAddress || "unknown";
    if (!forgotLimiter(ip)) return send(res, 429, { error: "Too many attempts. Try again in a minute." });
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
    const pwError = validatePassword(password);
    if (pwError) return send(res, 400, { error: pwError });
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
    const pwError = validatePassword(password);
    if (pwError) return send(res, 400, { error: pwError });
    user.hash = hashPassword(password);
    revokeToken(req);
    saveDb();
    send(res, 200, { ok: true });
  }
});

routes.push({
  method: "POST", path: "/api/auth/change-username",
  handler: async (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const body = JSON.parse((await readBody(req, 1024 * 16)).toString() || "{}");
    const username = String(body.username || "").trim();
    if (username.length < 3) return send(res, 400, { error: "Username must be at least 3 characters" });
    const taken = db.users.some((u) => u.id !== user.id && u.username.toLowerCase() === username.toLowerCase());
    if (taken) return send(res, 400, { error: "That display name is already taken" });
    user.username = username;
    saveDb();
    send(res, 200, { ok: true, user: publicUser(user) });
  }
});

routes.push({
  method: "POST", path: "/api/auth/theme-schedule",
  handler: async (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const body = JSON.parse((await readBody(req, 1024)).toString() || "{}");
    user.themeSchedule = {
      enabled: !!body.enabled,
      darkStart: String(body.darkStart || "20:00"),
      darkEnd: String(body.darkEnd || "07:00")
    };
    saveDb();
    send(res, 200, { ok: true, themeSchedule: user.themeSchedule });
  }
});

routes.push({
  method: "POST", path: "/api/auth/reminders",
  handler: async (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const body = JSON.parse((await readBody(req, 2048)).toString() || "{}");
    if (!user.reminders) user.reminders = [];
    if (body.action === "delete") {
      user.reminders = user.reminders.filter((r) => r.id !== body.id);
    } else {
      const reminder = {
        id: "rem" + Date.now() + Math.random().toString(16).slice(2, 5),
        text: String(body.text || "").trim().slice(0, 200),
        time: String(body.time || "09:00"),
        days: Array.isArray(body.days) ? body.days : [1, 2, 3, 4, 5],
        enabled: body.enabled !== false
      };
      if (!reminder.text) return send(res, 400, { error: "Reminder text required" });
      user.reminders.push(reminder);
    }
    saveDb();
    send(res, 200, { ok: true, reminders: user.reminders });
  }
});

routes.push({
  method: "GET", path: "/api/auth/reminders",
  handler: (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    send(res, 200, { reminders: user.reminders || [] });
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
  method: "GET", path: "/api/users/search",
  handler: (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const url = new URL(req.url, "http://localhost");
    const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
    if (!q) return send(res, 200, { users: [] });
    const matches = db.users
      .filter((u) => u.username.toLowerCase().includes(q) && u.id !== user.id)
      .slice(0, 10)
      .map((u) => ({ id: u.id, username: u.username, role: u.role }));
    send(res, 200, { users: matches });
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
    const pwError = validatePassword(password);
    if (pwError) return send(res, 400, { error: pwError });
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
      if (supabaseConfigured()) supaDelete("uploads/" + f.storedName).catch(() => {});
    }
    db.files = db.files.filter((f) => f.uploadedBy !== removed.id);
    for (const f of db.files) {
      if (f.savedBy) f.savedBy = f.savedBy.filter((id) => id !== removed.id);
      if (f.viewedBy) f.viewedBy = f.viewedBy.filter((id) => id !== removed.id);
      if (f.comments) f.comments = f.comments.filter((c) => c.userId !== removed.id);
    }
    for (const u of db.users) {
      if (u.followers) u.followers = u.followers.filter((id) => id !== removed.id);
      if (u.following) u.following = u.following.filter((id) => id !== removed.id);
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

routes.push({
  method: "POST", path: "/api/notifications/:id/read",
  handler: (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const n = (user.notifications || []).find((x) => x.id === params.id);
    if (!n) return send(res, 404, { error: "Notification not found" });
    n.read = true;
    saveDb();
    ok(res);
  }
});

/* ---------- schools ---------- */

routes.push({
  method: "GET", path: "/api/schools",
  handler: (req, res) => {
    const fp = path.join(PUBLIC_DIR, "schools.json");
    if (!fs.existsSync(fp)) return send(res, 200, { schools: [] });
    try {
      const data = JSON.parse(fs.readFileSync(fp, "utf8"));
      send(res, 200, { schools: data.schools || [] });
    } catch { send(res, 200, { schools: [] }); }
  }
});

routes.push({
  method: "GET", path: "/api/university-requests",
  handler: (req, res) => {
    const user = getAuthUser(req);
    if (!user || user.role !== "admin") return send(res, 403, { error: "Admins only" });
    send(res, 200, { requests: db.universityRequests || [] });
  }
});

routes.push({
  method: "POST", path: "/api/university-requests",
  handler: (req, res) => {
    const body = readBody(req);
    const name = (body.name || "").trim();
    if (!name) return send(res, 400, { error: "University name is required" });
    const email = (body.email || "").trim();
    if (!db.universityRequests) db.universityRequests = [];
    db.universityRequests.push({
      id: "ur" + Date.now(),
      name,
      email,
      requestedAt: new Date().toISOString()
    });
    saveDb();
    send(res, 200, { message: "Request submitted successfully." });
  }
});

routes.push({
  method: "GET", path: "/api/login-logs",
  handler: (req, res) => {
    const user = getAuthUser(req);
    if (!user || user.role !== "admin") return send(res, 403, { error: "Admins only" });
    const logs = (db.loginLogs || []).slice().reverse();
    send(res, 200, { logs });
  }
});

/* ---------- courses ---------- */

routes.push({
  method: "GET", path: "/api/courses",
  handler: (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const enrolledIds = user.enrolledCourses || [];
    const enriched = db.courses.map((c) => {
      const files = db.files.filter((f) => f.courseId === c.id && (f.approved || f.uploadedBy === user.id || user.role === "admin"));
      const viewed = files.filter((f) => (f.viewedBy || []).includes(user.id)).length;
      const ratings = c.ratings || [];
      const avgRating = ratings.length ? Math.round((ratings.reduce((s, r) => s + r.score, 0) / ratings.length) * 10) / 10 : 0;
      const myRating = ratings.find((r) => r.userId === user.id)?.score || 0;
      return {
        ...c,
        enrolled: enrolledIds.includes(c.id),
        fileCount: files.length,
        viewedCount: viewed,
        progress: files.length ? Math.round((viewed / files.length) * 100) : 0,
        avgRating,
        ratingCount: ratings.length,
        myRating
      };
    });
    send(res, 200, { courses: enriched });
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
  method: "PUT", path: "/api/courses/:id",
  handler: async (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    if (user.role !== "admin") return send(res, 403, { error: "Admins only" });
    const course = db.courses.find((c) => c.id === params.id);
    if (!course) return send(res, 404, { error: "Course not found" });
    const body = JSON.parse((await readBody(req, 1024 * 16)).toString() || "{}");
    if (body.name !== undefined) course.name = String(body.name).trim() || course.name;
    if (body.code !== undefined) course.code = String(body.code).trim() || course.code;
    if (body.description !== undefined) course.description = String(body.description).trim();
    if (body.category !== undefined) course.category = String(body.category).trim();
    if (body.semester !== undefined) course.semester = String(body.semester).trim();
    saveDb();
    send(res, 200, { course });
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
      if (supabaseConfigured()) supaDelete("uploads/" + f.storedName).catch(() => {});
    }
    db.files = db.files.filter((f) => f.courseId !== params.id);
    saveDb();
    ok(res);
  }
});

routes.push({
  method: "POST", path: "/api/courses/:id/enroll",
  handler: (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const course = db.courses.find((c) => c.id === params.id);
    if (!course) return send(res, 404, { error: "Course not found" });
    if (!user.enrolledCourses) user.enrolledCourses = [];
    const idx = user.enrolledCourses.indexOf(params.id);
    if (idx === -1) {
      user.enrolledCourses.push(params.id);
      saveDb();
      send(res, 200, { enrolled: true });
    } else {
      user.enrolledCourses.splice(idx, 1);
      saveDb();
      send(res, 200, { enrolled: false });
    }
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
  method: "POST", path: "/api/courses/:id/rating",
  handler: async (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const c = db.courses.find((x) => x.id === params.id);
    if (!c) return send(res, 404, { error: "Course not found" });
    const body = JSON.parse((await readBody(req, 1024)).toString() || "{}");
    const score = Math.min(5, Math.max(1, parseInt(body.score) || 0));
    if (!score) return send(res, 400, { error: "Score 1-5 required" });
    if (!c.ratings) c.ratings = [];
    const existing = c.ratings.find((r) => r.userId === user.id);
    if (existing) existing.score = score;
    else c.ratings.push({ userId: user.id, score });
    const avg = c.ratings.reduce((s, r) => s + r.score, 0) / c.ratings.length;
    saveDb();
    ok(res, { avgRating: Math.round(avg * 10) / 10, ratingCount: c.ratings.length, myRating: score });
  }
});

routes.push({
  method: "DELETE", path: "/api/courses/:id/rating",
  handler: (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const c = db.courses.find((x) => x.id === params.id);
    if (!c) return send(res, 404, { error: "Course not found" });
    if (c.ratings) c.ratings = c.ratings.filter((r) => r.userId !== user.id);
    const avg = c.ratings && c.ratings.length ? c.ratings.reduce((s, r) => s + r.score, 0) / c.ratings.length : 0;
    saveDb();
    ok(res, { avgRating: Math.round(avg * 10) / 10, ratingCount: (c.ratings || []).length, myRating: 0 });
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
    const tag = url.searchParams.get("tag");
    let files = db.files;
    if (courseId) files = files.filter((f) => f.courseId === courseId);
    if (tag) files = files.filter((f) => (f.tags || []).includes(tag.toLowerCase()));
    files = files.filter((f) => canSeeFile(f, user));
    const sort = url.searchParams.get("sort") || "date";
    const order = url.searchParams.get("order") === "asc" ? 1 : -1;
    if (sort === "name") files.sort((a, b) => order * (a.name || "").localeCompare(b.name || ""));
    else if (sort === "size") files.sort((a, b) => order * ((a.size || 0) - (b.size || 0)));
    else if (sort === "views") files.sort((a, b) => order * ((a.views || 0) - (b.views || 0)));
    else if (sort === "downloads") files.sort((a, b) => order * ((a.downloads || 0) - (b.downloads || 0)));
    else files.sort((a, b) => order * (new Date(b.uploadedAt) - new Date(a.uploadedAt)));
    const total = files.length;
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit")) || 50, 1), 200);
    const page = Math.max(parseInt(url.searchParams.get("page")) || 1, 1);
    const pages = Math.max(Math.ceil(total / limit), 1);
    const paged = files.slice((page - 1) * limit, page * limit);
    send(res, 200, { files: paged.map((f) => fileInfo(f, user)), total, page, pages, limit });
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
    const ip = req.socket.remoteAddress || "unknown";
    if (!uploadLimiter(ip)) return send(res, 429, { error: "Too many uploads. Try again in a minute." });
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
    if (supabaseConfigured()) supaPut("uploads/" + storedName, buf).catch(() => {});
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
      tags: [],
      text
    };
    db.files.push(file);
    trackFileHistory(file, "upload", user.id, file.name);
    trackUserActivity(user, "upload", file.name);
    saveDb();
    if (file.approved) {
      for (const u of db.users) {
        if (u.id === user.id) continue;
        const enrolled = (u.enrolledCourses || []).includes(courseId);
        const savedCourse = db.files.some(
          (x) => x.courseId === courseId && (x.savedBy || []).includes(u.id)
        );
        if (enrolled || savedCourse) {
          notify(u.id, `New material "${file.name}" added to ${courseLabel(courseId)}`, "upload", "/course/" + courseId);
        }
      }
    } else {
      for (const u of db.users) {
        if (u.role === "admin" && u.id !== user.id) {
          notify(u.id, `New upload pending approval: "${file.name}" by ${user.username} in ${courseLabel(courseId)}`, "upload");
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
  if (!ctx.user.lastViewed) ctx.user.lastViewed = {};
  ctx.user.lastViewed[ctx.f.id] = new Date().toISOString();
  if (mode === "inline") {
    const existing = db.materialViews.find((v) => v.userId === ctx.user.id && v.fileId === ctx.f.id);
    if (existing) {
      existing.lastViewed = new Date().toISOString();
    } else {
      db.materialViews.push({
        userId: ctx.user.id,
        fileId: ctx.f.id,
        courseId: ctx.f.courseId,
        fileName: ctx.f.name,
        courseLabel: courseLabel(ctx.f.courseId),
        firstViewed: new Date().toISOString(),
        lastViewed: new Date().toISOString()
      });
    }
    const rv = db.recentlyViewed.find((r) => r.userId === ctx.user.id && r.fileId === ctx.f.id);
    if (rv) {
      rv.viewedAt = new Date().toISOString();
    } else {
      db.recentlyViewed.unshift({
        userId: ctx.user.id,
        fileId: ctx.f.id,
        courseId: ctx.f.courseId,
        fileName: ctx.f.name,
        courseLabel: courseLabel(ctx.f.courseId),
        viewedAt: new Date().toISOString()
      });
    }
    const userViews = db.recentlyViewed.filter((r) => r.userId === ctx.user.id);
    if (userViews.length > 50) {
      const toRemove = userViews.sort((a, b) => new Date(a.viewedAt) - new Date(b.viewedAt)).slice(0, userViews.length - 50);
      for (const r of toRemove) {
        const idx = db.recentlyViewed.indexOf(r);
        if (idx !== -1) db.recentlyViewed.splice(idx, 1);
      }
    }
  }
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
  method: "POST", path: "/api/files/:id/progress",
  handler: async (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const f = db.files.find((x) => x.id === params.id);
    if (!f) return send(res, 404, { error: "File not found" });
    const body = JSON.parse((await readBody(req, 1024)).toString() || "{}");
    const pct = Math.max(0, Math.min(100, Math.round(Number(body.pct) || 0)));
    if (!user.readProgress) user.readProgress = {};
    user.readProgress[f.id] = { pct, at: new Date().toISOString() };
    saveDb();
    ok(res, { pct });
  }
});

routes.push({
  method: "GET", path: "/api/files/progress",
  handler: (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    send(res, 200, { progress: user.readProgress || {} });
  }
});

routes.push({
  method: "GET", path: "/api/files/:id/bookmarks",
  handler: (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    if (!user.bookmarks) user.bookmarks = {};
    send(res, 200, { bookmarks: user.bookmarks[params.id] || [] });
  }
});

routes.push({
  method: "POST", path: "/api/files/:id/bookmarks",
  handler: async (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const body = JSON.parse((await readBody(req, 1024)).toString() || "{}");
    const text = String(body.text || "").trim().slice(0, 500);
    const page = Math.max(1, Math.round(Number(body.page) || 1));
    if (!text) return send(res, 400, { error: "Note text required" });
    if (!user.bookmarks) user.bookmarks = {};
    if (!user.bookmarks[params.id]) user.bookmarks[params.id] = [];
    const bm = { id: "bm" + Date.now() + Math.random().toString(16).slice(2, 6), text, page, createdAt: new Date().toISOString() };
    user.bookmarks[params.id].push(bm);
    if (user.bookmarks[params.id].length > 50) user.bookmarks[params.id] = user.bookmarks[params.id].slice(-50);
    saveDb();
    ok(res, { bookmark: bm });
  }
});

routes.push({
  method: "DELETE", path: "/api/files/:id/bookmarks/:bid",
  handler: (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    if (!user.bookmarks || !user.bookmarks[params.id]) return send(res, 404, { error: "Not found" });
    user.bookmarks[params.id] = user.bookmarks[params.id].filter((b) => b.id !== params.bid);
    saveDb();
    ok(res);
  }
});

routes.push({
  method: "PUT", path: "/api/files/:id/rename",
  handler: async (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const f = db.files.find((x) => x.id === params.id);
    if (!f) return send(res, 404, { error: "File not found" });
    if (user.role !== "admin" && f.uploadedBy !== user.id) {
      return send(res, 403, { error: "Not allowed" });
    }
    const body = JSON.parse((await readBody(req, 1024 * 16)).toString() || "{}");
    const name = String(body.name || "").trim();
    if (!name) return send(res, 400, { error: "Name is required" });
    f.name = name;
    saveDb();
    send(res, 200, { file: fileInfo(f, user) });
  }
});

/* ---------- file versioning ---------- */

routes.push({
  method: "GET", path: "/api/files/:id/versions",
  handler: (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const f = db.files.find((x) => x.id === params.id);
    if (!f) return send(res, 404, { error: "File not found" });
    const versions = (f.versions || []).map((v) => ({
      id: v.id, name: v.name, size: v.size, uploadedAt: v.uploadedAt, uploadedByName: v.uploadedByName, version: v.version
    }));
    send(res, 200, { versions });
  }
});

routes.push({
  method: "GET", path: "/api/files/:id/flashcards",
  handler: (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const f = db.files.find((x) => x.id === params.id);
    if (!f || !canSeeFile(f, user)) return send(res, 404, { error: "File not found" });
    const text = f.text || "";
    if (!text) return send(res, 200, { cards: [] });
    const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 20 && s.length < 300);
    const defs = text.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s*(?:is|are|was|were|refers to|means|defined as)\s*([^.;]{10,200})/gi) || [];
    const cards = [];
    for (let i = 0; i < Math.min(defs.length, 10); i++) {
      const match = defs[i].match(/^(\b[A-Z][^\s]*(?:\s[A-Z][^\s]*)*)\s+(?:is|are|was|were|refers to|means|defined as)\s+(.+)/i);
      if (match) cards.push({ front: match[1].trim(), back: match[2].trim().replace(/[.;]+$/, "") });
    }
    const used = new Set(cards.map((c) => c.front.toLowerCase()));
    const keySents = sentences.filter((s) => /\b(define|definition|important|key|note|concept|principle|theorem|formula|equation)\b/i.test(s));
    for (const s of keySents) {
      if (cards.length >= 15) break;
      const parts = s.split(/[:–—-]\s*/);
      if (parts.length >= 2 && !used.has(parts[0].toLowerCase().slice(0, 30))) {
        cards.push({ front: parts[0].trim().slice(0, 150), back: parts.slice(1).join(": ").trim().slice(0, 300) });
        used.add(parts[0].toLowerCase().slice(0, 30));
      }
    }
    if (cards.length < 5) {
      for (const s of sentences) {
        if (cards.length >= 10) break;
        const words = s.split(/\s+/);
        if (words.length > 8) {
          const mid = Math.floor(words.length / 2);
          const front = words.slice(0, mid).join(" ");
          const back = words.slice(mid).join(" ");
          if (!used.has(front.toLowerCase().slice(0, 30))) {
            cards.push({ front: front.slice(0, 150), back: back.slice(0, 300) });
            used.add(front.toLowerCase().slice(0, 30));
          }
        }
      }
    }
    send(res, 200, { cards: cards.slice(0, 15) });
  }
});

routes.push({
  method: "POST", path: "/api/files/:id/version",
  handler: async (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const f = db.files.find((x) => x.id === params.id);
    if (!f || !canSeeFile(f, user)) return send(res, 404, { error: "File not found" });
    if (user.role !== "admin" && f.uploadedBy !== user.id) return send(res, 403, { error: "Only uploader or admin can add versions" });
    if (req.headers["content-type"] !== "application/octet-stream") return send(res, 400, { error: "Upload the file as binary" });
    const buf = await readBody(req);
    if (buf.length < 5 || buf.slice(0, 5).toString("latin1") !== "%PDF-") return send(res, 400, { error: "Only PDF files are allowed" });
    if (!f.versions) f.versions = [];
    const verNum = f.versions.length + 1;
    f.versions.push({
      id: "v" + Date.now() + Math.random().toString(16).slice(2, 6),
      name: f.name,
      storedName: f.storedName,
      size: f.size,
      uploadedAt: f.uploadedAt,
      uploadedByName: f.uploadedByName,
      version: verNum
    });
    const storedName = Date.now() + "-" + Math.round(Math.random() * 1e9) + ".pdf";
    fs.writeFileSync(path.join(UPLOAD_DIR, storedName), buf);
    if (supabaseConfigured()) supaPut("uploads/" + storedName, buf).catch(() => {});
    f.storedName = storedName;
    f.size = buf.length;
    f.uploadedAt = new Date().toISOString();
    f.uploadedBy = user.id;
    f.uploadedByName = user.username;
    f.text = extractPdfText(buf).slice(0, 100000);
    f.version = verNum + 1;
    saveDb();
    send(res, 200, { file: fileInfo(f, user), version: verNum + 1 });
  }
});

routes.push({
  method: "POST", path: "/api/files/bulk-action",
  handler: async (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const body = JSON.parse((await readBody(req, 1024 * 16)).toString() || "{}");
    const ids = Array.isArray(body.fileIds) ? body.fileIds : [];
    const action = body.action;
    if (!ids.length) return send(res, 400, { error: "No files selected" });
    const validActions = ["approve", "reject", "download", "delete"];
    if (!validActions.includes(action)) return send(res, 400, { error: "Action must be " + validActions.join(" or ") });
    if ((action === "approve" || action === "reject") && user.role !== "admin") return send(res, 403, { error: "Admins only" });
    if (action === "delete" && user.role !== "admin") return send(res, 403, { error: "Admins only" });
    if (action === "download") {
      const files = ids.map((id) => db.files.find((x) => x.id === id)).filter(Boolean);
      if (!files.length) return send(res, 404, { error: "No matching files" });
      const entries = [];
      for (const f of files) {
        const fp = path.join(UPLOAD_DIR, f.storedName);
        try {
          const data = fs.readFileSync(fp);
          entries.push({ name: (f.originalName || f.name || f.id) + ".pdf", buffer: data });
        } catch {}
      }
      if (!entries.length) return send(res, 404, { error: "No files found on disk" });
      const zipData = buildZip(entries);
      for (const f of files) {
        if (!f.downloads) f.downloads = 0;
        f.downloads++;
      }
      saveDb();
      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Disposition": "attachment; filename=\"files.zip\"",
        "Content-Length": zipData.length
      });
      res.end(zipData);
      return;
    }
    let count = 0;
    for (const id of ids) {
      const idx = db.files.findIndex((x) => x.id === id);
      if (idx === -1) continue;
      const f = db.files[idx];
      if (action === "approve") {
        if (!f.approved) {
          f.approved = true;
          count++;
          notify(f.uploadedBy, `Your file "${f.name}" was approved and is now visible to everyone.`, "approval", "/course/" + f.courseId);
          for (const u of db.users) {
            if (u.id === f.uploadedBy) continue;
            const enrolled = (u.enrolledCourses || []).includes(f.courseId);
            const savedCourse =
              db.files.some((x) => x.courseId === f.courseId && (x.savedBy || []).includes(u.id));
            if (enrolled || savedCourse) notify(u.id, `New material "${f.name}" added to ${courseLabel(f.courseId)}`, "upload", "/course/" + f.courseId);
          }
        }
      } else if (action === "reject") {
        db.files.splice(idx, 1);
        count++;
        notify(f.uploadedBy, `Your file "${f.name}" was rejected by an admin.`, "approval");
        fs.rm(path.join(UPLOAD_DIR, f.storedName), { force: true }, () => {});
        if (supabaseConfigured()) supaDelete("uploads/" + f.storedName).catch(() => {});
      } else if (action === "delete") {
        db.files.splice(idx, 1);
        count++;
        fs.rm(path.join(UPLOAD_DIR, f.storedName), { force: true }, () => {});
        if (supabaseConfigured()) supaDelete("uploads/" + f.storedName).catch(() => {});
      }
    }
    saveDb();
    send(res, 200, { ok: true, count });
  }
});

routes.push({
  method: "PUT", path: "/api/files/:id/tags",
  handler: async (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const f = db.files.find((x) => x.id === params.id);
    if (!f || !canSeeFile(f, user)) return send(res, 404, { error: "File not found" });
    if (user.role !== "admin" && f.uploadedBy !== user.id) {
      return send(res, 403, { error: "Not allowed" });
    }
    const body = JSON.parse((await readBody(req, 1024 * 16)).toString() || "{}");
    const tags = Array.isArray(body.tags)
      ? body.tags.map((t) => String(t || "").trim().toLowerCase()).filter(Boolean).slice(0, 10)
      : [];
    f.tags = tags;
    saveDb();
    send(res, 200, { file: fileInfo(f, user) });
  }
});

routes.push({
  method: "GET", path: "/api/tags",
  handler: (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const tagSet = new Set();
    for (const f of db.files) {
      if (!canSeeFile(f, user)) continue;
      for (const t of (f.tags || [])) tagSet.add(t);
    }
    send(res, 200, { tags: [...tagSet].sort() });
  }
});

routes.push({
  method: "POST", path: "/api/files/:id/approve",
  handler: (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    if (user.role !== "admin") return send(res, 403, { error: "Admins only" });
    const f = db.files.find((x) => x.id === params.id);
    if (!f) return send(res, 404, { error: "File not found" });
    f.approved = true;
    trackFileHistory(f, "approved", user.id);
    saveDb();
    notify(f.uploadedBy, `Your file "${f.name}" was approved and is now visible to everyone.`, "approval", "/course/" + f.courseId);
    for (const u of db.users) {
      if (u.id === f.uploadedBy) continue;
      const enrolled = (u.enrolledCourses || []).includes(f.courseId);
      const savedCourse =
        db.files.some((x) => x.courseId === f.courseId && (x.savedBy || []).includes(u.id));
      if (enrolled || savedCourse) notify(u.id, `New material "${f.name}" added to ${courseLabel(f.courseId)}`, "upload", "/course/" + f.courseId);
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
    if (!f.approved) notify(f.uploadedBy, `Your file "${f.name}" was rejected by an admin.`, "approval");
    trackFileHistory(f, "deleted", user.id);
    fs.rm(path.join(UPLOAD_DIR, f.storedName), { force: true }, () => {});
    if (supabaseConfigured()) supaDelete("uploads/" + f.storedName).catch(() => {});
    saveDb();
    ok(res);
  }
});

routes.push({
  method: "GET", path: "/api/files/:id/history",
  handler: (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const f = db.files.find((x) => x.id === params.id);
    if (!f) return send(res, 404, { error: "File not found" });
    send(res, 200, { history: (f.history || []).map(h => ({ ...h, userName: db.users.find(u => u.id === h.userId)?.username || "Unknown" })) });
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
    const text = stripTags(String(body.text || "").trim().slice(0, 2000));
    if (!text) return send(res, 400, { error: "Comment cannot be empty" });
    if (!f.comments) f.comments = [];
    const mentionUsernames = [...new Set((text.match(/@(\w+)/g) || []).map((m) => m.slice(1).toLowerCase()))];
    const mentionedUserIds = [];
    for (const uname of mentionUsernames) {
      const mentioned = db.users.find((u) => u.username.toLowerCase() === uname);
      if (mentioned && mentioned.id !== user.id) mentionedUserIds.push({ id: mentioned.id, username: mentioned.username });
    }
    const c = { id: "cm" + Date.now() + Math.random().toString(16).slice(2, 6), userId: user.id, username: user.username, text, at: new Date().toISOString(), mentions: mentionedUserIds.map((u) => u.id) };
    f.comments.push(c);
    trackUserActivity(user, "comment", f.name);
    saveDb();
    if (f.uploadedBy !== user.id) {
      notify(f.uploadedBy, `${user.username} commented on your file "${f.name}"`, "comment", "/course/" + f.courseId);
    }
    for (const mu of mentionedUserIds) {
      if (mu.id !== f.uploadedBy) {
        notify(mu.id, `${user.username} mentioned you in a comment on "${f.name}"`, "mention", "/course/" + f.courseId);
      }
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

function extractSnippet(text, query, len) {
  if (!text) return "";
  const low = text.toLowerCase();
  const idx = low.indexOf(query.toLowerCase().split(/\s+/)[0]);
  if (idx === -1) return text.slice(0, len);
  const start = Math.max(0, idx - Math.floor(len / 3));
  const end = Math.min(text.length, start + len);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = "..." + snippet;
  if (end < text.length) snippet = snippet + "...";
  return snippet;
}

routes.push({
  method: "GET", path: "/api/search",
  handler: (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const ip = req.socket.remoteAddress || "unknown";
    if (!searchLimiter(ip)) return send(res, 429, { error: "Too many requests. Try again in a minute." });
    const url = new URL(req.url, "http://localhost");
    const q = String(url.searchParams.get("q") || "").toLowerCase().trim();
    const contentOnly = url.searchParams.get("content") === "1";
    const filterCourse = String(url.searchParams.get("courseId") || "").trim();
    const filterType = String(url.searchParams.get("type") || "").trim();
    const filterSemester = String(url.searchParams.get("semester") || "").trim();
    const filterCategory = String(url.searchParams.get("category") || "").trim();
    if (!q && !filterCourse && !filterType && !filterSemester && !filterCategory) return send(res, 200, { files: [] });
    const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
    const matches = db.files.filter((f) => {
      if (!canSeeFile(f, user)) return false;
      const course = db.courses.find((c) => c.id === f.courseId);
      if (filterCourse && f.courseId !== filterCourse) return false;
      if (filterSemester && (!course || course.semester !== filterSemester)) return false;
      if (filterCategory && (!course || course.category !== filterCategory)) return false;
      if (filterType) {
        const tags = (f.tags || []).map((t) => t.toLowerCase());
        const fname = (f.name || "").toLowerCase();
        const typeMatch = tags.includes(filterType.toLowerCase()) || fname.includes(filterType.toLowerCase());
        if (!typeMatch) return false;
      }
      if (!tokens.length) return true;
      const hay = [
        f.name, f.originalName, f.text || "",
        course ? course.name : "", course ? course.code : "",
        ...(f.tags || [])
      ].join(" ").toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
    const ranked = matches
      .sort((a, b) => {
        if (contentOnly) {
          const aText = (a.text || "").toLowerCase();
          const bText = (b.text || "").toLowerCase();
          const aScore = tokens.reduce((s, t) => s + (aText.split(t).length - 1), 0);
          const bScore = tokens.reduce((s, t) => s + (bText.split(t).length - 1), 0);
          return bScore - aScore;
        }
        const sa = (a.views || 0) + (a.downloads || 0);
        const sb = (b.views || 0) + (b.downloads || 0);
        return sb - sa;
      })
      .slice(0, 50);
    send(res, 200, { files: ranked.map((f) => {
      const info = fileInfo(f, user);
      if (f.text) {
        const firstToken = tokens[0] || "";
        info.snippet = extractSnippet(f.text, firstToken, 200);
        info.matchCount = tokens.reduce((s, t) => s + ((f.text || "").toLowerCase().split(t).length - 1), 0);
      }
      return info;
    }) });
  }
});

routes.push({
  method: "GET", path: "/api/feed",
  handler: (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const url = new URL(req.url, "http://localhost");
    const followingOnly = url.searchParams.get("following") === "1";
    const followingIds = followingOnly ? (user.following || []) : null;
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const files = db.files
      .filter((f) => canSeeFile(f, user) && new Date(f.uploadedAt).getTime() >= weekAgo && (!followingOnly || (followingIds && followingIds.includes(f.uploadedBy))))
      .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
      .slice(0, 20)
      .map((f) => fileInfo(f, user));
    if (followingOnly) {
      const comments = [];
      for (const f of db.files) {
        if (!f.comments) continue;
        for (const c of f.comments) {
          if (followingIds.includes(c.userId) && new Date(c.at).getTime() >= weekAgo) {
            comments.push({ type: "comment", fileId: f.id, fileName: f.name, courseId: f.courseId, username: c.username, userId: c.userId, text: c.text, at: c.at });
          }
        }
      }
      comments.sort((a, b) => new Date(b.at) - new Date(a.at));
      send(res, 200, { files, activity: comments.slice(0, 20) });
    } else {
      send(res, 200, { files });
    }
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

/* ---------- likes ---------- */

routes.push({
  method: "POST", path: "/api/files/:id/like",
  handler: (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const f = db.files.find((x) => x.id === params.id);
    if (!f || !canSeeFile(f, user)) return send(res, 404, { error: "File not found" });
    if (!f.likedBy) f.likedBy = [];
    if (!f.likedBy.includes(user.id)) f.likedBy.push(user.id);
    trackUserActivity(user, "like", f.name);
    saveDb();
    ok(res, { likes: f.likedBy.length, liked: true });
  }
});

routes.push({
  method: "DELETE", path: "/api/files/:id/like",
  handler: (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const f = db.files.find((x) => x.id === params.id);
    if (!f) return send(res, 404, { error: "File not found" });
    if (f.likedBy) f.likedBy = f.likedBy.filter((id) => id !== user.id);
    saveDb();
    ok(res, { likes: (f.likedBy || []).length, liked: false });
  }
});

routes.push({
  method: "POST", path: "/api/files/:id/rating",
  handler: async (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const f = db.files.find((x) => x.id === params.id);
    if (!f || !canSeeFile(f, user)) return send(res, 404, { error: "File not found" });
    const body = JSON.parse((await readBody(req, 1024)).toString() || "{}");
    const score = Math.round(Number(body.score) || 0);
    if (score < 1 || score > 5) return send(res, 400, { error: "Rating must be 1-5" });
    if (!f.ratings) f.ratings = [];
    const existing = f.ratings.find((r) => r.userId === user.id);
    if (existing) existing.score = score;
    else f.ratings.push({ userId: user.id, score });
    const avg = f.ratings.reduce((s, r) => s + r.score, 0) / f.ratings.length;
    saveDb();
    ok(res, { avgRating: Math.round(avg * 10) / 10, ratingCount: f.ratings.length, myRating: score });
  }
});

routes.push({
  method: "DELETE", path: "/api/files/:id/rating",
  handler: (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const f = db.files.find((x) => x.id === params.id);
    if (!f) return send(res, 404, { error: "File not found" });
    if (f.ratings) f.ratings = f.ratings.filter((r) => r.userId !== user.id);
    const avg = f.ratings && f.ratings.length ? f.ratings.reduce((s, r) => s + r.score, 0) / f.ratings.length : 0;
    saveDb();
    ok(res, { avgRating: Math.round(avg * 10) / 10, ratingCount: (f.ratings || []).length, myRating: 0 });
  }
});

/* ---------- announcements ---------- */

routes.push({
  method: "GET", path: "/api/announcements",
  handler: (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const visible = db.announcements.filter((a) => {
      if (a.targetType && a.targetType !== "all") {
        if (a.targetType === "course") {
          const enrolled = (user.enrolledCourses || []).includes(a.targetId);
          return enrolled;
        }
        if (a.targetType === "faculty") return (user.faculty || "") === a.targetId;
        if (a.targetType === "department") return (user.department || "") === a.targetId;
        if (a.targetType === "university") return (user.school || "") === a.targetId;
      }
      if (!a.courseId) return true;
      const course = db.courses.find((c) => c.id === a.courseId);
      return !!course;
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 20);
    send(res, 200, { announcements: visible });
  }
});

routes.push({
  method: "POST", path: "/api/announcements",
  handler: async (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    if (user.role !== "admin" && user.role !== "lecturer") return send(res, 403, { error: "Admins and lecturers only" });
    const body = JSON.parse((await readBody(req, 1024 * 4)).toString() || "{}");
    const text = stripTags(String(body.text || "").trim().slice(0, 2000));
    if (!text) return send(res, 400, { error: "Announcement text is required" });
    const targetType = String(body.targetType || "all").trim();
    const targetId = String(body.targetId || "").trim() || null;
    if (user.role === "lecturer" && targetType !== "all" && targetType !== "course") {
      return send(res, 403, { error: "Lecturers can only target their own courses" });
    }
    if (user.role === "lecturer" && targetType === "course" && targetId) {
      const course = db.courses.find((c) => c.id === targetId);
      if (!course || course.createdBy !== user.id) {
        return send(res, 403, { error: "You can only target courses you created" });
      }
    }
    const a = {
      id: "ann" + Date.now(),
      text,
      courseId: body.courseId || null,
      targetType: targetType === "all" ? "all" : targetType,
      targetId: targetType === "course" ? targetId : (targetType === "faculty" ? (user.faculty || targetId) : (targetType === "department" ? (user.department || targetId) : (targetType === "university" ? (user.school || targetId) : null))),
      authorId: user.id,
      authorName: user.username,
      authorRole: user.role,
      createdAt: new Date().toISOString()
    };
    db.announcements.unshift(a);
    if (db.announcements.length > 50) db.announcements.length = 50;
    saveDb();
    send(res, 201, { announcement: a });
  }
});

routes.push({
  method: "DELETE", path: "/api/announcements/:id",
  handler: (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    if (user.role !== "admin") return send(res, 403, { error: "Admins only" });
    db.announcements = db.announcements.filter((a) => a.id !== params.id);
    saveDb();
    ok(res);
  }
});

/* ---------- recently viewed / material views ---------- */

routes.push({
  method: "POST", path: "/api/material-views",
  handler: async (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const body = JSON.parse((await readBody(req, 1024)).toString() || "{}");
    const fileId = String(body.fileId || "").trim();
    const courseId = String(body.courseId || "").trim();
    if (!fileId) return send(res, 400, { error: "fileId is required" });
    const f = db.files.find((x) => x.id === fileId);
    if (!f) return send(res, 404, { error: "File not found" });
    if (!f.approved && f.uploadedBy !== user.id && user.role !== "admin") {
      return send(res, 403, { error: "Not approved yet" });
    }
    const existing = db.materialViews.find((v) => v.userId === user.id && v.fileId === fileId);
    if (existing) {
      existing.lastViewed = new Date().toISOString();
    } else {
      db.materialViews.push({
        userId: user.id,
        fileId,
        courseId: courseId || f.courseId,
        fileName: f.name,
        courseLabel: courseLabel(courseId || f.courseId),
        firstViewed: new Date().toISOString(),
        lastViewed: new Date().toISOString()
      });
    }
    const rv = db.recentlyViewed.find((r) => r.userId === user.id && r.fileId === fileId);
    if (rv) {
      rv.viewedAt = new Date().toISOString();
    } else {
      db.recentlyViewed.unshift({
        userId: user.id,
        fileId,
        courseId: courseId || f.courseId,
        fileName: f.name,
        courseLabel: courseLabel(courseId || f.courseId),
        viewedAt: new Date().toISOString()
      });
    }
    const userViews = db.recentlyViewed.filter((r) => r.userId === user.id);
    if (userViews.length > 50) {
      const toRemove = userViews.sort((a, b) => new Date(a.viewedAt) - new Date(b.viewedAt)).slice(0, userViews.length - 50);
      for (const r of toRemove) {
        const idx = db.recentlyViewed.indexOf(r);
        if (idx !== -1) db.recentlyViewed.splice(idx, 1);
      }
    }
    saveDb();
    ok(res);
  }
});

routes.push({
  method: "GET", path: "/api/recently-viewed",
  handler: (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const recent = db.recentlyViewed
      .filter((r) => r.userId === user.id)
      .sort((a, b) => new Date(b.viewedAt) - new Date(a.viewedAt))
      .slice(0, 30);
    send(res, 200, { recentlyViewed: recent });
  }
});

routes.push({
  method: "GET", path: "/api/material-views",
  handler: (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const views = db.materialViews.filter((v) => v.userId === user.id);
    send(res, 200, { materialViews: views });
  }
});

/* ---------- notifications extended ---------- */

routes.push({
  method: "GET", path: "/api/notifications/unread-count",
  handler: (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const unread = (user.notifications || []).filter((n) => !n.read).length;
    send(res, 200, { unread });
  }
});

routes.push({
  method: "GET", path: "/api/auth/weekly-progress",
  handler: (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const now = Date.now();
    const WEEK = 7 * 24 * 60 * 60 * 1000;
    if (user.lastWeeklyReport && now - user.lastWeeklyReport < WEEK) {
      return send(res, 200, { generated: false });
    }
    const enrolledIds = user.enrolledCourses || [];
    const enrolled = db.courses.filter((c) => enrolledIds.includes(c.id));
    const allFiles = db.files.filter((f) => enrolledIds.includes(f.courseId) && (f.approved || f.uploadedBy === user.id || user.role === "admin"));
    const viewed = allFiles.filter((f) => (f.viewedBy || []).includes(user.id));
    const newThisWeek = allFiles.filter((f) => now - new Date(f.uploadedAt).getTime() < WEEK);
    const total = allFiles.length;
    const pct = total ? Math.round((viewed.length / total) * 100) : 0;
    const unviewed = total - viewed.length;
    const summary = `Weekly Progress: ${pct}% complete across ${enrolled.length} courses (${viewed.length}/${total} materials viewed). ${newThisWeek.length} new uploads this week. ${unviewed ? unviewed + " materials remaining." : "All caught up!"}`;
    if (!user.notifications) user.notifications = [];
    user.notifications.unshift({
      id: "wp" + Date.now(),
      type: "system",
      text: summary,
      read: false,
      createdAt: new Date().toISOString()
    });
    if (user.notifications.length > 50) user.notifications.length = 50;
    user.lastWeeklyReport = now;
    saveDb();
    send(res, 200, { generated: true, summary, total, viewed: viewed.length, newThisWeek: newThisWeek.length });
  }
});

/* ---------- collections (notebooks) ---------- */

routes.push({
  method: "GET", path: "/api/collections",
  handler: (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    if (!user.collections) user.collections = [];
    const enriched = user.collections.map((col) => ({
      ...col,
      files: (col.fileIds || []).map((fid) => {
        const f = db.files.find((x) => x.id === fid);
        return f ? fileInfo(f, user) : null;
      }).filter(Boolean)
    }));
    send(res, 200, { collections: enriched });
  }
});

routes.push({
  method: "POST", path: "/api/collections",
  handler: async (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const body = JSON.parse((await readBody(req, 1024 * 4)).toString() || "{}");
    const name = String(body.name || "").trim();
    if (!name) return send(res, 400, { error: "Collection name is required" });
    if (!user.collections) user.collections = [];
    if (user.collections.length >= 20) return send(res, 400, { error: "Maximum 20 collections" });
    const col = {
      id: "col" + Date.now(),
      name,
      description: String(body.description || "").trim(),
      fileIds: [],
      createdAt: new Date().toISOString()
    };
    user.collections.push(col);
    saveDb();
    send(res, 201, { collection: { ...col, files: [] } });
  }
});

routes.push({
  method: "POST", path: "/api/collections/:id/add",
  handler: async (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const body = JSON.parse((await readBody(req, 1024 * 4)).toString() || "{}");
    const fileId = String(body.fileId || "").trim();
    if (!fileId) return send(res, 400, { error: "fileId is required" });
    const col = (user.collections || []).find((c) => c.id === params.id);
    if (!col) return send(res, 404, { error: "Collection not found" });
    if (!col.fileIds.includes(fileId)) col.fileIds.push(fileId);
    saveDb();
    ok(res);
  }
});

routes.push({
  method: "POST", path: "/api/collections/:id/remove",
  handler: async (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const body = JSON.parse((await readBody(req, 1024 * 4)).toString() || "{}");
    const fileId = String(body.fileId || "").trim();
    const col = (user.collections || []).find((c) => c.id === params.id);
    if (!col) return send(res, 404, { error: "Collection not found" });
    col.fileIds = col.fileIds.filter((id) => id !== fileId);
    saveDb();
    ok(res);
  }
});

routes.push({
  method: "DELETE", path: "/api/collections/:id",
  handler: (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    user.collections = (user.collections || []).filter((c) => c.id !== params.id);
    saveDb();
    ok(res);
  }
});

routes.push({
  method: "GET", path: "/api/collections/:id/zip",
  handler: (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const col = (user.collections || []).find((c) => c.id === params.id);
    if (!col) return send(res, 404, { error: "Collection not found" });
    const files = (col.fileIds || []).map((id) => db.files.find((f) => f.id === id)).filter(Boolean);
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
    const meta = {
      collection: col.name,
      description: col.description || "",
      exportedAt: new Date().toISOString(),
      exportedBy: user.displayName || user.username,
      fileCount: entries.length,
      files: files.map((f) => ({
        name: f.originalName || f.name,
        course: (db.courses.find((c) => c.id === f.courseId) || {}).name || "",
        tags: f.tags || [],
        uploadedAt: f.uploadedAt,
        uploadedBy: f.uploadedByName || ""
      }))
    };
    entries.unshift({ name: "_metadata.json", buffer: Buffer.from(JSON.stringify(meta, null, 2), "utf8") });
    const zip = buildZip(entries);
    const filename = `${col.name}.zip`;
    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Content-Length": zip.length
    });
    res.end(zip);
  }
});

/* ---------- study groups ---------- */

routes.push({
  method: "GET", path: "/api/groups",
  handler: (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const myGroups = db.groups.filter((g) => g.memberIds.includes(user.id));
    send(res, 200, { groups: myGroups.map((g) => ({
      id: g.id, name: g.name, description: g.description, ownerId: g.ownerId,
      ownerName: (db.users.find((u) => u.id === g.ownerId) || {}).username || "Unknown",
      memberCount: g.memberIds.length, collectionCount: (g.collectionIds || []).length,
      createdAt: g.createdAt
    }))});
  }
});

routes.push({
  method: "POST", path: "/api/groups",
  handler: async (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const body = JSON.parse((await readBody(req, 1024)).toString() || "{}");
    const name = String(body.name || "").trim();
    if (!name) return send(res, 400, { error: "Group name required" });
    if (name.length > 60) return send(res, 400, { error: "Name too long" });
    const g = {
      id: "grp" + Date.now() + Math.random().toString(16).slice(2, 6),
      name,
      description: String(body.description || "").trim().slice(0, 200),
      ownerId: user.id,
      memberIds: [user.id],
      collectionIds: [],
      createdAt: new Date().toISOString()
    };
    db.groups.push(g);
    saveDb();
    ok(res, { group: { id: g.id, name: g.name, description: g.description, memberCount: 1 } });
  }
});

routes.push({
  method: "GET", path: "/api/groups/:id",
  handler: (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const g = db.groups.find((x) => x.id === params.id);
    if (!g) return send(res, 404, { error: "Group not found" });
    if (!g.memberIds.includes(user.id)) return send(res, 403, { error: "Not a member" });
    const members = g.memberIds.map((mid) => {
      const u = db.users.find((x) => x.id === mid);
      return u ? { id: u.id, username: u.username, role: u.role } : null;
    }).filter(Boolean);
    const sharedCols = (g.collectionIds || []).map((cid) => {
      for (const u of db.users) {
        const col = (u.collections || []).find((c) => c.id === cid);
        if (col) return { id: col.id, name: col.name, description: col.description, fileCount: (col.fileIds || []).length, ownerName: u.username };
      }
      return null;
    }).filter(Boolean);
    send(res, 200, { group: { id: g.id, name: g.name, description: g.description, ownerId: g.ownerId, ownerName: (db.users.find((u) => u.id === g.ownerId) || {}).username, members, sharedCollections: sharedCols, createdAt: g.createdAt } });
  }
});

routes.push({
  method: "POST", path: "/api/groups/:id/join",
  handler: (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const g = db.groups.find((x) => x.id === params.id);
    if (!g) return send(res, 404, { error: "Group not found" });
    if (g.memberIds.includes(user.id)) return send(res, 400, { error: "Already a member" });
    g.memberIds.push(user.id);
    saveDb();
    notify(g.ownerId, `${user.username} joined your group "${g.name}"`, "group");
    ok(res, { memberCount: g.memberIds.length });
  }
});

routes.push({
  method: "POST", path: "/api/groups/:id/leave",
  handler: (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const g = db.groups.find((x) => x.id === params.id);
    if (!g) return send(res, 404, { error: "Group not found" });
    if (g.ownerId === user.id) return send(res, 400, { error: "Owner cannot leave. Transfer ownership or delete." });
    g.memberIds = g.memberIds.filter((id) => id !== user.id);
    saveDb();
    ok(res, { memberCount: g.memberIds.length });
  }
});

routes.push({
  method: "DELETE", path: "/api/groups/:id",
  handler: (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const g = db.groups.find((x) => x.id === params.id);
    if (!g) return send(res, 404, { error: "Group not found" });
    if (g.ownerId !== user.id) return send(res, 403, { error: "Only owner can delete" });
    db.groups = db.groups.filter((x) => x.id !== params.id);
    saveDb();
    ok(res);
  }
});

routes.push({
  method: "POST", path: "/api/groups/:id/share",
  handler: async (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const g = db.groups.find((x) => x.id === params.id);
    if (!g) return send(res, 404, { error: "Group not found" });
    if (!g.memberIds.includes(user.id)) return send(res, 403, { error: "Not a member" });
    const body = JSON.parse((await readBody(req, 1024)).toString() || "{}");
    const colId = String(body.collectionId || "");
    if (!colId) return send(res, 400, { error: "collectionId required" });
    const col = (user.collections || []).find((c) => c.id === colId);
    if (!col) return send(res, 404, { error: "Collection not found" });
    if (!g.collectionIds) g.collectionIds = [];
    if (g.collectionIds.includes(colId)) return send(res, 400, { error: "Already shared" });
    g.collectionIds.push(colId);
    saveDb();
    for (const mid of g.memberIds) {
      if (mid !== user.id) notify(mid, `${user.username} shared "${col.name}" in group "${g.name}"`, "group");
    }
    ok(res, { shared: true });
  }
});

/* ---------- profiles & leaderboard ---------- */

routes.push({
  method: "POST", path: "/api/profile/bio",
  handler: async (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const body = JSON.parse((await readBody(req, 1024)).toString() || "{}");
    user.bio = String(body.bio || "").trim().slice(0, 500);
    saveDb();
    ok(res, { bio: user.bio });
  }
});

routes.push({
  method: "POST", path: "/api/profile/avatar",
  handler: async (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    if (req.headers["content-type"] !== "application/octet-stream") {
      return send(res, 400, { error: "Upload the image as binary" });
    }
    const buf = await readBody(req, 2 * 1024 * 1024);
    if (buf.length < 8) return send(res, 400, { error: "File too small" });
    let ext = "";
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) ext = "jpg";
    else if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) ext = "png";
    else if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) ext = "webp";
    else return send(res, 400, { error: "Only JPG, PNG, or WebP images are allowed" });
    if (user.avatarStoredName) {
      try { fs.unlinkSync(path.join(UPLOAD_DIR, user.avatarStoredName)); } catch {}
    }
    const storedName = "av-" + user.id + "-" + Date.now() + "." + ext;
    fs.writeFileSync(path.join(UPLOAD_DIR, storedName), buf);
    if (supabaseConfigured()) supaPut("avatars/" + storedName, buf).catch(() => {});
    user.avatarStoredName = storedName;
    user.avatarUrl = "/api/profile/avatar/" + user.id;
    saveDb();
    ok(res, { avatarUrl: user.avatarUrl });
  }
});

routes.push({
  method: "GET", path: "/api/profile/avatar/:id",
  handler: (req, res, params) => {
    const target = db.users.find((u) => u.id === params.id);
    if (!target || !target.avatarStoredName) {
      res.writeHead(404);
      res.end();
      return;
    }
    const filePath = path.join(UPLOAD_DIR, target.avatarStoredName);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const ext = path.extname(target.avatarStoredName).slice(1).toLowerCase();
    const mime = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" }[ext] || "application/octet-stream";
    const buf = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": mime, "Cache-Control": "public, max-age=86400" });
    res.end(buf);
  }
});

routes.push({
  method: "POST", path: "/api/auth/notif-prefs",
  handler: async (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const body = JSON.parse((await readBody(req, 1024)).toString() || "{}");
    user.notifPrefs = {
      upload: body.upload !== false,
      approval: body.approval !== false,
      comment: body.comment !== false,
      mention: body.mention !== false,
      follow: body.follow !== false,
      group: body.group !== false
    };
    saveDb();
    ok(res, { notifPrefs: user.notifPrefs });
  }
});

routes.push({
  method: "GET", path: "/api/profile/:id",
  handler: (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const target = db.users.find((u) => u.id === params.id);
    if (!target) return send(res, 404, { error: "User not found" });
    const uploads = db.files.filter((f) => f.uploadedBy === target.id);
    const totalViews = uploads.reduce((s, f) => s + (f.views || 0), 0);
    const totalDownloads = uploads.reduce((s, f) => s + (f.downloads || 0), 0);
    const totalLikes = uploads.reduce((s, f) => s + (f.likedBy || []).length, 0);
    const isFollowing = user.following && user.following.includes(target.id);
    const enrolledCourses = (target.enrolledCourses || []).map((cid) => {
      const c = db.courses.find((x) => x.id === cid);
      return c ? { id: c.id, name: c.name, code: c.code } : null;
    }).filter(Boolean);
    send(res, 200, {
      profile: {
        id: target.id,
        username: target.username,
        role: target.role,
        bio: target.bio || "",
        avatarUrl: target.avatarUrl || "",
        school: target.school || "",
        faculty: target.faculty || "",
        department: target.department || "",
        level: target.level || "",
        joinedAt: target.joinedAt || target.createdAt || null,
        followerCount: (target.followers || []).length,
        followingCount: (target.following || []).length,
        isFollowing,
        uploadCount: uploads.length,
        totalViews,
        totalDownloads,
        totalLikes,
        enrolledCourses,
        recentUploads: uploads.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)).slice(0, 5).map((f) => fileInfo(f, user)),
        activity: (target.activity || []).slice(0, 20)
      }
    });
  }
});

routes.push({
  method: "POST", path: "/api/users/:id/follow",
  handler: (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    if (params.id === user.id) return send(res, 400, { error: "Cannot follow yourself" });
    const target = db.users.find((u) => u.id === params.id);
    if (!target) return send(res, 404, { error: "User not found" });
    if (!user.following) user.following = [];
    if (!target.followers) target.followers = [];
    if (user.following.includes(target.id)) return send(res, 400, { error: "Already following" });
    user.following.push(target.id);
    target.followers.push(user.id);
    saveDb();
    notify(target.id, `${user.username} started following you`, "follow", "/profile/" + user.id);
    ok(res, { following: true, followerCount: target.followers.length });
  }
});

routes.push({
  method: "DELETE", path: "/api/users/:id/follow",
  handler: (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const target = db.users.find((u) => u.id === params.id);
    if (!target) return send(res, 404, { error: "User not found" });
    if (user.following) user.following = user.following.filter((id) => id !== target.id);
    if (target.followers) target.followers = target.followers.filter((id) => id !== user.id);
    saveDb();
    ok(res, { following: false, followerCount: (target.followers || []).length });
  }
});

routes.push({
  method: "GET", path: "/api/users/:id/followers",
  handler: (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const target = db.users.find((u) => u.id === params.id);
    if (!target) return send(res, 404, { error: "User not found" });
    const followers = (target.followers || []).map((fid) => {
      const u = db.users.find((x) => x.id === fid);
      return u ? { id: u.id, username: u.username, role: u.role, avatarUrl: u.avatarUrl || "" } : null;
    }).filter(Boolean);
    send(res, 200, { followers });
  }
});

routes.push({
  method: "GET", path: "/api/users/:id/following",
  handler: (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const target = db.users.find((u) => u.id === params.id);
    if (!target) return send(res, 404, { error: "User not found" });
    const following = (target.following || []).map((fid) => {
      const u = db.users.find((x) => x.id === fid);
      return u ? { id: u.id, username: u.username, role: u.role, avatarUrl: u.avatarUrl || "" } : null;
    }).filter(Boolean);
    send(res, 200, { following });
  }
});

routes.push({
  method: "GET", path: "/api/leaderboard",
  handler: (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    const uploaders = {};
    for (const f of db.files) {
      if (!f.uploadedBy) continue;
      if (!uploaders[f.uploadedBy]) {
        const u = db.users.find((x) => x.id === f.uploadedBy);
        uploaders[f.uploadedBy] = { id: f.uploadedBy, username: u ? u.username : "Unknown", role: u ? u.role : "student", uploads: 0, views: 0, downloads: 0, likes: 0 };
      }
      const u = uploaders[f.uploadedBy];
      u.uploads++;
      u.views += f.views || 0;
      u.downloads += f.downloads || 0;
      u.likes += (f.likedBy || []).length;
    }
    const board = Object.values(uploaders).sort((a, b) => (b.views + b.downloads + b.likes * 2) - (a.views + a.downloads + a.likes * 2)).slice(0, 20);
    send(res, 200, { leaderboard: board });
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

    const now = Date.now();
    const dayMs = 86400000;
    const uploadTrend = [];
    for (let i = 29; i >= 0; i--) {
      const dayStart = new Date(now - i * dayMs);
      const dayStr = dayStart.toISOString().slice(0, 10);
      const count = db.files.filter((f) => f.uploadedAt && f.uploadedAt.slice(0, 10) === dayStr).length;
      uploadTrend.push({ date: dayStr, count });
    }

    const userActivity = {};
    for (const f of db.files) {
      if (!f.uploadedBy) continue;
      if (!userActivity[f.uploadedBy]) userActivity[f.uploadedBy] = { uploads: 0, views: 0, downloads: 0, likes: 0, comments: 0 };
      userActivity[f.uploadedBy].uploads++;
      userActivity[f.uploadedBy].views += f.views || 0;
      userActivity[f.uploadedBy].downloads += f.downloads || 0;
      userActivity[f.uploadedBy].likes += (f.likedBy || []).length;
      userActivity[f.uploadedBy].comments += (f.comments || []).length;
    }
    const topUsers = Object.entries(userActivity)
      .map(([id, a]) => {
        const u = db.users.find((x) => x.id === id);
        return { id, username: u ? u.username : "Unknown", ...a, score: a.views + a.downloads + a.likes * 2 + a.comments };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const courseStats = db.courses.map((c) => {
      const files = db.files.filter((f) => f.courseId === c.id);
      return {
        name: c.name,
        fileCount: files.length,
        totalViews: files.reduce((s, f) => s + (f.views || 0), 0),
        totalDownloads: files.reduce((s, f) => s + (f.downloads || 0), 0)
      };
    }).sort((a, b) => b.totalViews - a.totalViews).slice(0, 5);

    const totalComments = db.files.reduce((s, f) => s + (f.comments || []).length, 0);
    const totalRatings = db.files.reduce((s, f) => s + (f.ratings || []).length, 0);

    send(res, 200, { stats: { totalFiles, totalDownloads, totalViews, totalCourses, totalUsers, pending, totalComments, totalRatings }, topFiles, uploadTrend, topUsers, courseStats });
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
  if (!fp.startsWith(PUBLIC_DIR + path.sep) && fp !== PUBLIC_DIR) return send(res, 403, { error: "Forbidden" });
  if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    if (!path.extname(rel)) {
      fp = path.join(PUBLIC_DIR, "index.html");
    } else {
      return send(res, 404, { error: "Not found" });
    }
  }
  const ext = path.extname(fp).toLowerCase();
  const cacheHeaders = {};
  if (ext === ".html") {
    cacheHeaders["Cache-Control"] = "no-cache";
  } else if (ext === ".css" || ext === ".js") {
    cacheHeaders["Cache-Control"] = "no-cache";
  } else {
    cacheHeaders["Cache-Control"] = "public, max-age=86400";
  }
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Content-Length": fs.statSync(fp).size,
    ...cacheHeaders
  });
  fs.createReadStream(fp).pipe(res);
}

const server = http.createServer((req, res) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src 'self' blob:; connect-src 'self'");
  const start = Date.now();
  res.on("finish", () => {
    const dur = Date.now() - start;
    console.log(req.method + " " + req.url + " " + res.statusCode + " " + dur + "ms");
  });
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;
  if (pathname.startsWith("/api/")) return handleApi(req, res, pathname);
  return serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`Course Library running at http://localhost:${PORT}`);
  console.log(`Seeded logins -> admin/admin123, student1/student123`);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});
