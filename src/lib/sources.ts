import type { QueueSource } from "./types";

export interface ParsedSource {
  source: QueueSource;
  sourceId: string;
  /** URL kanonik untuk membuka di situs aslinya. */
  url: string;
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const YT_LIST = /^[A-Za-z0-9_-]{10,64}$/;
const MEDIA_EXT = /\.(mp4|m4v|webm|ogv|ogg|mov|m3u8)(\?|#|$)/i;

/**
 * Mengubah URL yang ditempel pengguna menjadi sumber yang didukung.
 * Didukung: YouTube (watch, youtu.be, shorts, embed, live, playlist) dan
 * tautan langsung ke file video (MP4/WebM/HLS) milik sendiri.
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

  if (host === "youtu.be") {
    const id = url.pathname.split("/")[1] ?? "";
    if (YT_ID.test(id)) return { source: "youtube", sourceId: id, url: `https://www.youtube.com/watch?v=${id}` };
    return null;
  }

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

  if (MEDIA_EXT.test(url.pathname + url.search) && url.protocol === "https:") {
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
    default:
      return sourceId;
  }
}

export function defaultThumbnail(source: QueueSource, sourceId: string): string | null {
  if (source === "youtube") return `https://i.ytimg.com/vi/${sourceId}/mqdefault.jpg`;
  return null;
}

export function isHls(url: string) {
  return /\.m3u8(\?|#|$)/i.test(url);
}

