"use client";

import { useEffect, useRef } from "react";
import { isHls } from "@/lib/sources";
import type { PlayerAdapter, PlayerProps, PlayerState } from "./types";

/**
 * Pemutar HTML5 untuk tautan langsung ke file video milik sendiri (MP4/WebM/HLS).
 * Server file harus mendukung HTTP range request agar seek berjalan baik.
 */
export default function Html5Player(props: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cb = useRef(props);
  cb.current = props;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const { sourceId, startSeconds, autoplay } = cb.current;
    let destroyed = false;
    let hls: { destroy(): void } | null = null;
    let state: PlayerState = "unstarted";

    const setState = (s: PlayerState) => {
      if (state === s) return;
      state = s;
      cb.current.onStateChange(s);
    };

    const adapter: PlayerAdapter = {
      play: () => {
        video.play().catch(() => setState("paused"));
      },
      pause: () => video.pause(),
      seekTo: (s) => {
        video.currentTime = Math.max(0, s);
      },
      getCurrentTime: () => video.currentTime || 0,
      getDuration: () => (Number.isFinite(video.duration) ? video.duration : 0),
      getState: () => state,
      setRate: (r) => {
        video.playbackRate = r;
      },
      getRate: () => video.playbackRate,
      setVolume: (v) => {
        video.volume = Math.min(1, Math.max(0, v));
      },
      getPlaylistIndex: () => 0,
      playPlaylistIndex: () => {},
    };

    const onLoaded = () => {
      if (startSeconds > 0) video.currentTime = startSeconds;
      cb.current.onReady(adapter);
      if (autoplay) adapter.play();
    };
    const onPlaying = () => setState("playing");
    const onPause = () => {
      if (!video.ended) setState("paused");
    };
    const onWaiting = () => {
      if (!video.paused) setState("buffering");
    };
    const onEnded = () => setState("ended");
    const onRate = () => cb.current.onRateChange(video.playbackRate);
    const onError = () =>
      cb.current.onError(
        "File video tidak bisa diputar. Pastikan tautan mengarah langsung ke file video (bukan halaman pratinjau) dan bisa diakses publik.",
        true,
      );

    video.addEventListener("loadedmetadata", onLoaded, { once: true });
    video.addEventListener("playing", onPlaying);
    video.addEventListener("pause", onPause);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("ended", onEnded);
    video.addEventListener("ratechange", onRate);
    video.addEventListener("error", onError);

    if (isHls(sourceId) && !video.canPlayType("application/vnd.apple.mpegurl")) {
      import("hls.js").then(({ default: Hls }) => {
        if (destroyed) return;
        if (!Hls.isSupported()) {
          onError();
          return;
        }
        const h = new Hls();
        h.loadSource(sourceId);
        h.attachMedia(video);
        h.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) onError();
        });
        hls = h;
      });
    } else {
      video.src = sourceId;
    }

    return () => {
      destroyed = true;
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("ratechange", onRate);
      video.removeEventListener("error", onError);
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, []);

  return (
    <video
      ref={videoRef}
      className="absolute inset-0 h-full w-full bg-black"
      controls
      playsInline
      preload="auto"
      aria-label="Pemutar video"
    />
  );
}

