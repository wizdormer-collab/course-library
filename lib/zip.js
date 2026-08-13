import zlib from "zlib";

export function buildZip(entries) {
  const files = entries.filter((e) => e.buffer && e.buffer.length > 0);
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const { name, buffer } of files) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = zlib.crc32(buffer) >>> 0;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0x0021, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(buffer.length, 18);
    lh.writeUInt32LE(buffer.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    chunks.push(lh, nameBuf, buffer);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0x0021, 12);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(buffer.length, 20);
    ch.writeUInt32LE(buffer.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);
    offset += 30 + nameBuf.length + buffer.length;
  }

  const cdOffset = offset;
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(cdOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, cd, end]);
}
