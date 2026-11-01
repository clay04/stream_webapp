"use client";

import { useEffect, useState } from "react";
import { expectedPosition, type usePlaybackSync } from "@/hooks/usePlaybackSync";
import type { WebRTCController } from "@/hooks/useWebRTC";

export const REACTIONS = ["❤️", "😂", "😮", "😢", "🔥", "👏"];

function fmt(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

interface Props {
  sync: ReturnType<typeof usePlaybackSync>;
  rtc: WebRTCController;
  hasItem: boolean;
  hasNext: boolean;
  focus: boolean;
  videoVolume: number;
  onVideoVolumeChange: (v: number) => void;
  callVolume: number;
  onCallVolumeChange: (v: number) => void;
  onToggleFocus: () => void;
  onFullscreen: () => void;
  onReact: (emoji: string) => void;
}

/** Bar kontrol bersama: setiap aksi di sini disiarkan ke semua peserta. */
export default function ControlBar({
  sync,
  rtc,
  hasItem,
  hasNext,
  focus,
  videoVolume,
  onVideoVolumeChange,
  callVolume,
  onCallVolumeChange,
  onToggleFocus,
  onFullscreen,
  onReact,
}: Props) {
  const [time, setTime] = useState({ pos: 0, dur: 0 });
  const [scrub, setScrub] = useState<number | null>(null);
  const [showReactions, setShowReactions] = useState(false);
  const [showMixer, setShowMixer] = useState(false);
  const { getAdapter, state } = sync;

  useEffect(() => {
    const id = window.setInterval(() => {
      const a = getAdapter();
      setTime({ pos: a ? a.getCurrentTime() : expectedPosition(state), dur: a ? a.getDuration() : 0 });
    }, 500);
    return () => window.clearInterval(id);
  }, [getAdapter, state]);

  const playing = state.status === "playing";
  const btn =
    "grid h-10 min-w-10 place-items-center rounded-lg px-2 text-lg transition hover:bg-surface-2 disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <div className="flex flex-col gap-1 border-b border-border bg-surface px-2 py-2 sm:px-3">
      <div className="flex items-center gap-2 px-1 text-xs tabular-nums text-muted">
        <span>{fmt(scrub ?? time.pos)}</span>
        <input
          type="range"
          aria-label="Posisi video"
          className="h-1 flex-1 cursor-pointer accent-pink-500"
          min={0}
          max={Math.max(1, time.dur)}
          step={1}
          value={Math.min(scrub ?? time.pos, Math.max(1, time.dur))}
          disabled={!hasItem || !time.dur}
          onChange={(e) => setScrub(Number(e.target.value))}
          onPointerUp={() => {
            if (scrub !== null) sync.controls.seekTo(scrub);
            setScrub(null);
          }}
          onKeyUp={() => {
            if (scrub !== null) sync.controls.seekTo(scrub);
            setScrub(null);
          }}
        />
        <span>{fmt(time.dur)}</span>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <button className={btn} disabled={!hasItem} onClick={() => sync.controls.seekBy(-10)} aria-label="Mundur 10 detik">
          ⏪
        </button>
        <button
          className={`${btn} bg-accent-strong/90 text-white hover:bg-accent`}
          disabled={!hasItem}
          onClick={() => (playing ? sync.controls.pause() : sync.controls.play())}
          aria-label={playing ? "Jeda untuk semua" : "Putar untuk semua"}
        >
          {playing ? "⏸" : "▶"}
        </button>
        <button className={btn} disabled={!hasItem} onClick={() => sync.controls.seekBy(10)} aria-label="Maju 10 detik">
          ⏩
        </button>
        <button className={btn} disabled={!hasNext} onClick={() => sync.controls.next()} aria-label="Video berikutnya">
          ⏭
        </button>
        <button className={btn} onClick={() => sync.controls.resync()} aria-label="Sinkronkan ulang" title="Sinkronkan ulang">
          🔄
        </button>

        {/* Tombol Share Layar & Voice/Video Call */}
        <div className="ml-1 flex items-center gap-1">
          <button
            type="button"
            onClick={() => void rtc.toggleScreenShare()}
            aria-pressed={rtc.screenSharing}
            className={`flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition ${
              rtc.screenSharing
                ? "border-accent bg-accent/20 text-pink-200"
                : "border-border bg-surface-2 hover:border-accent"
            }`}
            title="Bagikan layar / tab browser ke panggung video utama"
          >
            <span>🖥️</span>
            <span className="hidden sm:inline">{rtc.screenSharing ? "Stop Share" : "Share Layar"}</span>
          </button>

          {!rtc.inCall && (
            <>
              <button
                type="button"
                disabled={rtc.connecting}
                onClick={() => void rtc.joinCall(false)}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 text-xs font-medium hover:border-accent disabled:opacity-50"
                title="Mulai panggilan suara (Voice Call)"
              >
                <span>📞</span>
                <span className="hidden sm:inline">Voice Call</span>
              </button>
              <button
                type="button"
                disabled={rtc.connecting}
                onClick={() => void rtc.joinCall(true)}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 text-xs font-medium hover:border-accent disabled:opacity-50"
                title="Mulai panggilan video (Video Call)"
              >
                <span>📹</span>
                <span className="hidden sm:inline">Video Call</span>
              </button>
            </>
          )}
        </div>

        {/* Pengatur Volume Video Utama & Panggilan (Audio Mixer) */}
        <div className="relative ml-auto flex items-center gap-1">
          <div className="hidden items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 sm:flex">
            <button
              type="button"
              onClick={() => onVideoVolumeChange(videoVolume > 0 ? 0 : 1)}
              className="text-sm"
              title="Volume Video Utama"
            >
              {videoVolume === 0 ? "🔇" : videoVolume < 0.5 ? "🔉" : "🔊"}
            </button>
            <input
              type="range"
              aria-label="Volume video utama"
              min={0}
              max={1}
              step={0.05}
              value={videoVolume}
              onChange={(e) => onVideoVolumeChange(Number(e.target.value))}
              className="h-1 w-20 cursor-pointer accent-pink-500"
            />
          </div>

          <button
            type="button"
            className={`${btn} text-base`}
            onClick={() => {
              setShowMixer((m) => !m);
              setShowReactions(false);
            }}
            aria-expanded={showMixer}
            aria-label="Mixer volume video dan panggilan"
            title="Atur perbandingan suara Video Utama & Panggilan"
          >
            🎚️
          </button>

          {showMixer && (
            <div className="absolute bottom-12 right-0 z-30 w-72 rounded-2xl border border-border bg-surface-2 p-3.5 shadow-2xl">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="text-xs font-semibold">Mixer Suara</span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      onCallVolumeChange(1.5);
                      onVideoVolumeChange(0.35);
                    }}
                    className="rounded-md border border-border bg-surface px-2 py-0.5 text-[10px] hover:border-accent"
                    title="Besarkan suara pasangan, kecilkan suara film"
                  >
                    Fokus Call
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onCallVolumeChange(1);
                      onVideoVolumeChange(1);
                    }}
                    className="rounded-md border border-border bg-surface px-2 py-0.5 text-[10px] hover:border-accent"
                  >
                    Seimbang
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onCallVolumeChange(0.6);
                      onVideoVolumeChange(1);
                    }}
                    className="rounded-md border border-border bg-surface px-2 py-0.5 text-[10px] hover:border-accent"
                    title="Besarkan suara film, kecilkan suara panggilan"
                  >
                    Fokus Video
                  </button>
                </div>
              </div>

              <div className="space-y-2.5 text-xs">
                <div>
                  <div className="mb-1 flex justify-between">
                    <span className="text-muted">📞 Suara Panggilan (Call)</span>
                    <span className="font-mono tabular-nums text-emerald-300">{Math.round(callVolume * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    value={callVolume}
                    onChange={(e) => onCallVolumeChange(Number(e.target.value))}
                    className="h-1.5 w-full cursor-pointer accent-emerald-400"
                  />
                </div>

                <div>
                  <div className="mb-1 flex justify-between">
                    <span className="text-muted">🎬 Suara Video Utama</span>
                    <span className="font-mono tabular-nums text-pink-300">{Math.round(videoVolume * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={videoVolume}
                    onChange={(e) => onVideoVolumeChange(Number(e.target.value))}
                    className="h-1.5 w-full cursor-pointer accent-pink-500"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="relative">
          <button
            className={btn}
            onClick={() => {
              setShowReactions((s) => !s);
              setShowMixer(false);
            }}
            aria-expanded={showReactions}
            aria-label="Kirim reaksi"
          >
            😊
          </button>
          {showReactions && (
            <div className="absolute bottom-12 right-0 z-20 flex gap-1 rounded-xl border border-border bg-surface-2 p-1 shadow-xl">
              {REACTIONS.map((r) => (
                <button
                  key={r}
                  className="grid h-10 w-10 place-items-center rounded-lg text-xl hover:bg-surface"
                  onClick={() => onReact(r)}
                  aria-label={`Reaksi ${r}`}
                >
                  {r}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          className={btn}
          onClick={onToggleFocus}
          aria-pressed={focus}
          aria-label={focus ? "Keluar mode fokus" : "Mode fokus"}
          title={focus ? "Keluar mode fokus" : "Mode fokus"}
        >
          {focus ? "🗗" : "🎯"}
        </button>
        <button className={btn} onClick={onFullscreen} aria-label="Layar penuh" title="Layar penuh">
          ⛶
        </button>
      </div>
    </div>
  );
}
