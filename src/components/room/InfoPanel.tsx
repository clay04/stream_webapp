"use client";

import { useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { PresenceMeta, Room } from "@/lib/types";
import { Avatar } from "./PresenceBar";

interface Props {
  room: Room;
  userId: string;
  online: PresenceMeta[];
  names: Record<string, string>;
  onRoomUpdated: (room: Room) => void;
  onRoomDeleted: () => void;
}

export default function InfoPanel({ room, userId, online, names, onRoomUpdated, onRoomDeleted }: Props) {
  const [name, setName] = useState(room.name);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOwner = room.owner_id === userId;
  const onlineUserIds = new Set(online.map((p) => p.userId));
  const offlineUserIds = Object.keys(names).filter((id) => !onlineUserIds.has(id));

  function copy(text: string, kind: "code" | "link") {
    void navigator.clipboard.writeText(text);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1800);
  }

  async function updateRoom(patch: Partial<Pick<Room, "name" | "is_locked">>) {
    setSaving(true);
    setError(null);
    const { data, error: err } = await getSupabaseBrowser()
      .from("rooms")
      .update(patch)
      .eq("id", room.id)
      .select()
      .single();
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    onRoomUpdated(data as Room);
  }

  async function deleteRoom() {
    if (!confirm("Hapus room ini beserta seluruh antrean dan riwayat chat?")) return;
    setSaving(true);
    const { error: err } = await getSupabaseBrowser().from("rooms").delete().eq("id", room.id);
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    onRoomDeleted();
  }

  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/room/${room.room_code}` : "";

  return (
    <div className="scrollbar-thin flex h-full flex-col gap-5 overflow-y-auto p-4 text-sm">
      {error && (
        <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-2.5 text-xs text-red-200">
          {error}
        </p>
      )}

      <section className="space-y-2 rounded-xl border border-border bg-surface p-3.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted">Kode room</span>
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">
            {room.type === "temporary" ? "Sementara (7 hari)" : "Permanen"}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-xl font-bold tracking-[0.2em]">{room.room_code}</span>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => copy(room.room_code, "code")}
              className="rounded-lg border border-border px-2.5 py-1.5 text-xs hover:border-accent"
            >
              {copied === "code" ? "Tersalin ✓" : "Salin kode"}
            </button>
            <button
              type="button"
              onClick={() => copy(shareUrl, "link")}
              className="rounded-lg bg-accent-strong px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-accent"
            >
              {copied === "link" ? "Tersalin ✓" : "Salin tautan"}
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted">
          Anggota ({online.length + offlineUserIds.length})
        </h3>
        <ul className="space-y-1.5">
          {online.map((p) => (
            <li key={p.clientId} className="flex items-center gap-2.5 rounded-xl bg-surface px-3 py-2">
              <Avatar name={p.name} online size={28} />
              <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
              <span className="text-xs text-emerald-400">Online</span>
            </li>
          ))}
          {offlineUserIds.map((id) => {
            const displayName = names[id] ?? "Tamu";
            return (
              <li key={id} className="flex items-center gap-2.5 rounded-xl bg-surface px-3 py-2">
                <Avatar name={displayName} online={false} size={28} />
                <span className="min-w-0 flex-1 truncate font-medium">{displayName}</span>
                <span className="text-xs text-muted">Offline</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted">Pengaturan room</h3>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && name.trim() !== room.name) {
              void updateRoom({ name: name.trim() });
            }
          }}
          className="flex gap-2"
        >
          <label htmlFor="edit-room-name" className="sr-only">
            Nama room
          </label>
          <input
            id="edit-room-name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            className="min-w-0 flex-1 rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={saving || !name.trim() || name.trim() === room.name}
            className="rounded-xl border border-border px-3 py-2 text-xs font-medium hover:border-accent disabled:opacity-40"
          >
            Simpan
          </button>
        </form>

        <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3">
          <div>
            <p className="font-medium">{room.is_locked ? "🔒 Room terkunci" : "🔓 Room terbuka"}</p>
            <p className="mt-0.5 text-xs text-muted">
              {room.is_locked
                ? "Orang baru tidak bisa masuk meski punya kode."
                : "Siapa pun yang punya kode bisa masuk (otomatis terkunci setelah 2 orang)."}
            </p>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => void updateRoom({ is_locked: !room.is_locked })}
            className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:border-accent disabled:opacity-50"
          >
            {room.is_locked ? "Buka kunci" : "Kunci"}
          </button>
        </div>

        {isOwner && (
          <button
            type="button"
            disabled={saving}
            onClick={() => void deleteRoom()}
            className="w-full rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-xs font-semibold text-red-300 hover:bg-red-500/20 disabled:opacity-50"
          >
            Hapus room dan seluruh datanya
          </button>
        )}
      </section>
    </div>
  );
}

