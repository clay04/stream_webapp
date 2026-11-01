"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PresenceMeta } from "@/lib/types";
import type { RoomChannel } from "./useRoomChannel";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  { urls: "stun:stun.cloudflare.com:3478" },
];

const CALL_STORAGE_KEY = "nb:active_call";

export interface RemotePeer {
  clientId: string;
  name: string;
  inCall: boolean;
  stream: MediaStream;
  screenStream: MediaStream;
  streamVersion: number;
  micMuted: boolean;
  camOn: boolean;
  screenSharing: boolean;
}

export interface ActiveScreenShare {
  stream: MediaStream;
  streamVersion: number;
  name: string;
  isSelf: boolean;
}

interface MediaStatePayload {
  sessionId: string;
  inCall: boolean;
  micMuted: boolean;
  camOn: boolean;
  screenSharing: boolean;
  callStreamId: string | null;
  screenStreamId: string | null;
}

type RtcSignal =
  | ({ type: "join" | "media-state"; from: string; name: string; reply?: boolean } & MediaStatePayload)
  | { type: "leave"; from: string; sessionId?: string }
  | ({
      type: "signal";
      from: string;
      to: string;
      name: string;
      description?: RTCSessionDescriptionInit;
      candidate?: RTCIceCandidateInit;
    } & Partial<MediaStatePayload>);

interface PeerInternal {
  pc: RTCPeerConnection;
  sessionId: string | null;
  name: string;
  inCall: boolean;
  stream: MediaStream;
  screenStream: MediaStream;
  streamTracks: Map<string, Set<MediaStreamTrack>>;
  knownScreenStreamIds: Set<string>;
  fallbackTracks: Set<MediaStreamTrack>;
  streamVersion: number;
  micMuted: boolean;
  camOn: boolean;
  screenSharing: boolean;
  callStreamId: string | null;
  screenStreamId: string | null;
  hasConnectedOnce: boolean;
  makingOffer: boolean;
  needsNegotiation: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  disconnectTimer?: number;
  analyser?: AnalyserNode;
  sourceNode?: MediaStreamAudioSourceNode;
}

interface Options {
  selfClientId: string;
  selfName: string;
  channel: RoomChannel;
  online: PresenceMeta[];
  onVolumeDuck: (ducked: boolean) => void;
}

function sameTracks(a: MediaStream, b: MediaStreamTrack[]): boolean {
  const cur = a.getTracks();
  if (cur.length !== b.length) return false;
  return cur.every((t) => b.some((x) => x.id === t.id));
}

function saveCallSessionState(state: { inCall: boolean; camOn: boolean; micMuted: boolean } | null) {
  if (typeof window === "undefined") return;
  try {
    if (!state || !state.inCall) {
      sessionStorage.removeItem(CALL_STORAGE_KEY);
    } else {
      sessionStorage.setItem(CALL_STORAGE_KEY, JSON.stringify(state));
    }
  } catch {
    /* abaikan */
  }
}

function loadCallSessionState(): { inCall: boolean; camOn: boolean; micMuted: boolean } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CALL_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as { inCall: boolean; camOn: boolean; micMuted: boolean };
  } catch {
    return null;
  }
}

/**
 * WebRTC Voice Call, Video Call, dan Share Screen terpisah:
 * - Koneksi yang sudah aktif (`RTCPeerConnection`) dipertahankan saat menyalakan/mematikan Share Screen
 *   maupun kamera sehingga panggilan tidak pernah terputus.
 * - Setiap muat ulang halaman memiliki `sessionId` baru sehingga peer lama otomatis di-reset bersih (tidak tekancing).
 * - Menyimpan status panggilan di `sessionStorage` agar saat halaman di-refresh tanpa menutup call, otomatis gabung kembali.
 */
