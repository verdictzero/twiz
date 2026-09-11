/* A tiny store-only (uncompressed) ZIP writer.
 * Enough to hand back a folder of JSON, a PNG and the sprite files a layout
 * actually uses, without pulling in a compression library. */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS date/time pair used by the ZIP headers. */
function dosStamp(date) {
  const time = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() / 2) & 31);
  const day = (((date.getFullYear() - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31);
  return { time, day };
}

const encoder = new TextEncoder();

/**
 * @param {Array<{name: string, data: Uint8Array|string}>} files
 * @returns {Blob} an uncompressed .zip
 */
export function makeZip(files) {
  const stamp = dosStamp(new Date());
  const entries = files.map(f => {
    const data = typeof f.data === 'string' ? encoder.encode(f.data) : f.data;
    return { name: encoder.encode(f.name), data, crc: crc32(data) };
  });

  const localSize = entries.reduce((s, e) => s + 30 + e.name.length + e.data.length, 0);
  const centralSize = entries.reduce((s, e) => s + 46 + e.name.length, 0);
  const buf = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(buf.buffer);
  let at = 0;

  const u16 = v => { view.setUint16(at, v, true); at += 2; };
  const u32 = v => { view.setUint32(at, v >>> 0, true); at += 4; };
  const raw = bytes => { buf.set(bytes, at); at += bytes.length; };

  for (const e of entries) {
    e.offset = at;
    u32(0x04034b50);          // local file header
    u16(20);                  // version needed
    u16(0x0800);              // UTF-8 names
    u16(0);                   // stored, no compression
    u16(stamp.time);
    u16(stamp.day);
    u32(e.crc);
    u32(e.data.length);
    u32(e.data.length);
    u16(e.name.length);
    u16(0);
    raw(e.name);
    raw(e.data);
  }

  const centralStart = at;
  for (const e of entries) {
    u32(0x02014b50);          // central directory header
    u16(20);                  // version made by
    u16(20);                  // version needed
    u16(0x0800);
    u16(0);
    u16(stamp.time);
    u16(stamp.day);
    u32(e.crc);
    u32(e.data.length);
    u32(e.data.length);
    u16(e.name.length);
    u16(0); u16(0); u16(0); u16(0);
    u32(0);                   // external attributes
    u32(e.offset);
    raw(e.name);
  }

  const centralEnd = at;
  u32(0x06054b50);            // end of central directory
  u16(0); u16(0);
  u16(entries.length);
  u16(entries.length);
  u32(centralEnd - centralStart);
  u32(centralStart);
  u16(0);

  return new Blob([buf], { type: 'application/zip' });
}
