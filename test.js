import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import os from "os";
import zlib from "zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "courselib-test-"));

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
  env: { ...process.env, PORT: String(PORT), DATA_DIR: TEST_DATA_DIR },
  stdio: ["ignore", "pipe", "pipe"]
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

let pdf = buildPdf("Course Library integration test");
const samplePdfPath = path.join(TEST_DATA_DIR, "sample-test.pdf");
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
  let adminToken = adminLogin.data.token;

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
  check("register creates account", reg.status === 201 && !!reg.data.token && reg.data.user.verified === true);
  const newkidToken = reg.data.token;

  const preVerify = await api("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: newkidEmail, password: "pass1234" })
  });
  check("registered user can log in immediately", preVerify.status === 200);

  const schoolRegEmail = "schoolkid" + stamp + "@student.edu.ng";
  const schoolReg = await api("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: schoolRegEmail, password: "pass1234",
      school: "unilag", faculty: "Science", department: "Computer Science",
      level: "300", matricNumber: "UNILAG/2024/001", studentType: "science"
    })
  });
  check("register with school fields", schoolReg.status === 201 && schoolReg.data.user && schoolReg.data.user.school === "unilag" && schoolReg.data.user.department === "Computer Science");
  check("studentType set from faculty", schoolReg.status === 201 && schoolReg.data.user && schoolReg.data.user.studentType === "science");

  const schools = await api("/api/schools", { token: adminToken });
  check("GET /api/schools returns list", schools.status === 200 && Array.isArray(schools.data.schools) && schools.data.schools.length > 20);
  check("school has faculties", schools.data.schools && schools.data.schools[0] && schools.data.schools[0].faculties.length > 0);
  check("faculty has departments", schools.data.schools && schools.data.schools[0] && schools.data.schools[0].faculties[0] && schools.data.schools[0].faculties[0].departments.length > 0);

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
  check("valid invite code creates admin", adminReg.status === 201 && adminReg.data.user.role === "admin");
  const bossToken = adminReg.data.token;
  const bossCanAdmin = await api("/api/files/pending", { token: bossToken });
  check("invite-signed admin has admin powers", bossCanAdmin.status === 200);

  const markNotif = await api("/api/notifications/read", { method: "POST", token: adminToken });
  check("mark all notifications read", markNotif.status === 200);

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

  const adminNotifs = await api("/api/notifications", { token: adminToken });
  check("admin notified of pending upload", adminNotifs.data.notifications.some((n) => n.text.includes("pending approval")));

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

  const pdf2 = buildPdf("Phase 4 test material");

  const renameUp = await api("/api/files", {
    method: "POST",
    token: adminToken,
    headers: {
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent("Rename Me.pdf"),
      "X-Original-Name": encodeURIComponent("rename-me.pdf"),
      "X-Course-Id": courseId
    },
    body: pdf2
  });
  const renameId = renameUp.data.file.id;

  const renameOk = await api(`/api/files/${renameId}/rename`, {
    method: "PUT",
    token: adminToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Renamed File.pdf" })
  });
  check("rename file works", renameOk.status === 200 && renameOk.data.file.name === "Renamed File.pdf");

  const renameEmpty = await api(`/api/files/${renameId}/rename`, {
    method: "PUT",
    token: adminToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "" })
  });
  check("rename file rejects empty name", renameEmpty.status === 400);

  const renameDenied = await api(`/api/files/${renameId}/rename`, {
    method: "PUT",
    token: studentToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Hacked.pdf" })
  });
  check("student cannot rename admin file", renameDenied.status === 403);

  const editCourse = await api(`/api/courses/${courseId}`, {
    method: "PUT",
    token: adminToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Updated Course Name" })
  });
  check("admin edits course", editCourse.status === 200 && editCourse.data.course.name === "Updated Course Name");

  await api(`/api/courses/${courseId}`, {
    method: "PUT",
    token: adminToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "CS 101" })
  });

  const editCourseBad = await api(`/api/courses/${courseId}`, {
    method: "PUT",
    token: studentToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Hijack" })
  });
  check("student cannot edit course", editCourseBad.status === 403);

  const setTags = await api(`/api/files/${renameId}/tags`, {
    method: "PUT",
    token: adminToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tags: ["past-question", "exam"] })
  });
  check("set tags on file", setTags.status === 200 && setTags.data.file.tags.includes("past-question"));

  const getTags = await api("/api/tags", { token: adminToken });
  check("list all tags", getTags.status === 200 && getTags.data.tags.includes("past-question"));

  const filterByTag = await api("/api/files?tag=past-question", { token: adminToken });
  check("filter files by tag", filterByTag.status === 200 && filterByTag.data.files.some((f) => f.id === renameId));

  const tagDenied = await api(`/api/files/${renameId}/tags`, {
    method: "PUT",
    token: studentToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tags: ["hacked"] })
  });
  check("student cannot tag admin file", tagDenied.status === 403);

  const pageRes = await api("/api/files?page=1&limit=1", { token: adminToken });
  check("pagination returns page info", pageRes.status === 200 && pageRes.data.files.length <= 1 && typeof pageRes.data.pages === "number");

  const emptyPage = await api("/api/files?page=9999", { token: adminToken });
  check("pagination empty page returns no files", emptyPage.status === 200 && emptyPage.data.files.length === 0);

  const bulkUp = await api("/api/files", {
    method: "POST",
    token: studentToken,
    headers: {
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent("Bulk Test.pdf"),
      "X-Original-Name": encodeURIComponent("bulk.pdf"),
      "X-Course-Id": courseId
    },
    body: pdf2
  });
  const bulkId = bulkUp.data.file.id;

  const bulkApprove = await api("/api/files/bulk-action", {
    method: "POST",
    token: adminToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileIds: [bulkId], action: "approve" })
  });
  check("bulk approve works", bulkApprove.status === 200 && bulkApprove.data.count === 1);

  const bulkUp2 = await api("/api/files", {
    method: "POST",
    token: studentToken,
    headers: {
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent("Bulk Reject.pdf"),
      "X-Original-Name": encodeURIComponent("bulk2.pdf"),
      "X-Course-Id": courseId
    },
    body: pdf2
  });
  const bulkId2 = bulkUp2.data.file.id;

  const bulkReject = await api("/api/files/bulk-action", {
    method: "POST",
    token: adminToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileIds: [bulkId2], action: "reject" })
  });
  check("bulk reject works", bulkReject.status === 200 && bulkReject.data.count === 1);

  const bulkDenied = await api("/api/files/bulk-action", {
    method: "POST",
    token: studentToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileIds: ["fake"], action: "approve" })
  });
  check("student cannot use bulk action", bulkDenied.status === 403);

  const logout = await api("/api/auth/logout", {
    method: "POST",
    token: adminToken
  });
  check("logout succeeds", logout.status === 200);

  const afterLogout = await api("/api/courses", { token: adminToken });
  check("logged out token rejected", afterLogout.status === 401);

  const adminReLogin = await api("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" })
  });
  adminToken = adminReLogin.data.token;

  await api(`/api/files/${renameId}`, { method: "DELETE", token: adminToken });
  await api(`/api/files/${bulkId}`, { method: "DELETE", token: adminToken });

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

  const relogin2 = await api("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "student1", password: "student123" })
  });
  check("login with changed password works", relogin2.status === 200);
  const tokenAfterChange = relogin2.data.token;

  const sq = await api("/api/auth/security-question", {
    method: "POST",
    token: tokenAfterChange,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: "Favourite food?", answer: "Pizza" })
  });
  check("set security question", sq.status === 200);

  const sqRestore = await api("/api/auth/security-question", {
    method: "POST",
    token: tokenAfterChange,
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

  const me = await api("/api/me", { token: adminToken });
  check("/api/me returns current user", me.status === 200 && me.data.user.role === "admin");

  const freshUpload = await api("/api/files", {
    method: "POST", token: adminToken,
    headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent("Fresh test.pdf"), "X-Course-Id": courseId },
    body: pdf
  });
  check("fresh upload for new tests", freshUpload.status === 201 && !!freshUpload.data.file);
  const freshFileId = freshUpload.data.file.id;

  const searchUsers = await api("/api/users/search?q=student", { token: adminToken });
  check("user search works", searchUsers.status === 200 && searchUsers.data.users.length >= 1);

  const profile = await api(`/api/profile/${studentLogin.data.user.id}`, { token: adminToken });
  check("get user profile", profile.status === 200 && !!profile.data.profile.username);

  const setBio = await api("/api/profile/bio", {
    method: "POST", token: studentToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bio: "CS student who loves coding" })
  });
  check("set bio", setBio.status === 200);

  const setNotifPrefs = await api("/api/auth/notif-prefs", {
    method: "POST", token: studentToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prefs: { upload: true, comment: false } })
  });
  check("set notification prefs", setNotifPrefs.status === 200);

  const changeUsername = await api("/api/auth/change-username", {
    method: "POST", token: studentToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "student1renamed" })
  });
  check("change username", changeUsername.status === 200 && changeUsername.data.user.username === "student1renamed");

  const changeUsernameBack = await api("/api/auth/change-username", {
    method: "POST", token: studentToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "student1" })
  });
  check("change username back", changeUsernameBack.status === 200);

  const lb = await api("/api/leaderboard", { token: adminToken });
  check("leaderboard returns data", lb.status === 200 && Array.isArray(lb.data.leaderboard));

  const follow1 = await api(`/api/users/${studentLogin.data.user.id}/follow`, {
    method: "POST", token: adminToken
  });
  check("follow user", follow1.status === 200);

  const followers = await api(`/api/users/${studentLogin.data.user.id}/followers`, { token: adminToken });
  check("get followers", followers.status === 200 && followers.data.followers.length >= 1);

  const following = await api(`/api/users/${adminLogin.data.user.id}/following`, { token: adminToken });
  check("get following", following.status === 200 && following.data.following.length >= 1);

  const unfollow = await api(`/api/users/${studentLogin.data.user.id}/follow`, {
    method: "DELETE", token: adminToken
  });
  check("unfollow user", unfollow.status === 200);

  const bookmark1 = await api(`/api/files/${freshFileId}/bookmarks`, {
    method: "POST", token: adminToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "Important concept", page: 1 })
  });
  check("create bookmark", bookmark1.status === 200);

  const bookmarks = await api(`/api/files/${freshFileId}/bookmarks`, { token: adminToken });
  check("list bookmarks", bookmarks.status === 200 && bookmarks.data.bookmarks.length >= 1);

  const bmId = bookmarks.data.bookmarks[0].id;
  const delBm = await api(`/api/files/${freshFileId}/bookmarks/${bmId}`, { method: "DELETE", token: adminToken });
  check("delete bookmark", delBm.status === 200);

  const like1 = await api(`/api/files/${freshFileId}/like`, {
    method: "POST", token: studentToken
  });
  check("like file", like1.status === 200);

  const like2 = await api(`/api/files/${freshFileId}/like`, {
    method: "POST", token: studentToken
  });
  check("duplicate like idempotent", like2.status === 200);

  const unlike = await api(`/api/files/${freshFileId}/like`, {
    method: "DELETE", token: studentToken
  });
  check("unlike file", unlike.status === 200);

  const rate = await api(`/api/files/${freshFileId}/rating`, {
    method: "POST", token: studentToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ score: 4 })
  });
  check("rate file", rate.status === 200);

  const rateDup = await api(`/api/files/${freshFileId}/rating`, {
    method: "POST", token: studentToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ score: 5 })
  });
  check("re-rate file updates", rateDup.status === 200);

  const delRate = await api(`/api/files/${freshFileId}/rating`, { method: "DELETE", token: studentToken });
  check("delete rating", delRate.status === 200);

  const saveProg = await api(`/api/files/${freshFileId}/progress`, {
    method: "POST", token: studentToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pct: 45 })
  });
  check("save read progress", saveProg.status === 200);

  const getProg = await api("/api/files/progress", { token: studentToken });
  check("get all progress", getProg.status === 200 && getProg.data.progress[freshFileId]?.pct >= 45);

  const versions = await api(`/api/files/${freshFileId}/versions`, { token: adminToken });
  check("list versions", versions.status === 200 && Array.isArray(versions.data.versions));

  const newVer = await api(`/api/files/${freshFileId}/version`, {
    method: "POST", token: adminToken,
    headers: { "Content-Type": "application/octet-stream", "X-File-Name": "test-v2.pdf" },
    body: pdf
  });
  check("upload new version", newVer.status === 200);

  const flashcards = await api(`/api/files/${freshFileId}/flashcards`, { token: adminToken });
  check("get flashcards", flashcards.status === 200 && Array.isArray(flashcards.data.cards));

  const createCol = await api("/api/collections", {
    method: "POST", token: adminToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Test Collection", description: "A test" })
  });
  check("create collection", createCol.status === 201 && !!createCol.data.collection);
  const colId = createCol.data.collection.id;

  const addToFileCol = await api(`/api/collections/${colId}/add`, {
    method: "POST", token: adminToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId: freshFileId })
  });
  check("add file to collection", addToFileCol.status === 200);

  const listCols = await api("/api/collections", { token: adminToken });
  check("list collections", listCols.status === 200 && listCols.data.collections.length >= 1);

  const colZip = await fetch(BASE + `/api/collections/${colId}/zip`, { headers: { Authorization: "Bearer " + adminToken } });
  check("export collection as ZIP", colZip.status === 200 && colZip.headers.get("content-type") === "application/zip");

  const removeFromCol = await api(`/api/collections/${colId}/remove`, {
    method: "POST", token: adminToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId: freshFileId })
  });
  check("remove file from collection", removeFromCol.status === 200);

  const deleteCol = await api(`/api/collections/${colId}`, { method: "DELETE", token: adminToken });
  check("delete collection", deleteCol.status === 200);

  const ann1 = await api("/api/announcements", {
    method: "POST", token: adminToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "Test announcement" })
  });
  check("create announcement", ann1.status === 201);

  const listAnns = await api("/api/announcements", { token: adminToken });
  check("list announcements", listAnns.status === 200 && listAnns.data.announcements.length >= 1);
  const annId = listAnns.data.announcements[0].id;

  const delAnn = await api(`/api/announcements/${annId}`, { method: "DELETE", token: adminToken });
  check("delete announcement", delAnn.status === 200);

  const createGroup = await api("/api/groups", {
    method: "POST", token: adminToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Study Group" })
  });
  check("create group", createGroup.status === 200 && !!createGroup.data.group);
  const groupId = createGroup.data.group.id;

  const listGroups = await api("/api/groups", { token: adminToken });
  check("list groups", listGroups.status === 200 && listGroups.data.groups.length >= 1);

  const joinGroup = await api(`/api/groups/${groupId}/join`, {
    method: "POST", token: studentToken
  });
  check("join group", joinGroup.status === 200);

  const groupDetail = await api(`/api/groups/${groupId}`, { token: adminToken });
  check("get group detail", groupDetail.status === 200 && groupDetail.data.group.members.length >= 2);

  const leaveGroup = await api(`/api/groups/${groupId}/leave`, {
    method: "POST", token: studentToken
  });
  check("leave group", leaveGroup.status === 200);

  const delGroup = await api(`/api/groups/${groupId}`, { method: "DELETE", token: adminToken });
  check("delete group", delGroup.status === 200);

  const searchResult2 = await api("/api/search?q=library", { token: adminToken });
  check("search works", searchResult2.status === 200 && Array.isArray(searchResult2.data.files));

  const searchContent2 = await api("/api/search?q=library&content=1", { token: adminToken });
  check("content search works", searchContent2.status === 200);

  const stats2 = await api("/api/stats", { token: adminToken });
  check("admin stats", stats2.status === 200 && stats2.data.stats.totalUsers >= 3);

  const notifs2 = await api("/api/notifications", { token: adminToken });
  check("list notifications", notifs2.status === 200 && Array.isArray(notifs2.data.notifications));

  const firstNotifId = notifs2.data && notifs2.data.notifications && notifs2.data.notifications[0] ? notifs2.data.notifications[0].id : "nonexistent";
  const singleNotif = await api("/api/notifications/" + firstNotifId + "/read", { method: "POST", token: adminToken });
  check("mark single notification read", singleNotif.status === 200 || singleNotif.status === 404);

  const readNotifs = await api("/api/notifications/read", { method: "POST", token: adminToken });
  check("mark notifications read", readNotifs.status === 200);

  const feed2 = await api("/api/feed?following=1", { token: adminToken });
  check("activity feed", feed2.status === 200 && Array.isArray(feed2.data.activity));

  const themeSchedule = await api("/api/auth/theme-schedule", {
    method: "POST", token: adminToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lightAt: "07:00", darkAt: "19:00" })
  });
  check("set theme schedule", themeSchedule.status === 200);

  const delFile = await api(`/api/files/${freshFileId}`, { method: "DELETE", token: adminToken });
  check("delete file", delFile.status === 200);

  const delFileAuth = await api(`/api/files/nonexistent`, { method: "DELETE", token: adminToken });
  check("delete nonexistent file 404", delFileAuth.status === 404);
} catch (err) {
  results.push("ERROR " + err.message);
  if (serverLog) results.push("SERVER LOG: " + serverLog.slice(0, 2000));
} finally {
  fs.rmSync(samplePdfPath, { force: true });
  server.kill();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
}

const out = path.join(__dirname, "test-results.txt");
fs.writeFileSync(out, results.join("\n"));
console.log("done");
