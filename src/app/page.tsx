"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ensureIdentity, ensureSession, getStoredName } from "@/lib/identity";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { Room, RoomType } from "@/lib/types";

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "Terjadi kesalahan");
  return json as T;
}

export default function HomePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [roomName, setRoomName] = useState("Nonton Bareng");
  const [roomType, setRoomType] = useState<RoomType>("permanent");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);

  useEffect(() => {
    setName(getStoredName());
    const params = new URLSearchParams(window.location.search);
    const c = params.get("code");
    if (c) setCode(c.toUpperCase());

    (async () => {
      try {
        const supabase = getSupabaseBrowser();
        const { data } = await supabase.auth.getSession();
        if (!data.session) return;
        const { data: list } = await supabase
          .from("rooms")
          .select("*")
          .order("last_active_at", { ascending: false })
          .limit(10);
        setRooms((list as Room[]) ?? []);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, []);

  async function createRoom(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy("create");
    try {
      await ensureIdentity(name);
      const { roomCode } = await postJson<{ roomCode: string }>("/api/rooms", {
        name: roomName.trim() || "Nonton Bareng",
        type: roomType,
      });
      router.push(`/room/${roomCode}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  async function joinRoom(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy("join");
    try {
      await ensureIdentity(name);
      const { roomCode } = await postJson<{ roomCode: string }>("/api/rooms/join", { code: code.trim() });
      router.push(`/room/${roomCode}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  const inputCls =
    "w-full rounded-xl border border-border bg-surface-2 px-4 py-3 text-base outline-none placeholder:text-muted focus:border-accent";
  const btnCls =
    "w-full rounded-xl bg-accent-strong px-4 py-3 font-semibold text-white transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 px-4 py-10 sm:py-16">
      <header className="text-center">
        <div className="text-5xl" aria-hidden>
          🍿
        </div>
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Nonton Bareng</h1>
        <p className="mt-2 text-muted">Nonton video bareng pasangan dari jauh, sinkron di dua layar.</p>
      </header>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <label htmlFor="nickname" className="mb-2 block text-sm font-medium text-muted">
          Nama panggilan kamu
        </label>
        <input
          id="nickname"
          className={inputCls}
          value={name}
          maxLength={32}
          autoComplete="nickname"
          placeholder="mis. Sayang"
          onChange={(e) => setName(e.target.value)}
        />
        <p className="mt-2 text-xs text-muted">Tanpa akun. Nama disimpan di perangkat ini.</p>
      </section>

      {error && (
        <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        <form onSubmit={createRoom} className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-lg font-semibold">Buat room</h2>
          <div>
            <label htmlFor="room-name" className="mb-2 block text-sm text-muted">
              Nama room
            </label>
            <input
              id="room-name"
              className={inputCls}
              value={roomName}
              maxLength={60}
              onChange={(e) => setRoomName(e.target.value)}
            />
          </div>
          <fieldset>
            <legend className="mb-2 text-sm text-muted">Tipe room</legend>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["permanent", "Permanen", "Kode tetap, data disimpan"],
                  ["temporary", "Sementara", "Terhapus setelah 7 hari tidak aktif"],
                ] as const
              ).map(([value, label, hint]) => (
                <label
                  key={value}
                  className={`cursor-pointer rounded-xl border p-3 text-sm transition ${
                    roomType === value ? "border-accent bg-accent/10" : "border-border bg-surface-2"
                  }`}
                >
                  <input
                    type="radio"
                    name="room-type"
                    value={value}
                    className="sr-only"
                    checked={roomType === value}
                    onChange={() => setRoomType(value)}
                  />
                  <span className="block font-medium">{label}</span>
                  <span className="mt-1 block text-xs text-muted">{hint}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <button type="submit" className={`${btnCls} mt-auto`} disabled={!name.trim() || busy !== null}>
            {busy === "create" ? "Membuat…" : "Buat Room"}
          </button>
        </form>

        <form onSubmit={joinRoom} className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-lg font-semibold">Gabung room</h2>
          <div>
            <label htmlFor="room-code" className="mb-2 block text-sm text-muted">
              Kode room
            </label>
            <input
              id="room-code"
              className={`${inputCls} font-mono uppercase tracking-[0.2em]`}
              value={code}
              maxLength={16}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="ABCD234XYZ"
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            />
          </div>
          <p className="text-xs text-muted">Minta kode dari pasanganmu. Room terkunci otomatis setelah 2 orang masuk.</p>
          <button
            type="submit"
            className={`${btnCls} mt-auto`}
            disabled={!name.trim() || code.length < 8 || busy !== null}
          >
            {busy === "join" ? "Masuk…" : "Gabung"}
          </button>
        </form>
      </div>

      {rooms.length > 0 && (
        <section className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="mb-3 text-lg font-semibold">Room kamu</h2>
          <ul className="divide-y divide-border">
            {rooms.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/room/${r.room_code}`}
                  onClick={() => void ensureSession()}
                  className="flex items-center justify-between gap-3 py-3 hover:text-accent"
                >
                  <span className="truncate font-medium">{r.name}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {r.type === "temporary" ? "Sementara" : "Permanen"} · <span className="font-mono">{r.room_code}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-auto text-center text-xs text-muted">
        Nonton bersama secara privat dan sinkron di dua perangkat.
      </footer>
    </main>
  );
}

