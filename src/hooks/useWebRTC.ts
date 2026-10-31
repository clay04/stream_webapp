"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PresenceMeta } from "@/lib/types";
import type { RoomChannel } from "./useRoomChannel";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  { urls: "stun:stun.cloudflare.com:3478" },
];

export interface RemotePeer {
  clientId: string;
  name: string;
  stream: MediaStream;
  streamVersion: number;
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
      micMuted?: boolean;
      camOn?: boolean;
      description?: RTCSessionDescriptionInit;
      candidate?: RTCIceCandidateInit;
    };

interface PeerInternal {
  pc: RTCPeerConnection;
  name: string;
  stream: MediaStream;
  streamVersion: number;
  micMuted: boolean;
  camOn: boolean;
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

/**
 * WebRTC Voice & Video Call peer-to-peer di atas Supabase Realtime Broadcast
 * dengan negosiasi deterministik (bebas tabrakan offer) + deteksi suara (VAD) untuk auto-ducking volume video.
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
  const [peers, setPeers] = useState<RemotePeer[]>([]);
  const [speaking, setSpeaking] = useState<Record<string, boolean>>({});

  const inCallRef = useRef(false);
  const micMutedRef = useRef(false);
  const camOnRef = useRef(false);
  const screenSharingRef = useRef(false);
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
    for (const [clientId, p] of peersRef.current.entries()) {
      list.push({
        clientId,
        name: p.name,
        stream: p.stream,
        streamVersion: p.streamVersion,
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
            micMuted: micMutedRef.current,
            camOn: camOnRef.current,
            description: pc.localDescription.toJSON(),
          } satisfies RtcSignal);
        }
      } catch {
        /* abaikan negosiasi gagal sementara */
      } finally {
        peer.makingOffer = false;
      }
    },
    [channel, selfClientId, selfName],
  );

  const getOrCreatePeer = useCallback(
    (peerId: string, peerName: string, initialMedia?: { micMuted?: boolean; camOn?: boolean }): PeerInternal => {
      const existing = peersRef.current.get(peerId);
      if (existing) {
        let changed = false;
        if (peerName && existing.name !== peerName) {
          existing.name = peerName;
          changed = true;
        }
        if (initialMedia?.micMuted !== undefined && existing.micMuted !== initialMedia.micMuted) {
          existing.micMuted = initialMedia.micMuted;
          changed = true;
        }
        if (initialMedia?.camOn !== undefined && existing.camOn !== initialMedia.camOn) {
          existing.camOn = initialMedia.camOn;
          existing.streamVersion++;
          changed = true;
        }
        if (changed) syncPeersState();
        return existing;
      }

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const remoteStream = new MediaStream();

      const peer: PeerInternal = {
        pc,
        name: peerName || "Pasangan",
        stream: remoteStream,
        streamVersion: 1,
        micMuted: initialMedia?.micMuted ?? false,
        camOn: initialMedia?.camOn ?? false,
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
            candidate: candidate.toJSON(),
          } satisfies RtcSignal);
        }
      };

      pc.onnegotiationneeded = () => {
        // Saat koneksi awal, hanya satu pihak (selfClientId > peerId) yang membuat Offer
        // agar tidak terjadi tabrakan offer (glare). Setelah terhubung, kedua pihak boleh renegosiasi.
        if (!peer.hasConnectedOnce && selfClientId < peerId) return;
        void sendOffer(peerId, peer);
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

        if (track.kind === "video") {
          peer.camOn = true;
        }
        if (track.kind === "audio" && !peer.analyser) {
          const { analyser, sourceNode } = attachStreamAnalyser(peer.stream);
          peer.analyser = analyser;
          peer.sourceNode = sourceNode;
        }

        peer.streamVersion++;
        track.onunmute = () => {
          peer.streamVersion++;
          syncPeersState();
        };
        track.onended = () => {
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
            }, 7000);
          }
        } else if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          closePeer(peerId);
        }
      };

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
    [attachStreamAnalyser, channel, closePeer, selfClientId, selfName, sendOffer, syncPeersState],
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
          from: selfClientId,
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
    [attachStreamAnalyser, channel, connecting, selfClientId, selfName],
  );

  // ---------- Keluar dari panggilan ----------
  const leaveCall = useCallback(() => {
    if (!inCallRef.current) return;
    inCallRef.current = false;
    screenSharingRef.current = false;
    setInCall(false);
    setMicMuted(false);
    setCamOn(false);
    setScreenSharing(false);
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
    channel.send("rtc", { type: "leave", from: selfClientId } satisfies RtcSignal);
  }, [channel, closePeer, selfClientId]);

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
      from: selfClientId,
      name: selfName,
      micMuted: nextMuted,
      camOn: camOnRef.current,
    } satisfies RtcSignal);
  }, [channel, selfClientId, selfName]);

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
        for (const [peerId, p] of peersRef.current.entries()) {
          const sender = p.pc.getSenders().find((s) => s.track === track);
          if (sender) p.pc.removeTrack(sender);
          void sendOffer(peerId, p);
        }
      }
      camOnRef.current = false;
      setCamOn(false);
      setLocalStream(new MediaStream(stream.getTracks()));
      channel.updatePresence({ inCall: true, camOn: false });
      channel.send("rtc", {
        type: "media-state",
        from: selfClientId,
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
        for (const [peerId, p] of peersRef.current.entries()) {
          p.pc.addTrack(videoTrack, stream);
          void sendOffer(peerId, p);
        }
        camOnRef.current = true;
        setCamOn(true);
        setLocalStream(new MediaStream(stream.getTracks()));
        channel.updatePresence({ inCall: true, camOn: true });
        channel.send("rtc", {
          type: "media-state",
          from: selfClientId,
          name: selfName,
          micMuted: micMutedRef.current,
          camOn: true,
        } satisfies RtcSignal);
      } catch (err) {
        setError((err as Error).message || "Tidak bisa menyalakan kamera.");
      }
    }
  }, [channel, selfClientId, selfName, sendOffer]);

  // ---------- Share Screen + Audio Tab (F13b) ----------
  const toggleScreenShare = useCallback(async () => {
    const stream = localStreamRef.current;
    if (!stream || !inCallRef.current) return;
    setError(null);

    if (screenSharingRef.current) {
      for (const track of stream.getVideoTracks()) {
        track.stop();
        stream.removeTrack(track);
        for (const [peerId, p] of peersRef.current.entries()) {
          const sender = p.pc.getSenders().find((s) => s.track === track);
          if (sender) p.pc.removeTrack(sender);
          void sendOffer(peerId, p);
        }
      }
      screenSharingRef.current = false;
      camOnRef.current = false;
      setScreenSharing(false);
      setCamOn(false);
      setLocalStream(new MediaStream(stream.getTracks()));
      channel.updatePresence({ inCall: true, camOn: false });
      channel.send("rtc", {
        type: "media-state",
        from: selfClientId,
        name: selfName,
        micMuted: micMutedRef.current,
        camOn: false,
      } satisfies RtcSignal);
      return;
    }

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      const screenTrack = displayStream.getVideoTracks()[0];
      if (!screenTrack) return;

      // Hentikan video kamera sebelumnya bila ada
      for (const oldTrack of stream.getVideoTracks()) {
        oldTrack.stop();
        stream.removeTrack(oldTrack);
        for (const p of peersRef.current.values()) {
          const sender = p.pc.getSenders().find((s) => s.track === oldTrack);
          if (sender) p.pc.removeTrack(sender);
        }
      }

      stream.addTrack(screenTrack);
      const tabAudioTrack = displayStream.getAudioTracks()[0];
      if (tabAudioTrack) {
        stream.addTrack(tabAudioTrack);
      }

      for (const [peerId, p] of peersRef.current.entries()) {
        p.pc.addTrack(screenTrack, stream);
        if (tabAudioTrack) p.pc.addTrack(tabAudioTrack, stream);
        void sendOffer(peerId, p);
      }

      screenTrack.onended = () => {
        if (screenSharingRef.current) {
          void toggleScreenShare();
        }
      };

      screenSharingRef.current = true;
      camOnRef.current = true;
      setScreenSharing(true);
      setCamOn(true);
      setLocalStream(new MediaStream(stream.getTracks()));
      channel.updatePresence({ inCall: true, camOn: true });
      channel.send("rtc", {
        type: "media-state",
        from: selfClientId,
        name: selfName,
        micMuted: micMutedRef.current,
        camOn: true,
      } satisfies RtcSignal);
    } catch (err) {
      setError((err as Error).message || "Batal membagikan layar.");
    }
  }, [channel, selfClientId, selfName, sendOffer]);

  // ---------- Auto-discovery dari Presence (jika pasangan sudah di panggilan lebih dulu) ----------
  useEffect(() => {
    if (!inCall) return;
    for (const p of online) {
      if (p.clientId !== selfClientId && p.inCall && !peersRef.current.has(p.clientId)) {
        getOrCreatePeer(p.clientId, p.name, { camOn: p.camOn });
        channel.send("rtc", {
          type: "join",
          from: selfClientId,
          name: selfName,
          micMuted: micMutedRef.current,
          camOn: camOnRef.current,
        } satisfies RtcSignal);
      }
    }
  }, [channel, getOrCreatePeer, inCall, online, selfClientId, selfName]);

  // ---------- Listener Signaling RTC ----------
  useEffect(() => {
    const off = channel.on("rtc", async (msg: RtcSignal) => {
      if (!msg || msg.from === selfClientId || !inCallRef.current) return;

      if (msg.type === "join") {
        const peer = getOrCreatePeer(msg.from, msg.name, { micMuted: msg.micMuted, camOn: msg.camOn });
        if (!msg.reply) {
          channel.send("rtc", {
            type: "join",
            from: selfClientId,
            name: selfName,
            micMuted: micMutedRef.current,
            camOn: camOnRef.current,
            reply: true,
          } satisfies RtcSignal);
        }
        if (selfClientId > msg.from) {
          void sendOffer(msg.from, peer);
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
          peer.streamVersion++;
          syncPeersState();
        }
        return;
      }

      if (msg.type === "signal" && msg.to === selfClientId) {
        const peer = getOrCreatePeer(msg.from, msg.name, { micMuted: msg.micMuted, camOn: msg.camOn });
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
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              if (pc.localDescription) {
                channel.send("rtc", {
                  type: "signal",
                  from: selfClientId,
                  to: msg.from,
                  name: selfName,
                  micMuted: micMutedRef.current,
                  camOn: camOnRef.current,
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
  }, [channel, closePeer, getOrCreatePeer, selfClientId, selfName, sendOffer, syncPeersState]);

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
      if (inCallRef.current) {
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
    screenSharing,
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
    toggleScreenShare,
  };
}

export type WebRTCController = ReturnType<typeof useWebRTC>;
