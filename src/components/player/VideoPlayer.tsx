"use client";

import dynamic from "next/dynamic";
import type { QueueItem } from "@/lib/types";
import type { PlayerCallbacks } from "./types";

// Pemutar dimuat lazy agar tidak membebani LCP.
const YouTubePlayer = dynamic(() => import("./YouTubePlayer"), { ssr: false });
const Html5Player = dynamic(() => import("./Html5Player"), { ssr: false });

interface Props extends PlayerCallbacks {
  item: QueueItem;
  startSeconds: number;
  autoplay: boolean;
  playlistIndex: number;
}

/** Memilih adapter pemutar berdasarkan sumber item antrean. */
export default function VideoPlayer({ item, ...rest }: Props) {
  switch (item.source) {
    case "youtube":
    case "youtube_playlist":
      return <YouTubePlayer sourceId={item.source_id} isPlaylist={item.source === "youtube_playlist"} {...rest} />;
    case "url":
      return <Html5Player sourceId={item.source_id} {...rest} />;
    default:
      return (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted">
          Sumber “{item.source}” belum didukung di versi ini.
        </div>
      );
  }
}

