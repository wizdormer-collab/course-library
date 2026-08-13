import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import zlib from "zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3999;
const BASE = `http://localhost:${PORT}`;

function buildPdf(text) {
  const objs = [];
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objs.push(
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>"
  );
  const stream = `BT /F1 20 Tf 72 700 Td (${text}) Tj ET`;
  objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xrefPos = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => {
    pdf += String(off).padStart(10, "0") + " 00000 n \n";
  });
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

function buildComplexPdf(text) {
  const codes = {};
  let code = 1;
  for (const ch of text) {
    if (!(ch in codes)) {
      codes[ch] = code++;
    }
  }
  const hex = [...text].map((ch) => codes[ch].toString(16).padStart(4, "0")).join("");
  const cmapEntries = Object.entries(codes)
    .map(([ch, c]) => `<${c.toString(16).padStart(4, "0")}> <${Buffer.from(ch, "utf8").toString("hex")}>`)
    .join("\n");
  const cmap = `/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${Object.keys(codes).length} beginbfchar\n${cmapEntries}\nendbfchar\nendcmap`;
  const content = `BT /F1 12 Tf 72 700 Td <${hex}> Tj ET`;
  const contentDeflated = zlib.deflateSync(Buffer.from(content, "latin1"));
  const cmapDeflated = zlib.deflateSync(Buffer.from(cmap, "latin1"));

  const objs = [];
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objs.push(
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"
  );
  objs.push("<< /Type /Font /Subtype /Type0 /BaseFont /Helvetica /Encoding /Identity-H /ToUnicode 7 0 R >>");
  objs.push(`<< /Length ${contentDeflated.length} /Filter /FlateDecode >>\nstream\n${contentDeflated.toString("latin1")}\nendstream`);
  objs.push("<< /Type /Font /Subtype /CIDFontType0 /BaseFont /Helvetica /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> >>");
  objs.push(`<< /Length ${cmapDeflated.length} /Filter /FlateDecode >>\nstream\n${cmapDeflated.toString("latin1")}\nendstream`);

  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xrefPos = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => (pdf += String(off).padStart(10, "0") + " 00000 n \n"));
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

const results = [];
function check(name, cond, extra = "") {
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  -> " + extra : ""}`);
}

