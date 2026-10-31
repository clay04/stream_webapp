import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdmin, getSupabaseServer } from "@/lib/supabase/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const Body = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{8,16}$/),
});

const MESSAGES: Record<string, { status: number; error: string }> = {
  not_found: { status: 404, error: "Kode room tidak ditemukan." },
  locked: { status: 403, error: "Room terkunci. Minta pemilik room membuka kunci di pengaturan." },
  full: { status: 403, error: "Room sudah penuh." },
  rate_limited: { status: 429, error: "Terlalu banyak percobaan. Tunggu 15 menit lalu coba lagi." },
};

/** POST /api/rooms/join — verifikasi kode room lalu jadikan pengguna anggota. */
export async function POST(req: Request) {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sesi tidak ditemukan, muat ulang halaman." }, { status: 401 });

  const ip = clientIp(req.headers);
  if (!rateLimit(`join:${ip ?? user.id}`, 20, 15 * 60 * 1000)) {
    return NextResponse.json(MESSAGES.rate_limited, { status: 429 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json(MESSAGES.not_found, { status: 404 });

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("join_room", {
    p_user: user.id,
    p_code: parsed.data.code,
    p_ip: ip,
  });
  if (error) return NextResponse.json({ error: "Gagal bergabung ke room" }, { status: 500 });

  const result = data as { status: string; room_code?: string };
  if (result.status === "ok") return NextResponse.json({ roomCode: result.room_code });
  const m = MESSAGES[result.status] ?? { status: 400, error: "Gagal bergabung" };
  return NextResponse.json({ error: m.error }, { status: m.status });
}

