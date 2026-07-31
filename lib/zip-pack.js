/**
 * Minimal ZIP (store / no compression) — no native deps.
 * Used to ship PC-agent source to any Windows machine.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n >>> 0, 0);
  return b;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

/**
 * @param {{ name: string, data: Buffer }[]} files
 * @returns {Buffer}
 */
function createZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const f of files) {
    const name = String(f.name).replace(/\\/g, "/");
    const nameBuf = Buffer.from(name, "utf8");
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data || "");
    const crc = crc32(data);
    const size = data.length;

    const local = Buffer.concat([
      u32(0x04034b50), // local file header sig
      u16(20), // version needed
      u16(0), // flags
      u16(0), // method store
      u16(0), // time
      u16(0), // date
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBuf.length),
      u16(0), // extra len
      nameBuf,
      data,
    ]);
    locals.push(local);

    const central = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBuf.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBuf,
    ]);
    centrals.push(central);
    offset += local.length;
  }

  const centralDir = Buffer.concat(centrals);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ]);

  return Buffer.concat([...locals, centralDir, end]);
}

/**
 * Walk project files needed by PC agent.
 * @param {string} root project root
 * @returns {{ name: string, data: Buffer }[]}
 */
function collectAgentFiles(root) {
  const out = [];
  const addFile = (rel) => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return;
    out.push({
      name: rel.replace(/\\/g, "/"),
      data: fs.readFileSync(abs),
    });
  };
  const walk = (relDir) => {
    const abs = path.join(root, relDir);
    if (!fs.existsSync(abs)) return;
    for (const name of fs.readdirSync(abs)) {
      const rel = path.join(relDir, name);
      const full = path.join(root, rel);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(rel);
      else if (st.isFile()) addFile(rel);
    }
  };

  addFile("package.json");
  addFile("package-lock.json");
  walk("lib");
  addFile(path.join("scripts", "pc-agent.js"));

  // Real-ESRGAN (Windows): animevideov3 + photoreal x4plus (+ anime x4plus)
  const esrganFiles = [
    "tools/realesrgan/realesrgan-ncnn-vulkan.exe",
    "tools/realesrgan/vcomp140.dll",
    "tools/realesrgan/vcomp140d.dll",
    "tools/realesrgan/models/realesr-animevideov3-x2.bin",
    "tools/realesrgan/models/realesr-animevideov3-x2.param",
    "tools/realesrgan/models/realesr-animevideov3-x3.bin",
    "tools/realesrgan/models/realesr-animevideov3-x3.param",
    "tools/realesrgan/models/realesr-animevideov3-x4.bin",
    "tools/realesrgan/models/realesr-animevideov3-x4.param",
    "tools/realesrgan/models/realesrgan-x4plus.bin",
    "tools/realesrgan/models/realesrgan-x4plus.param",
    "tools/realesrgan/models/realesrgan-x4plus-anime.bin",
    "tools/realesrgan/models/realesrgan-x4plus-anime.param",
  ];
  for (const rel of esrganFiles) addFile(rel);

  return out;
}

function createAgentZip(root) {
  const files = collectAgentFiles(root);
  const names = new Set(files.map((f) => f.name));
  if (!names.has("package.json")) {
    throw new Error("zip-pack: missing package.json");
  }
  if (!names.has("scripts/pc-agent.js")) {
    throw new Error(
      "zip-pack: missing scripts/pc-agent.js (Docker must COPY scripts/pc-agent.js)"
    );
  }
  if (![...names].some((n) => n.startsWith("lib/"))) {
    throw new Error("zip-pack: missing lib/ files");
  }
  return createZip(files);
}

/** Optional gzip of a tar-like payload is heavy; zip is enough for Windows Expand-Archive. */
function createAgentZipGz(root) {
  return zlib.gzipSync(createAgentZip(root), { level: 6 });
}

module.exports = {
  createZip,
  collectAgentFiles,
  createAgentZip,
  createAgentZipGz,
};
