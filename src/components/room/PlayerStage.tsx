"use client";

import { useEffect, useRef, useState } from "react";
import { expectedPosition, type usePlaybackSync } from "@/hooks/usePlaybackSync";
import type { ActiveScreenShare } from "@/hooks/useWebRTC";
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
  screenShare: ActiveScreenShare | null;
  onStopScreenShare: () => void;
  videoVolume: number;
  reactions: FloatingReaction[];
  peersBuffering: string[];
  fill: boolean;
}

const AUTO_SKIP_SECONDS = 8;

function ScreenShareStage({
  screenShare,
  videoVolume,
  onStop,
}: {
  screenShare: ActiveScreenShare;
  videoVolume: number;
  onStop: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [needsUnmute, setNeedsUnmute] = useState(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = screenShare.stream;
    el.muted = screenShare.isSelf;
    el.volume = Math.min(1, Math.max(0, videoVolume));
    el.play().catch(() => {
      if (!screenShare.isSelf) {
        el.muted = true;
        setNeedsUnmute(true);
        void el.play().catch(() => {});
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenShare.stream, screenShare.streamVersion, screenShare.isSelf]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = Math.min(1, Math.max(0, videoVolume));
    }
  }, [videoVolume]);

  return (
    <div className="absolute inset-0 bg-black">
      <video ref={videoRef} autoPlay playsInline className="h-full w-full object-contain" />
      <div className=" absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full bg-black/75 px-3 py-1.5 text-xs text-white backdrop-blur-sm">
        <span>🖥️ Layar {screenShare.name}</span>
        {screenShare.isSelf && (
          <button
            type="button"
            onClick={onStop}
            className="rounded-full bg-red-600 px-2.5 py-0.5 text-[11px] font-semibold text-white hover:bg-red-500"
          >
            Hentikan
          </button>
        )}
      </div>
      {needsUnmute && !screenShare.isSelf && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-black/40">
          <button
            type="button"
            onClick={() => {
              if (videoRef.current) {
                videoRef.current.muted = false;
                void videoRef.current.play();
              }
              setNeedsUnmute(false);
            }}
            className="rounded-full bg-accent-strong px-5 py-2.5 text-sm font-semibold text-white shadow-lg hover:bg-accent"
          >
            🔊 Aktifkan suara Share Screen
          </button>
        </div>
      )}
    </div>
  );
}

export default function PlayerStage({
  item,
  sync,
  screenShare,
  onStopScreenShare,
  videoVolume,
  reactions,
  peersBuffering,
  fill,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    setError(null);
    setCountdown(null);
  }, [item?.id]);

  useEffect(() => {
    if (screenShare) {
      sync.player.detach();
    }
  }, [screenShare, sync.player]);

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
      {/* Jika sedang ada Share Screen aktif, tampilkan di panggung video utama */}
      {screenShare ? (
        <ScreenShareStage screenShare={screenShare} videoVolume={videoVolume} onStop={onStopScreenShare} />
      ) : (
        <>
          {!item && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center">
              <div>
                <div className="text-4xl" aria-hidden>
                  🎬
                </div>
                <p className="mt-2 text-sm text-muted">
                  Tempel tautan video di bawah atau gunakan tombol Share Layar untuk mulai nonton.
                </p>
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
                <p className="text-xs text-white/80">
                  Video sedang diputar bersama — ketuk sekali untuk mengaktifkan suara.
                </p>
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
                    <button
                      onClick={() => setCountdown(null)}
                      className="rounded-lg px-4 py-2 text-sm text-muted underline"
                    >
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
        </>
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
