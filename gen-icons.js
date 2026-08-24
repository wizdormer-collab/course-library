const fs = require("fs"), zlib = require("zlib"), path = require("path");

function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) {
    c ^= b[i];
    for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chk(t, d) {
  const l = Buffer.alloc(4);
  l.writeUInt32BE(d.length);
  const b = Buffer.concat([Buffer.from(t), d]), cr = Buffer.alloc(4);
  cr.writeUInt32BE(crc32(b));
  return Buffer.concat([l, b, cr]);
}

function mkPng(w, h, px) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  const rb = 1 + w * 4, raw = Buffer.alloc(h * rb);
  for (let y = 0; y < h; y++) {
    raw[y * rb] = 0;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4, d = y * rb + 1 + x * 4;
      raw[d] = px[s]; raw[d + 1] = px[s + 1]; raw[d + 2] = px[s + 2]; raw[d + 3] = px[s + 3];
    }
  }
  return Buffer.concat([sig, chk("IHDR", ih), chk("IDAT", zlib.deflateSync(raw, { level: 9 })), chk("IEND", Buffer.alloc(0))]);
}

function dst(a, b, c, d) { return Math.sqrt((a - c) ** 2 + (b - d) ** 2); }
function lr(a, b, t) { return Math.round(a + (b - a) * t); }
function lc(a, b, t) { return [lr(a[0], b[0], t), lr(a[1], b[1], t), lr(a[2], b[2], t)]; }

function inRR(px, py, x, y, w, h, r) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const cs = [[x + r, y + r], [x + w - r, y + r], [x + r, y + h - r], [x + w - r, y + h - r]];
  for (const [cx, cy] of cs) {
    if (dst(px, py, cx, cy) > r && (px < x + r || px > x + w - r) && (py < y + r || py > y + h - r)) return false;
  }
  return true;
}

function pip(px, py, pts) {
  let ins = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}

function bgGrad(x, y, w, h, b1, b2, b3) {
  let t = (x / w + y / h) / 2;
  return t < 0.5 ? lc(b1, b2, t / 0.5) : lc(b2, b3, (t - 0.5) / 0.5);
}

function gen(sz) {
  const w = sz, h = sz, px = Buffer.alloc(w * h * 4), cr = Math.round(sz * 0.1875), s = sz / 512;
  const b1 = [79, 70, 229], b2 = [109, 40, 217], b3 = [30, 58, 138];
  const cx = 256 * s, cy = 240 * s;
  const ct = [[0, -75 * s], [120 * s, -25 * s], [0, 5 * s], [-120 * s, -25 * s]].map(([x, y]) => [cx + x, cy + y]);
  const cb = [[-50 * s, -22 * s], [50 * s, -22 * s], [50 * s, -4 * s], [-50 * s, -4 * s]].map(([x, y]) => [cx + x, cy + y]);
  const bl = [[-8 * s, 20 * s], [-65 * s, 25 * s], [-70 * s, 35 * s], [-70 * s, 80 * s], [-8 * s, 60 * s]].map(([x, y]) => [cx + x, cy + y]);
  const br = [[8 * s, 20 * s], [65 * s, 25 * s], [70 * s, 35 * s], [70 * s, 80 * s], [8 * s, 60 * s]].map(([x, y]) => [cx + x, cy + y]);
  const te = [cx + 35 * s, cy + 33 * s], tr = 5 * s;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inside = inRR(x, y, 0, 0, w, h, cr);
      let c = bgGrad(x, y, w, h, b1, b2, b3);
      if (!inside) {
        px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
        continue;
      }
      const sh = Math.max(0, 1 - dst(x, y, w * 0.35, h * 0.3) / (w * 0.6)) * 0.12;
      c[0] = Math.min(255, c[0] + sh * 255);
      c[1] = Math.min(255, c[1] + sh * 255);
      c[2] = Math.min(255, c[2] + sh * 255);
      if (pip(x, y, ct)) {
        const ry = (y - (cy - 75 * s)) / (10 * s);
        c = ry < 0.5 ? lc([224, 212, 255], [255, 255, 255], ry * 2) : [255, 255, 255];
      } else if (pip(x, y, cb)) {
        c = lc(lc(b2, b3, 0.5), [255, 255, 255], 0.85);
      } else {
        const x0 = cx, y0 = cy - 5 * s, x1 = cx + 35 * s, y1 = cy + 30 * s;
        const ld = Math.abs((y1 - y0) * x - (x1 - x0) * y + x1 * y0 - y1 * x0) / dst(x0, y0, x1, y1);
        if (ld < 1.5 * s && x >= x0 && x <= x1 && y >= y0 && y <= y1) c = [255, 255, 255];
        else if (dst(x, y, te[0], te[1]) <= tr) c = [255, 255, 255];
        else if (pip(x, y, bl) || pip(x, y, br)) {
          c = lc([255, 255, 255], [230, 220, 255], 0.1);
        } else {
          if (Math.abs(x - cx) < 1 * s && y >= cy + 18 * s && y <= cy + 62 * s) c = lc(c, [255, 255, 255], 0.5);
        }
      }
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
    }
  }
  return mkPng(w, h, px);
}

const dir = path.join(__dirname, "public");
const b192 = gen(192);
fs.writeFileSync(path.join(dir, "icon-192.png"), b192);
console.log("icon-192.png: " + b192.length + " bytes");
const b512 = gen(512);
fs.writeFileSync(path.join(dir, "icon-512.png"), b512);
console.log("icon-512.png: " + b512.length + " bytes");
