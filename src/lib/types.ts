export type RoomType = "permanent" | "temporary";
export type QueueSource = "youtube" | "youtube_playlist" | "url" | "vimeo" | "twitch" | "soundcloud";
export type PlaybackStatus = "playing" | "paused";

export interface Room {
  id: string;
  owner_id: string;
  name: string;
  room_code: string;
  is_locked: boolean;
  type: RoomType;
  last_active_at: string;
  created_at: string;
}

export interface Profile {
  id: string;
  display_name: string;
}

export interface RoomMember {
  room_id: string;
  user_id: string;
  role: "host" | "partner";
  joined_at: string;
  profiles?: Profile | null;
}

export interface QueueItem {
  id: string;
  room_id: string;
  source: QueueSource;
  source_id: string;
  title: string | null;
  thumbnail: string | null;
  position: number;
  added_by: string | null;
  played_at: string | null;
  created_at: string;
}

export interface RoomStateRow {
  room_id: string;
  current_item_id: string | null;
  status: PlaybackStatus;
  position: number;
  rate: number;
  playlist_index: number;
  updated_at: string;
  updated_by: string | null;
}

export interface ChatMessage {
  id: string;
  room_id: string;
  user_id: string;
  body: string;
  created_at: string;
}

/** State pemutaran bersama: "video X, status S, posisi P pada waktu T (jam server)". */
export interface SyncState {
  itemId: string | null;
  status: PlaybackStatus;
  position: number;
  rate: number;
  playlistIndex: number;
  /** Waktu (ms, jam server terkoreksi) saat `position` berlaku. */
  updatedAt: number;
  /** User yang terakhir mengubah state. */
  by: string | null;
}

export type SyncEventType = "play" | "pause" | "seek" | "change_video" | "rate_change" | "heartbeat" | "state";

export interface SyncEvent {
  type: SyncEventType;
  state: SyncState;
  /** Info sumber, agar penerima bisa memuat video meski antreannya belum ter-refresh. */
  videoId?: string | null;
  source?: QueueSource | null;
  sentAt: number;
  senderId: string;
}

export interface PresenceMeta {
  userId: string;
  name: string;
  onlineAt: number;
  buffering?: boolean;
  inCall?: boolean;
  camOn?: boolean;
}

