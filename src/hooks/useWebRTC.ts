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
  rawStreams: Map<string, MediaStream>;
  fallbackTracks: Set<MediaStreamTrack>;
  streamVersion: number;
  micMuted: boolean;
  camOn: boolean;
  screenSharing: boolean;
  screenStreamId: string | null;
  hasConnectedOnce: boolean;
  makingOffer: boolean;
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

  /** ID unik per siklus hidup halaman/call untuk mendeteksi bila pasangan baru saja me-refresh halaman. */
  const sessionIdRef = useRef<string>(typeof crypto !== "undefined" ? crypto.randomUUID() : String(Date.now()));
  const inCallRef = useRef(false);
  const micMutedRef = useRef(false);
  const camOnRef = useRef(false);
  const screenSharingRef = useRef(false);
  const autoDuckRef = useRef(true);
  autoDuckRef.current = autoDuck;

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
   * Bangun ulang objek MediaStream baru setiap kali track berubah agar elemen `<video>`
   * di browser selalu me-refresh decoder videonya (mencegah video membeku / tekancing).
   */
  const routePeerTracks = useCallback(
    (peer: PeerInternal) => {
      const callTracks: MediaStreamTrack[] = [];
      const screenTracks: MediaStreamTrack[] = [];

      for (const [streamId, rawStream] of peer.rawStreams.entries()) {
        const isScreen = peer.screenStreamId !== null && streamId === peer.screenStreamId;
        for (const t of rawStream.getTracks()) {
          if (t.readyState === "ended") continue;
          if (isScreen) {
            if (!screenTracks.some((x) => x.id === t.id)) screenTracks.push(t);
          } else {
            if (!callTracks.some((x) => x.id === t.id)) callTracks.push(t);
          }
        }
      }

      for (const t of peer.fallbackTracks) {
        if (t.readyState === "ended") continue;
        const isScreen = peer.screenSharing && !peer.camOn && t.kind === "video";
        if (isScreen) {
          if (!screenTracks.some((x) => x.id === t.id)) screenTracks.push(t);
        } else {
          if (!callTracks.some((x) => x.id === t.id)) callTracks.push(t);
        }
      }

      peer.stream = new MediaStream(callTracks);
      peer.screenStream = peer.screenSharing ? new MediaStream(screenTracks) : new MediaStream();

      if (callTracks.some((t) => t.kind === "audio")) {
        try {
          peer.sourceNode?.disconnect();
        } catch {
          /* abaikan */
        }
        const { analyser, sourceNode } = attachStreamAnalyser(peer.stream);
        peer.analyser = analyser;
        peer.sourceNode = sourceNode;
      }
    },
    [attachStreamAnalyser],
  );

  const sendOffer = useCallback(
    async (peerId: string, peer: PeerInternal) => {
      const { pc } = peer;
      if (peer.makingOffer || pc.signalingState !== "stable") return;
      try {
        peer.makingOffer = true;
        const offer = await pc.createOffer();
        if (pc.signalingState !== "stable") return;
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
      }
    },
    [channel, currentMediaPayload, selfClientId, selfName],
  );

  const getOrCreatePeer = useCallback(
    (peerId: string, peerName: string, meta?: Partial<MediaStatePayload>): PeerInternal => {
      const existing = peersRef.current.get(peerId);

      // Jika peer mengirim sessionId baru (mis. habis refresh halaman) atau koneksi lama sudah rusak,
      // tutup koneksi lama dan buat RTCPeerConnection baru agar video tidak membeku/tekancing.
      if (existing) {
        const sessionReplaced =
          meta?.sessionId && existing.sessionId && existing.sessionId !== meta.sessionId;
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
          if (meta?.camOn !== undefined && existing.camOn !== meta.camOn) {
            existing.camOn = meta.camOn;
            existing.streamVersion++;
            changed = true;
          }
          if (meta?.screenSharing !== undefined && existing.screenSharing !== meta.screenSharing) {
            existing.screenSharing = meta.screenSharing;
            existing.streamVersion++;
            changed = true;
          }
          if (meta?.screenStreamId !== undefined && existing.screenStreamId !== meta.screenStreamId) {
            existing.screenStreamId = meta.screenStreamId;
            existing.streamVersion++;
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

      const peer: PeerInternal = {
        pc,
        sessionId: meta?.sessionId ?? null,
        name: peerName || "Pasangan",
        inCall: meta?.inCall ?? false,
        stream: new MediaStream(),
        screenStream: new MediaStream(),
        rawStreams: new Map(),
        fallbackTracks: new Set(),
        streamVersion: 1,
        micMuted: meta?.micMuted ?? false,
        camOn: meta?.camOn ?? false,
        screenSharing: meta?.screenSharing ?? false,
        screenStreamId: meta?.screenStreamId ?? null,
        hasConnectedOnce: false,
        makingOffer: false,
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
            sessionId: sessionIdRef.current,
            candidate: candidate.toJSON(),
          } satisfies RtcSignal);
        }
      };

      pc.onnegotiationneeded = () => {
        if (!peer.hasConnectedOnce && selfClientId < peerId) return;
        void sendOffer(peerId, peer);
      };

      pc.ontrack = ({ track, streams }) => {
        const srcStream = streams[0];
        if (srcStream) {
          peer.rawStreams.set(srcStream.id, srcStream);
        } else {
          peer.fallbackTracks.add(track);
        }
        routePeerTracks(peer);
        peer.streamVersion++;

        track.onunmute = () => {
          routePeerTracks(peer);
          peer.streamVersion++;
          syncPeersState();
        };
        track.onended = () => {
          routePeerTracks(peer);
          peer.streamVersion++;
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
            }, 5000);
          }
        } else if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          closePeer(peerId);
        }
      };

      if (localStreamRef.current) {
        for (const track of localStreamRef.current.getTracks()) {
          pc.addTrack(track, localStreamRef.current);
        }
      }
      if (localScreenStreamRef.current) {
        for (const track of localScreenStreamRef.current.getTracks()) {
          pc.addTrack(track, localScreenStreamRef.current);
        }
      }

      peersRef.current.set(peerId, peer);
      syncPeersState();
      return peer;
    },
    [channel, closePeer, routePeerTracks, selfClientId, selfName, sendOffer, syncPeersState],
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

        // Buat sessionId baru setiap kali masuk call agar peer di seberang me-reset koneksi lama
        sessionIdRef.current = crypto.randomUUID();

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

        for (const [peerId, p] of peersRef.current.entries()) {
          for (const track of stream.getTracks()) {
            p.pc.addTrack(track, stream);
          }
          void sendOffer(peerId, p);
        }

        broadcastState("join");
      } catch (err) {
        saveCallSessionState(null);
        setError((err as Error).message || "Gagal mengakses mikrofon/kamera.");
      } finally {
        setConnecting(false);
      }
    },
    [attachStreamAnalyser, broadcastState, connecting, sendOffer],
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

    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        track.stop();
        for (const [peerId, p] of peersRef.current.entries()) {
          const sender = p.pc.getSenders().find((s) => s.track === track);
          if (sender) p.pc.removeTrack(sender);
          if (screenSharingRef.current || p.screenSharing) {
            void sendOffer(peerId, p);
          }
        }
      }
      localStreamRef.current = null;
    }
    localAnalyserRef.current = null;
    setLocalStream(null);

    if (isDuckedRef.current) {
      isDuckedRef.current = false;
      onVolumeDuckRef.current(false);
    }

    if (!screenSharingRef.current && !Array.from(peersRef.current.values()).some((p) => p.screenSharing)) {
      for (const peerId of Array.from(peersRef.current.keys())) {
        closePeer(peerId);
      }
      channel.updatePresence({ inCall: false, camOn: false, screenSharing: false });
      channel.send("rtc", { type: "leave", from: selfClientId, sessionId: sessionIdRef.current } satisfies RtcSignal);
    } else {
      broadcastState("media-state");
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
      for (const track of stream.getVideoTracks()) {
        track.stop();
        stream.removeTrack(track);
        for (const [peerId, p] of peersRef.current.entries()) {
          const sender = p.pc.getSenders().find((s) => s.track === track);
          if (sender) p.pc.removeTrack(sender);
          void sendOffer(peerId, p);
        }
      }
      camOnRef.current = false;
      setCamOn(false);
      setLocalVersion((v) => v + 1);
      saveCallSessionState({ inCall: true, camOn: false, micMuted: micMutedRef.current });
      broadcastState("media-state");
    } else {
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: "user" },
        });
        const videoTrack = camStream.getVideoTracks()[0];
        if (!videoTrack) return;
        stream.addTrack(videoTrack);
        for (const [peerId, p] of peersRef.current.entries()) {
          p.pc.addTrack(videoTrack, stream);
          void sendOffer(peerId, p);
        }
        camOnRef.current = true;
        setCamOn(true);
        setLocalVersion((v) => v + 1);
        saveCallSessionState({ inCall: true, camOn: true, micMuted: micMutedRef.current });
        broadcastState("media-state");
      } catch (err) {
        setError((err as Error).message || "Tidak bisa menyalakan kamera.");
      }
    }
  }, [broadcastState, sendOffer]);

  // ---------- Share Screen + Audio Tab ke Panggung Video Utama ----------
  const stopScreenShare = useCallback(() => {
    const screenStream = localScreenStreamRef.current;
    if (!screenStream) return;
    for (const track of screenStream.getTracks()) {
      track.stop();
      for (const [peerId, p] of peersRef.current.entries()) {
        const sender = p.pc.getSenders().find((s) => s.track === track);
        if (sender) p.pc.removeTrack(sender);
        if (inCallRef.current || p.inCall || p.screenSharing) {
          void sendOffer(peerId, p);
        }
      }
    }
    localScreenStreamRef.current = null;
    screenSharingRef.current = false;
    setLocalScreenStream(null);
    setScreenSharing(false);
    setLocalVersion((v) => v + 1);

    if (!inCallRef.current && !Array.from(peersRef.current.values()).some((p) => p.screenSharing)) {
      for (const peerId of Array.from(peersRef.current.keys())) {
        closePeer(peerId);
      }
      channel.updatePresence({ inCall: false, camOn: false, screenSharing: false });
      channel.send("rtc", { type: "leave", from: selfClientId, sessionId: sessionIdRef.current } satisfies RtcSignal);
    } else {
      broadcastState("media-state");
    }
  }, [broadcastState, channel, closePeer, selfClientId, sendOffer]);

  const toggleScreenShare = useCallback(async () => {
    setError(null);
    if (screenSharingRef.current) {
      stopScreenShare();
      return;
    }

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      const screenTrack = displayStream.getVideoTracks()[0];
      if (!screenTrack) return;

      screenTrack.onended = () => {
        stopScreenShare();
      };

      localScreenStreamRef.current = displayStream;
      screenSharingRef.current = true;
      setLocalScreenStream(displayStream);
      setScreenSharing(true);
      setLocalVersion((v) => v + 1);

      for (const [peerId, p] of peersRef.current.entries()) {
        for (const track of displayStream.getTracks()) {
          p.pc.addTrack(track, displayStream);
        }
        void sendOffer(peerId, p);
      }

      broadcastState("join");
    } catch (err) {
      setError((err as Error).message || "Batal membagikan layar.");
    }
  }, [broadcastState, sendOffer, stopScreenShare]);

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

    for (const p of online) {
      if (p.clientId === selfClientId) continue;
      const shouldConnect = (activeLocal && (p.inCall || p.screenSharing)) || p.screenSharing || screenSharing;
      if (shouldConnect && !peersRef.current.has(p.clientId)) {
        getOrCreatePeer(p.clientId, p.name, {
          inCall: p.inCall,
          camOn: p.camOn,
          screenSharing: p.screenSharing,
        });
        broadcastState("join");
      }
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
        // Jika menerima "join" baru (bukan reply), tutup peer lama dari pengirim tersebut agar negosiasi ulang bersih
        if (!msg.reply && peersRef.current.has(msg.from)) {
          closePeer(msg.from);
        }
        const peer = getOrCreatePeer(msg.from, msg.name, msg);
        if (!msg.reply) {
          broadcastState("join", true);
        }
        // Pihak yang menerima "join" awal (atau pihak dengan ID lebih besar saat reply) langsung mengirim Offer
        if (!msg.reply || selfClientId > msg.from || (screenSharingRef.current && !msg.screenSharing)) {
          void sendOffer(msg.from, peer);
        }
        return;
      }

      if (msg.type === "media-state") {
        getOrCreatePeer(msg.from, msg.name, msg);
        return;
      }

      if (msg.type === "signal" && msg.to === selfClientId) {
        const peer = getOrCreatePeer(msg.from, msg.name, msg);
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
  }, [broadcastState, channel, closePeer, currentMediaPayload, getOrCreatePeer, selfClientId, selfName, sendOffer]);

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
