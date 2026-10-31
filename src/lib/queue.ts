"use client";

import { getSupabaseBrowser } from "./supabase/client";
import type { QueueItem } from "./types";

export interface VideoMeta {
  source: QueueItem["source"];
  sourceId: string;
  title: string | null;
  thumbnail: string | null;
}

export async function fetchMeta(url: string): Promise<VideoMeta> {
  const res = await fetch(`/api/metadata?url=${encodeURIComponent(url)}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "Gagal membaca tautan");
  return json as VideoMeta;
}

export async function loadQueue(roomId: string): Promise<QueueItem[]> {
  const { data, error } = await getSupabaseBrowser()
    .from("queue_items")
    .select("*")
    .eq("room_id", roomId)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as QueueItem[]) ?? [];
}

/**
 * Menambah item ke antrean. `after` = id item yang menjadi patokan (sisip setelahnya);
 * null = tambahkan di akhir. Posisi memakai angka pecahan agar sisipan tidak perlu menggeser item lain.
 */
export async function addQueueItem(
  roomId: string,
  userId: string,
  meta: VideoMeta,
  queue: QueueItem[],
  after: string | null,
): Promise<QueueItem> {
  const sorted = [...queue].sort((a, b) => a.position - b.position);
  let position: number;
  const idx = after ? sorted.findIndex((i) => i.id === after) : -1;
  if (idx >= 0) {
    const a = sorted[idx].position;
    const b = sorted[idx + 1]?.position;
    position = b === undefined ? a + 1 : (a + b) / 2;
  } else {
    position = (sorted[sorted.length - 1]?.position ?? 0) + 1;
  }
  const { data, error } = await getSupabaseBrowser()
    .from("queue_items")
    .insert({
      room_id: roomId,
      source: meta.source,
      source_id: meta.sourceId,
      title: meta.title,
      thumbnail: meta.thumbnail,
      position,
      added_by: userId,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as QueueItem;
}

export async function removeQueueItem(id: string) {
  const { error } = await getSupabaseBrowser().from("queue_items").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function moveQueueItem(queue: QueueItem[], id: string, dir: -1 | 1) {
  const sorted = [...queue].sort((a, b) => a.position - b.position);
  const i = sorted.findIndex((q) => q.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sorted.length) return;
  const a = sorted[i];
  const b = sorted[j];
  const supabase = getSupabaseBrowser();
  const [r1, r2] = await Promise.all([
    supabase.from("queue_items").update({ position: b.position }).eq("id", a.id),
    supabase.from("queue_items").update({ position: a.position }).eq("id", b.id),
  ]);
  if (r1.error || r2.error) throw new Error((r1.error ?? r2.error)!.message);
}

export async function clearPlayed(roomId: string, keepId: string | null) {
  let q = getSupabaseBrowser().from("queue_items").delete().eq("room_id", roomId).not("played_at", "is", null);
  if (keepId) q = q.neq("id", keepId);
  const { error } = await q;
  if (error) throw new Error(error.message);
}

