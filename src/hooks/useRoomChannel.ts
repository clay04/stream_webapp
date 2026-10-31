"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { PresenceMeta } from "@/lib/types";

export type ChannelStatus = "connecting" | "connected" | "error";
export type RoomEvent = "sync" | "state_request" | "queue" | "chat" | "reaction" | "room" | "rtc";
type Listener = (payload: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any

const EVENTS: RoomEvent[] = ["sync", "state_request", "queue", "chat", "reaction", "room", "rtc"];

/**
 * Satu channel Supabase Realtime privat per room ("room:<id>"):
 * Broadcast untuk event pemutar/chat/reaksi, Presence untuk status online.
 * Akses dibatasi oleh policy RLS pada realtime.messages (hanya anggota room).
 */
export function useRoomChannel(roomId: string | null, self: { userId: string; name: string } | null) {
  const [status, setStatus] = useState<ChannelStatus>("connecting");
  const [online, setOnline] = useState<PresenceMeta[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const listeners = useRef(new Map<RoomEvent, Set<Listener>>());
  const metaRef = useRef<PresenceMeta | null>(null);
  const onSubscribed = useRef(new Set<() => void>());

  const userId = self?.userId;
  const name = self?.name;

  useEffect(() => {
    if (!roomId || !userId) return;
    const supabase = getSupabaseBrowser();
    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);

      channel = supabase.channel(`room:${roomId}`, {
        config: { private: true, broadcast: { self: false }, presence: { key: userId } },
      });

      for (const ev of EVENTS) {
        channel.on("broadcast", { event: ev }, ({ payload }) => {
          listeners.current.get(ev)?.forEach((fn) => fn(payload));
        });
      }

      channel.on("presence", { event: "sync" }, () => {
        const state = channel!.presenceState<PresenceMeta>();
        const list: PresenceMeta[] = [];
        for (const key of Object.keys(state)) {
          const metas = state[key];
          if (metas?.length) list.push(metas[metas.length - 1]);
        }
        list.sort((a, b) => a.onlineAt - b.onlineAt);
        setOnline(list);
      });

      channel.subscribe(async (s) => {
        if (cancelled) return;
        if (s === "SUBSCRIBED") {
          setStatus("connected");
          metaRef.current = { userId, name: name ?? "Tamu", onlineAt: Date.now(), buffering: false };
          await channel!.track(metaRef.current);
          onSubscribed.current.forEach((fn) => fn());
        } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") {
          setStatus("error");
        } else if (s === "CLOSED") {
          setStatus("connecting");
        }
      });
      channelRef.current = channel;
    })();

    // Perbarui token realtime saat sesi disegarkan.
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) supabase.realtime.setAuth(session.access_token);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
      if (channel) supabase.removeChannel(channel);
      channelRef.current = null;
      setStatus("connecting");
    };
  }, [roomId, userId, name]);

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
    return () => {
      onSubscribed.current.delete(fn);
    };
  }, []);

  const updatePresence = useCallback((patch: Partial<PresenceMeta>) => {
    const ch = channelRef.current;
    if (!ch || !metaRef.current) return;
    metaRef.current = { ...metaRef.current, ...patch };
    void ch.track(metaRef.current);
  }, []);

  // Objek API stabil agar efek yang bergantung padanya tidak dijalankan ulang tiap render.
  const api = useMemo(() => ({ send, on, whenSubscribed, updatePresence }), [send, on, whenSubscribed, updatePresence]);

  return { status, online, api };
}

export type RoomChannel = ReturnType<typeof useRoomChannel>["api"];
