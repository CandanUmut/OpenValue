/**
 * Guard the things that silently break a PWA on GitHub Pages.
 *
 * Every failure here has actually shipped in someone's project before: a
 * root-absolute asset URL that 404s under /<repo>/, a manifest whose scope does
 * not cover start_url so the install prompt never appears, a missing SPA
 * fallback so a refresh on a deep link 404s, or a service worker precaching a
 * path that does not exist.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

const DIST = 'dist';
const BASE = process.env.VITE_BASE ?? '/';
const problems = [];

const exists = async (p) => fs.access(path.join(DIST, p)).then(() => true, () => false);

for (const file of [
  'index.html', '404.html', 'sw.js', 'manifest.webmanifest', '.nojekyll',
  'apple-touch-icon.png', 'favicon.svg', 'favicon.ico',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png',
  'fonts/inter-latin.woff2', 'data/latest.json',
]) {
  if (!await exists(file)) problems.push(`missing ${file}`);
}

const html = await fs.readFile(path.join(DIST, 'index.html'), 'utf8');

// Under a project-page base, any src/href starting with "/" but not with the
// base resolves to the domain root and 404s.
for (const [, url] of html.matchAll(/(?:src|href)="(\/[^"]*)"/g)) {
  if (!url.startsWith(BASE)) problems.push(`index.html references ${url}, outside base ${BASE}`);
}

// A "./" URL resolves against the CURRENT page, so it works at the root and
// 404s on every deep link (/a/fx-eur asks for /a/fonts/...). Vite rewrites
// root-absolute URLs to include the base; it leaves relative ones alone.
for (const [, url] of html.matchAll(/(?:src|href)="(\.\/[^"]*)"/g)) {
  problems.push(`index.html uses relative ${url}, which breaks on deep links — use a root-absolute path`);
}

const manifest = JSON.parse(await fs.readFile(path.join(DIST, 'manifest.webmanifest'), 'utf8'));
// A start_url outside scope means the browser refuses to treat the app as
// installable, with no visible error anywhere.
const scope = new URL(manifest.scope, `https://example.com${BASE}`);
const start = new URL(manifest.start_url, `https://example.com${BASE}`);
if (!start.pathname.startsWith(scope.pathname)) {
  problems.push(`manifest start_url ${start.pathname} is outside scope ${scope.pathname}`);
}
for (const icon of manifest.icons) {
  if (!await exists(icon.src)) problems.push(`manifest icon ${icon.src} not in dist`);
}
if (!manifest.icons.some((i) => i.purpose === 'maskable')) {
  problems.push('manifest has no maskable icon');
}

// Every precached URL must resolve, or install() silently drops it and the app
// is only partly available offline.
const sw = await fs.readFile(path.join(DIST, 'sw.js'), 'utf8');
const shell = JSON.parse(sw.match(/const SHELL = (\[[\s\S]*?\]);/)[1]);
for (const url of shell) {
  if (!url.startsWith(BASE)) problems.push(`sw precache ${url} is outside base ${BASE}`);
  else if (!await exists(url.slice(BASE.length))) problems.push(`sw precaches missing ${url}`);
}
if (!sw.includes(`const BASE = '${BASE}'`)) problems.push('sw.js BASE does not match build base');

if (problems.length) {
  console.error(`Build is not deployable (base ${BASE}):`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}

console.log(`Build verified for base ${BASE}: ${shell.length} shell files, ${manifest.icons.length} icons.`);
