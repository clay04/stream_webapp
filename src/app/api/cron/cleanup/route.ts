import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** GET /api/cron/cleanup — dipanggil Vercel Cron harian untuk menghapus room sementara yang tidak aktif. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const days = Number(process.env.TEMP_ROOM_TTL_DAYS ?? 7) || 7;
  const { data, error } = await getSupabaseAdmin().rpc("delete_inactive_temporary_rooms", { p_days: days });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: data, days });
}

