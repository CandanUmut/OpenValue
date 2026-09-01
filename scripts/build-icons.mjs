/**
 * Rasterise the chosen mark into every icon the PWA needs.
 *
 *   node scripts/build-icons.mjs
 *
 * Outputs are committed, so nothing at build or deploy time depends on sharp.
 * To change the mark, point CONCEPT at a different file in design/icons and
 * re-run. Every size derives from that one SVG — there is no second source of
 * truth to drift.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const CONCEPT = 'design/icons/concept-a-steps.svg';
const FIELD = '#0B0D10';
const MARK = '#19C2A8';
const OUT = 'public';

const markPath = 'M120 352 H216 V256 H312 V160 H392';

/** The mark alone, scaled and centred on a solid field. */
function svg({ size = 512, scale = 1, field = FIELD, rounded = true }) {
  const radius = rounded ? 112 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
  <rect width="512" height="512" rx="${radius}" fill="${field}"/>
  <g transform="translate(256,256) scale(${scale}) translate(-256,-256)">
    <path d="${markPath}" fill="none" stroke="${MARK}" stroke-width="44"
          stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;
}

const TARGETS = [
  // purpose:any — keep the alpha so the rounded corners stay transparent and the
  // launcher's own background shows through.
  { file: 'icons/icon-192.png', size: 192, opts: {} },
  { file: 'icons/icon-512.png', size: 512, opts: {} },
  // Android crops maskable icons to a circle or squircle. Anything outside the
  // inner 80% is clipped, so the mark goes to 60% on a full-bleed square field.
  { file: 'icons/maskable-512.png', size: 512, opts: { scale: 0.6, rounded: false }, opaque: true },
  // iOS applies its own mask and renders transparency as BLACK, so this one is
  // square, opaque, and has no rounded corners baked in.
  { file: 'apple-touch-icon.png', size: 180, opts: { rounded: false }, opaque: true },
  { file: 'icons/favicon-32.png', size: 32, opts: {} },
];

await fs.mkdir(path.join(OUT, 'icons'), { recursive: true });

for (const { file, size, opts, opaque } of TARGETS) {
  let pipeline = sharp(Buffer.from(svg({ size, ...opts })), { density: 384 })
    .resize(size, size);
  // Only the icons that MUST be opaque get flattened. Flattening the rounded
  // ones would fill their transparent corners with solid black.
  if (opaque) pipeline = pipeline.flatten({ background: FIELD });
  await pipeline.png({ compressionLevel: 9 }).toFile(path.join(OUT, file));

  const { hasAlpha, width, height } = await sharp(path.join(OUT, file)).metadata();
  if (opaque && hasAlpha) throw new Error(`${file} must not carry an alpha channel`);
  console.log(`  ${file} — ${width}x${height}, alpha: ${hasAlpha}`);
}

// favicon.svg — scales to any tab size and stays sharp on hidpi.
await fs.writeFile(path.join(OUT, 'favicon.svg'), svg({ size: 512 }) + '\n');
console.log('  favicon.svg');

// favicon.ico — 32x32. Some crawlers and older browsers still ask for /favicon.ico
// by name and ignore the <link>, so it has to exist as a real file.
await sharp(Buffer.from(svg({ size: 32 })), { density: 384 })
  .resize(32, 32)
  .toFormat('png')
  .toFile(path.join(OUT, 'favicon.ico'));
console.log('  favicon.ico (PNG-encoded, which every browser since IE11 accepts)');
