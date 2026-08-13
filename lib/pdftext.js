import zlib from "zlib";

const MAX_PARSE_BYTES = 15 * 1024 * 1024;

function parseObjects(buf) {
  const str = buf.toString("latin1");
  const objs = [];
  const re = /(\d+)\s+0\s+obj\b/g;
  let m;
  while ((m = re.exec(str))) {
    const endIdx = str.indexOf("endobj", m.index + m[0].length);
    if (endIdx === -1) break;
    objs.push({ num: m[1], body: str.slice(m.index, endIdx) });
    re.lastIndex = endIdx;
  }
  return objs;
}

function extractStream(o) {
  const idx = o.body.indexOf("stream");
  if (idx === -1) return null;
  let start = o.body.indexOf("\n", idx);
  if (start === -1) start = o.body.indexOf("\r", idx);
  if (start === -1) return null;
  start += 1;
  const endIdx = o.body.indexOf("endstream", start);
  if (endIdx === -1) return null;
  return Buffer.from(o.body.slice(start, endIdx), "latin1");
}

function parseCMap(s) {
  const map = new Map();
  const charRe = /beginbfchar([\s\S]*?)endbfchar/g;
  let m;
  while ((m = charRe.exec(s))) {
    const triples = m[1].match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g);
    for (const t of triples || []) {
      const [, src, dst] = t.match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/);
      map.set(parseInt(src, 16), Buffer.from(dst, "hex").toString("utf8"));
    }
  }
  const rangeRe = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((m = rangeRe.exec(s))) {
    const parts = m[1].match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g);
    for (const p of parts || []) {
      const [, loS, hiS, dstS] = p.match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/);
      const lo = parseInt(loS, 16);
      const hi = parseInt(hiS, 16);
      let c = parseInt(dstS, 16);
      for (let i = lo; i <= hi; i++) map.set(i, String.fromCodePoint(c++));
    }
  }
  return map;
}

function mapToUnicode(bytes, map) {
  if (map.size === 0) return Buffer.from(bytes).toString("latin1");
  let s = "";
  for (const b of bytes) s += map.get(b) ?? String.fromCharCode(b);
  return s;
}

function decodeLiteral(str, map) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === "\\") {
      const nxt = str[++i];
      if (nxt === "n") bytes.push(10);
      else if (nxt === "r") bytes.push(13);
      else if (nxt === "t") bytes.push(9);
      else if (nxt === "b") bytes.push(8);
      else if (nxt === "f") bytes.push(12);
      else if (nxt >= "0" && nxt <= "7") {
        let oct = nxt;
        for (let k = 0; k < 2; k++) {
          const c = str[i + 1];
          if (c >= "0" && c <= "7") {
            oct += c;
            i++;
          } else break;
        }
        bytes.push(parseInt(oct, 8));
      } else bytes.push(nxt.charCodeAt(0));
    } else bytes.push(ch.charCodeAt(0));
  }
  return mapToUnicode(bytes, map);
}

function decodeHex(h, map) {
  const s = h.replace(/\s+/g, "");
  const out = [];
  for (let i = 0; i < s.length; ) {
    if (i + 3 < s.length && map.has(parseInt(s.slice(i, i + 4), 16))) {
      out.push(parseInt(s.slice(i, i + 4), 16));
      i += 4;
    } else if (i + 1 < s.length) {
      out.push(parseInt(s.slice(i, i + 2), 16));
      i += 2;
    } else {
      out.push(parseInt(s[i] + "0", 16));
      i += 1;
    }
  }
  return mapToUnicode(out, map);
}

function extractTextOps(data, map) {
  const s = data.toString("latin1");
  const chunks = [];
  const strRe = /\((?:\\.|[^()\\])*\)/g;
  let m;
  while ((m = strRe.exec(s))) chunks.push(decodeLiteral(m[0].slice(1, -1), map));
  const hexRe = /<[0-9A-Fa-f]{2,}>/g;
  while ((m = hexRe.exec(s))) chunks.push(decodeHex(m[0].slice(1, -1), map));
  return chunks.join("");
}

export function extractPdfText(buffer) {
  try {
    const slice = buffer.length > MAX_PARSE_BYTES ? buffer.subarray(0, MAX_PARSE_BYTES) : buffer;
    const objs = parseObjects(slice);
    const tocRefs = new Set();
    for (const o of objs) {
      const m = o.body.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/);
      if (m) tocRefs.add(m[1]);
    }
    let map = new Map();
    for (const ref of tocRefs) {
      const cmap = objs.find((o) => o.num === ref);
      if (cmap) {
        const cm = extractStream(cmap);
        if (cm) {
          let cmData = cm;
          if (cmap.body.includes("/FlateDecode")) {
            try {
              cmData = zlib.inflateSync(cm);
            } catch {
              try {
                cmData = zlib.inflateRawSync(cm);
              } catch {}
            }
          }
          map = new Map([...map, ...parseCMap(cmData.toString("latin1"))]);
        }
      }
    }
    const out = [];
    for (const o of objs) {
      const raw = extractStream(o);
      if (!raw) continue;
      let data = raw;
      if (o.body.includes("/FlateDecode")) {
        try {
          data = zlib.inflateSync(raw);
        } catch {
          try {
            data = zlib.inflateRawSync(raw);
          } catch {
            continue;
          }
        }
      }
      const s = data.toString("latin1");
      if (!/\)\s*Tj|>\s*Tj|\bTJ|\s'|\s"/.test(s)) continue;
      const txt = extractTextOps(s, map);
      if (txt.trim()) out.push(txt);
    }
    return out.join("\n").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
  } catch {
    return "";
  }
}