export function useWebRTC({ selfClientId, selfName, channel, online, onVolumeDuck }: Options) {
  const [inCall, setInCall] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [autoDuck, setAutoDuck] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [localVersion, setLocalVersion] = useState(1);
  const [peers, setPeers] = useState<RemotePeer[]>([]);
  const [speaking, setSpeaking] = useState<Record<string, boolean>>({});

  /** ID unik per sesi koneksi untuk mendeteksi bila pasangan baru saja me-refresh halaman. */
  const sessionIdRef = useRef<string>(typeof crypto !== "undefined" ? crypto.randomUUID() : String(Date.now()));
  const inCallRef = useRef(false);
  const micMutedRef = useRef(false);
  const camOnRef = useRef(false);
  const screenSharingRef = useRef(false);
  const autoDuckRef = useRef(true);
  autoDuckRef.current = autoDuck;

  const onlineRef = useRef(online);
  onlineRef.current = online;

  const localStreamRef = useRef<MediaStream | null>(null);
  const localScreenStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef(new Map<string, PeerInternal>());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const localAnalyserRef = useRef<AnalyserNode | null>(null);
  const duckHoldUntilRef = useRef(0);
  const isDuckedRef = useRef(false);
  const autoRejoinedRef = useRef(false);
  const onVolumeDuckRef = useRef(onVolumeDuck);
  onVolumeDuckRef.current = onVolumeDuck;

  const currentMediaPayload = useCallback(
    (): MediaStatePayload => ({
      sessionId: sessionIdRef.current,
      inCall: inCallRef.current,
      micMuted: micMutedRef.current,
      camOn: camOnRef.current,
      screenSharing: screenSharingRef.current,
      callStreamId: localStreamRef.current?.id ?? null,
      screenStreamId: localScreenStreamRef.current?.id ?? null,
    }),
    [],
  );

  const syncPeersState = useCallback(() => {
    const list: RemotePeer[] = [];
    for (const [clientId, p] of peersRef.current.entries()) {
      list.push({
        clientId,
        name: p.name,
        inCall: p.inCall,
        stream: p.stream,
        screenStream: p.screenStream,
        streamVersion: p.streamVersion,
        micMuted: p.micMuted,
        camOn: p.camOn,
        screenSharing: p.screenSharing,
      });
    }
    setPeers(list);
  }, []);

  const ensureAudioContext = useCallback(() => {
    if (typeof window === "undefined") return null;
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (Ctx) audioCtxRef.current = new Ctx();
    }
    if (audioCtxRef.current?.state === "suspended") {
      void audioCtxRef.current.resume().catch(() => {});
    }
    return audioCtxRef.current;
  }, []);

  const attachStreamAnalyser = useCallback(
    (stream: MediaStream): { analyser?: AnalyserNode; sourceNode?: MediaStreamAudioSourceNode } => {
      if (stream.getAudioTracks().length === 0) return {};
      const ctx = ensureAudioContext();
      if (!ctx) return {};
      try {
        const sourceNode = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        sourceNode.connect(analyser);
        return { analyser, sourceNode };
      } catch {
        return {};
      }
    },
    [ensureAudioContext],
  );

  const closePeer = useCallback(
    (peerId: string) => {
      const p = peersRef.current.get(peerId);
      if (!p) return;
      if (p.disconnectTimer) window.clearTimeout(p.disconnectTimer);
      try {
        p.sourceNode?.disconnect();
        p.pc.onicecandidate = null;
        p.pc.ontrack = null;
        p.pc.onnegotiationneeded = null;
        p.pc.onsignalingstatechange = null;
        p.pc.onconnectionstatechange = null;
        p.pc.close();
      } catch {
        /* abaikan */
      }
      peersRef.current.delete(peerId);
      syncPeersState();
    },
    [syncPeersState],
  );

  /**
   * Pisahkan track Panggilan (mic/webcam) dan track Share Screen ke masing-masing MediaStream.
   * Hanya membuat instance MediaStream baru untuk stream yang daftar track-nya benar-benar berubah,
   * sehingga memulai/menghentikan Share Screen tidak menyentuh stream suara/video panggilan.
   */
  const routePeerTracks = useCallback(
    (peer: PeerInternal): boolean => {
      const callTracks: MediaStreamTrack[] = [];
      const screenTracks: MediaStreamTrack[] = [];

      for (const [streamId, trackSet] of peer.streamTracks.entries()) {
        const isScreen =
          (peer.screenStreamId !== null && streamId === peer.screenStreamId) ||
          peer.knownScreenStreamIds.has(streamId);

        for (const t of trackSet) {
          if (t.readyState === "ended") continue;
          if (isScreen) {
            if (peer.screenSharing && !screenTracks.some((x) => x.id === t.id)) {
              screenTracks.push(t);
            }
          } else {
            if (t.kind === "video" && !peer.camOn) continue;
            if (!callTracks.some((x) => x.id === t.id)) {
              callTracks.push(t);
            }
          }
        }
      }

      for (const t of peer.fallbackTracks) {
        if (t.readyState === "ended") continue;
        const isScreen = peer.screenSharing && !peer.camOn && t.kind === "video";
        if (isScreen) {
          if (!screenTracks.some((x) => x.id === t.id)) screenTracks.push(t);
        } else {
          if (t.kind === "video" && !peer.camOn) continue;
          if (!callTracks.some((x) => x.id === t.id)) callTracks.push(t);
        }
      }

      const nextScreenTracks = peer.screenSharing ? screenTracks : [];
      let updated = false;

      if (!sameTracks(peer.stream, callTracks)) {
        peer.stream = new MediaStream(callTracks);
        updated = true;
        try {
          peer.sourceNode?.disconnect();
        } catch {
          /* abaikan */
        }
        peer.analyser = undefined;
        peer.sourceNode = undefined;
        if (callTracks.some((t) => t.kind === "audio")) {
          const { analyser, sourceNode } = attachStreamAnalyser(peer.stream);
          peer.analyser = analyser;
          peer.sourceNode = sourceNode;
        }
      }

      if (!sameTracks(peer.screenStream, nextScreenTracks)) {
        peer.screenStream = new MediaStream(nextScreenTracks);
        updated = true;
      }

      if (updated) {
        peer.streamVersion++;
      }
      return updated;
    },
    [attachStreamAnalyser],
  );

  const sendOffer = useCallback(
    async (peerId: string, peer: PeerInternal) => {
      const { pc } = peer;
      if (pc.connectionState === "closed" || pc.signalingState === "closed") return;
      if (peer.makingOffer || pc.signalingState !== "stable") {
        peer.needsNegotiation = true;
        return;
      }
      try {
        peer.makingOffer = true;
        peer.needsNegotiation = false;
        const offer = await pc.createOffer();
        if (pc.signalingState !== "stable") {
          peer.needsNegotiation = true;
          return;
        }
        await pc.setLocalDescription(offer);
        if (pc.localDescription) {
          channel.send("rtc", {
            type: "signal",
            from: selfClientId,
            to: peerId,
            name: selfName,
            ...currentMediaPayload(),
            description: pc.localDescription.toJSON(),
          } satisfies RtcSignal);
        }
      } catch {
        /* abaikan negosiasi gagal sementara */
      } finally {
        peer.makingOffer = false;
        if (peer.needsNegotiation && pc.signalingState === "stable") {
          peer.needsNegotiation = false;
          void sendOffer(peerId, peer);
        }
      }
    },
    [channel, currentMediaPayload, selfClientId, selfName],
  );

  const syncLocalTracksToPeer = useCallback((peer: PeerInternal) => {
    const { pc } = peer;
    if (pc.signalingState === "closed" || pc.connectionState === "closed") return;
    const senders = pc.getSenders();
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        if (!senders.some((s) => s.track === track)) {
          pc.addTrack(track, localStreamRef.current);
        }
      }
    }
    if (localScreenStreamRef.current) {
      for (const track of localScreenStreamRef.current.getTracks()) {
        if (!senders.some((s) => s.track === track)) {
          pc.addTrack(track, localScreenStreamRef.current);
        }
      }
    }
  }, []);

  const getOrCreatePeer = useCallback(
    (peerId: string, peerName: string, meta?: Partial<MediaStatePayload>): PeerInternal => {
      const existing = peersRef.current.get(peerId);

      // Hanya tutup peer lama jika pasangan benar-benar berganti sessionId (mis. habis refresh halaman)
      // atau jika RTCPeerConnection sudah mati (failed / closed).
      if (existing) {
        const sessionReplaced = Boolean(
          meta?.sessionId && existing.sessionId && existing.sessionId !== meta.sessionId,
        );
        const connDead =
          existing.pc.connectionState === "failed" || existing.pc.connectionState === "closed";

        if (sessionReplaced || connDead) {
          closePeer(peerId);
        } else {
          let changed = false;
          if (meta?.sessionId && !existing.sessionId) {
            existing.sessionId = meta.sessionId;
          }
          if (peerName && existing.name !== peerName) {
            existing.name = peerName;
            changed = true;
          }
          if (meta?.inCall !== undefined && existing.inCall !== meta.inCall) {
            existing.inCall = meta.inCall;
            changed = true;
          }
          if (meta?.micMuted !== undefined && existing.micMuted !== meta.micMuted) {
            existing.micMuted = meta.micMuted;
            changed = true;
          }
          if (meta?.callStreamId !== undefined && existing.callStreamId !== meta.callStreamId) {
            existing.callStreamId = meta.callStreamId;
            changed = true;
          }
          if (meta?.camOn !== undefined && existing.camOn !== meta.camOn) {
            // Jika kamera pasangan dimatikan, bersihkan track video kamera lama agar tidak membeku saat dinyalakan lagi
            if (!meta.camOn) {
              for (const [sid, set] of existing.streamTracks.entries()) {
                if (!existing.knownScreenStreamIds.has(sid) && sid !== existing.screenStreamId) {
                  for (const t of Array.from(set)) {
                    if (t.kind === "video") set.delete(t);
                  }
                }
              }
            }
            existing.camOn = meta.camOn;
            changed = true;
          }
          if (meta?.screenStreamId !== undefined && existing.screenStreamId !== meta.screenStreamId) {
            if (meta.screenStreamId) {
              existing.knownScreenStreamIds.add(meta.screenStreamId);
            }
            existing.screenStreamId = meta.screenStreamId;
            changed = true;
          }
          if (meta?.screenSharing !== undefined && existing.screenSharing !== meta.screenSharing) {
            if (!meta.screenSharing) {
              for (const sid of existing.knownScreenStreamIds) {
                existing.streamTracks.delete(sid);
              }
            }
            existing.screenSharing = meta.screenSharing;
            changed = true;
          }
          if (changed) {
            routePeerTracks(existing);
            syncPeersState();
          }
          return existing;
        }
      }

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const knownScreenIds = new Set<string>();
      if (meta?.screenStreamId) knownScreenIds.add(meta.screenStreamId);

      const peer: PeerInternal = {
        pc,
        sessionId: meta?.sessionId ?? null,
        name: peerName || "Pasangan",
        inCall: meta?.inCall ?? false,
        stream: new MediaStream(),
        screenStream: new MediaStream(),
        streamTracks: new Map(),
        knownScreenStreamIds: knownScreenIds,
        fallbackTracks: new Set(),
        streamVersion: 1,
        micMuted: meta?.micMuted ?? false,
        camOn: meta?.camOn ?? false,
        screenSharing: meta?.screenSharing ?? false,
        callStreamId: meta?.callStreamId ?? null,
        screenStreamId: meta?.screenStreamId ?? null,
        hasConnectedOnce: false,
        makingOffer: false,
        needsNegotiation: false,
        ignoreOffer: false,
        isSettingRemoteAnswerPending: false,
        pendingCandidates: [],
      };

      pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
          channel.send("rtc", {
            type: "signal",
            from: selfClientId,
            to: peerId,
            name: selfName,
            ...currentMediaPayload(),
            candidate: candidate.toJSON(),
          } satisfies RtcSignal);
        }
      };

      pc.onnegotiationneeded = () => {
        if (!peer.hasConnectedOnce) return;
        void sendOffer(peerId, peer);
      };

      pc.onsignalingstatechange = () => {
        if (pc.signalingState === "stable" && peer.needsNegotiation) {
          peer.needsNegotiation = false;
          void sendOffer(peerId, peer);
        }
      };

      pc.ontrack = ({ track, streams }) => {
        const srcStream = streams[0];
        if (srcStream) {
          let set = peer.streamTracks.get(srcStream.id);
          if (!set) {
            set = new Set();
            peer.streamTracks.set(srcStream.id, set);
          }
          set.add(track);
          for (const t of srcStream.getTracks()) {
            set.add(t);
          }
          srcStream.onremovetrack = ({ track: removed }) => {
            set?.delete(removed);
            routePeerTracks(peer);
            syncPeersState();
          };
        } else {
          peer.fallbackTracks.add(track);
        }

        routePeerTracks(peer);

        track.onunmute = () => {
          routePeerTracks(peer);
          syncPeersState();
        };
        track.onended = () => {
          if (srcStream) {
            peer.streamTracks.get(srcStream.id)?.delete(track);
          } else {
            peer.fallbackTracks.delete(track);
          }
          routePeerTracks(peer);
          syncPeersState();
        };
        syncPeersState();
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          peer.hasConnectedOnce = true;
          if (peer.disconnectTimer) {
            window.clearTimeout(peer.disconnectTimer);
            peer.disconnectTimer = undefined;
          }
        } else if (pc.connectionState === "disconnected") {
          if (!peer.disconnectTimer) {
            peer.disconnectTimer = window.setTimeout(() => {
              if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
                closePeer(peerId);
              }
            }, 6000);
          }
        } else if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          closePeer(peerId);
        }
      };

      syncLocalTracksToPeer(peer);

      peersRef.current.set(peerId, peer);
      syncPeersState();
      return peer;
    },
    [channel, closePeer, currentMediaPayload, routePeerTracks, selfClientId, selfName, sendOffer, syncLocalTracksToPeer, syncPeersState],
  );

  const broadcastState = useCallback(
    (type: "join" | "media-state", reply?: boolean) => {
      const payload = currentMediaPayload();
      channel.updatePresence({
        inCall: payload.inCall,
        camOn: payload.camOn,
        screenSharing: payload.screenSharing,
      });
      channel.send("rtc", {
        type,
        from: selfClientId,
        name: selfName,
        ...(reply ? { reply: true } : {}),
        ...payload,
      } satisfies RtcSignal);
    },
    [channel, currentMediaPayload, selfClientId, selfName],
  );

  const cleanDeadPeers = useCallback(() => {
    for (const [peerId, p] of Array.from(peersRef.current.entries())) {
      if (p.pc.connectionState === "failed" || p.pc.connectionState === "closed") {
        closePeer(peerId);
      }
    }
  }, [closePeer]);

  // ---------- Masuk ke panggilan suara/video ----------
  const joinCall = useCallback(
    async (withVideo: boolean, initialMicMuted = false) => {
      if (inCallRef.current || connecting) return;
      setConnecting(true);
      setError(null);
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Browser tidak mengizinkan akses mikrofon/kamera. Pastikan membuka lewat localhost atau HTTPS.");
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: withVideo
            ? { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: "user" }
            : false,
        });

        if (initialMicMuted) {
          for (const t of stream.getAudioTracks()) t.enabled = false;
        }

        cleanDeadPeers();

        // Hanya rotasi sessionId bila belum ada koneksi aktif (mis. belum ada Share Screen aktif)
        const hadActivePeers = peersRef.current.size > 0;
        if (!hadActivePeers) {
          sessionIdRef.current = crypto.randomUUID();
        }

        localStreamRef.current = stream;
        setLocalStream(stream);
        const hasVideo = stream.getVideoTracks().length > 0;
        inCallRef.current = true;
        micMutedRef.current = initialMicMuted;
        camOnRef.current = hasVideo;
        setInCall(true);
        setMicMuted(initialMicMuted);
        setCamOn(hasVideo);
        setLocalVersion((v) => v + 1);
        saveCallSessionState({ inCall: true, camOn: hasVideo, micMuted: initialMicMuted });

        const { analyser } = attachStreamAnalyser(stream);
        localAnalyserRef.current = analyser ?? null;

        // Pastikan peer untuk pasangan yang sudah online dibuat sebelum mengirim sinyal
        for (const p of onlineRef.current) {
          if (p.clientId === selfClientId) continue;
          if ((p.inCall || p.screenSharing || screenSharingRef.current) && !peersRef.current.has(p.clientId)) {
            getOrCreatePeer(p.clientId, p.name, {
              inCall: p.inCall,
              camOn: p.camOn,
              screenSharing: p.screenSharing,
            });
          }
        }

        for (const [peerId, p] of peersRef.current.entries()) {
          syncLocalTracksToPeer(p);
          if (hadActivePeers) {
            void sendOffer(peerId, p);
          }
        }

        broadcastState(hadActivePeers ? "media-state" : "join");
      } catch (err) {
        saveCallSessionState(null);
        setError((err as Error).message || "Gagal mengakses mikrofon/kamera.");
      } finally {
        setConnecting(false);
      }
    },
    [attachStreamAnalyser, broadcastState, cleanDeadPeers, connecting, getOrCreatePeer, selfClientId, sendOffer, syncLocalTracksToPeer],
  );

  // ---------- Keluar dari panggilan suara/video ----------
  const leaveCall = useCallback(() => {
    saveCallSessionState(null);
    if (!inCallRef.current) return;
    inCallRef.current = false;
    micMutedRef.current = false;
    camOnRef.current = false;
    setInCall(false);
    setMicMuted(false);
    setCamOn(false);
    setSpeaking({});

    const stream = localStreamRef.current;
    localStreamRef.current = null;
    localAnalyserRef.current = null;
    setLocalStream(null);

    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
        for (const p of peersRef.current.values()) {
          const sender = p.pc.getSenders().find((s) => s.track === track);
          if (sender) {
            try {
              p.pc.removeTrack(sender);
            } catch {
              /* abaikan */
            }
          }
        }
      }
    }

    if (isDuckedRef.current) {
      isDuckedRef.current = false;
      onVolumeDuckRef.current(false);
    }

    const keepForScreen =
      screenSharingRef.current || Array.from(peersRef.current.values()).some((p) => p.screenSharing);

    if (!keepForScreen) {
      const oldSession = sessionIdRef.current;
      for (const peerId of Array.from(peersRef.current.keys())) {
        closePeer(peerId);
      }
      sessionIdRef.current = crypto.randomUUID();
      channel.updatePresence({ inCall: false, camOn: false, screenSharing: false });
      channel.send("rtc", { type: "leave", from: selfClientId, sessionId: oldSession } satisfies RtcSignal);
    } else {
      broadcastState("media-state");
      for (const [peerId, p] of peersRef.current.entries()) {
        void sendOffer(peerId, p);
      }
    }
  }, [broadcastState, channel, closePeer, selfClientId, sendOffer]);

  // ---------- Mute / Unmute Mikrofon ----------
  const toggleMic = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const nextMuted = !micMutedRef.current;
    for (const t of stream.getAudioTracks()) {
      t.enabled = !nextMuted;
    }
    micMutedRef.current = nextMuted;
    setMicMuted(nextMuted);
    saveCallSessionState({ inCall: inCallRef.current, camOn: camOnRef.current, micMuted: nextMuted });
    broadcastState("media-state");
  }, [broadcastState]);

  // ---------- Nyalakan / Matikan Kamera di tengah panggilan ----------
  const toggleCam = useCallback(async () => {
    const stream = localStreamRef.current;
    if (!stream || !inCallRef.current) return;
    setError(null);

    if (camOnRef.current) {
      camOnRef.current = false;
      setCamOn(false);
      for (const track of stream.getVideoTracks()) {
        track.stop();
        stream.removeTrack(track);
        for (const p of peersRef.current.values()) {
          const sender = p.pc.getSenders().find((s) => s.track === track);
          if (sender) {
            try {
              p.pc.removeTrack(sender);
            } catch {
              /* abaikan */
            }
          }
        }
      }
      setLocalVersion((v) => v + 1);
      saveCallSessionState({ inCall: true, camOn: false, micMuted: micMutedRef.current });
      broadcastState("media-state");
      for (const [peerId, p] of peersRef.current.entries()) {
        void sendOffer(peerId, p);
      }
    } else {
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: "user" },
        });
        const videoTrack = camStream.getVideoTracks()[0];
        if (!videoTrack) return;
        stream.addTrack(videoTrack);
        camOnRef.current = true;
        setCamOn(true);
        setLocalVersion((v) => v + 1);
        saveCallSessionState({ inCall: true, camOn: true, micMuted: micMutedRef.current });

        broadcastState("media-state");
        for (const [peerId, p] of peersRef.current.entries()) {
          syncLocalTracksToPeer(p);
          void sendOffer(peerId, p);
        }
      } catch (err) {
        setError((err as Error).message || "Tidak bisa menyalakan kamera.");
      }
    }
  }, [broadcastState, sendOffer, syncLocalTracksToPeer]);

  // ---------- Share Screen + Audio Tab ke Panggung Video Utama ----------
  const stopScreenShare = useCallback(() => {
    const screenStream = localScreenStreamRef.current;
    if (!screenStream) return;

    localScreenStreamRef.current = null;
    screenSharingRef.current = false;
    setLocalScreenStream(null);
    setScreenSharing(false);
    setLocalVersion((v) => v + 1);

    for (const track of screenStream.getTracks()) {
      track.stop();
      for (const p of peersRef.current.values()) {
        const sender = p.pc.getSenders().find((s) => s.track === track);
        if (sender) {
          try {
            p.pc.removeTrack(sender);
          } catch {
            /* abaikan */
          }
        }
      }
    }

    const keepForCall =
      inCallRef.current || Array.from(peersRef.current.values()).some((p) => p.inCall || p.screenSharing);

    if (!keepForCall) {
      const oldSession = sessionIdRef.current;
      for (const peerId of Array.from(peersRef.current.keys())) {
        closePeer(peerId);
      }
      sessionIdRef.current = crypto.randomUUID();
      channel.updatePresence({ inCall: false, camOn: false, screenSharing: false });
      channel.send("rtc", { type: "leave", from: selfClientId, sessionId: oldSession } satisfies RtcSignal);
    } else {
      broadcastState("media-state");
      for (const [peerId, p] of peersRef.current.entries()) {
        void sendOffer(peerId, p);
      }
    }
  }, [broadcastState, channel, closePeer, selfClientId, sendOffer]);

  const toggleScreenShare = useCallback(async () => {
    setError(null);
    if (screenSharingRef.current) {
      stopScreenShare();
      return;
    }

    try {
      let displayStream: MediaStream;
      try {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
      } catch (firstErr) {
        const errName = (firstErr as DOMException)?.name;
        if (errName === "NotAllowedError" || errName === "AbortError") {
          return;
        }
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
        });
      }

      const screenTrack = displayStream.getVideoTracks()[0];
      if (!screenTrack) return;

      screenTrack.onended = () => {
        stopScreenShare();
      };

      cleanDeadPeers();

      // Jangan ubah sessionId bila sudah ada koneksi peer aktif (mis. sedang Voice/Video Call)
      const hadActivePeers = peersRef.current.size > 0;
      if (!hadActivePeers) {
        sessionIdRef.current = crypto.randomUUID();
      }

      localScreenStreamRef.current = displayStream;
      screenSharingRef.current = true;
      setLocalScreenStream(displayStream);
      setScreenSharing(true);
      setLocalVersion((v) => v + 1);

      // Pastikan peer dibuat untuk semua peserta yang sedang online di room
      for (const p of onlineRef.current) {
        if (p.clientId === selfClientId) continue;
        if (!peersRef.current.has(p.clientId)) {
          getOrCreatePeer(p.clientId, p.name, {
            inCall: p.inCall,
            camOn: p.camOn,
            screenSharing: p.screenSharing,
          });
        }
      }

      if (hadActivePeers) {
        // Beri tahu pasangan bahwa screenStreamId aktif terlebih dahulu, lalu renegosiasi pada koneksi yang sama
        broadcastState("media-state");
        for (const [peerId, p] of peersRef.current.entries()) {
          syncLocalTracksToPeer(p);
          void sendOffer(peerId, p);
        }
      } else {
        for (const p of peersRef.current.values()) {
          syncLocalTracksToPeer(p);
        }
        broadcastState("join");
      }
    } catch (err) {
      const errName = (err as DOMException)?.name;
      if (errName === "NotAllowedError" || errName === "AbortError") return;
      setError((err as Error).message || "Gagal membagikan layar.");
    }
  }, [broadcastState, cleanDeadPeers, getOrCreatePeer, selfClientId, sendOffer, stopScreenShare, syncLocalTracksToPeer]);

  // ---------- Otomatis gabung kembali ke Call jika halaman di-refresh tanpa menutup Call ----------
  useEffect(() => {
    const offSub = channel.whenSubscribed(() => {
      if (autoRejoinedRef.current || inCallRef.current) return;
      const saved = loadCallSessionState();
      if (saved?.inCall) {
        autoRejoinedRef.current = true;
        void joinCall(saved.camOn, saved.micMuted);
      }
    });
    return () => offSub();
  }, [channel, joinCall]);

  // ---------- Kirim sinyal "leave" saat tab di-refresh / ditutup agar pasangan langsung membersihkan peer lama ----------
  useEffect(() => {
    const onUnload = () => {
      if (inCallRef.current || screenSharingRef.current) {
        channel.send("rtc", {
          type: "leave",
          from: selfClientId,
          sessionId: sessionIdRef.current,
        } satisfies RtcSignal);
      }
    };
    window.addEventListener("pagehide", onUnload);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("pagehide", onUnload);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [channel, selfClientId]);

  // ---------- Auto-discovery dari Presence ----------
  useEffect(() => {
    const activeLocal = inCall || screenSharing;
    const anyRemoteScreen = online.some((p) => p.clientId !== selfClientId && p.screenSharing);
    if (!activeLocal && !anyRemoteScreen) return;

    let addedNewPeer = false;
    for (const p of online) {
      if (p.clientId === selfClientId) continue;
      const shouldConnect = (activeLocal && (p.inCall || p.screenSharing)) || p.screenSharing || screenSharing;
      if (shouldConnect && !peersRef.current.has(p.clientId)) {
        getOrCreatePeer(p.clientId, p.name, {
          inCall: p.inCall,
          camOn: p.camOn,
          screenSharing: p.screenSharing,
        });
        addedNewPeer = true;
      }
    }
    if (addedNewPeer) {
      broadcastState("join");
    }
  }, [broadcastState, getOrCreatePeer, inCall, online, screenSharing, selfClientId]);

  // ---------- Listener Signaling RTC ----------
  useEffect(() => {
    const off = channel.on("rtc", async (msg: RtcSignal) => {
      if (!msg || msg.from === selfClientId) return;

      if (msg.type === "leave") {
        const existing = peersRef.current.get(msg.from);
        if (!existing || !msg.sessionId || !existing.sessionId || existing.sessionId === msg.sessionId) {
          closePeer(msg.from);
        }
        return;
      }

      const activeLocal = inCallRef.current || screenSharingRef.current;
      const remoteWantsScreen = "screenSharing" in msg && !!msg.screenSharing;
      const hasExistingPeer = peersRef.current.has(msg.from);

      if (!activeLocal && !remoteWantsScreen && !hasExistingPeer) return;

      if (msg.type === "join") {
        const peer = getOrCreatePeer(msg.from, msg.name, msg);
        syncLocalTracksToPeer(peer);

        if (!msg.reply) {
          broadcastState("join", true);
        }

        const localHasMedia = inCallRef.current || screenSharingRef.current;
        const remoteHasMedia = Boolean(msg.inCall || msg.screenSharing);
        const shouldInitiateOffer =
          localHasMedia && (!remoteHasMedia || selfClientId > msg.from);

        if (shouldInitiateOffer) {
          void sendOffer(msg.from, peer);
        }
        return;
      }

      if (msg.type === "media-state") {
        const peer = getOrCreatePeer(msg.from, msg.name, msg);
        syncLocalTracksToPeer(peer);
        return;
      }

      if (msg.type === "signal" && msg.to === selfClientId) {
        const peer = getOrCreatePeer(msg.from, msg.name, msg);
        syncLocalTracksToPeer(peer);
        const { pc } = peer;
        const polite = selfClientId < msg.from;

        try {
          if (msg.description) {
            const readyForOffer =
              !peer.makingOffer && (pc.signalingState === "stable" || peer.isSettingRemoteAnswerPending);
            const offerCollision = msg.description.type === "offer" && !readyForOffer;

            peer.ignoreOffer = !polite && offerCollision;
            if (peer.ignoreOffer) return;

            peer.isSettingRemoteAnswerPending = msg.description.type === "answer";
            if (offerCollision) {
              await Promise.all([
                pc.setLocalDescription({ type: "rollback" }),
                pc.setRemoteDescription(msg.description),
              ]);
            } else {
              await pc.setRemoteDescription(msg.description);
            }
            peer.isSettingRemoteAnswerPending = false;
            peer.hasConnectedOnce = true;

            while (peer.pendingCandidates.length > 0) {
              const c = peer.pendingCandidates.shift()!;
              try {
                await pc.addIceCandidate(c);
              } catch {
                /* abaikan */
              }
            }

            if (msg.description.type === "offer") {
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              if (pc.localDescription) {
                channel.send("rtc", {
                  type: "signal",
                  from: selfClientId,
                  to: msg.from,
                  name: selfName,
                  ...currentMediaPayload(),
                  description: pc.localDescription.toJSON(),
                } satisfies RtcSignal);
              }
            }

            // Bila masih ada track lokal (mis. kamera atau share screen) yang belum ternegosiasi, langsung kirim offer lanjutan
            const hasUnnegotiatedTracks = pc
              .getTransceivers()
              .some(
                (t) =>
                  t.currentDirection === null &&
                  t.direction !== "inactive" &&
                  t.direction !== "stopped" &&
                  t.sender.track !== null,
              );
            if ((peer.needsNegotiation || hasUnnegotiatedTracks) && pc.signalingState === "stable") {
              peer.needsNegotiation = false;
              void sendOffer(msg.from, peer);
            }
          } else if (msg.candidate) {
            try {
              if (pc.remoteDescription && pc.remoteDescription.type) {
                await pc.addIceCandidate(msg.candidate);
              } else {
                peer.pendingCandidates.push(msg.candidate);
              }
            } catch (err) {
              if (!peer.ignoreOffer) throw err;
            }
          }
        } catch {
          peer.isSettingRemoteAnswerPending = false;
        }
      }
    });

    return () => off();
  }, [broadcastState, channel, closePeer, currentMediaPayload, getOrCreatePeer, selfClientId, selfName, sendOffer, syncLocalTracksToPeer]);

  // ---------- Deteksi Suara (VAD) & Auto-Ducking Volume Video ----------
  useEffect(() => {
    if (!inCall) return;
    const buf = new Uint8Array(64);
    const SPEAK_THRESHOLD = 14;
    const HOLD_MS = 700;

    function rmsLevel(analyser: AnalyserNode): number {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = buf[i] - 128;
        sum += v * v;
      }
      return Math.sqrt(sum / buf.length);
    }

    const id = window.setInterval(() => {
      const nextSpeaking: Record<string, boolean> = {};
      let anyRemoteSpeaking = false;

      if (localAnalyserRef.current && !micMutedRef.current) {
        nextSpeaking[selfClientId] = rmsLevel(localAnalyserRef.current) > SPEAK_THRESHOLD;
      }

      for (const [peerId, p] of peersRef.current.entries()) {
        if (p.analyser && !p.micMuted) {
          const active = rmsLevel(p.analyser) > SPEAK_THRESHOLD;
          nextSpeaking[peerId] = active;
          if (active) anyRemoteSpeaking = true;
        }
      }

      setSpeaking(nextSpeaking);

      const now = performance.now();
      if (anyRemoteSpeaking) {
        duckHoldUntilRef.current = now + HOLD_MS;
      }
      const shouldDuck = autoDuckRef.current && now < duckHoldUntilRef.current;
      if (shouldDuck !== isDuckedRef.current) {
        isDuckedRef.current = shouldDuck;
        onVolumeDuckRef.current(shouldDuck);
      }
    }, 150);

    return () => window.clearInterval(id);
  }, [inCall, selfClientId]);

  useEffect(() => {
    if (!autoDuck && isDuckedRef.current) {
      isDuckedRef.current = false;
      onVolumeDuckRef.current(false);
    }
  }, [autoDuck]);

  useEffect(() => {
    return () => {
      for (const p of peersRef.current.values()) {
        if (p.disconnectTimer) window.clearTimeout(p.disconnectTimer);
        try {
          p.pc.close();
        } catch {
          /* abaikan */
        }
      }
      peersRef.current.clear();
      if (localStreamRef.current) {
        for (const t of localStreamRef.current.getTracks()) t.stop();
      }
      if (localScreenStreamRef.current) {
        for (const t of localScreenStreamRef.current.getTracks()) t.stop();
      }
      if (audioCtxRef.current) {
        void audioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  /** Share screen aktif (baik dari diri sendiri maupun dari pasangan) untuk ditampilkan di PlayerStage. */
  const activeScreenShare = useMemo<ActiveScreenShare | null>(() => {
    if (screenSharing && localScreenStream) {
      return {
        stream: localScreenStream,
        streamVersion: localVersion,
        name: `${selfName} (Kamu)`,
        isSelf: true,
      };
    }
    const sharingPeer = peers.find((p) => p.screenSharing && p.screenStream.getTracks().length > 0);
    if (sharingPeer) {
      return {
        stream: sharingPeer.screenStream,
        streamVersion: sharingPeer.streamVersion,
        name: sharingPeer.name,
        isSelf: false,
      };
    }
    return null;
  }, [localScreenStream, localVersion, peers, screenSharing, selfName]);

  return {
    inCall,
    connecting,
    micMuted,
    camOn,
    screenSharing,
    activeScreenShare,
    autoDuck,
    setAutoDuck,
    error,
    localStream,
    localVersion,
    peers,
    speaking,
    joinCall,
    leaveCall,
    toggleMic,
    toggleCam,
    toggleScreenShare,
  };
}

export type WebRTCController = ReturnType<typeof useWebRTC>;
