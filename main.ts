import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Meme Sprint 3: AI Agent Goes Rogue — writes the shipped meme image to
// /output/entry.png.
//
// The gate accepts a whole PNG or JPEG of at most 1 MiB (1,048,576 bytes)
// and 1024 by 1024 pixels. The shipped file (meme.jpg) is a 1024x1024
// JPEG, so this program copies it to the output path and verifies the
// gate limits itself before finishing. Node 22 stdlib only, no network.
//
// Env vars (with defaults matching the make.fun program runner):
//   MAKEFUN_OUTPUT_DIR - destination directory (default '/output')

const outputDir: string = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const here: string = dirname(fileURLToPath(import.meta.url));
const src: string = join(here, 'meme.jpg');
const dest: string = join(outputDir, 'entry.png');

const MAX_BYTES = 1048576;
const MAX_DIM = 1024;

// Parse width/height from a JPEG's first SOF segment (SOF0/SOF1/SOF2/...),
// reading the marker stream with the stdlib only. Throws on anything
// that is not a well-formed JPEG with a readable frame header.
function jpegDimensions(buf: Buffer): { width: number; height: number } {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    throw new Error('not a JPEG (missing SOI marker 0xFFD8)');
  }
  let off = 2;
  while (off + 9 < buf.length) {
    if (buf[off] !== 0xff) {
      throw new Error('corrupt JPEG marker stream');
    }
    const marker: number = buf[off + 1];
    if (marker === 0xd9 || marker === 0xda) {
      break; // EOI / SOS: no SOF segment found before the scan data
    }
    const len: number = buf.readUInt16BE(off + 2);
    if (len < 2 || off + 2 + len > buf.length) {
      throw new Error('corrupt JPEG segment length');
    }
    const isSof: boolean =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 && // DHT
      marker !== 0xc8 && // JPG
      marker !== 0xcc; // DAC
    if (isSof) {
      // SOF segment: precision (1 byte), height (2), width (2).
      const height: number = buf.readUInt16BE(off + 5);
      const width: number = buf.readUInt16BE(off + 7);
      return { width, height };
    }
    off += 2 + len;
  }
  throw new Error('no JPEG SOF segment found');
}

try {
  const data: Buffer = await readFile(src);
  if (data.length > MAX_BYTES) {
    throw new Error(`meme.jpg is ${data.length} bytes, over the 1 MiB gate cap`);
  }
  const { width, height } = jpegDimensions(data);
  if (width > MAX_DIM || height > MAX_DIM) {
    throw new Error(`meme is ${width}x${height}, over the 1024x1024 gate cap`);
  }
  await mkdir(outputDir, { recursive: true });
  await copyFile(src, dest);
  const out = await stat(dest);
  if (out.size !== data.length) {
    throw new Error(`copy size mismatch: wrote ${out.size} bytes, expected ${data.length}`);
  }
  // Guard: read the written file back and confirm it is byte-for-byte
  // the validated image, so a truncated or partial copy cannot pass.
  const written: Buffer = await readFile(dest);
  if (!written.equals(data)) {
    throw new Error('written file differs from the validated source image');
  }
  console.log(`Wrote ${dest} (${width}x${height} JPEG, ${data.length} bytes)`);
} catch (err) {
  const message: string = err instanceof Error ? err.message : String(err);
  console.error(`Failed to write entry image to ${dest}: ${message}`);
  process.exit(1);
}
