import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** GET /api/time — jam server untuk koreksi selisih jam antar perangkat. */
export function GET() {
  return NextResponse.json({ now: Date.now() }, { headers: { "Cache-Control": "no-store" } });
}

