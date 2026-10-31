import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { defaultThumbnail, isDirectMediaUrl, parseVideoUrl } from "@/lib/sources";

function extractMetaTag(html: string, prop: string): string | null {
  const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i");
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, "i");
  const m = html.match(re1) ?? html.match(re2);
  return m?.[1]?.trim() ?? null;
}

function normalizeUrl(raw: string, baseUrl: string): string | null {
  const trimmed = raw.trim().replace(/&amp;/g, "&");
  if (!trimmed || trimmed === "about:blank" || trimmed.startsWith("javascript:")) return null;
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return null;
  }
}

function extractEmbeddedPlayerUrl(html: string, pageUrl: string): string | null {
  // 1. Iframe pemutar utama (id/class yang umum dipakai situs streaming film)
  const mainIframeMatch =
    html.match(/<iframe[^>]+id=["'](?:player-iframe|iframe-player|embed-player|myframe)["'][^>]*>/i)?.[0] ?? null;
  if (mainIframeMatch) {
    const src =
      mainIframeMatch.match(/(?:data-src|src)=["']([^"']+)["']/i)?.[1] ?? null;
    const norm = src ? normalizeUrl(src, pageUrl) : null;
    if (norm && !norm.includes("youtube.com/embed")) return norm;
  }

  // 2. Tautan server/provider yang menargetkan iframe pemutar (mis. target="player-iframe" atau data-server)
  const providerPatterns = [
    /<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]+(?:target=["'](?:player-iframe|iframe)["']|data-server|data-iframe)/i,
    /<a[^>]+(?:target=["'](?:player-iframe|iframe)["']|data-server|data-iframe)[^>]+href=["'](https?:\/\/[^"']+)["']/i,
    /data-(?:embed|video|iframe|src)=["'](https?:\/\/[^"']+)["']/i,
  ];
  for (const re of providerPatterns) {
    const m = html.match(re);
    if (m?.[1]) {
      const norm = normalizeUrl(m[1], pageUrl);
      if (norm && !norm.includes("youtube.com")) return norm;
    }
  }

  // 3. Semua tag iframe pada halaman (abaikan iklan, analitik, dan trailer YouTube bila ada pemutar lain)
  const iframeRegex = /<iframe[^>]+(?:data-src|src)=["']([^"']+)["'][^>]*>/gi;
  const candidates: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = iframeRegex.exec(html)) !== null) {
    const norm = normalizeUrl(match[1], pageUrl);
    if (!norm) continue;
    if (/googletagmanager|google-analytics|doubleclick|facebook\.com|disqus\.com|chatango/i.test(norm)) continue;
    candidates.push(norm);
  }
  const nonTrailer = candidates.find((u) => !/youtube\.com\/embed|youtu\.be/i.test(u));
  return nonTrailer ?? candidates[0] ?? null;
}

/**
 * GET /api/metadata?url=... — mengambil judul, thumbnail, dan stream/embed video.
 */
export async function GET(req: Request) {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const input = new URL(req.url).searchParams.get("url") ?? "";
  const parsed = parseVideoUrl(input);
  if (!parsed) return NextResponse.json({ error: "Sumber tidak didukung" }, { status: 400 });

  let title: string | null = parsed.fallbackTitle ?? null;
  let thumbnail: string | null = defaultThumbnail(parsed.source, parsed.sourceId);
  let resolvedSourceId = parsed.sourceId;

  if (parsed.source === "youtube" || parsed.source === "youtube_playlist") {
    try {
      const res = await fetch(
        `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(parsed.url)}`,
        { next: { revalidate: 86400 } },
      );
      if (res.ok) {
        const j = (await res.json()) as { title?: string; thumbnail_url?: string };
        title = j.title ?? title;
        thumbnail = j.thumbnail_url ?? thumbnail;
      }
    } catch {
      // metadata opsional
    }
    if (!title && parsed.source === "youtube_playlist") title = "Playlist YouTube";
  } else if (parsed.source === "vimeo") {
    try {
      const res = await fetch(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(parsed.url)}`);
      if (res.ok) {
        const j = (await res.json()) as { title?: string; thumbnail_url?: string };
        title = j.title ?? title;
        thumbnail = j.thumbnail_url ?? thumbnail;
      }
    } catch {
      // metadata opsional
    }
  } else if (parsed.source === "url" && !isDirectMediaUrl(parsed.sourceId)) {
    // Ekstraksi generik untuk halaman web video eksternal (batas waktu 3.5 detik)
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3500);
    try {
      const res = await fetch(parsed.url, {
        signal: ctrl.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      if (res.ok) {
        const html = await res.text();
        const ogTitle =
          extractMetaTag(html, "og:title") ??
          html.match(/setVideoTitle\(['"]([^'"]+)['"]\)/)?.[1] ??
          html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ??
          null;
        const ogImage =
          extractMetaTag(html, "og:image") ??
          html.match(/setThumbUrl169\(['"]([^'"]+)['"]\)/)?.[1] ??
          html.match(/setThumbUrl\(['"]([^'"]+)['"]\)/)?.[1] ??
          null;

        const hlsUrl =
          html.match(/setVideoHLS\(['"]([^'"]+)['"]\)/)?.[1] ??
          html.match(/["']file["']\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i)?.[1] ??
          null;
        const mp4High =
          html.match(/setVideoUrlHigh\(['"]([^'"]+)['"]\)/)?.[1] ??
          html.match(/["']file["']\s*:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i)?.[1] ??
          null;
        const mp4Low = html.match(/setVideoUrlLow\(['"]([^'"]+)['"]\)/)?.[1] ?? null;
        const directStream = hlsUrl || mp4High || mp4Low;

        if (ogTitle) title = ogTitle;
        if (ogImage) thumbnail = ogImage;

        if (directStream) {
          resolvedSourceId = `${directStream}#embed=${encodeURIComponent(parsed.sourceId)}`;
        } else {
          const embeddedIframe = extractEmbeddedPlayerUrl(html, parsed.url);
          if (embeddedIframe) {
            resolvedSourceId = embeddedIframe;
          }
        }
      }
    } catch {
      // Gunakan fallbackTitle dan parsed.sourceId jika fetch gagal/timeout
    } finally {
      clearTimeout(timer);
    }
  } else if (!title) {
    try {
      const u = new URL(parsed.sourceId);
      title = decodeURIComponent(u.pathname.split("/").pop() || u.hostname);
    } catch {
      title = "Video";
    }
  }

  return NextResponse.json({
    source: parsed.source,
    sourceId: resolvedSourceId,
    url: parsed.url,
    title,
    thumbnail,
  });
}
