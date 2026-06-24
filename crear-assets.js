/**
 * CAS Express — Genera assets PNG válidos
 * Ejecutar con: node crear-assets.js
 */
const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

// CRC32 para PNG válido
function crc32(buf) {
  const table = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function makePNG(w, h, r, g, b) {
  const sig  = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w,0); ihdr.writeUInt32BE(h,4);
  ihdr[8]=8; ihdr[9]=2; // 8-bit depth, RGB color type
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const o = y * (1 + w * 3);
    raw[o] = 0; // filter: None
    for (let x = 0; x < w; x++) {
      raw[o + 1 + x*3] = r;
      raw[o + 1 + x*3 + 1] = g;
      raw[o + 1 + x*3 + 2] = b;
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const assetsDir = path.join(__dirname, 'assets');
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir);

// CAS Express azul #0a2463 = R:10, G:36, B:99
const archivos = [
  { nombre: 'favicon.png',       w: 32,   h: 32   },
  { nombre: 'icon.png',          w: 1024, h: 1024 },
  { nombre: 'splash.png',        w: 1024, h: 1024 },
  { nombre: 'adaptive-icon.png', w: 1024, h: 1024 },
];

archivos.forEach(({ nombre, w, h }) => {
  const ruta = path.join(assetsDir, nombre);
  fs.writeFileSync(ruta, makePNG(w, h, 10, 36, 99));
  console.log(`✅ ${nombre} (${w}×${h})`);
});

console.log('\n🎉 Assets creados correctamente.');
