"use client";

import { useEffect, useRef } from "react";
import type { PlayerAdapter, PlayerProps, PlayerState } from "./types";

/* Tipe minimal YouTube IFrame Player API (https://developers.google.com/youtube/iframe_api_reference). */
interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setPlaybackRate(rate: number): void;
  getPlaybackRate(): number;
  setVolume(v: number): void;
  getPlaylistIndex(): number;
  playVideoAt(index: number): void;
  destroy(): void;
}
interface YTNamespace {
  Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer;
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;
function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT!);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => {
      apiPromise = null;
      reject(new Error("Gagal memuat YouTube IFrame API"));
    };
    document.head.appendChild(s);
  });
  return apiPromise;
}

const STATE_MAP: Record<number, PlayerState> = {
  [-1]: "unstarted",
  0: "ended",
  1: "playing",
  2: "paused",
  3: "buffering",
  5: "paused", // cued
};

const ERROR_MAP: Record<number, string> = {
  2: "Tautan video tidak valid.",
  5: "Video tidak bisa diputar di pemutar HTML5.",
  100: "Video tidak ditemukan atau sudah dihapus/dijadikan privat.",
  101: "Pemilik video tidak mengizinkan video ini diputar di situs lain.",
  150: "Pemilik video tidak mengizinkan video ini diputar di situs lain.",
};

interface Props extends PlayerProps {
  isPlaylist: boolean;
}

export default function YouTubePlayer(props: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cb = useRef(props);
  cb.current = props;

  // Player dibuat sekali per mount; komponen di-remount (key) saat item berganti.
  useEffect(() => {
    let player: YTPlayer | null = null;
    let disposed = false;
    const { sourceId, startSeconds, autoplay, isPlaylist, playlistIndex } = cb.current;

    loadYouTubeApi()
      .then((YT) => {
        if (disposed || !hostRef.current) return;
        const mount = document.createElement("div");
        hostRef.current.appendChild(mount);
        const playerVars: Record<string, unknown> = {
          autoplay: autoplay ? 1 : 0,
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          start: Math.max(0, Math.floor(startSeconds)),
          origin: window.location.origin,
        };
        if (isPlaylist) {
          playerVars.listType = "playlist";
          playerVars.list = sourceId;
          playerVars.index = playlistIndex ?? 0;
        }
        player = new YT.Player(mount, {
          width: "100%",
          height: "100%",
          videoId: isPlaylist ? undefined : sourceId,
          playerVars,
          events: {
            onReady: () => {
              if (disposed || !player) return;
              const p = player;
              // Pemutar yang sudah dihancurkan bisa melempar error; jangan biarkan merusak loop sinkronisasi.
              const safe = <T,>(fn: () => T, fallback: T): T => {
                try {
                  return fn();
                } catch {
                  return fallback;
                }
              };
              const adapter: PlayerAdapter = {
                play: () => safe(() => p.playVideo(), undefined),
                pause: () => safe(() => p.pauseVideo(), undefined),
                seekTo: (s) => safe(() => p.seekTo(Math.max(0, s), true), undefined),
                getCurrentTime: () => safe(() => p.getCurrentTime() ?? 0, 0),
                getDuration: () => safe(() => p.getDuration() ?? 0, 0),
                getState: () => safe(() => STATE_MAP[p.getPlayerState()] ?? "unstarted", "unstarted" as PlayerState),
                setRate: (r) => safe(() => p.setPlaybackRate(r), undefined),
                getRate: () => safe(() => p.getPlaybackRate() ?? 1, 1),
                setVolume: (v) => safe(() => p.setVolume(Math.round(v * 100)), undefined),
                getPlaylistIndex: () => (isPlaylist ? safe(() => Math.max(0, p.getPlaylistIndex() ?? 0), 0) : 0),
                playPlaylistIndex: (i) => (isPlaylist ? safe(() => p.playVideoAt(i), undefined) : undefined),
              };
              cb.current.onReady(adapter);
            },
            onStateChange: (e: { data: number }) => {
              const st = STATE_MAP[e.data];
              if (st) cb.current.onStateChange(st);
            },
            onPlaybackRateChange: (e: { data: number }) => cb.current.onRateChange(e.data),
            onError: (e: { data: number }) =>
              cb.current.onError(ERROR_MAP[e.data] ?? `Terjadi kesalahan pemutar (kode ${e.data}).`, true),
          },
        });
      })
      .catch((err: Error) => cb.current.onError(err.message, true));

    return () => {
      disposed = true;
      try {
        player?.destroy();
      } catch {
        /* abaikan */
      }
      if (hostRef.current) hostRef.current.innerHTML = "";
    };
  }, []);

  return <div ref={hostRef} className="absolute inset-0 [&_iframe]:h-full [&_iframe]:w-full" />;
}
