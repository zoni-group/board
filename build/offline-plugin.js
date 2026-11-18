import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/** Public files the app never requests while running. */
const EXCLUDED_PUBLIC = [/^CNAME$/, /(^|\/)[^/]*-og-[^/]*\.(jpe?g|png)$/i];

/**
 * Build the sorted, de-duplicated list of root-relative URLs to precache.
 * @param {string[]} bundleFiles File names emitted by the build (JS, CSS, assets, index.html).
 * @param {string[]} publicFiles File paths copied from `public/`, relative to that folder.
 * @returns {string[]}
 */
export function buildPrecacheList(bundleFiles, publicFiles) {
  const files = [
    ...bundleFiles.filter((file) => !file.endsWith('.map') && file !== 'sw.js'),
    ...publicFiles.filter((file) => !EXCLUDED_PUBLIC.some((pattern) => pattern.test(file))),
  ];
  return [
    ...new Set(files.map((file) => '/' + file.split(sep).join('/').replace(/^\/+/, ''))),
  ].sort();
}

function listFiles(folder) {
  let entries;
  try {
    entries = readdirSync(folder, { recursive: true, withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && !entry.name.includes(':'))
    .map((entry) => relative(folder, join(entry.parentPath, entry.name)));
}

/**
 * Emits `sw.js` with a precache list of every built file, versioned by content hash.
 * @param {{ template?: string }} [options]
 * @returns {import('vite').Plugin}
 */
export function offlinePlugin(options = {}) {
  let publicDir = '';
  const template = resolve(options.template ?? 'src/offline/service-worker.js');
  return {
    name: 'zoni-offline',
    apply: 'build',
    // Run after Vite's HTML plugin so index.html is already in the bundle.
    enforce: 'post',
    configResolved(config) {
      publicDir = config.publicDir;
    },
    generateBundle(_, bundle) {
      const publicFiles = publicDir ? listFiles(publicDir) : [];
      if (!bundle['index.html']) this.error('index.html must be built before sw.js');
      const urls = buildPrecacheList(Object.keys(bundle), publicFiles);
      const hash = createHash('sha256');
      for (const url of urls) {
        hash.update(url);
        const output = bundle[url.slice(1)];
        if (output) hash.update(output.type === 'chunk' ? output.code : output.source);
        else hash.update(readFileSync(join(publicDir, url.slice(1))));
      }
      const source = readFileSync(template, 'utf8')
        .replace("'__CACHE_VERSION__'", JSON.stringify(hash.digest('hex').slice(0, 12)))
        .replace("['__PRECACHE_URLS__']", JSON.stringify(urls));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
