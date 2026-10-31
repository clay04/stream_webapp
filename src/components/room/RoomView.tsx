"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RoomData } from "@/app/room/[code]/RoomClient";
import { useRoomChannel } from "@/hooks/useRoomChannel";
import { usePlaybackSync } from "@/hooks/usePlaybackSync";
import { useWebRTC } from "@/hooks/useWebRTC";
import { getClientId } from "@/lib/identity";
import { loadQueue } from "@/lib/queue";
import type { ChatMessage, QueueItem, Room, SyncState } from "@/lib/types";
import AddVideoForm from "./AddVideoForm";
import CallBar, { CallAudioRenderer } from "./CallBar";
import ChatPanel from "./ChatPanel";
import ControlBar from "./ControlBar";
import InfoPanel from "./InfoPanel";
import PlayerStage, { type FloatingReaction } from "./PlayerStage";
import PresenceBar from "./PresenceBar";
import QueuePanel from "./QueuePanel";

type Tab = "queue" | "chat" | "info";

interface Props {
  initial: RoomData;
  userId: string;
  userName: string;
}

export default function RoomView({ initial, userId, userName }: Props) {
  const router = useRouter();
  const [clientId] = useState(() => getClientId());
  const [room, setRoom] = useState<Room>(initial.room);
  const [queue, setQueue] = useState(initial.queue);
  const [names, setNames] = useState<Record<string, string>>({ ...initial.profiles, [userId]: userName });
  const [messages, setMessages] = useState<ChatMessage[]>(initial.messages);
  const [tab, setTab] = useState<Tab>("queue");
  const [focus, setFocus] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const stageRef = useRef<HTMLDivElement>(null);

  const self = useMemo(() => ({ clientId, userId, name: userName }), [clientId, userId, userName]);
  const { status, online, api } = useRoomChannel(room.id, self);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const refreshQueue = useCallback(async () => {
    try {
      setQueue(await loadQueue(room.id));
    } catch {
      /* abaikan, coba lagi di event berikutnya */
    }
  }, [room.id]);

  const upsertQueueItem = useCallback((item: QueueItem) => {
    setQueue((prev) => {
      if (prev.some((q) => q.id === item.id)) return prev;
      return [...prev, item].sort((a, b) => a.position - b.position);
    });
  }, []);

  const initialSync = useMemo<SyncState>(() => {
    const s = initial.state;
    return {
      itemId: s?.current_item_id ?? null,
      status: s?.status ?? "paused",
      position: s?.position ?? 0,
      rate: s?.rate ?? 1,
      playlistIndex: s?.playlist_index ?? 0,
      updatedAt: s ? Date.parse(s.updated_at) : 0,
      by: s?.updated_by ?? null,
    };
  }, [initial.state]);

  const sync = usePlaybackSync({
    roomId: room.id,
    selfClientId: clientId,
    selfUserId: userId,
    selfName: userName,
    channel: api,
    initial: initialSync,
    queue,
    onUnknownItem: refreshQueue,
    onItemReceived: upsertQueueItem,
  });

  const rtc = useWebRTC({
    selfClientId: clientId,
    selfName: userName,
    channel: api,
    online,
    onVolumeDuck: (ducked) => {
      sync.getAdapter()?.setVolume(ducked ? 0.25 : 1);
    },
  });

  const notifyQueue = useCallback(() => {
    api.send("queue", { at: Date.now() });
    void refreshQueue();
  }, [api, refreshQueue]);

  const addReaction = useCallback((emoji: string, name: string) => {
    const r: FloatingReaction = { id: crypto.randomUUID(), emoji, name, left: 10 + Math.random() * 75 };
    setReactions((prev) => [...prev.slice(-20), r]);
    window.setTimeout(() => setReactions((prev) => prev.filter((x) => x.id !== r.id)), 2700);
  }, []);

  const sendReaction = useCallback(
    (emoji: string) => {
      api.send("reaction", { emoji, name: userName });
      addReaction(emoji, userName);
    },
    [api, addReaction, userName],
  );

  const onMessageSent = useCallback(
    (m: ChatMessage) => {
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      api.send("chat", { message: m, name: userName });
    },
    [api, userName],
  );

  useEffect(() => {
    const offs = [
      api.on("queue", () => void refreshQueue()),
      api.on("chat", (p: { message: ChatMessage; name: string }) => {
        if (!p?.message) return;
        setNames((n) => ({ ...n, [p.message.user_id]: p.name }));
        setMessages((prev) => (prev.some((x) => x.id === p.message.id) ? prev : [...prev, p.message]));
        if (tabRef.current !== "chat") setUnread((u) => u + 1);
      }),
      api.on("reaction", (p: { emoji: string; name: string }) => {
        if (p?.emoji) addReaction(p.emoji, p.name);
      }),
      api.on("room", (p: { type: "updated"; room: Room } | { type: "deleted" }) => {
        if (p?.type === "updated") setRoom(p.room);
        if (p?.type === "deleted") {
          alert("Room ini sudah dihapus oleh pemiliknya.");
          router.replace("/");
        }
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [api, addReaction, refreshQueue, router]);

  useEffect(() => {
    setNames((n) => {
      let changed = false;
      const next = { ...n };
      for (const p of online) {
        if (p.userId && next[p.userId] !== p.name) {
          next[p.userId] = p.name;
          changed = true;
        }
      }
      return changed ? next : n;
    });
  }, [online]);

  useEffect(() => {
    if (tab === "chat") setUnread(0);
  }, [tab]);

  const currentItem = queue.find((i) => i.id === sync.state.itemId) ?? null;
  const showOverlayCall = focus || isFullscreen;

  const panel = (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Panel Voice Call & Video Call di bagian atas Sidebar Kanan */}
      {!showOverlayCall && (
        <CallBar rtc={rtc} selfClientId={clientId} selfName={userName} online={online} mode="sidebar" />
      )}

      <div role="tablist" aria-label="Panel room" className="flex shrink-0 border-b border-border">
        {(
          [
            ["queue", `Antrean (${queue.filter((q) => !q.played_at || q.id === currentItem?.id).length})`],
            ["chat", unread ? `Chat (${unread})` : "Chat"],
            ["info", "Info"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`flex-1 px-3 py-3 text-sm font-medium transition ${
              tab === key ? "border-b-2 border-accent text-white" : "text-muted hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "queue" && (
          <QueuePanel
            roomId={room.id}
            userId={userId}
            queue={queue}
            currentId={sync.state.itemId}
            names={names}
            onPlay={(id) => {
              const target = queue.find((q) => q.id === id) ?? null;
              sync.controls.changeVideo(id, target);
            }}
            onChanged={notifyQueue}
          />
        )}
        {tab === "chat" && (
          <ChatPanel
            roomId={room.id}
            userId={userId}
            messages={messages}
            names={names}
            onSent={onMessageSent}
            onReact={sendReaction}
          />
        )}
        {tab === "info" && (
          <InfoPanel
            room={room}
            userId={userId}
            online={online}
            names={names}
            onRoomUpdated={(r) => {
              setRoom(r);
              api.send("room", { type: "updated", room: r });
            }}
            onRoomDeleted={() => {
              api.send("room", { type: "deleted" });
              router.replace("/");
            }}
          />
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-dvh flex-col">
      {/* Audio panggilan tetap hidup meskipun beralih antara mode normal dan Fullscreen/Fokus */}
      <CallAudioRenderer peers={rtc.peers} />

      {!focus && (
        <header className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-2 sm:px-4">
          <button onClick={() => router.push("/")} className="text-xl" aria-label="Kembali ke beranda">
            🍿
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold sm:text-base">{room.name}</h1>
            <p className="text-xs text-muted">
              <span className="font-mono">{room.room_code}</span>
              {room.is_locked ? " · 🔒 Terkunci" : " · 🔓 Terbuka"}
              {status !== "connected" && (
                <span className={status === "error" ? " text-red-300" : ""}>
                  {status === "error" ? " · Koneksi realtime gagal" : " · Menghubungkan…"}
                </span>
              )}
            </p>
          </div>
          <PresenceBar online={online} selfClientId={clientId} />
        </header>
      )}

      <div className={`flex min-h-0 flex-1 flex-col ${focus ? "" : "lg:flex-row"}`}>
        <section className="flex min-h-0 flex-col lg:flex-1">
          <div ref={stageRef} className="relative bg-black">
            <PlayerStage
              item={currentItem}
              sync={sync}
              screenShare={rtc.activeScreenShare}
              onStopScreenShare={() => void rtc.toggleScreenShare()}
              reactions={reactions}
              peersBuffering={sync.peersBuffering}
              fill={focus}
            />
            {/* Saat Fullscreen atau Mode Fokus, tampilan Voice/Video Call tetap melayang bersama video utama */}
            {showOverlayCall && (
              <CallBar rtc={rtc} selfClientId={clientId} selfName={userName} online={online} mode="overlay" />
            )}
          </div>
          <ControlBar
            sync={sync}
            rtc={rtc}
            hasItem={!!currentItem}
            hasNext={queue.length > 0}
            focus={focus}
            onToggleFocus={() => setFocus((f) => !f)}
            onFullscreen={() => {
              const el = stageRef.current;
              if (!el) return;
              if (document.fullscreenElement) void document.exitFullscreen();
              else void el.requestFullscreen?.().catch(() => setFocus(true));
            }}
            onReact={sendReaction}
          />
          {!focus && (
            <div className="border-b border-border px-3 py-3 sm:px-4 lg:border-b-0">
              <AddVideoForm
                roomId={room.id}
                userId={userId}
                queue={queue}
                currentId={sync.state.itemId}
                onAdded={(item, playNow) => {
                  upsertQueueItem(item);
                  api.send("queue", { at: Date.now() });
                  if (playNow || !sync.state.itemId) sync.controls.changeVideo(item.id, item);
                }}
              />
            </div>
          )}
        </section>

        {!focus && (
          <aside className="flex min-h-0 flex-1 flex-col border-border lg:w-[380px] lg:flex-none lg:border-l">
            {panel}
          </aside>
        )}
      </div>
    </div>
  );
}
