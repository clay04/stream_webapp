import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { defaultThumbnail, parseVideoUrl } from "@/lib/sources";

/**
 * GET /api/metadata?url=... — judul & thumbnail lewat oEmbed resmi YouTube.
 * Tidak mengunduh atau mengekstrak stream apa pun.
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

  let title: string | null = null;
  let thumbnail: string | null = defaultThumbnail(parsed.source, parsed.sourceId);

  if (parsed.source === "youtube" || parsed.source === "youtube_playlist") {
    try {
      const res = await fetch(
        `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(parsed.url)}`,
        { next: { revalidate: 86400 } },
      );
      if (res.ok) {
        const j = (await res.json()) as { title?: string; thumbnail_url?: string };
        title = j.title ?? null;
        thumbnail = j.thumbnail_url ?? thumbnail;
      }
    } catch {
      // metadata opsional
    }
    if (!title && parsed.source === "youtube_playlist") title = "Playlist YouTube";
  } else {
    try {
      const u = new URL(parsed.sourceId);
      title = decodeURIComponent(u.pathname.split("/").pop() || u.hostname);
    } catch {
      title = "Video";
    }
  }

  return NextResponse.json({ ...parsed, title, thumbnail });
}

