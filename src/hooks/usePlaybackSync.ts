"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { serverNow } from "@/lib/clock";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { QueueItem, SyncEvent, SyncEventType, SyncState } from "@/lib/types";
import type { PlayerAdapter, PlayerState } from "@/components/player/types";
import type { RoomChannel } from "./useRoomChannel";

/** Ambang koreksi (detik). */
const EVENT_THRESHOLD = 0.75; // saat menerima play/pause/seek eksplisit
const DRIFT_THRESHOLD = 1.5; // koreksi drift dari heartbeat / pemantauan lokal
const SEEK_JUMP = 1.4; // lompatan waktu lokal yang dianggap seek oleh pengguna
const HEARTBEAT_MS = 4000;
const POLL_MS = 500;

export function expectedPosition(s: SyncState, now = serverNow()) {
  if (s.status !== "playing") return s.position;
  return Math.max(0, s.position + ((now - s.updatedAt) / 1000) * s.rate);
}

export function nextQueueItem(queue: QueueItem[], currentId: string | null): QueueItem | null {
  const sorted = [...queue].sort((a, b) => a.position - b.position);
  if (!currentId) return sorted.find((i) => !i.played_at) ?? sorted[0] ?? null;
  const idx = sorted.findIndex((i) => i.id === currentId);
  if (idx === -1) return sorted.find((i) => !i.played_at) ?? null;
  return sorted[idx + 1] ?? null;
}

interface Options {
  roomId: string;
  selfClientId: string;
  selfUserId: string;
  selfName: string;
  channel: RoomChannel;
  initial: SyncState;
  queue: QueueItem[];
  onUnknownItem: () => void;
  onItemReceived: (item: QueueItem) => void;
}

/**
 * Inti sinkronisasi (PRD bagian 8). Semua peserta setara: aksi lokal (play/pause/seek/
 * ganti video/kecepatan) menjadi state bersama baru yang disiarkan; penerima menghitung
 * posisi target = position + (now - sentAt) lalu mengoreksi pemutar bila melewati ambang.
 */
