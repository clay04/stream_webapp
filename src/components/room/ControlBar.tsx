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
  onToggleFocus: () => void;
  onFullscreen: () => void;
  onReact: (emoji: string) => void;
}

/** Bar kontrol bersama: setiap aksi di sini disiarkan ke semua peserta. */
export default function ControlBar({ sync, rtc, hasItem, hasNext, focus, onToggleFocus, onFullscreen, onReact }: Props) {
  const [time, setTime] = useState({ pos: 0, dur: 0 });
  const [scrub, setScrub] = useState<number | null>(null);
  const [showReactions, setShowReactions] = useState(false);
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

      <div className="flex items-center gap-1">
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

        {/* Tombol mulai Voice / Video Call */}
        {!rtc.inCall && (
          <div className="ml-1 flex items-center gap-1">
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
          </div>
        )}

        <div className="relative ml-auto">
          <button
            className={btn}
            onClick={() => setShowReactions((s) => !s)}
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

