"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomChannel } from "./useRoomChannel";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  { urls: "stun:stun.cloudflare.com:3478" },
];

export interface RemotePeer {
  userId: string;
  name: string;
  stream: MediaStream;
  micMuted: boolean;
  camOn: boolean;
}

type RtcSignal =
  | { type: "join"; from: string; name: string; micMuted: boolean; camOn: boolean; reply?: boolean }
  | { type: "leave"; from: string }
  | { type: "media-state"; from: string; name: string; micMuted: boolean; camOn: boolean }
  | {
      type: "signal";
      from: string;
      to: string;
      name: string;
      description?: RTCSessionDescriptionInit;
      candidate?: RTCIceCandidateInit;
    };

interface PeerInternal {
  pc: RTCPeerConnection;
  name: string;
  stream: MediaStream;
  micMuted: boolean;
  camOn: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  analyser?: AnalyserNode;
  sourceNode?: MediaStreamAudioSourceNode;
}

interface Options {
  selfId: string;
  selfName: string;
  channel: RoomChannel;
  onlineUserIds: string[];
  onVolumeDuck: (ducked: boolean) => void;
}

/**
 * WebRTC Voice & Video Call peer-to-peer di atas Supabase Realtime Broadcast
 * dengan pola W3C Perfect Negotiation + deteksi suara (VAD) untuk auto-ducking volume video.
 */
