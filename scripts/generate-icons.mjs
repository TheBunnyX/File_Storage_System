import { readFile, writeFile, mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const source = await readFile(new URL('../app/icon.svg', import.meta.url));
const destination = new URL('../public/icons/', import.meta.url);
await mkdir(destination, { recursive: true });
for (const size of [192, 512]) {
  await sharp(source).resize(size, size).png().toFile(fileURLToPath(new URL(`nexafile-${size}.png`, destination)));
}
await writeFile(new URL('../app/apple-icon.png', import.meta.url), await sharp(source).resize(180, 180).flatten({ background: '#2279ff' }).png().toBuffer());

// ICO supports PNG-compressed frames; multiple sizes keep the browser tab crisp.
const frames = await Promise.all([16, 32, 48].map(async size => ({ size, data: await sharp(source).resize(size, size).png().toBuffer() })));
const header = Buffer.alloc(6 + frames.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(frames.length, 4);
let offset = header.length;
frames.forEach(({ size, data }, index) => {
  const entry = 6 + index * 16;
  header[entry] = size; header[entry + 1] = size;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(data.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += data.length;
});
await writeFile(new URL('../app/favicon.ico', import.meta.url), Buffer.concat([header, ...frames.map(frame => frame.data)]));
console.log('Generated NexaFile favicon, Apple touch icon, and 192/512px app icons.');
