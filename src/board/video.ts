import { normalizeVideoSource } from './model.ts';
import type { VideoSource } from './model.ts';

/** Parse known provider URLs, never arbitrary iframe markup or remote media URLs. */
export function parseVideoUrl(input: string): VideoSource | null {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split('/').filter(Boolean);
    if (host === 'youtu.be') return normalizeVideoSource({ kind: 'youtube', videoId: parts[0] });
    if (
      ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com'].includes(host)
    ) {
      const videoId =
        url.pathname === '/watch'
          ? url.searchParams.get('v')
          : ['embed', 'shorts', 'live'].includes(parts[0])
            ? parts[1]
            : undefined;
      return normalizeVideoSource({ kind: 'youtube', videoId });
    }
    if (['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(host)) {
      const videoId = parts[0] === 'video' ? parts[1] : parts[0];
      const hash = url.searchParams.get('h') ?? (parts[0] === 'video' ? undefined : parts[1]);
      return normalizeVideoSource({ kind: 'vimeo', videoId, ...(hash ? { hash } : {}) });
    }
  } catch {
    /* Invalid URL. */
  }
  return null;
}

export function videoEmbedUrl(source: VideoSource): string | null {
  if (source.kind === 'local') return null;
  if (source.kind === 'youtube')
    return `https://www.youtube-nocookie.com/embed/${source.videoId}?autoplay=0&rel=0`;
  return `https://player.vimeo.com/video/${source.videoId}?dnt=1&autoplay=0${source.hash ? `&h=${source.hash}` : ''}`;
}
