"use client";

import { useEffect, useMemo, useRef } from "react";
import type { QueueSource } from "@/lib/types";
import type { PlayerAdapter, PlayerProps, PlayerState } from "./types";

interface Props extends PlayerProps {
  source: QueueSource;
}

/**
 * Pemutar Embed (iframe), Vimeo, Twitch, dan URL embed lainnya.
 * Mengimplementasikan PlayerAdapter agar pergantian video di antrean dan kontrol dasar tetap berjalan.
 */
export default function EmbedPlayer(props: Props) {
  const cb = useRef(props);
  cb.current = props;
  const stateRef = useRef<PlayerState>("playing");
  const startWallRef = useRef<number>(Date.now() - props.startSeconds * 1000);

  const embedSrc = useMemo(() => {
    const { source, sourceId } = props;
    if (source === "vimeo") {
      return `https://player.vimeo.com/video/${sourceId}?autoplay=1`;
    }
    if (source === "twitch") {
      const parent = typeof window !== "undefined" ? window.location.hostname : "localhost";
      if (sourceId.startsWith("video:")) {
        return `https://player.twitch.tv/?video=${sourceId.slice(6)}&parent=${parent}&autoplay=true`;
      }
      const ch = sourceId.replace(/^channel:/, "");
      return `https://player.twitch.tv/?channel=${ch}&parent=${parent}&autoplay=true`;
    }
    return sourceId;
  }, [props.source, props.sourceId]);

  useEffect(() => {
    startWallRef.current = Date.now() - cb.current.startSeconds * 1000;
    const adapter: PlayerAdapter = {
      play: () => {
        stateRef.current = "playing";
        cb.current.onStateChange("playing");
      },
      pause: () => {
        stateRef.current = "paused";
        cb.current.onStateChange("paused");
      },
      seekTo: (s) => {
        startWallRef.current = Date.now() - Math.max(0, s) * 1000;
      },
      getCurrentTime: () => Math.max(0, (Date.now() - startWallRef.current) / 1000),
      getDuration: () => 0,
      getState: () => stateRef.current,
      setRate: () => {},
      getRate: () => 1,
      setVolume: () => {},
      getPlaylistIndex: () => 0,
      playPlaylistIndex: () => {},
    };
    cb.current.onReady(adapter);
    cb.current.onStateChange("playing");
  }, [embedSrc]);

  return (
    <iframe
      src={embedSrc}
      className="absolute inset-0 h-full w-full border-0 bg-black"
      allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
      allowFullScreen
      title="Pemutar video"
    />
  );
}

