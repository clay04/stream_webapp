import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdmin, getSupabaseServer } from "@/lib/supabase/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const Body = z.object({
  name: z.string().trim().min(1).max(60),
  type: z.enum(["permanent", "temporary"]),
});

/** POST /api/rooms — buat room baru. Pembuat otomatis menjadi host. */
export async function POST(req: Request) {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sesi tidak ditemukan, muat ulang halaman." }, { status: 401 });

  const ip = clientIp(req.headers) ?? "unknown";
  if (!rateLimit(`create:${ip}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Terlalu banyak room dibuat. Coba lagi nanti." }, { status: 429 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Data tidak valid" }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("create_room", {
    p_user: user.id,
    p_name: parsed.data.name,
    p_type: parsed.data.type,
  });
  if (error) {
    const limited = error.message.includes("rate_limited");
    return NextResponse.json(
      { error: limited ? "Terlalu banyak room dibuat. Coba lagi nanti." : "Gagal membuat room" },
      { status: limited ? 429 : 500 },
    );
  }
  return NextResponse.json({ roomCode: (data as { room_code: string }).room_code });
}

