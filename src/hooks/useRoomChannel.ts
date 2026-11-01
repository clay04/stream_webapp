"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { PresenceMeta } from "@/lib/types";

export type ChannelStatus = "connecting" | "connected" | "error";
export type RoomEvent = "sync" | "state_request" | "queue" | "chat" | "reaction" | "room" | "rtc" | "buffering";
type Listener = (payload: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any

const EVENTS: RoomEvent[] = ["sync", "state_request", "queue", "chat", "reaction", "room", "rtc", "buffering"];

/**
 * Satu channel Supabase Realtime per room ("room:<id>"):
 * Broadcast untuk event pemutar/chat/reaksi/WebRTC, Presence untuk status online & status panggilan.
 * Topic memakai UUID room (`room.id`) yang hanya bisa dibaca oleh anggota room melalui RLS `public.rooms`.
 */
export function useRoomChannel(
  roomId: string | null,
  self: { clientId: string; userId: string; name: string } | null,
) {
  const [status, setStatus] = useState<ChannelStatus>("connecting");
  const [online, setOnline] = useState<PresenceMeta[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const subscribedRef = useRef(false);
  const listeners = useRef(new Map<RoomEvent, Set<Listener>>());
  const metaRef = useRef<PresenceMeta | null>(null);
  const onSubscribed = useRef(new Set<() => void>());

  const clientId = self?.clientId;
  const userId = self?.userId;
  const name = self?.name;

  useEffect(() => {
    if (!roomId || !clientId || !userId) return;
    const supabase = getSupabaseBrowser();
    let cancelled = false;

    metaRef.current = {
      clientId,
      userId,
      name: name ?? "Tamu",
      onlineAt: metaRef.current?.onlineAt ?? Date.now(),
      inCall: metaRef.current?.inCall ?? false,
      camOn: metaRef.current?.camOn ?? false,
      screenSharing: metaRef.current?.screenSharing ?? false,
    };

    const channel = supabase.channel(`room:${roomId}`, {
      config: {
        broadcast: { self: false },
        presence: { key: clientId },
      },
    });
    channelRef.current = channel;

    for (const ev of EVENTS) {
      channel.on("broadcast", { event: ev }, ({ payload }) => {
        listeners.current.get(ev)?.forEach((fn) => fn(payload));
      });
    }

    const syncPresence = () => {
      const state = channel.presenceState<PresenceMeta>();
      const list: PresenceMeta[] = [];
      for (const key of Object.keys(state)) {
        const metas = state[key];
        if (metas?.length) {
          const latest = metas[metas.length - 1];
          list.push({ ...latest, clientId: latest.clientId || key });
        }
      }
      list.sort((a, b) => a.onlineAt - b.onlineAt);
      setOnline(list);
    };

    channel.on("presence", { event: "sync" }, syncPresence);
    channel.on("presence", { event: "join" }, syncPresence);
    channel.on("presence", { event: "leave" }, syncPresence);

    channel.subscribe(async (s) => {
      if (cancelled) return;
      if (s === "SUBSCRIBED") {
        subscribedRef.current = true;
        setStatus("connected");
        if (metaRef.current) {
          await channel.track(metaRef.current);
        }
        onSubscribed.current.forEach((fn) => fn());
      } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") {
        subscribedRef.current = false;
        setStatus("error");
      } else if (s === "CLOSED") {
        subscribedRef.current = false;
        setStatus("connecting");
      }
    });

    return () => {
      cancelled = true;
      subscribedRef.current = false;
      void supabase.removeChannel(channel);
      channelRef.current = null;
      setStatus("connecting");
    };
    // Sengaja tidak memasukkan `name` agar perubahan nama tidak memutus koneksi channel
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, clientId, userId]);

  // Jika nama berubah, cukup perbarui presence tanpa memutus channel
  useEffect(() => {
    if (!name || !metaRef.current || metaRef.current.name === name) return;
    metaRef.current = { ...metaRef.current, name };
    if (channelRef.current && subscribedRef.current) {
      void channelRef.current.track(metaRef.current);
    }
  }, [name]);

  const send = useCallback((event: RoomEvent, payload: unknown) => {
    const ch = channelRef.current;
    if (!ch) return;
    void ch.send({ type: "broadcast", event, payload });
  }, []);

  const on = useCallback((event: RoomEvent, fn: Listener) => {
    let set = listeners.current.get(event);
    if (!set) listeners.current.set(event, (set = new Set()));
    set.add(fn);
    return () => {
      set!.delete(fn);
    };
  }, []);

  const whenSubscribed = useCallback((fn: () => void) => {
    onSubscribed.current.add(fn);
    if (subscribedRef.current) fn();
    return () => {
      onSubscribed.current.delete(fn);
    };
  }, []);

  const updatePresence = useCallback((patch: Partial<PresenceMeta>) => {
    if (!metaRef.current) return;
    const next: PresenceMeta = { ...metaRef.current, ...patch };
    const changed = (Object.keys(patch) as (keyof PresenceMeta)[]).some(
      (k) => metaRef.current![k] !== next[k],
    );
    if (!changed) return;
    metaRef.current = next;
    const ch = channelRef.current;
    if (ch && subscribedRef.current) {
      void ch.track(metaRef.current);
    }
  }, []);

  const api = useMemo(() => ({ send, on, whenSubscribed, updatePresence }), [send, on, whenSubscribed, updatePresence]);

  return { status, online, api };
}

export type RoomChannel = ReturnType<typeof useRoomChannel>["api"];
