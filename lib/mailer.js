import net from "net";
import tls from "tls";

const CFG = {
  host: process.env.SMTP_HOST || "",
  port: parseInt(process.env.SMTP_PORT || "587", 10),
  user: process.env.SMTP_USER || "",
  pass: process.env.SMTP_PASS || "",
  from: process.env.SMTP_FROM || process.env.SMTP_USER || "",
  secure: process.env.SMTP_SECURE === "1"
};

export function smtpConfigured() {
  return !!(CFG.host && CFG.user && CFG.pass);
}

function connect() {
  const secure = CFG.secure || CFG.port === 465;
  return new Promise((resolve, reject) => {
    const sock = secure
      ? tls.connect({ host: CFG.host, port: CFG.port, rejectUnauthorized: false })
      : net.connect(CFG.port, CFG.host);
    sock.setTimeout(20000);
    sock.once("connect", () => resolve(sock));
    sock.once("error", reject);
    sock.once("timeout", () => {
      sock.destroy();
      reject(new Error("SMTP connection timeout"));
    });
  });
}

function readResponse(socket) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (chunk) => {
      buf += chunk.toString("utf8");
      const m = buf.match(/(?:^|\r\n)(\d{3}) /);
      if (!m) return;
      cleanup();
      resolve({ code: parseInt(m[1], 10), text: buf });
    };
    const onError = (e) => {
      cleanup();
      reject(e);
    };
    const onEnd = () => {
      cleanup();
      reject(new Error("SMTP connection closed by server"));
    };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("end", onEnd);
    };
    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("end", onEnd);
  });
}

function cmd(socket, line) {
  socket.write(line + "\r\n");
  return readResponse(socket);
}

function upgradeTls(socket) {
  return new Promise((resolve, reject) => {
    const tlsSock = tls.connect({ socket, rejectUnauthorized: false });
    tlsSock.once("secureConnect", () => resolve(tlsSock));
    tlsSock.once("error", reject);
  });
}

function expect(r, code) {
  if (r.code !== code) throw new Error("SMTP error " + r.code + ": " + r.text.replace(/\r?\n/g, " ").trim());
}

export async function sendMail({ to, subject, text }) {
  let socket = await connect();
  try {
    let r = await readResponse(socket);
    expect(r, 220);
    r = await cmd(socket, "EHLO " + (CFG.host || "localhost"));
    expect(r, 250);
    let secure = CFG.secure || CFG.port === 465;
    if (!secure && /STARTTLS/i.test(r.text)) {
      r = await cmd(socket, "STARTTLS");
      if (r.code === 220) {
        const upgraded = await upgradeTls(socket);
        socket = upgraded;
        r = await cmd(socket, "EHLO " + (CFG.host || "localhost"));
        expect(r, 250);
      }
    }
    r = await cmd(socket, "AUTH LOGIN");
    expect(r, 334);
    r = await cmd(socket, Buffer.from(CFG.user).toString("base64"));
    expect(r, 334);
    r = await cmd(socket, Buffer.from(CFG.pass).toString("base64"));
    expect(r, 235);
    r = await cmd(socket, "MAIL FROM:<" + CFG.from + ">");
    expect(r, 250);
    r = await cmd(socket, "RCPT TO:<" + to + ">");
    expect(r, 250);
    r = await cmd(socket, "DATA");
    expect(r, 354);
    socket.write(
      "From: " + CFG.from +
      "\r\nTo: " + to +
      "\r\nSubject: " + subject +
      "\r\nMIME-Version: 1.0" +
      "\r\nContent-Type: text/plain; charset=utf-8" +
      "\r\n\r\n" + text + "\r\n.\r\n"
    );
    r = await readResponse(socket);
    expect(r, 250);
    await cmd(socket, "QUIT").catch(() => {});
  } finally {
    socket.destroy();
  }
}
