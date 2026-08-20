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

let db;
if (fs.existsSync(DATA_FILE)) {
  db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
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

function _writeDb() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  try { fs.copyFileSync(DATA_FILE, BACKUP_FILE); } catch {}
  if (supabaseConfigured()) supaPut("db.json", JSON.stringify(db)).catch(() => {});
  _dirty = false;
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
  return { id: u.id, username: u.username, email: u.email || "", role: u.role, verified: !!u.verified };
}

function send(res, status, data) {
  const body = JSON.stringify(data);
  const etag = '"' + crypto.createHash("md5").update(body).digest("hex") + '"';
  const ifNoneMatch = res.req?.headers?.["if-none-match"];
  if (ifNoneMatch && ifNoneMatch === etag && status === 200) {
    res.writeHead(304);
    res.end();
    return;
  }
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "ETag": etag
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
const registerLimiter = rateLimiter(5, 60 * 1000);

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
    db.users.push(user);
    saveDb();
    send(res, 201, {
      message: "Account created successfully.",
      token: signToken(user),
      user: publicUser(user)
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

routes.push({
  method: "POST", path: "/api/files/bulk-action",
  handler: async (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    if (user.role !== "admin") return send(res, 403, { error: "Admins only" });
    const body = JSON.parse((await readBody(req, 1024 * 16)).toString() || "{}");
    const ids = Array.isArray(body.fileIds) ? body.fileIds : [];
    const action = body.action;
    if (!ids.length) return send(res, 400, { error: "No files selected" });
    if (action !== "approve" && action !== "reject") return send(res, 400, { error: "Action must be approve or reject" });
    let count = 0;
    for (const id of ids) {
      const idx = db.files.findIndex((x) => x.id === id);
      if (idx === -1) continue;
      const f = db.files[idx];
      if (action === "approve") {
        if (!f.approved) {
          f.approved = true;
          count++;
          notify(f.uploadedBy, `Your file "${f.name}" was approved and is now visible to everyone.`);
          for (const u of db.users) {
            const savedCourse =
              u.id !== f.uploadedBy &&
              db.files.some((x) => x.courseId === f.courseId && (x.savedBy || []).includes(u.id));
            if (savedCourse) notify(u.id, `New material "${f.name}" added to ${courseLabel(f.courseId)}`);
          }
        }
      } else {
        db.files.splice(idx, 1);
        count++;
        notify(f.uploadedBy, `Your file "${f.name}" was rejected by an admin.`);
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
    if (supabaseConfigured()) supaDelete("uploads/" + f.storedName).catch(() => {});
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

/* ---------- announcements ---------- */

routes.push({
  method: "GET", path: "/api/announcements",
  handler: (req, res) => {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Not authenticated" });
    if (!db.announcements) db.announcements = [];
    const visible = db.announcements.filter((a) => {
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
    if (user.role !== "admin") return send(res, 403, { error: "Admins only" });
    const body = JSON.parse((await readBody(req, 1024 * 4)).toString() || "{}");
    const text = String(body.text || "").trim();
    if (!text) return send(res, 400, { error: "Announcement text is required" });
    if (!db.announcements) db.announcements = [];
    const a = {
      id: "ann" + Date.now(),
      text,
      courseId: body.courseId || null,
      authorId: user.id,
      authorName: user.username,
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
    if (!db.announcements) db.announcements = [];
    db.announcements = db.announcements.filter((a) => a.id !== params.id);
    saveDb();
    ok(res);
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

/* ---------- profiles & leaderboard ---------- */

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
    send(res, 200, {
      profile: {
        id: target.id,
        username: target.username,
        role: target.role,
        uploadCount: uploads.length,
        totalViews,
        totalDownloads,
        totalLikes,
        recentUploads: uploads.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)).slice(0, 5).map((f) => fileInfo(f, user))
      }
    });
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