async function api(path, { method = "GET", token, body, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h["Authorization"] = "Bearer " + token;
  const res = await fetch(BASE + path, { method, headers: h, body });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
}

function waitForServer() {
  return new Promise((resolve, reject) => {
    const t = Date.now();
    const timer = setInterval(async () => {
      try {
        const r = await fetch(BASE + "/api/health");
        if (r.ok) {
          clearInterval(timer);
          resolve();
        }
      } catch {}
      if (Date.now() - t > 30000) {
        clearInterval(timer);
        reject(new Error("Server did not start"));
      }
    }, 500);
  });
}

const server = spawn(process.execPath, [path.join(__dirname, "server.js")], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"]
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

let pdf = buildPdf("Course Library integration test");
const samplePdfPath = path.join(__dirname, "sample-test.pdf");
fs.writeFileSync(samplePdfPath, pdf);

try {
  await waitForServer();
  const health = await api("/api/health");
  check("health endpoint", health.status === 200);

  const anon = await api("/api/courses");
  check("unauthenticated access rejected (401)", anon.status === 401);

  const dupLogin = await api("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "wrongpass" })
  });
  check("bad password rejected (401)", dupLogin.status === 401);

  const adminLogin = await api("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" })
  });
  check("admin login works", adminLogin.status === 200 && adminLogin.data.user.role === "admin");
  const adminToken = adminLogin.data.token;

  const studentLogin = await api("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "student1", password: "student123" })
  });
  check("student login works", studentLogin.status === 200 && studentLogin.data.user.role === "student");
  const studentToken = studentLogin.data.token;

  const emailLogin = await api("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "student1@university.edu.ng", password: "student123" })
  });
  check("login with student email works", emailLogin.status === 200 && emailLogin.data.user.email === "student1@university.edu.ng");

  const stamp = Date.now();
  const newkidEmail = "newkid" + stamp + "@student.edu.ng";
  const reg = await api("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: newkidEmail, password: "pass1234" })
  });
  check("register creates pending account", reg.status === 201 && reg.data.pending === true && !!reg.data.devCode);

  const preVerify = await api("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: newkidEmail, password: "pass1234" })
  });
  check("login blocked before verification (403)", preVerify.status === 403);

  const wrongCode = await api("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: newkidEmail, code: "000000" })
  });
  check("wrong verification code rejected (401)", wrongCode.status === 401);

  const verifyNew = await api("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: newkidEmail, code: reg.data.devCode })
  });
  check("correct code activates account", verifyNew.status === 200 && verifyNew.data.user.verified === true);
  const newkidToken = verifyNew.data.token;

  const badEmail = await api("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "notanemail", password: "pass1234" })
  });
  check("invalid email rejected (400)", badEmail.status === 400);

  const regDup = await api("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@course-library.edu.ng", password: "pass1234" })
  });
  check("duplicate email rejected (409)", regDup.status === 409);

  const badInvite = await api("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "evil" + stamp + "@student.edu.ng", password: "pass1234", inviteCode: "wrong-code" })
  });
  check("wrong invite code rejected (403)", badInvite.status === 403);

  const bossEmail = "boss" + stamp + "@student.edu.ng";
  const adminReg = await api("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: bossEmail, password: "pass1234", inviteCode: "admin2026" })
  });
  check("valid invite code creates pending admin", adminReg.status === 201 && adminReg.data.pending === true);

  const resend = await api("/api/auth/resend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: bossEmail })
  });
  check("resend issues a new code", resend.status === 200 && !!resend.data.devCode);

  const verifyBoss = await api("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: bossEmail, code: resend.data.devCode })
  });
  check("admin account verified with resent code", verifyBoss.status === 200 && verifyBoss.data.user.role === "admin");
  const bossToken = verifyBoss.data.token;
  const bossCanAdmin = await api("/api/files/pending", { token: bossToken });
  check("invite-signed admin has admin powers", bossCanAdmin.status === 200);

  const courses = await api("/api/courses", { token: adminToken });
  check("courses listed", courses.status === 200 && courses.data.courses.length >= 3);
  const courseId = courses.data.courses[0].id;

  const nonPdf = await api("/api/files", {
    method: "POST",
    token: studentToken,
    headers: {
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent("notapdf.pdf"),
      "X-Original-Name": encodeURIComponent("notapdf.pdf"),
      "X-Course-Id": courseId
    },
    body: Buffer.from("this is not a pdf")
  });
  check("non-PDF upload rejected", nonPdf.status === 400);

  const up = await api("/api/files", {
    method: "POST",
    token: studentToken,
    headers: {
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent("Student Notes - Week 1.pdf"),
      "X-Original-Name": encodeURIComponent("student-notes.pdf"),
      "X-Course-Id": courseId
    },
    body: pdf
  });
  check("student upload accepted as pending", up.status === 201 && up.data.file.approved === false);
  const fileId = up.data.file.id;

  const studentSeesOwn = await api(`/api/files?courseId=${courseId}`, { token: studentToken });
  const own = studentSeesOwn.data.files.find((f) => f.id === fileId);
  check("student can see their pending upload", !!own && own.approved === false);

  const pending = await api("/api/files/pending", { token: adminToken });
  check("admin sees pending list", pending.status === 200 && pending.data.files.some((f) => f.id === fileId));

  const asStudent = await api(`/api/files/${fileId}/inline`, { token: studentToken });
  check("uploader can preview own pending file", asStudent.status === 200);

  const approve = await api(`/api/files/${fileId}/approve`, { method: "POST", token: adminToken });
  check("admin approves file", approve.status === 200 && approve.data.file.approved === true);

  const dl = await fetch(BASE + `/api/files/${fileId}/download`, {
    headers: { Authorization: "Bearer " + studentToken }
  });
  const bytes = Buffer.from(await dl.arrayBuffer());
  check("downloaded bytes match uploaded PDF", dl.status === 200 && bytes.equals(pdf));

  const newkidLogin2 = await api("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "newkid" + stamp, password: "pass1234" })
  });
  check("verified student can log in", newkidLogin2.status === 200);
  const otherSees = await api(`/api/files?courseId=${courseId}`, { token: newkidToken });
  check("other student sees approved file", otherSees.data.files.some((f) => f.id === fileId && f.approved));

  const saveIt = await api(`/api/files/${fileId}/save`, { method: "POST", token: newkidToken });
  check("student can save a file", saveIt.status === 200);
  const savedList = await api("/api/files/saved", { token: newkidToken });
  check("saved list contains the file", savedList.data.files.some((f) => f.id === fileId));

  const comment = await api(`/api/files/${fileId}/comments`, {
    method: "POST",
    token: newkidToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "Can someone explain the third slide?" })
  });
  check("post comment works", comment.status === 201);
  const comments = await api(`/api/files/${fileId}/comments`, { token: newkidToken });
  check("comments listed", comments.data.comments.some((c) => c.text.includes("third slide")));
  const commentId = comments.data.comments[0].id;
  const delComment = await api(`/api/files/${fileId}/comments/${commentId}`, { method: "DELETE", token: newkidToken });
  check("author can delete own comment", delComment.status === 200);

  const search = await api("/api/search?q=" + encodeURIComponent("integration"), { token: newkidToken });
  check("full-text search finds PDF content", search.data.files.some((f) => f.id === fileId));

  const searchNo = await api("/api/search?q=" + encodeURIComponent("zzzznope"), { token: newkidToken });
  check("search with no match returns empty", searchNo.data.files.length === 0);

  const feed = await api("/api/feed", { token: newkidToken });
  check("feed includes recently uploaded file", feed.data.files.some((f) => f.id === fileId));

  const popular = await api("/api/popular", { token: newkidToken });
  check("popular list returns files", Array.isArray(popular.data.files));

  const notifs = await api("/api/notifications", { token: studentToken });
  check("uploader notified on approval", notifs.data.notifications.some((n) => n.text.includes("approved")));
  const markRead = await api("/api/notifications/read", { method: "POST", token: studentToken });
  check("mark notifications read", markRead.status === 200);

  const progress = await api(`/api/courses/${courseId}/progress`, { token: newkidToken });
  check("progress endpoint reports viewed files", progress.status === 200 && progress.data.total >= 1);

  const stats = await api("/api/stats", { token: adminToken });
  check("admin stats work", stats.status === 200 && stats.data.stats.totalFiles >= 1 && stats.data.stats.totalDownloads >= 1);

  const zipRes = await fetch(BASE + `/api/courses/${courseId}/zip`, {
    headers: { Authorization: "Bearer " + studentToken }
  });
  const zipBytes = Buffer.from(await zipRes.arrayBuffer());
  check(
    "course zip downloads",
    zipRes.status === 200 &&
      zipRes.headers.get("content-type") === "application/zip" &&
      zipBytes.slice(0, 2).toString("latin1") === "PK"
  );

  const complexPdf = buildComplexPdf("HydraPassword the third");
  const upComplex = await api("/api/files", {
    method: "POST",
    token: adminToken,
    headers: {
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent("Advanced Lecture.pdf"),
      "X-Original-Name": encodeURIComponent("advanced.pdf"),
      "X-Course-Id": courseId
    },
    body: complexPdf
  });
  check("compressed+ToUnicode PDF uploads", upComplex.status === 201);
  const complexId = upComplex.data.file.id;
  const searchComplex = await api("/api/search?q=" + encodeURIComponent("HydraPassword"), { token: newkidToken });
  check("search extracts text from compressed ToUnicode PDF", searchComplex.data.files.some((f) => f.id === complexId));
  const delComplex = await api(`/api/files/${complexId}`, { method: "DELETE", token: adminToken });
  check("cleanup complex PDF", delComplex.status === 200);

  const del = await api(`/api/files/${fileId}`, { method: "DELETE", token: adminToken });
  check("admin deletes file", del.status === 200);

  const studentDel = await api(`/api/files/${fileId}`, { method: "DELETE", token: studentToken });
  check("student cannot delete (403)", studentDel.status === 403);

  const studentCourse = await api("/api/courses", {
    method: "POST",
    token: studentToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "x", code: "X" })
  });
  check("student cannot create course (403)", studentCourse.status === 403);

  const adminCourse = await api("/api/courses", {
    method: "POST",
    token: adminToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Test Course", code: "TEST" })
  });
  check("admin creates course", adminCourse.status === 201);
  const tcId = adminCourse.data.course.id;
  const delCourse = await api(`/api/courses/${tcId}`, { method: "DELETE", token: adminToken });
  check("admin deletes course", delCourse.status === 200);

  const forgotStart = await api("/api/auth/forgot/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "student1" })
  });
  check("forgot password returns question", forgotStart.status === 200 && forgotStart.data.question === "What city were you born in?");

  const forgotWrong = await api("/api/auth/forgot/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "student1", answer: "nope", newPassword: "newpass1" })
  });
  check("forgot password wrong answer rejected (401)", forgotWrong.status === 401);

  const forgotOk = await api("/api/auth/forgot/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "student1", answer: "lagos", newPassword: "newpass1" })
  });
  check("forgot password resets password", forgotOk.status === 200);

  const relogin = await api("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "student1", password: "newpass1" })
  });
  check("login with new password works", relogin.status === 200);
  const reloginToken = relogin.data.token;

  const changeBad = await api("/api/auth/change-password", {
    method: "POST",
    token: reloginToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ oldPassword: "wrong", newPassword: "whatever" })
  });
  check("change password with wrong old password rejected", changeBad.status === 401);

  const changeOk = await api("/api/auth/change-password", {
    method: "POST",
    token: reloginToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ oldPassword: "newpass1", newPassword: "student123" })
  });
  check("change password works", changeOk.status === 200);

  const sq = await api("/api/auth/security-question", {
    method: "POST",
    token: reloginToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: "Favourite food?", answer: "Pizza" })
  });
  check("set security question", sq.status === 200);

  const sqRestore = await api("/api/auth/security-question", {
    method: "POST",
    token: reloginToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: "What city were you born in?", answer: "lagos" })
  });
  check("restore seeded security question", sqRestore.status === 200);

  const users = await api("/api/users", { token: adminToken });
  const newkidId = users.data.users.find((u) => u.username === "newkid" + stamp).id;
  check("admin lists users", users.status === 200 && users.data.users.length >= 4);

  const promote = await api(`/api/users/${newkidId}/role`, {
    method: "POST",
    token: adminToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "admin" })
  });
  check("admin promotes user to admin", promote.status === 200 && promote.data.user.role === "admin");

  const demote = await api(`/api/users/${newkidId}/role`, {
    method: "POST",
    token: adminToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "student" })
  });
  check("admin demotes user to student", demote.status === 200 && demote.data.user.role === "student");

  const selfDemote = await api(`/api/users/${adminLogin.data.user.id}/role`, {
    method: "POST",
    token: adminToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "student" })
  });
  check("admin cannot demote self", selfDemote.status === 400);

  const resetPw = await api(`/api/users/${newkidId}/reset-password`, {
    method: "POST",
    token: adminToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newPassword: "resetpw1" })
  });
  check("admin resets user password", resetPw.status === 200);

  const delUser = await api(`/api/users/${newkidId}`, { method: "DELETE", token: adminToken });
  check("admin deletes user", delUser.status === 200);

  const selfDel = await api(`/api/users/${adminLogin.data.user.id}`, { method: "DELETE", token: adminToken });
  check("admin cannot delete self", selfDel.status === 400);
} catch (err) {
  results.push("ERROR " + err.message);
  if (serverLog) results.push("SERVER LOG: " + serverLog.slice(0, 2000));
} finally {
  fs.rmSync(samplePdfPath, { force: true });
  server.kill();
}

const out = path.join(__dirname, "test-results.txt");
fs.writeFileSync(out, results.join("\n"));
console.log("done");
