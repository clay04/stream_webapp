import type { QueueSource } from "./types";

export interface ParsedSource {
  source: QueueSource;
  sourceId: string;
  /** URL kanonik untuk membuka di situs aslinya. */
  url: string;
  /** Judul cadangan dari slug URL jika situs memblokir fetch server. */
  fallbackTitle?: string;
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const YT_LIST = /^[A-Za-z0-9_-]{10,64}$/;
const MEDIA_EXT = /\.(mp4|m4v|webm|ogv|ogg|mov|m3u8)(\?|#|$)/i;

export function isDirectMediaUrl(url: string): boolean {
  return MEDIA_EXT.test(url);
}

export function isEmbedUrl(url: string): boolean {
  return !isDirectMediaUrl(url);
}

/**
 * Mengubah URL yang ditempel pengguna menjadi sumber yang didukung.
 * Didukung:
 * - YouTube (watch, youtu.be, shorts, embed, live, playlist)
 * - File video langsung (.mp4, .webm, .m3u8 HLS)
 * - XNXX (xnxx.com/video-xxx/..., xnxx.com/embedframe/xxx, beserta domain cerminnya)
 * - Vimeo & Twitch
 */
export function parseVideoUrl(input: string): ParsedSource | null {
  const raw = input.trim();
  if (!raw) return null;

  // ID YouTube polos
  if (YT_ID.test(raw)) {
    return { source: "youtube", sourceId: raw, url: `https://www.youtube.com/watch?v=${raw}` };
  }

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "").toLowerCase();

  // YouTube short link
  if (host === "youtu.be") {
    const id = url.pathname.split("/")[1] ?? "";
    if (YT_ID.test(id)) return { source: "youtube", sourceId: id, url: `https://www.youtube.com/watch?v=${id}` };
    return null;
  }

  // YouTube
  if (host === "youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com") {
    const v = url.searchParams.get("v");
    const list = url.searchParams.get("list");
    if (url.pathname === "/playlist" && list && YT_LIST.test(list)) {
      return { source: "youtube_playlist", sourceId: list, url: `https://www.youtube.com/playlist?list=${list}` };
    }
    if (v && YT_ID.test(v)) {
      return { source: "youtube", sourceId: v, url: `https://www.youtube.com/watch?v=${v}` };
    }
    const m = url.pathname.match(/^\/(shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
    if (m) return { source: "youtube", sourceId: m[2], url: `https://www.youtube.com/watch?v=${m[2]}` };
    if (list && YT_LIST.test(list)) {
      return { source: "youtube_playlist", sourceId: list, url: `https://www.youtube.com/playlist?list=${list}` };
    }
    return null;
  }

  // XNXX (xnxx.com, xnxx.tv, xnxx.es, xnxx2.com, dll.)
  if (/^xnxx[0-9]*\.(com|tv|es|dev|health|gold)$/i.test(host)) {
    // Format: /video-<id>/<slug>
    const videoMatch = url.pathname.match(/^\/video-([a-z0-9]+)(?:\/([^/?#]+))?/i);
    if (videoMatch) {
      const id = videoMatch[1];
      const slug = videoMatch[2] ? decodeURIComponent(videoMatch[2]).replace(/[_-]+/g, " ").trim() : undefined;
      return {
        source: "url",
        sourceId: `https://${url.hostname}/embedframe/${id}`,
        url: url.toString(),
        fallbackTitle: slug ? `XNXX · ${slug}` : `XNXX Video (${id})`,
      };
    }
    // Format: /embedframe/<id>
    const embedMatch = url.pathname.match(/^\/embedframe\/([a-z0-9]+)/i);
    if (embedMatch) {
      const id = embedMatch[1];
      return {
        source: "url",
        sourceId: `https://${url.hostname}/embedframe/${id}`,
        url: `https://${url.hostname}/video-${id}/`,
        fallbackTitle: `XNXX Video (${id})`,
      };
    }
  }

  // Vimeo
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const m = url.pathname.match(/\/(?:video\/)?([0-9]{6,12})/);
    if (m) {
      return {
        source: "vimeo",
        sourceId: m[1],
        url: `https://vimeo.com/${m[1]}`,
        fallbackTitle: `Vimeo (${m[1]})`,
      };
    }
  }

  // Twitch
  if (host === "twitch.tv" || host === "player.twitch.tv") {
    const vMatch = url.pathname.match(/^\/videos\/([0-9]+)/);
    if (vMatch) {
      return {
        source: "twitch",
        sourceId: `video:${vMatch[1]}`,
        url: `https://www.twitch.tv/videos/${vMatch[1]}`,
        fallbackTitle: `Twitch VOD (${vMatch[1]})`,
      };
    }
    const chMatch = url.pathname.match(/^\/([a-zA-Z0-9_]{3,25})\/?$/);
    if (chMatch) {
      return {
        source: "twitch",
        sourceId: `channel:${chMatch[1]}`,
        url: `https://www.twitch.tv/${chMatch[1]}`,
        fallbackTitle: `Twitch · ${chMatch[1]}`,
      };
    }
  }

  // File media langsung (.mp4, .webm, .m3u8, dll.)
  if (MEDIA_EXT.test(url.pathname + url.search)) {
    return { source: "url", sourceId: url.toString(), url: url.toString() };
  }

  return null;
}

export function sourceUrl(source: QueueSource, sourceId: string): string {
  switch (source) {
    case "youtube":
      return `https://www.youtube.com/watch?v=${sourceId}`;
    case "youtube_playlist":
      return `https://www.youtube.com/playlist?list=${sourceId}`;
    case "vimeo":
      return `https://vimeo.com/${sourceId}`;
    case "twitch":
      return sourceId.startsWith("video:")
        ? `https://www.twitch.tv/videos/${sourceId.slice(6)}`
        : `https://www.twitch.tv/${sourceId.replace(/^channel:/, "")}`;
    default: {
      const m = sourceId.match(/^(https?:\/\/[^/]+)\/embedframe\/([a-z0-9]+)/i);
      if (m) return `${m[1]}/video-${m[2]}/`;
      return sourceId;
    }
  }
}

export function defaultThumbnail(source: QueueSource, sourceId: string): string | null {
  if (source === "youtube") return `https://i.ytimg.com/vi/${sourceId}/mqdefault.jpg`;
  return null;
}

export function isHls(url: string) {
  return /\.m3u8(\?|#|$)/i.test(url);
}
