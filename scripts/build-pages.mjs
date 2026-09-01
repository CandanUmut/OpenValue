/**
 * Post-build: copy the data snapshot in, generate the service worker with a real
 * precache list, and add the GitHub Pages SPA fallback.
 *
 *   node scripts/build-pages.mjs
 */
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const DIST = 'dist';
const BASE = process.env.VITE_BASE ?? '/';

// --- data snapshot --------------------------------------------------------
await fs.cp('data', path.join(DIST, 'data'), { recursive: true });
console.log('copied data/ into dist/');

// --- SPA fallback ---------------------------------------------------------
// GitHub Pages has no rewrite rules; it serves 404.html for any unknown path.
// Making that a copy of index.html turns it into the SPA fallback, so a refresh
// on /a/fx-eur loads the app instead of a 404 page.
await fs.copyFile(path.join(DIST, 'index.html'), path.join(DIST, '404.html'));
console.log('wrote 404.html (SPA fallback)');

// Jekyll would otherwise skip files and folders beginning with an underscore.
await fs.writeFile(path.join(DIST, '.nojekyll'), '');

// --- service worker -------------------------------------------------------
const files = await walk(DIST);

// Precache the shell only. The data snapshot is 5MB and belongs to the
// stale-while-revalidate path, not to install.
const shell = files
  .filter((f) => !f.startsWith('data/') && f !== 'sw.js' && f !== '404.html')
  .filter((f) => /\.(html|js|css|woff2|png|svg|ico|webmanifest)$/.test(f))
  .map((f) => BASE + f);

const version = createHash('sha256')
  .update(shell.sort().join('\n'))
  // Hashing the precache list means the SW version changes exactly when the
  // shell does, so a data-only deploy does not prompt everyone to reload.
  .digest('hex')
  .slice(0, 12);

const template = await fs.readFile('scripts/sw-template.js', 'utf8');
await fs.writeFile(
  path.join(DIST, 'sw.js'),
  template
    .replace('__VERSION__', version)
    .replace('__BASE__', BASE)
    .replace('__SHELL__', JSON.stringify(shell, null, 2)),
);

console.log(`wrote sw.js — version ${version}, ${shell.length} shell files precached`);

async function walk(dir, prefix = '') {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...await walk(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}
