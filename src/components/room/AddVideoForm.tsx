"use client";

import { useState } from "react";
import { addQueueItem, fetchMeta } from "@/lib/queue";
import { parseVideoUrl } from "@/lib/sources";
import type { QueueItem } from "@/lib/types";

interface Props {
  roomId: string;
  userId: string;
  queue: QueueItem[];
  currentId: string | null;
  onAdded: (item: QueueItem, playNow: boolean) => void;
}

export default function AddVideoForm({ roomId, userId, queue, currentId, onAdded }: Props) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(playNow: boolean) {
    setError(null);
    if (!parseVideoUrl(url)) {
      setError("Tautan belum didukung. Gunakan tautan YouTube atau tautan langsung ke file .mp4/.webm/.m3u8.");
      return;
    }
    setBusy(true);
    try {
      const meta = await fetchMeta(url);
      // "Putar sekarang" disisipkan tepat setelah video yang sedang diputar.
      const item = await addQueueItem(roomId, userId, meta, queue, playNow ? currentId : null);
      onAdded(item, playNow);
      setUrl("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void add(!currentId);
      }}
      className="flex flex-col gap-2"
    >
      <div className="flex gap-2">
        <label htmlFor="video-url" className="sr-only">
          Tautan video
        </label>
        <input
          id="video-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Tempel tautan YouTube / MP4…"
          inputMode="url"
          autoComplete="off"
          className="min-w-0 flex-1 rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-accent"
        />
        <button
          type="button"
          disabled={!url.trim() || busy}
          onClick={() => void add(true)}
          className="shrink-0 rounded-xl bg-accent-strong px-3 py-2.5 text-sm font-semibold text-white hover:bg-accent disabled:opacity-50"
        >
          Putar
        </button>
        <button
          type="button"
          disabled={!url.trim() || busy}
          onClick={() => void add(false)}
          className="shrink-0 rounded-xl border border-border px-3 py-2.5 text-sm hover:border-accent disabled:opacity-50"
          aria-label="Tambah ke antrean"
        >
          + Antre
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
    </form>
  );
}

