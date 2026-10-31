import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { defaultThumbnail, parseVideoUrl } from "@/lib/sources";

function extractMetaTag(html: string, prop: string): string | null {
  const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i");
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, "i");
  const m = html.match(re1) ?? html.match(re2);
  return m?.[1]?.trim() ?? null;
}

/**
 * GET /api/metadata?url=... — mengambil judul & thumbnail video.
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
  } else if (parsed.sourceId.includes("/embedframe/")) {
    // Coba ambil judul & thumbnail dari halaman XNXX (dengan batas waktu 3 detik agar tidak menggantung jika diblokir)
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    try {
      const res = await fetch(parsed.url, {
        signal: ctrl.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
        },
      });
      if (res.ok) {
        const html = await res.text();
        const ogTitle =
          extractMetaTag(html, "og:title") ?? html.match(/setVideoTitle\(['"]([^'"]+)['"]\)/)?.[1] ?? null;
        const ogImage =
          extractMetaTag(html, "og:image") ??
          html.match(/setThumbUrl169\(['"]([^'"]+)['"]\)/)?.[1] ??
          html.match(/setThumbUrl\(['"]([^'"]+)['"]\)/)?.[1] ??
          null;
        const hlsUrl = html.match(/setVideoHLS\(['"]([^'"]+)['"]\)/)?.[1] ?? null;
        const mp4High = html.match(/setVideoUrlHigh\(['"]([^'"]+)['"]\)/)?.[1] ?? null;
        const mp4Low = html.match(/setVideoUrlLow\(['"]([^'"]+)['"]\)/)?.[1] ?? null;
        const directStream = hlsUrl || mp4High || mp4Low;

        if (ogTitle) title = ogTitle;
        if (ogImage) thumbnail = ogImage;
        if (directStream) {
          // Gunakan stream HLS/MP4 langsung agar sinkronisasi play/pause/seek berjalan penuh,
          // dengan cadangan otomatis ke embedframe bila stream langsung gagal dimuat di klien.
          resolvedSourceId = `${directStream}#embed=${encodeURIComponent(parsed.sourceId)}`;
        }
      }
    } catch {
      // Gunakan fallbackTitle dari slug URL jika fetch gagal/timeout
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
