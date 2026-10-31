"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { syncClock } from "@/lib/clock";
import { ensureIdentity, ensureSession, getStoredName } from "@/lib/identity";
import { loadQueue } from "@/lib/queue";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { ChatMessage, Profile, QueueItem, Room, RoomMember, RoomStateRow } from "@/lib/types";
import RoomView from "@/components/room/RoomView";

export interface RoomData {
  room: Room;
  members: RoomMember[];
  profiles: Record<string, string>;
  queue: QueueItem[];
  state: RoomStateRow | null;
  messages: ChatMessage[];
}

type Phase = { kind: "loading" } | { kind: "join"; error?: string } | { kind: "ready"; data: RoomData; userId: string; name: string } | { kind: "error"; message: string };

async function loadRoom(code: string): Promise<RoomData | null> {
  const supabase = getSupabaseBrowser();
  const { data: room } = await supabase.from("rooms").select("*").eq("room_code", code).maybeSingle();
  if (!room) return null;
  const r = room as Room;
  const [members, queue, state, messages] = await Promise.all([
    supabase.from("room_members").select("*").eq("room_id", r.id),
    loadQueue(r.id),
    supabase.from("room_state").select("*").eq("room_id", r.id).maybeSingle(),
    supabase.from("messages").select("*").eq("room_id", r.id).order("created_at", { ascending: false }).limit(100),
  ]);
  const memberRows = (members.data as RoomMember[]) ?? [];
  const { data: profs } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in(
      "id",
      memberRows.map((m) => m.user_id),
    );
  const profiles: Record<string, string> = {};
  for (const p of (profs as Profile[]) ?? []) profiles[p.id] = p.display_name;
  return {
    room: r,
    members: memberRows,
    profiles,
    queue,
    state: (state.data as RoomStateRow) ?? null,
    messages: (((messages.data as ChatMessage[]) ?? []) as ChatMessage[]).reverse(),
  };
}

export default function RoomClient({ code }: { code: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const enter = useCallback(async () => {
    try {
      const [userId] = await Promise.all([ensureSession(), syncClock()]);
      const data = await loadRoom(code);
      const stored = getStoredName();
      if (!data || !stored) {
        setName(stored);
        setPhase({ kind: "join" });
        return;
      }
      setPhase({ kind: "ready", data, userId, name: stored || data.profiles[userId] });
    } catch (err) {
      setPhase({ kind: "error", message: (err as Error).message });
    }
  }, [code]);

  useEffect(() => {
    void enter();
  }, [enter]);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await ensureIdentity(name);
      const res = await fetch("/api/rooms/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Gagal bergabung");
      setPhase({ kind: "loading" });
      await enter();
    } catch (err) {
      setPhase({ kind: "join", error: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (phase.kind === "ready") {
    return <RoomView initial={phase.data} userId={phase.userId} userName={phase.name} />;
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-10">
      <div className="text-center">
        <div className="text-5xl" aria-hidden>
          🍿
        </div>
        <h1 className="mt-3 text-2xl font-bold">Nonton Bareng</h1>
      </div>

      {phase.kind === "loading" && (
        <p className="text-center text-muted" role="status">
          Memuat room…
        </p>
      )}

      {phase.kind === "error" && (
        <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          {phase.message}
          <div className="mt-3">
            <Link href="/" className="underline">
              Kembali ke beranda
            </Link>
          </div>
        </div>
      )}

      {phase.kind === "join" && (
        <form onSubmit={join} className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5">
          <p className="text-sm text-muted">
            Kamu diundang ke room <span className="font-mono text-white">{code}</span>. Isi nama panggilanmu untuk masuk.
          </p>
          <label htmlFor="join-name" className="sr-only">
            Nama panggilan
          </label>
          <input
            id="join-name"
            autoFocus
            className="w-full rounded-xl border border-border bg-surface-2 px-4 py-3 outline-none focus:border-accent"
            value={name}
            maxLength={32}
            placeholder="Nama panggilan"
            onChange={(e) => setName(e.target.value)}
          />
          {phase.error && (
            <p role="alert" className="text-sm text-red-300">
              {phase.error}
            </p>
          )}
          <button
            type="submit"
            disabled={!name.trim() || busy}
            className="rounded-xl bg-accent-strong px-4 py-3 font-semibold text-white hover:bg-accent disabled:opacity-60"
          >
            {busy ? "Masuk…" : "Masuk ke room"}
          </button>
          <Link href="/" className="text-center text-sm text-muted hover:text-white">
            Kembali ke beranda
          </Link>
        </form>
      )}
    </main>
  );
}

