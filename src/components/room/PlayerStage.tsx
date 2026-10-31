"use client";

import { useEffect, useState } from "react";
import { expectedPosition, type usePlaybackSync } from "@/hooks/usePlaybackSync";
import { sourceUrl } from "@/lib/sources";
import type { QueueItem } from "@/lib/types";
import VideoPlayer from "@/components/player/VideoPlayer";

export interface FloatingReaction {
  id: string;
  emoji: string;
  name: string;
  left: number;
}

interface Props {
  item: QueueItem | null;
  sync: ReturnType<typeof usePlaybackSync>;
  reactions: FloatingReaction[];
  peersBuffering: string[];
  fill: boolean;
}

const AUTO_SKIP_SECONDS = 8;

export default function PlayerStage({ item, sync, reactions, peersBuffering, fill }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  // Reset error saat item berganti
  useEffect(() => {
    setError(null);
    setCountdown(null);
  }, [item?.id]);

  // Lewati otomatis video yang gagal diputar (mis. tidak boleh di-embed)
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      setCountdown(null);
      sync.controls.next();
      return;
    }
    const t = window.setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [countdown, sync.controls]);

  const sizeCls = fill ? "h-[calc(100dvh-64px)]" : "aspect-video max-h-[56dvh] lg:max-h-[calc(100dvh-210px)]";

  return (
    <div className={`stage relative mx-auto w-full overflow-hidden ${sizeCls}`}>
      {!item && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center">
          <div>
            <div className="text-4xl" aria-hidden>
              🎬
            </div>
            <p className="mt-2 text-sm text-muted">Tempel tautan YouTube atau file video di bawah untuk mulai nonton.</p>
          </div>
        </div>
      )}

      {item && !error && (
        <VideoPlayer
          key={item.id}
          item={item}
          startSeconds={expectedPosition(sync.state)}
          autoplay={sync.state.status === "playing"}
          playlistIndex={sync.state.playlistIndex}
          onReady={sync.player.onReady}
          onStateChange={sync.player.onStateChange}
          onRateChange={sync.player.onRateChange}
          onError={(msg, fatal) => {
            sync.player.detach();
            setError(msg);
            if (fatal) setCountdown(AUTO_SKIP_SECONDS);
          }}
        />
      )}

      {/* Jika browser memblokir autoplay bersuara (mis. baru refresh halaman), tampilkan tombol satu ketukan */}
      {item && !error && sync.autoplayBlocked && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-black/60 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-2 p-4 text-center">
            <button
              type="button"
              onClick={sync.controls.unlockAndPlay}
              className="rounded-full bg-accent-strong px-6 py-3 font-semibold text-white shadow-lg shadow-pink-500/30 hover:bg-accent"
            >
              🔊 Klik untuk mulai & sinkronkan
            </button>
            <p className="text-xs text-white/80">Video sedang diputar bersama — ketuk sekali untuk mengaktifkan suara.</p>
          </div>
        </div>
      )}

      {item && error && (
        <div role="alert" className="absolute inset-0 grid place-items-center bg-black/80 p-6 text-center">
          <div className="max-w-sm">
            <p className="text-sm">{error}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <a
                href={sourceUrl(item.source, item.source_id)}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-border px-4 py-2 text-sm hover:border-accent"
              >
                Buka di sumber asli
              </a>
              <button
                onClick={() => {
                  setCountdown(null);
                  sync.controls.next();
                }}
                className="rounded-lg bg-accent-strong px-4 py-2 text-sm font-medium text-white"
              >
                Lewati
              </button>
              {countdown !== null && (
                <button onClick={() => setCountdown(null)} className="rounded-lg px-4 py-2 text-sm text-muted underline">
                  Batal lewati otomatis ({countdown})
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {peersBuffering.length > 0 && (
        <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-full bg-black/70 px-3 py-1 text-xs text-white">
          ⏳ {peersBuffering.join(", ")} sedang buffering…
        </div>
      )}

      {sync.playerState === "buffering" && (
        <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-full bg-black/70 px-3 py-1 text-xs text-white">
          Memuat…
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-full overflow-hidden" aria-live="polite">
        {reactions.map((r) => (
          <div
            key={r.id}
            className="animate-float-up absolute bottom-12 flex flex-col items-center"
            style={{ left: `${r.left}%` }}
          >
            <span className="text-4xl drop-shadow-lg">{r.emoji}</span>
            <span className="mt-0.5 rounded bg-black/60 px-1.5 text-[10px] text-white">{r.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
