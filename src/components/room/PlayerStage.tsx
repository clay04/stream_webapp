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
  onCaptureSystemAudio: () => Promise<boolean>;
  onAttachDeviceAudio: (deviceId: string) => Promise<boolean>;
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
  onCaptureSystemAudio,
  onAttachDeviceAudio,
}: {
  screenShare: ActiveScreenShare;
  videoVolume: number;
  onStop: () => void;
  onCaptureSystemAudio: () => Promise<boolean>;
  onAttachDeviceAudio: (deviceId: string) => Promise<boolean>;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [needsUnmute, setNeedsUnmute] = useState(false);
  const [showAudioMenu, setShowAudioMenu] = useState(false);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);

  const hasAudioTrack = screenShare.stream
    .getAudioTracks()
    .some((t) => t.readyState === "live");

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

  const loadAudioDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    setLoadingDevices(true);
    try {
      let list = await navigator.mediaDevices.enumerateDevices();
      const inputs = list.filter((d) => d.kind === "audioinput");
      // Jika label masih kosong karena izin belum diberikan, minta izin singkat
      if (inputs.length > 0 && inputs.every((d) => !d.label) && navigator.mediaDevices.getUserMedia) {
        try {
          const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
          tmp.getTracks().forEach((t) => t.stop());
          list = await navigator.mediaDevices.enumerateDevices();
        } catch {
          /* abaikan */
        }
      }
      setAudioDevices(list.filter((d) => d.kind === "audioinput" && d.deviceId));
    } finally {
      setLoadingDevices(false);
    }
  };

  return (
    <div className="absolute inset-0 bg-black">
      <video ref={videoRef} autoPlay playsInline className="h-full w-full object-contain" />
      <div className="absolute left-3 top-3 z-20 flex flex-wrap items-center gap-2 rounded-2xl bg-black/80 px-3 py-1.5 text-xs text-white backdrop-blur-md">
        <span>🖥️ Layar {screenShare.name}</span>

        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            hasAudioTrack
              ? "bg-emerald-500/25 text-emerald-300 ring-1 ring-emerald-500/40"
              : "bg-amber-500/25 text-amber-200 ring-1 ring-amber-500/40"
          }`}
        >
          {hasAudioTrack ? "🔊 Audio Aktif" : "🔇 Tanpa Audio"}
        </span>

        {screenShare.isSelf && (
          <>
            <button
              type="button"
              onClick={() => {
                const next = !showAudioMenu;
                setShowAudioMenu(next);
                if (next) void loadAudioDevices();
              }}
              className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[11px] font-medium text-white ring-1 ring-white/20 hover:bg-border"
              title="Tambahkan atau ganti sumber suara sistem untuk Share Window / Layar"
            >
              {hasAudioTrack ? "⚙️ Sumber Audio" : "🔊 + Tambah Audio Sistem"}
            </button>

            <button
              type="button"
              onClick={onStop}
              className="rounded-full bg-red-600 px-2.5 py-0.5 text-[11px] font-semibold text-white hover:bg-red-500"
            >
              Hentikan
            </button>
          </>
        )}
      </div>

      {/* Menu penambah Audio Sistem saat pengguna melakukan Share Window / Entire Screen */}
      {screenShare.isSelf && showAudioMenu && (
        <div className="absolute left-3 top-14 z-30 w-80 max-w-[calc(100vw-24px)] rounded-2xl border border-white/15 bg-surface/95 p-3.5 text-xs text-white shadow-2xl backdrop-blur-md">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold">🔊 Audio Share Window / Layar</span>
            <button
              type="button"
              onClick={() => setShowAudioMenu(false)}
              className="rounded px-1.5 py-0.5 text-muted hover:bg-white/10 hover:text-white"
            >
              ✕
            </button>
          </div>

          <p className="mb-2.5 text-[11px] leading-relaxed text-muted">
            Jika browser tidak menyertakan suara saat memilih <strong>Window (Jendela)</strong>, kamu bisa menggabungkan suara sistem ke tayangan ini tanpa menghentikan video Window:
          </p>

          <button
            type="button"
            onClick={async () => {
              const ok = await onCaptureSystemAudio();
              if (ok) setShowAudioMenu(false);
            }}
            className="mb-3 w-full rounded-xl bg-accent-strong px-3 py-2 text-left text-xs font-semibold text-white hover:bg-accent"
          >
            🖥️ Ambil Audio dari &ldquo;Seluruh Layar&rdquo; / Tab
            <span className="mt-0.5 block text-[10px] font-normal text-pink-100/90">
              Pilih tab <b>Seluruh Layar (Entire Screen)</b> atau <b>Tab</b> lalu aktifkan centang <b>Bagikan audio sistem</b>.
            </span>
          </button>

          <div className="border-t border-border pt-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted">
                Atau pilih perangkat audio (Monitor / Stereo Mix):
              </span>
              <button
                type="button"
                onClick={() => void loadAudioDevices()}
                className="text-[11px] text-accent hover:underline"
              >
                {loadingDevices ? "Memuat…" : "Muat ulang"}
              </button>
            </div>

            {audioDevices.length === 0 ? (
              <p className="text-[11px] text-muted">Tidak ada perangkat input audio terdeteksi.</p>
            ) : (
              <div className="max-h-36 space-y-1 overflow-y-auto pr-1">
                {audioDevices.map((d, idx) => (
                  <button
                    key={d.deviceId || idx}
                    type="button"
                    onClick={async () => {
                      const ok = await onAttachDeviceAudio(d.deviceId);
                      if (ok) setShowAudioMenu(false);
                    }}
                    className="w-full truncate rounded-lg bg-surface-2 px-2.5 py-1.5 text-left text-[11px] hover:bg-border"
                    title={d.label || `Perangkat Audio ${idx + 1}`}
                  >
                    🎙️ {d.label || `Perangkat Audio ${idx + 1}`}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

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
  onCaptureSystemAudio,
  onAttachDeviceAudio,
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
        <ScreenShareStage
          screenShare={screenShare}
          videoVolume={videoVolume}
          onStop={onStopScreenShare}
          onCaptureSystemAudio={onCaptureSystemAudio}
          onAttachDeviceAudio={onAttachDeviceAudio}
        />
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