export function usePlaybackSync({
  roomId,
  selfClientId,
  selfUserId,
  selfName,
  channel,
  initial,
  queue,
  onUnknownItem,
  onItemReceived,
}: Options) {
  const [state, setState] = useState<SyncState>(initial);
  const [playerState, setPlayerState] = useState<PlayerState>("unstarted");
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [peersBuffering, setPeersBuffering] = useState<string[]>([]);

  const desired = useRef<SyncState>(initial);
  const adapter = useRef<PlayerAdapter | null>(null);
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const onUnknownRef = useRef(onUnknownItem);
  onUnknownRef.current = onUnknownItem;
  const onItemReceivedRef = useRef(onItemReceived);
  onItemReceivedRef.current = onItemReceived;

  /** Event pemutar sebelum waktu ini dianggap akibat sinkronisasi (flag `remote`), bukan aksi pengguna. */
  const suppressUntil = useRef(0);
  const lastSample = useRef<{ t: number; pos: number; st: PlayerState; idx: number } | null>(null);
  const mismatchCount = useRef(0);
  const pauseTimer = useRef<number | null>(null);
  const persistTimer = useRef<number | null>(null);
  const bufferingRef = useRef(false);
  const peersBufferingMap = useRef(new Map<string, string>());

  const suppress = (ms = 1200) => {
    suppressUntil.current = Math.max(suppressUntil.current, performance.now() + ms);
  };
  const isSuppressed = () => performance.now() < suppressUntil.current;

  const setDesired = useCallback((s: SyncState) => {
    desired.current = s;
    setState(s);
  }, []);

  // ---------- Persistensi ke room_state (untuk peserta yang join belakangan) ----------
  const persist = useCallback(() => {
    if (persistTimer.current) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      const s = desired.current;
      void getSupabaseBrowser()
        .from("room_state")
        .update({
          current_item_id: s.itemId,
          status: s.status,
          position: expectedPosition(s),
          rate: s.rate,
          playlist_index: s.playlistIndex,
          updated_by: selfUserId,
        })
        .eq("room_id", roomId);
    }, 300);
  }, [roomId, selfUserId]);

  // ---------- Terapkan state bersama ke pemutar lokal ----------
  const reconcile = useCallback((threshold: number, skipSeekIfStarting = false) => {
    const a = adapter.current;
    if (!a) return;
    const s = desired.current;
    const st = a.getState();

    const item = queueRef.current.find((i) => i.id === s.itemId);
    if (item?.source === "youtube_playlist" && a.getPlaylistIndex() !== s.playlistIndex) {
      suppress(2500);
      a.playPlaylistIndex(s.playlistIndex);
      lastSample.current = null;
      return;
    }

    const target = expectedPosition(s);
    const curPos = a.getCurrentTime();
    if (!skipSeekIfStarting || Math.abs(curPos - target) > 3) {
      if (Math.abs(curPos - target) > threshold) {
        suppress();
        a.seekTo(target);
      }
    }
    if (Math.abs(a.getRate() - s.rate) > 0.01) {
      suppress();
      a.setRate(s.rate);
    }
    if (s.status === "playing" && st !== "playing" && st !== "buffering" && st !== "ended") {
      suppress();
      a.play();
    } else if (s.status === "paused" && (st === "playing" || st === "buffering")) {
      suppress();
      a.pause();
    }
    lastSample.current = null;
    mismatchCount.current = 0;
  }, []);

  // ---------- Aksi lokal → state bersama baru ----------
  const commit = useCallback(
    (type: SyncEventType, patch: Partial<SyncState>, explicitItem?: QueueItem | null) => {
      const now = serverNow();
      const s: SyncState = { ...desired.current, ...patch, updatedAt: now, by: selfClientId };
      setDesired(s);
      const item = explicitItem ?? queueRef.current.find((i) => i.id === s.itemId) ?? null;
      const evt: SyncEvent = {
        type,
        state: s,
        item,
        videoId: item?.source_id ?? null,
        source: item?.source ?? null,
        sentAt: now,
        senderId: selfClientId,
      };
      channel.send("sync", evt);
      persist();
    },
    [channel, persist, selfClientId, setDesired],
  );

  const currentPos = () => adapter.current?.getCurrentTime() ?? expectedPosition(desired.current);

  // ---------- Kontrol bersama (tombol di UI aplikasi) ----------
  const changeVideo = useCallback(
    (itemId: string | null, explicitItem?: QueueItem | null) => {
      const prev = desired.current.itemId;
      if (prev && prev !== itemId) {
        void getSupabaseBrowser()
          .from("queue_items")
          .update({ played_at: new Date().toISOString() })
          .eq("id", prev);
      }
      adapter.current = null;
      setAutoplayBlocked(false);
      commit(
        "change_video",
        { itemId, status: itemId ? "playing" : "paused", position: 0, playlistIndex: 0, rate: 1 },
        explicitItem,
      );
    },
    [commit],
  );

  const play = useCallback(() => {
    setAutoplayBlocked(false);
    commit("play", { status: "playing", position: currentPos() });
    reconcile(EVENT_THRESHOLD);
  }, [commit, reconcile]);

  /** Dipanggil saat pengguna menekan tombol pembuka blokir autoplay browser. */
  const unlockAndPlay = useCallback(() => {
    setAutoplayBlocked(false);
    if (desired.current.status !== "playing") {
      commit("play", { status: "playing", position: currentPos() });
    }
    reconcile(0.4);
  }, [commit, reconcile]);

  const pause = useCallback(() => {
    commit("pause", { status: "paused", position: currentPos() });
    reconcile(EVENT_THRESHOLD);
  }, [commit, reconcile]);

  const seekTo = useCallback(
    (pos: number) => {
      const dur = adapter.current?.getDuration() || Infinity;
      commit("seek", { position: Math.min(Math.max(0, pos), dur) });
      reconcile(0.3);
    },
    [commit, reconcile],
  );

  const seekBy = useCallback((delta: number) => seekTo(currentPos() + delta), [seekTo]);

  const next = useCallback(() => {
    const n = nextQueueItem(queueRef.current, desired.current.itemId);
    changeVideo(n?.id ?? null, n);
  }, [changeVideo]);

  const requestState = useCallback(() => {
    channel.send("state_request", { senderId: selfClientId });
  }, [channel, selfClientId]);

  // ---------- Callback dari pemutar ----------
  const onPlayerReady = useCallback(
    (a: PlayerAdapter) => {
      adapter.current = a;
      lastSample.current = null;
      suppress(1500);
      reconcile(EVENT_THRESHOLD, true);
    },
    [reconcile],
  );

  const handleEnded = useCallback(() => {
    const n = nextQueueItem(queueRef.current, desired.current.itemId);
    if (n) changeVideo(n.id, n);
    else if (desired.current.status === "playing") {
      commit("pause", { status: "paused", position: adapter.current?.getDuration() ?? desired.current.position });
    }
  }, [changeVideo, commit]);

  const onPlayerState = useCallback(
    (st: PlayerState) => {
      setPlayerState(st);
      if (st === "playing") setAutoplayBlocked(false);

      const buffering = st === "buffering";
      if (buffering !== bufferingRef.current) {
        bufferingRef.current = buffering;
        channel.send("buffering", { clientId: selfClientId, name: selfName, buffering });
      }

      if (st === "ended") {
        handleEnded();
        return;
      }
      if (isSuppressed() || !adapter.current) return;
      const d = desired.current;
      if (st === "playing" && d.status !== "playing") {
        if (pauseTimer.current) window.clearTimeout(pauseTimer.current);
        commit("play", { status: "playing", position: adapter.current.getCurrentTime() });
      } else if (st === "paused" && d.status === "playing") {
        // Tunda sebentar: menggeser scrubber YouTube memicu pause sesaat.
        if (pauseTimer.current) window.clearTimeout(pauseTimer.current);
        pauseTimer.current = window.setTimeout(() => {
          const a = adapter.current;
          if (!a || isSuppressed()) return;
          if (a.getState() === "paused" && desired.current.status === "playing") {
            commit("pause", { status: "paused", position: a.getCurrentTime() });
          }
        }, 400);
      }
    },
    [channel, commit, handleEnded, selfClientId, selfName],
  );

  const onPlayerRate = useCallback(
    (rate: number) => {
      if (isSuppressed() || Math.abs(rate - desired.current.rate) < 0.01) return;
      commit("rate_change", { rate, position: currentPos() });
    },
    [commit],
  );

  // ---------- Event dari peserta lain ----------
  useEffect(() => {
    const offSync = channel.on("sync", (evt: SyncEvent) => {
      if (!evt?.state || evt.senderId === selfClientId) return;
      if (evt.item) {
        onItemReceivedRef.current(evt.item);
      }
      const s = evt.state;
      const cur = desired.current;
      if (s.updatedAt < cur.updatedAt && evt.type !== "heartbeat" && evt.type !== "state") return;

      const itemChanged = s.itemId !== cur.itemId;
      if (itemChanged) {
        adapter.current = null;
        setAutoplayBlocked(false);
      }
      setDesired(s);
      if (s.itemId && !evt.item && !queueRef.current.some((i) => i.id === s.itemId)) {
        onUnknownRef.current();
      }
      if (!itemChanged) {
        reconcile(evt.type === "heartbeat" ? DRIFT_THRESHOLD : evt.type === "seek" ? 0.3 : EVENT_THRESHOLD);
      }
    });

    const offReq = channel.on("state_request", (p: { senderId: string }) => {
      if (p?.senderId === selfClientId) return;
      const d = desired.current;
      if (!d.itemId) return;
      const a = adapter.current;
      const fresh: SyncState =
        a && d.status === "playing" && a.getState() === "playing"
          ? { ...d, position: a.getCurrentTime(), updatedAt: serverNow() }
          : d;
      const item = queueRef.current.find((i) => i.id === fresh.itemId) ?? null;
      const evt: SyncEvent = { type: "state", state: fresh, item, sentAt: serverNow(), senderId: selfClientId };
      channel.send("sync", evt);
    });

    const offBuf = channel.on("buffering", (p: { clientId: string; name: string; buffering: boolean }) => {
      if (!p || p.clientId === selfClientId) return;
      if (p.buffering) peersBufferingMap.current.set(p.clientId, p.name);
      else peersBufferingMap.current.delete(p.clientId);
      setPeersBuffering(Array.from(peersBufferingMap.current.values()));
    });

    // Join di tengah jalan: minta state terkini dari peserta yang online.
    const offSub = channel.whenSubscribed(() => requestState());

    return () => {
      offSync();
      offReq();
      offBuf();
      offSub();
    };
  }, [channel, reconcile, requestState, selfClientId, setDesired]);

  // ---------- Pemantauan lokal: deteksi seek pengguna, koreksi drift & deteksi blokir autoplay ----------
  useEffect(() => {
    const id = window.setInterval(() => {
      const a = adapter.current;
      if (!a) return;
      const now = performance.now();
      const pos = a.getCurrentTime();
      const st = a.getState();
      const idx = a.getPlaylistIndex();
      const prev = lastSample.current;
      lastSample.current = { t: now, pos, st, idx };
      const d = desired.current;

      if (st === "playing") {
        setAutoplayBlocked(false);
      }

      if (!prev || isSuppressed()) return;

      // Pindah video di dalam playlist lewat kontrol YouTube.
      const item = queueRef.current.find((i) => i.id === d.itemId);
      if (item?.source === "youtube_playlist" && idx !== d.playlistIndex && st !== "unstarted") {
        commit("seek", { playlistIndex: idx, position: pos });
        return;
      }

      // Seek manual: posisi melompat di luar rentang wajar sejak sampel terakhir.
      const elapsed = (now - prev.t) / 1000;
      const maxAdvance = prev.st === "playing" || st === "playing" ? elapsed * a.getRate() : 0;
      const delta = pos - prev.pos;
      const jump = delta < 0 ? -delta : Math.max(0, delta - maxAdvance);
      if (jump > SEEK_JUMP && st !== "ended" && st !== "unstarted") {
        commit("seek", { position: pos });
        return;
      }

      // Drift (mis. setelah buffering): ikuti state bersama.
      if (d.status === "playing" && st === "playing" && Math.abs(pos - expectedPosition(d)) > DRIFT_THRESHOLD) {
        reconcile(DRIFT_THRESHOLD);
        return;
      }

      // Status tidak cocok cukup lama (mis. autoplay dengan suara diblokir browser) → coba terapkan & tampilkan tombol
      const mismatch =
        (d.status === "playing" && (st === "paused" || st === "unstarted")) ||
        (d.status === "paused" && st === "playing");
      mismatchCount.current = mismatch ? mismatchCount.current + 1 : 0;
      if (mismatchCount.current === 3) {
        reconcile(EVENT_THRESHOLD);
      } else if (mismatchCount.current >= 5 && d.status === "playing" && (st === "paused" || st === "unstarted")) {
        setAutoplayBlocked(true);
      }
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [commit, reconcile]);

  // ---------- Heartbeat berkala saat memutar ----------
  useEffect(() => {
    const id = window.setInterval(() => {
      const a = adapter.current;
      const d = desired.current;
      if (!a || d.status !== "playing" || a.getState() !== "playing" || isSuppressed()) return;
      // Pengirim terakhir (atau jika belum ada pengirim) menyiarkan heartbeat
      if (d.by && d.by !== selfClientId && d.by !== selfUserId) return;
      const s: SyncState = { ...d, position: a.getCurrentTime(), updatedAt: serverNow(), by: selfClientId };
      desired.current = s;
      const item = queueRef.current.find((i) => i.id === s.itemId) ?? null;
      const evt: SyncEvent = { type: "heartbeat", state: s, item, sentAt: s.updatedAt, senderId: selfClientId };
      channel.send("sync", evt);
      persist();
    }, HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [channel, persist, selfClientId, selfUserId]);

  useEffect(
    () => () => {
      if (pauseTimer.current) window.clearTimeout(pauseTimer.current);
      if (persistTimer.current) window.clearTimeout(persistTimer.current);
    },
    [],
  );

  const controls = useMemo(
    () => ({ play, unlockAndPlay, pause, seekTo, seekBy, next, changeVideo, resync: requestState }),
    [play, unlockAndPlay, pause, seekTo, seekBy, next, changeVideo, requestState],
  );
  const player = useMemo(
    () => ({
      onReady: onPlayerReady,
      onStateChange: onPlayerState,
      onRateChange: onPlayerRate,
      detach: () => {
        adapter.current = null;
      },
    }),
    [onPlayerReady, onPlayerState, onPlayerRate],
  );

  return {
    state,
    playerState,
    autoplayBlocked,
    peersBuffering,
    controls,
    player,
    getAdapter: () => adapter.current,
  };
}
