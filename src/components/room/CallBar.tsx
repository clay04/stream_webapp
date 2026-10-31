"use client";

import { useEffect, useRef, useState } from "react";
import type { RemotePeer, WebRTCController } from "@/hooks/useWebRTC";
import type { PresenceMeta } from "@/lib/types";
import { Avatar } from "./PresenceBar";

/** Pemutar audio persisten agar suara panggilan tidak terputus saat pindah ke Fullscreen / Mode Fokus. */
export function CallAudioRenderer({ peers }: { peers: RemotePeer[] }) {
  return (
    <div className="sr-only" aria-hidden>
      {peers.map((p) => (
        <PeerAudio key={p.clientId} stream={p.stream} streamVersion={p.streamVersion} />
      ))}
    </div>
  );
}

function PeerAudio({ stream, streamVersion }: { stream: MediaStream; streamVersion: number }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.srcObject = stream;
      void audioRef.current.play().catch(() => {});
    }
  }, [stream, streamVersion]);
  return <audio ref={audioRef} autoPlay playsInline />;
}

function VideoElement({
  stream,
  streamVersion,
  mirror,
}: {
  stream: MediaStream | null;
  streamVersion: number;
  mirror?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      void videoRef.current.play().catch(() => {});
    }
  }, [stream, streamVersion]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      className={`h-full w-full object-cover ${mirror ? "-scale-x-100" : ""}`}
    />
  );
}

interface Props {
  rtc: WebRTCController;
  selfClientId: string;
  selfName: string;
  online: PresenceMeta[];
  /** "sidebar" untuk panel kanan, "overlay" untuk melayang di atas video saat Fullscreen / Mode Fokus. */
  mode: "sidebar" | "overlay";
}

