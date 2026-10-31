export type PlayerState = "unstarted" | "playing" | "paused" | "buffering" | "ended";

/**
 * Adapter pemutar: semua sumber (YouTube, MP4/HLS, nanti Vimeo/Twitch) dibungkus
 * dengan antarmuka yang sama sehingga logika sinkronisasi tidak perlu tahu sumbernya.
 */
export interface PlayerAdapter {
  play(): void;
  pause(): void;
  seekTo(seconds: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  getState(): PlayerState;
  setRate(rate: number): void;
  getRate(): number;
  setVolume(volume: number): void;
  /** Hanya untuk playlist; selain itu selalu 0. */
  getPlaylistIndex(): number;
  playPlaylistIndex(index: number): void;
}

export interface PlayerCallbacks {
  onReady: (adapter: PlayerAdapter) => void;
  onStateChange: (state: PlayerState) => void;
  onRateChange: (rate: number) => void;
  onError: (message: string, fatal: boolean) => void;
}

export interface PlayerProps extends PlayerCallbacks {
  sourceId: string;
  startSeconds: number;
  autoplay: boolean;
  playlistIndex?: number;
}

