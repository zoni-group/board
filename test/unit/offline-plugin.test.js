import { describe, expect, it } from 'vitest';
import { buildPrecacheList } from '../../build/offline-plugin.js';

describe('buildPrecacheList', () => {
  const bundle = [
    'index.html',
    'assets/index-abc.js',
    'assets/index-abc.css',
    'assets/text-editor-def.js',
    'assets/table-editor-123.js',
    'assets/index-abc.js.map',
    'sw.js',
  ];
  const publicFiles = [
    'CNAME',
    'site.webmanifest',
    'favicon.ico',
    'favicon_ligth.svg',
    'web-app-manifest-192x192.png',
    'img/vb_logo_dark.svg',
    'img/zoni-board-og-1200x630.jpg',
  ];

  it('includes the shell, lazy chunks and app icons as root URLs', () => {
    const urls = buildPrecacheList(bundle, publicFiles);
    expect(urls).toEqual(
      expect.arrayContaining([
        '/index.html',
        '/assets/text-editor-def.js',
        '/assets/table-editor-123.js',
        '/assets/index-abc.css',
        '/site.webmanifest',
        '/favicon_ligth.svg',
        '/web-app-manifest-192x192.png',
        '/img/vb_logo_dark.svg',
      ])
    );
  });

  it('excludes the CNAME, social image, source maps and the worker itself', () => {
    const urls = buildPrecacheList(bundle, publicFiles);
    expect(urls).not.toContain('/CNAME');
    expect(urls).not.toContain('/img/zoni-board-og-1200x630.jpg');
    expect(urls).not.toContain('/assets/index-abc.js.map');
    expect(urls).not.toContain('/sw.js');
  });

  it('is sorted and de-duplicated', () => {
    const urls = buildPrecacheList(['b.js', 'a.js', 'a.js'], ['a.js']);
    expect(urls).toEqual(['/a.js', '/b.js']);
  });
});
