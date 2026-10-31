"use client";

import { useState } from "react";
import { clearPlayed, moveQueueItem, removeQueueItem } from "@/lib/queue";
import type { QueueItem } from "@/lib/types";

interface Props {
  roomId: string;
  userId: string;
  queue: QueueItem[];
  currentId: string | null;
  names: Record<string, string>;
  onPlay: (id: string) => void;
  onChanged: () => void;
}

export default function QueuePanel({ roomId, queue, currentId, names, onPlay, onChanged }: Props) {
  const [error, setError] = useState<string | null>(null);
  const sorted = [...queue].sort((a, b) => a.position - b.position);
  const hasPlayed = sorted.some((q) => q.played_at && q.id !== currentId);

  async function run(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!sorted.length) {
    return <p className="p-6 text-center text-sm text-muted">Antrean kosong. Tambahkan video lewat kolom tautan.</p>;
  }

  const iconBtn = "grid h-8 w-8 place-items-center rounded-md text-sm text-muted hover:bg-surface-2 hover:text-white disabled:opacity-30";

  return (
    <div className="scrollbar-thin flex h-full flex-col overflow-y-auto">
      {error && (
        <p role="alert" className="px-4 pt-3 text-xs text-red-300">
          {error}
        </p>
      )}
      <ol className="flex flex-col gap-1 p-2">
        {sorted.map((item, i) => {
          const isCurrent = item.id === currentId;
          const played = !!item.played_at && !isCurrent;
          return (
            <li
              key={item.id}
              className={`group flex items-center gap-2 rounded-xl p-2 ${
                isCurrent ? "bg-accent/15 ring-1 ring-accent/50" : "hover:bg-surface"
              } ${played ? "opacity-50" : ""}`}
            >
              <button
                onClick={() => onPlay(item.id)}
                className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-lg bg-surface-2"
                aria-label={`Putar ${item.title ?? "video"}`}
              >
                {item.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.thumbnail} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <span className="grid h-full place-items-center text-xl">🎞️</span>
                )}
                {isCurrent && (
                  <span className="absolute inset-0 grid place-items-center bg-black/50 text-xs font-semibold">
                    Diputar
                  </span>
                )}
              </button>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm leading-snug">{item.title ?? item.source_id}</p>
                <p className="mt-0.5 truncate text-xs text-muted">
                  {item.source === "youtube_playlist" ? "Playlist · " : item.source === "url" ? "File · " : ""}
                  oleh {(item.added_by && names[item.added_by]) || "—"}
                </p>
              </div>
              <div className="flex shrink-0 flex-col sm:flex-row">
                <button
                  className={iconBtn}
                  disabled={i === 0}
                  onClick={() => run(() => moveQueueItem(queue, item.id, -1))}
                  aria-label="Naikkan"
                >
                  ▲
                </button>
                <button
                  className={iconBtn}
                  disabled={i === sorted.length - 1}
                  onClick={() => run(() => moveQueueItem(queue, item.id, 1))}
                  aria-label="Turunkan"
                >
                  ▼
                </button>
                <button
                  className={iconBtn}
                  onClick={() => run(() => removeQueueItem(item.id))}
                  aria-label="Hapus dari antrean"
                >
                  ✕
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      {hasPlayed && (
        <button
          onClick={() => run(() => clearPlayed(roomId, currentId))}
          className="mx-auto mb-4 mt-1 text-xs text-muted underline hover:text-white"
        >
          Bersihkan video yang sudah ditonton
        </button>
      )}
    </div>
  );
}

