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

function slugToTitle(pathname: string, hostname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  const cleaned = decodeURIComponent(last)
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
  return cleaned || hostname;
}

/**
 * Mengubah URL yang ditempel pengguna menjadi sumber yang didukung.
 * Mendukung YouTube, Vimeo, Twitch, file video langsung (.mp4/.webm/.m3u8),
 * serta halaman web video eksternal.
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

  // Pola generik /video-<id>/<slug> atau /embedframe/<id>
  const videoPathMatch = url.pathname.match(/^\/video-([a-z0-9]+)(?:\/([^/?#]+))?/i);
  if (videoPathMatch) {
    const id = videoPathMatch[1];
    const slug = videoPathMatch[2] ? decodeURIComponent(videoPathMatch[2]).replace(/[_-]+/g, " ").trim() : undefined;
    return {
      source: "url",
      sourceId: `${url.origin}/embedframe/${id}`,
      url: url.toString(),
      fallbackTitle: slug || `Video (${id})`,
    };
  }
  const embedFrameMatch = url.pathname.match(/^\/embedframe\/([a-z0-9]+)/i);
  if (embedFrameMatch) {
    const id = embedFrameMatch[1];
    return {
      source: "url",
      sourceId: `${url.origin}/embedframe/${id}`,
      url: `${url.origin}/video-${id}/`,
      fallbackTitle: `Video (${id})`,
    };
  }

  // File media langsung (.mp4, .webm, .m3u8, dll.) atau halaman web video lainnya
  return {
    source: "url",
    sourceId: url.toString(),
    url: url.toString(),
    fallbackTitle: slugToTitle(url.pathname, host),
  };
}

export function sourceUrl(source: QueueSource, sourceId: string): string {
  const cleanId = sourceId.split("#embed=")[0];
  switch (source) {
    case "youtube":
      return `https://www.youtube.com/watch?v=${cleanId}`;
    case "youtube_playlist":
      return `https://www.youtube.com/playlist?list=${cleanId}`;
    case "vimeo":
      return `https://vimeo.com/${cleanId}`;
    case "twitch":
      return cleanId.startsWith("video:")
        ? `https://www.twitch.tv/videos/${cleanId.slice(6)}`
        : `https://www.twitch.tv/${cleanId.replace(/^channel:/, "")}`;
    default: {
      const m = cleanId.match(/^(https?:\/\/[^/]+)\/embedframe\/([a-z0-9]+)/i);
      if (m) return `${m[1]}/video-${m[2]}/`;
      return cleanId;
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
