import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data = Buffer.alloc(0)): Buffer {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

type RGB = readonly [number, number, number];

function background(x: number, y: number, size: number): RGB {
  const nx = x / size;
  const ny = y / size;
  const glow = Math.max(0, 1 - Math.hypot(nx - 0.62, ny - 0.25) / 0.85);
  return [
    Math.round(15 + glow * 20),
    Math.round(18 + glow * 28),
    Math.round(38 + glow * 67),
  ];
}

function sample(x: number, y: number, size: number): RGB {
  const bg = background(x, y, size);
  const cx = size / 2;
  const cy = size / 2;
  const dx = x - cx;
  const dy = y - cy;
  const distance = Math.hypot(dx, dy);
  const radius = size * 0.31; // safely inside Android's maskable icon safe zone
  const outerStroke = size * 0.026;
  const centerBand = size * 0.025;
  const buttonRadius = size * 0.086;
  const buttonInnerRadius = size * 0.047;

  if (distance > radius) return bg;
  if (distance > radius - outerStroke) return [10, 11, 18];
  if (distance < buttonInnerRadius) return [244, 246, 255];
  if (distance < buttonRadius || Math.abs(dy) < centerBand) return [10, 11, 18];

  if (dy < 0) {
    const shine = Math.max(0, 1 - Math.hypot(dx + size * 0.09, dy + size * 0.1) / (size * 0.2));
    return [Math.round(227 + shine * 20), Math.round(36 + shine * 26), Math.round(29 + shine * 24)];
  }
  const shade = Math.max(0, Math.min(1, distance / radius));
  return [Math.round(250 - shade * 22), Math.round(251 - shade * 22), Math.round(255 - shade * 14)];
}

function createIcon(size: number): Buffer {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  const samples = 3;

  for (let y = 0; y < size; y++) {
    const row = y * stride;
    raw[row] = 0; // PNG filter: None
    for (let x = 0; x < size; x++) {
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const color = sample(x + (sx + 0.5) / samples, y + (sy + 0.5) / samples, size);
          red += color[0];
          green += color[1];
          blue += color[2];
        }
      }
      const count = samples * samples;
      const offset = row + 1 + x * 4;
      raw[offset] = Math.round(red / count);
      raw[offset + 1] = Math.round(green / count);
      raw[offset + 2] = Math.round(blue / count);
      raw[offset + 3] = 255;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND'),
  ]);
}

for (const size of [180, 192, 512]) {
  writeFileSync(path.join(publicDir, `app-icon-${size}.png`), createIcon(size));
}
writeFileSync(path.join(publicDir, 'app-icon-maskable-512.png'), createIcon(512));

console.log('Generated app icons: 180, 192, 512, and maskable 512.');
