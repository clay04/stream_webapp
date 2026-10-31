"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { isDirectMediaUrl } from "@/lib/sources";
import type { QueueItem } from "@/lib/types";
import type { PlayerCallbacks } from "./types";

// Pemutar dimuat lazy agar tidak membebani LCP.
const YouTubePlayer = dynamic(() => import("./YouTubePlayer"), { ssr: false });
const Html5Player = dynamic(() => import("./Html5Player"), { ssr: false });
const EmbedPlayer = dynamic(() => import("./EmbedPlayer"), { ssr: false });

interface Props extends PlayerCallbacks {
  item: QueueItem;
  startSeconds: number;
  autoplay: boolean;
  playlistIndex: number;
}

function splitEmbedFallback(sourceId: string): { primary: string; fallbackEmbed: string | null } {
  const idx = sourceId.indexOf("#embed=");
  if (idx === -1) return { primary: sourceId, fallbackEmbed: null };
  return {
    primary: sourceId.slice(0, idx),
    fallbackEmbed: decodeURIComponent(sourceId.slice(idx + 7)),
  };
}

/** Memilih adapter pemutar berdasarkan sumber item antrean. */
export default function VideoPlayer({ item, onError, ...rest }: Props) {
  const [useFallbackEmbed, setUseFallbackEmbed] = useState(false);

  useEffect(() => {
    setUseFallbackEmbed(false);
  }, [item.id, item.source_id]);

  switch (item.source) {
    case "youtube":
    case "youtube_playlist":
      return (
        <YouTubePlayer
          sourceId={item.source_id}
          isPlaylist={item.source === "youtube_playlist"}
          onError={onError}
          {...rest}
        />
      );
    case "url": {
      const { primary, fallbackEmbed } = splitEmbedFallback(item.source_id);
      if (!useFallbackEmbed && isDirectMediaUrl(primary)) {
        return (
          <Html5Player
            sourceId={primary}
            onError={(msg, fatal) => {
              if (fallbackEmbed) {
                setUseFallbackEmbed(true);
              } else {
                onError(msg, fatal);
              }
            }}
            {...rest}
          />
        );
      }
      return <EmbedPlayer source={item.source} sourceId={fallbackEmbed ?? primary} onError={onError} {...rest} />;
    }
    case "vimeo":
    case "twitch":
      return <EmbedPlayer source={item.source} sourceId={item.source_id} onError={onError} {...rest} />;
    default:
      return (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted">
          Sumber “{item.source}” belum didukung di versi ini.
        </div>
      );
  }
}