export function useWebRTC({ selfId, selfName, channel, onlineUserIds, onVolumeDuck }: Options) {
  const [inCall, setInCall] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [autoDuck, setAutoDuck] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState<RemotePeer[]>([]);
  const [speaking, setSpeaking] = useState<Record<string, boolean>>({});

  const inCallRef = useRef(false);
  const micMutedRef = useRef(false);
  const camOnRef = useRef(false);
  const autoDuckRef = useRef(true);
  autoDuckRef.current = autoDuck;

  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef(new Map<string, PeerInternal>());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const localAnalyserRef = useRef<AnalyserNode | null>(null);
  const duckHoldUntilRef = useRef(0);
  const isDuckedRef = useRef(false);
  const onVolumeDuckRef = useRef(onVolumeDuck);
  onVolumeDuckRef.current = onVolumeDuck;

  const syncPeersState = useCallback(() => {
    const list: RemotePeer[] = [];
    for (const [userId, p] of peersRef.current.entries()) {
      list.push({
        userId,
        name: p.name,
        stream: p.stream,
        micMuted: p.micMuted,
        camOn: p.camOn,
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

  const getOrCreatePeer = useCallback(
    (peerId: string, peerName: string): PeerInternal => {
      const existing = peersRef.current.get(peerId);
      if (existing) {
        if (peerName && existing.name !== peerName) {
          existing.name = peerName;
          syncPeersState();
        }
        return existing;
      }

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const remoteStream = new MediaStream();

      const peer: PeerInternal = {
        pc,
        name: peerName || "Pasangan",
        stream: remoteStream,
        micMuted: false,
        camOn: false,
        makingOffer: false,
        ignoreOffer: false,
        isSettingRemoteAnswerPending: false,
        pendingCandidates: [],
      };

      pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
          channel.send("rtc", {
            type: "signal",
            from: selfId,
            to: peerId,
            name: selfName,
            candidate: candidate.toJSON(),
          } satisfies RtcSignal);
        }
      };

      pc.onnegotiationneeded = async () => {
        try {
          peer.makingOffer = true;
          await pc.setLocalDescription();
          if (pc.localDescription) {
            channel.send("rtc", {
              type: "signal",
              from: selfId,
              to: peerId,
              name: selfName,
              description: pc.localDescription.toJSON(),
            } satisfies RtcSignal);
          }
        } catch {
          /* abaikan negosiasi gagal sementara */
        } finally {
          peer.makingOffer = false;
        }
      };

      pc.ontrack = ({ track, streams }) => {
        const srcStream = streams[0];
        if (srcStream) {
          for (const t of srcStream.getTracks()) {
            if (!peer.stream.getTracks().some((x) => x.id === t.id)) {
              peer.stream.addTrack(t);
            }
          }
        } else if (!peer.stream.getTracks().some((x) => x.id === track.id)) {
          peer.stream.addTrack(track);
        }

        if (track.kind === "audio" && !peer.analyser) {
          const { analyser, sourceNode } = attachStreamAnalyser(peer.stream);
          peer.analyser = analyser;
          peer.sourceNode = sourceNode;
        }

        track.onunmute = () => syncPeersState();
        track.onended = () => syncPeersState();
        syncPeersState();
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          closePeer(peerId);
        }
      };

      // Tambahkan track lokal setelah seluruh event handler terdaftar agar onnegotiationneeded terpanggil
      const local = localStreamRef.current;
      if (local) {
        for (const track of local.getTracks()) {
          pc.addTrack(track, local);
        }
      }

      peersRef.current.set(peerId, peer);
      syncPeersState();
      return peer;
    },
    [attachStreamAnalyser, channel, closePeer, selfId, selfName, syncPeersState],
  );

  // ---------- Masuk ke panggilan ----------
  const joinCall = useCallback(
    async (withVideo: boolean) => {
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

        localStreamRef.current = stream;
        setLocalStream(stream);
        const hasVideo = stream.getVideoTracks().length > 0;
        inCallRef.current = true;
        micMutedRef.current = false;
        camOnRef.current = hasVideo;
        setInCall(true);
        setMicMuted(false);
        setCamOn(hasVideo);

        const { analyser } = attachStreamAnalyser(stream);
        localAnalyserRef.current = analyser ?? null;

        channel.updatePresence({ inCall: true, camOn: hasVideo });
        channel.send("rtc", {
          type: "join",
          from: selfId,
          name: selfName,
          micMuted: false,
          camOn: hasVideo,
        } satisfies RtcSignal);
      } catch (err) {
        setError((err as Error).message || "Gagal mengakses mikrofon/kamera.");
      } finally {
        setConnecting(false);
      }
    },
    [attachStreamAnalyser, channel, connecting, selfId, selfName],
  );

  // ---------- Keluar dari panggilan ----------
  const leaveCall = useCallback(() => {
    if (!inCallRef.current) return;
    inCallRef.current = false;
    setInCall(false);
    setMicMuted(false);
    setCamOn(false);
    setSpeaking({});

    for (const peerId of Array.from(peersRef.current.keys())) {
      closePeer(peerId);
    }

    if (localStreamRef.current) {
      for (const t of localStreamRef.current.getTracks()) t.stop();
      localStreamRef.current = null;
    }
    localAnalyserRef.current = null;
    setLocalStream(null);

    if (isDuckedRef.current) {
      isDuckedRef.current = false;
      onVolumeDuckRef.current(false);
    }

    channel.updatePresence({ inCall: false, camOn: false });
    channel.send("rtc", { type: "leave", from: selfId } satisfies RtcSignal);
  }, [channel, closePeer, selfId]);

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
    channel.send("rtc", {
      type: "media-state",
      from: selfId,
      name: selfName,
      micMuted: nextMuted,
      camOn: camOnRef.current,
    } satisfies RtcSignal);
  }, [channel, selfId, selfName]);

  // ---------- Nyalakan / Matikan Kamera di tengah panggilan ----------
  const toggleCam = useCallback(async () => {
    const stream = localStreamRef.current;
    if (!stream || !inCallRef.current) return;
    setError(null);

    if (camOnRef.current) {
      // Matikan kamera
      for (const track of stream.getVideoTracks()) {
        track.stop();
        stream.removeTrack(track);
        for (const p of peersRef.current.values()) {
          const sender = p.pc.getSenders().find((s) => s.track === track);
          if (sender) p.pc.removeTrack(sender);
        }
      }
      camOnRef.current = false;
      setCamOn(false);
      setLocalStream(new MediaStream(stream.getTracks()));
      channel.updatePresence({ inCall: true, camOn: false });
      channel.send("rtc", {
        type: "media-state",
        from: selfId,
        name: selfName,
        micMuted: micMutedRef.current,
        camOn: false,
      } satisfies RtcSignal);
    } else {
      // Nyalakan kamera
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: "user" },
        });
        const videoTrack = camStream.getVideoTracks()[0];
        if (!videoTrack) return;
        stream.addTrack(videoTrack);
        for (const p of peersRef.current.values()) {
          p.pc.addTrack(videoTrack, stream);
        }
        camOnRef.current = true;
        setCamOn(true);
        setLocalStream(new MediaStream(stream.getTracks()));
        channel.updatePresence({ inCall: true, camOn: true });
        channel.send("rtc", {
          type: "media-state",
          from: selfId,
          name: selfName,
          micMuted: micMutedRef.current,
          camOn: true,
        } satisfies RtcSignal);
      } catch (err) {
        setError((err as Error).message || "Tidak bisa menyalakan kamera.");
      }
    }
  }, [channel, selfId, selfName]);

  // ---------- Listener Signaling RTC ----------
  useEffect(() => {
    const off = channel.on("rtc", async (msg: RtcSignal) => {
      if (!msg || msg.from === selfId || !inCallRef.current) return;

      if (msg.type === "join") {
        const peer = getOrCreatePeer(msg.from, msg.name);
        peer.micMuted = msg.micMuted;
        peer.camOn = msg.camOn;
        syncPeersState();

        if (!msg.reply) {
          channel.send("rtc", {
            type: "join",
            from: selfId,
            name: selfName,
            micMuted: micMutedRef.current,
            camOn: camOnRef.current,
            reply: true,
          } satisfies RtcSignal);
        }
        return;
      }

      if (msg.type === "leave") {
        closePeer(msg.from);
        return;
      }

      if (msg.type === "media-state") {
        const peer = peersRef.current.get(msg.from);
        if (peer) {
          peer.name = msg.name || peer.name;
          peer.micMuted = msg.micMuted;
          peer.camOn = msg.camOn;
          syncPeersState();
        }
        return;
      }

      if (msg.type === "signal" && msg.to === selfId) {
        const peer = getOrCreatePeer(msg.from, msg.name);
        const { pc } = peer;
        const polite = selfId < msg.from;

        try {
          if (msg.description) {
            const readyForOffer =
              !peer.makingOffer && (pc.signalingState === "stable" || peer.isSettingRemoteAnswerPending);
            const offerCollision = msg.description.type === "offer" && !readyForOffer;

            peer.ignoreOffer = !polite && offerCollision;
            if (peer.ignoreOffer) return;

            peer.isSettingRemoteAnswerPending = msg.description.type === "answer";
            await pc.setRemoteDescription(msg.description);
            peer.isSettingRemoteAnswerPending = false;

            // Terapkan ICE candidate yang sempat antre sebelum remoteDescription siap
            while (peer.pendingCandidates.length > 0) {
              const c = peer.pendingCandidates.shift()!;
              try {
                await pc.addIceCandidate(c);
              } catch {
                /* abaikan */
              }
            }

            if (msg.description.type === "offer") {
              await pc.setLocalDescription();
              if (pc.localDescription) {
                channel.send("rtc", {
                  type: "signal",
                  from: selfId,
                  to: msg.from,
                  name: selfName,
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
          /* abaikan kegagalan negosiasi transien */
        }
      }
    });

    return () => off();
  }, [channel, closePeer, getOrCreatePeer, selfId, selfName, syncPeersState]);

  // ---------- Deteksi Suara (VAD) & Auto-Ducking Volume Video ----------
  useEffect(() => {
    if (!inCall) return;
    const buf = new Uint8Array(64);
    const SPEAK_THRESHOLD = 14; // deviasi amplitudo (0-128)
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
        nextSpeaking[selfId] = rmsLevel(localAnalyserRef.current) > SPEAK_THRESHOLD;
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
  }, [inCall, selfId]);

  // Matikan ducking jika pengguna mematikan toggle autoDuck
  useEffect(() => {
    if (!autoDuck && isDuckedRef.current) {
      isDuckedRef.current = false;
      onVolumeDuckRef.current(false);
    }
  }, [autoDuck]);

  // Bersihkan peer yang keluar dari room (presence offline)
  useEffect(() => {
    if (!inCallRef.current) return;
    const onlineSet = new Set(onlineUserIds);
    for (const peerId of Array.from(peersRef.current.keys())) {
      if (!onlineSet.has(peerId)) {
        closePeer(peerId);
      }
    }
  }, [closePeer, onlineUserIds]);

  // Bersihkan saat keluar halaman
  useEffect(() => {
    return () => {
      if (inCallRef.current) {
        for (const p of peersRef.current.values()) {
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
      }
      if (audioCtxRef.current) {
        void audioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  return {
    inCall,
    connecting,
    micMuted,
    camOn,
    autoDuck,
    setAutoDuck,
    error,
    localStream,
    peers,
    speaking,
    joinCall,
    leaveCall,
    toggleMic,
    toggleCam,
  };
}

export type WebRTCController = ReturnType<typeof useWebRTC>;