export default function CallBar({ rtc, selfClientId, selfName, online, mode }: Props) {
  const [minimized, setMinimized] = useState(false);
  const partnersInCall = online.filter((p) => p.clientId !== selfClientId && p.inCall);
  const callPeers = rtc.peers.filter((p) => p.inCall || p.camOn || p.stream.getTracks().length > 0);

  if (!rtc.inCall && partnersInCall.length === 0 && !rtc.error) {
    return null;
  }

  const containerCls =
    mode === "overlay"
      ? "absolute right-3 top-3 z-20 w-72 sm:w-80 rounded-2xl border border-white/15 bg-black/80 p-3 shadow-2xl backdrop-blur-md"
      : "border-b border-border bg-surface/95 p-3";

  return (
    <div className={containerCls}>
      {rtc.error && (
        <div
          role="alert"
          className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-200"
        >
          <span>{rtc.error}</span>
        </div>
      )}

      {/* Banner ajakan saat pasangan sedang berada di panggilan */}
      {!rtc.inCall && partnersInCall.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="inline-block h-2.5 w-2.5 animate-ping rounded-full bg-emerald-400" />
            <span>
              <strong>{partnersInCall.map((p) => p.name).join(", ")}</strong> sedang di panggilan{" "}
              {partnersInCall.some((p) => p.camOn) ? "video" : "suara"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={rtc.connecting}
              onClick={() => void rtc.joinCall(false)}
              className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              🎙️ Gabung Suara
            </button>
            <button
              type="button"
              disabled={rtc.connecting}
              onClick={() => void rtc.joinCall(true)}
              className="rounded-lg bg-accent-strong px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-accent disabled:opacity-50"
            >
              📹 Gabung Video
            </button>
          </div>
        </div>
      )}

      {/* Panel panggilan aktif di Sidebar Kanan atau Overlay Fullscreen */}
      {rtc.inCall && (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Panggilan Aktif ({1 + callPeers.length})
            </span>
            {mode === "overlay" && (
              <button
                type="button"
                onClick={() => setMinimized((m) => !m)}
                className="rounded px-1.5 py-0.5 text-xs text-muted hover:bg-white/10 hover:text-white"
                title={minimized ? "Tampilkan kamera" : "Kecilkan panel"}
              >
                {minimized ? "▢ Perbesar" : "— Kecilkan"}
              </button>
            )}
          </div>

          {!minimized && (
            <div className="grid grid-cols-2 gap-2">
              <ParticipantTile
                name={`${selfName} (Kamu)`}
                stream={rtc.localStream}
                streamVersion={rtc.localVersion}
                isSelf
                micMuted={rtc.micMuted}
                camOn={rtc.camOn}
                speaking={!!rtc.speaking[selfClientId]}
              />

              {callPeers.map((peer: RemotePeer) => (
                <ParticipantTile
                  key={peer.clientId}
                  name={peer.name}
                  stream={peer.stream}
                  streamVersion={peer.streamVersion}
                  isSelf={false}
                  micMuted={peer.micMuted}
                  camOn={peer.camOn}
                  speaking={!!rtc.speaking[peer.clientId]}
                />
              ))}

              {callPeers.length === 0 && (
                <div className="grid aspect-video place-items-center rounded-xl border border-dashed border-border bg-surface-2/40 p-2 text-center text-[11px] text-muted">
                  Menunggu pasangan bergabung…
                </div>
              )}
            </div>
          )}

          {/* Tombol kontrol panggilan */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={rtc.toggleMic}
              aria-pressed={rtc.micMuted}
              className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition ${
                rtc.micMuted
                  ? "bg-red-500/20 text-red-200 ring-1 ring-red-500/40"
                  : "bg-surface-2 text-white hover:bg-border"
              }`}
              title={rtc.micMuted ? "Nyalakan mikrofon" : "Bisukan mikrofon"}
            >
              {rtc.micMuted ? "🔇 Bisu" : "🎙️ Mik"}
            </button>

            <button
              type="button"
              onClick={() => void rtc.toggleCam()}
              aria-pressed={rtc.camOn}
              className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition ${
                rtc.camOn
                  ? "bg-accent/20 text-pink-200 ring-1 ring-accent/50"
                  : "bg-surface-2 text-white hover:bg-border"
              }`}
              title={rtc.camOn ? "Matikan kamera" : "Nyalakan kamera"}
            >
              {rtc.camOn ? "📷 Cam ON" : "📷 Cam OFF"}
            </button>

            <button
              type="button"
              onClick={() => rtc.setAutoDuck((d) => !d)}
              aria-pressed={rtc.autoDuck}
              className={`rounded-lg px-2 py-1.5 text-xs font-medium transition ${
                rtc.autoDuck
                  ? "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/40"
                  : "bg-surface-2 text-muted hover:text-white"
              }`}
              title="Otomatis kecilkan suara film saat pasangan berbicara"
            >
              🔉 {rtc.autoDuck ? "ON" : "OFF"}
            </button>

            <button
              type="button"
              onClick={rtc.leaveCall}
              className="rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-red-500"
              title="Keluar dari panggilan"
            >
              📴
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ParticipantTile({
  name,
  stream,
  streamVersion,
  isSelf,
  micMuted,
  camOn,
  speaking,
}: {
  name: string;
  stream: MediaStream | null;
  streamVersion: number;
  isSelf: boolean;
  micMuted: boolean;
  camOn: boolean;
  speaking: boolean;
}) {
  const ringCls = speaking ? "ring-2 ring-emerald-400 shadow-sm shadow-emerald-500/30" : "ring-1 ring-border";
  const hasLiveVideo = !!stream && stream.getVideoTracks().some((t) => t.readyState === "live" && t.enabled);

  if (camOn && hasLiveVideo) {
    return (
      <div className={`relative aspect-video w-full overflow-hidden rounded-xl bg-black ${ringCls}`}>
        <VideoElement stream={stream} streamVersion={streamVersion} mirror={isSelf} />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/85 via-black/40 to-transparent px-2 py-1 text-[11px] text-white">
          <span className="truncate font-medium">{name}</span>
          <span>{micMuted ? "🔇" : speaking ? "🗣️" : ""}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex aspect-video w-full flex-col items-center justify-center gap-1 rounded-xl bg-surface-2 p-2 text-xs ${ringCls}`}
    >
      <Avatar name={name} size={32} />
      <div className="flex max-w-full items-center gap-1 px-1">
        <span className="truncate text-[11px] font-medium">{name}</span>
        <span className="text-[11px]">{micMuted ? "🔇" : speaking ? "🟢" : "🎙️"}</span>
      </div>
      {camOn && !hasLiveVideo && <span className="text-[10px] text-muted">Menghubungkan video…</span>}
    </div>
  );
}
