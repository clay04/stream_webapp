"use client";

import { useEffect, useRef, useState } from "react";
import type { RemotePeer, WebRTCController } from "@/hooks/useWebRTC";
import type { PresenceMeta } from "@/lib/types";
import { Avatar } from "./PresenceBar";

function MediaElement({
  stream,
  streamVersion,
  muted,
  video,
  mirror,
}: {
  stream: MediaStream | null;
  streamVersion: number;
  muted: boolean;
  video: boolean;
  mirror?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (video && videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      void videoRef.current.play().catch(() => {});
    }
  }, [stream, streamVersion, video]);

  useEffect(() => {
    if (!muted && audioRef.current && stream) {
      audioRef.current.srcObject = stream;
      void audioRef.current.play().catch(() => {});
    }
  }, [stream, streamVersion, muted]);

  return (
    <>
      {!muted && <audio ref={audioRef} autoPlay playsInline />}
      {video && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`h-full w-full object-cover ${mirror ? "-scale-x-100" : ""}`}
        />
      )}
    </>
  );
}

interface Props {
  rtc: WebRTCController;
  selfClientId: string;
  selfName: string;
  online: PresenceMeta[];
}

export default function CallBar({ rtc, selfClientId, selfName, online }: Props) {
  const [largeVideo, setLargeVideo] = useState(false);
  const partnersInCall = online.filter((p) => p.clientId !== selfClientId && p.inCall);

  if (!rtc.inCall && partnersInCall.length === 0 && !rtc.error) {
    return null;
  }

  return (
    <div className="border-b border-border bg-surface/95 px-3 py-2.5 sm:px-4">
      {rtc.error && (
        <div
          role="alert"
          className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs text-red-200"
        >
          <span>{rtc.error}</span>
        </div>
      )}

      {/* Banner ajakan saat pasangan sedang berada di panggilan */}
      {!rtc.inCall && partnersInCall.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs sm:text-sm">
            <span className="inline-block h-2.5 w-2.5 animate-ping rounded-full bg-emerald-400" />
            <span>
              <strong>{partnersInCall.map((p) => p.name).join(", ")}</strong> sedang di panggilan{" "}
              {partnersInCall.some((p) => p.camOn) ? "video" : "suara"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={rtc.connecting}
              onClick={() => void rtc.joinCall(false)}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              🎙️ Gabung Suara
            </button>
            <button
              type="button"
              disabled={rtc.connecting}
              onClick={() => void rtc.joinCall(true)}
              className="rounded-lg bg-accent-strong px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent disabled:opacity-50"
            >
              📹 Gabung Video
            </button>
          </div>
        </div>
      )}

      {/* Panel panggilan aktif */}
      {rtc.inCall && (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* Daftar peserta panggilan (kartu suara / kotak kamera) */}
            <div className="flex flex-wrap items-center gap-2">
              <ParticipantTile
                name={`${selfName} (Kamu)`}
                stream={rtc.localStream}
                streamVersion={rtc.camOn ? 1 : 0}
                isSelf
                micMuted={rtc.micMuted}
                camOn={rtc.camOn}
                speaking={!!rtc.speaking[selfClientId]}
                large={largeVideo}
                onToggleSize={() => setLargeVideo((v) => !v)}
              />

              {rtc.peers.map((peer: RemotePeer) => (
                <ParticipantTile
                  key={peer.clientId}
                  name={peer.name}
                  stream={peer.stream}
                  streamVersion={peer.streamVersion}
                  isSelf={false}
                  micMuted={peer.micMuted}
                  camOn={peer.camOn}
                  speaking={!!rtc.speaking[peer.clientId]}
                  large={largeVideo}
                  onToggleSize={() => setLargeVideo((v) => !v)}
                />
              ))}

              {rtc.peers.length === 0 && (
                <span className="px-2 text-xs text-muted">Menunggu pasangan bergabung ke panggilan…</span>
              )}
            </div>

            {/* Tombol kontrol panggilan */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={rtc.toggleMic}
                aria-pressed={rtc.micMuted}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                  rtc.micMuted
                    ? "bg-red-500/20 text-red-200 ring-1 ring-red-500/40"
                    : "bg-surface-2 text-white hover:bg-border"
                }`}
                title={rtc.micMuted ? "Nyalakan mikrofon" : "Bisukan mikrofon"}
              >
                {rtc.micMuted ? "🔇 Bisu" : "🎙️ Mik Aktif"}
              </button>

              <button
                type="button"
                onClick={() => void rtc.toggleCam()}
                aria-pressed={rtc.camOn && !rtc.screenSharing}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                  rtc.camOn && !rtc.screenSharing
                    ? "bg-accent/20 text-pink-200 ring-1 ring-accent/50"
                    : "bg-surface-2 text-white hover:bg-border"
                }`}
                title={rtc.camOn ? "Matikan kamera" : "Nyalakan kamera"}
              >
                {rtc.camOn && !rtc.screenSharing ? "📷 Kamera ON" : "📷 Kamera OFF"}
              </button>

              <button
                type="button"
                onClick={() => void rtc.toggleScreenShare()}
                aria-pressed={rtc.screenSharing}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                  rtc.screenSharing
                    ? "bg-accent/20 text-pink-200 ring-1 ring-accent/50"
                    : "bg-surface-2 text-white hover:bg-border"
                }`}
                title="Bagikan layar / tab browser beserta suaranya"
              >
                {rtc.screenSharing ? "🖥️ Stop Share" : "🖥️ Share Layar"}
              </button>

              <button
                type="button"
                onClick={() => rtc.setAutoDuck((d) => !d)}
                aria-pressed={rtc.autoDuck}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                  rtc.autoDuck
                    ? "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/40"
                    : "bg-surface-2 text-muted hover:text-white"
                }`}
                title="Otomatis kecilkan suara film saat pasangan berbicara"
              >
                🔉 Auto-kecilkan {rtc.autoDuck ? "ON" : "OFF"}
              </button>

              <button
                type="button"
                onClick={rtc.leaveCall}
                className="rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-red-500"
                title="Keluar dari panggilan"
              >
                📴 Tutup
              </button>
            </div>
          </div>

          <p className="text-[11px] text-muted">
            🎧 Tips: Gunakan headset/earphone agar suara video tidak memantul (echo) ke pasanganmu.
          </p>
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
  large,
  onToggleSize,
}: {
  name: string;
  stream: MediaStream | null;
  streamVersion: number;
  isSelf: boolean;
  micMuted: boolean;
  camOn: boolean;
  speaking: boolean;
  large: boolean;
  onToggleSize: () => void;
}) {
  const ringCls = speaking ? "ring-2 ring-emerald-400 shadow-sm shadow-emerald-500/30" : "ring-1 ring-border";

  if (camOn) {
    return (
      <div
        onClick={onToggleSize}
        title="Klik untuk memperbesar/memperkecil kamera"
        className={`relative cursor-pointer overflow-hidden rounded-xl bg-black transition-all ${ringCls} ${
          large ? "h-36 w-56 sm:h-44 sm:w-72" : "h-20 w-32 sm:h-24 sm:w-40"
        }`}
      >
        <MediaElement stream={stream} streamVersion={streamVersion} muted={isSelf} video mirror={isSelf} />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 via-black/40 to-transparent px-2 py-1 text-[11px] text-white">
          <span className="truncate font-medium">{name}</span>
          <span>{micMuted ? "🔇" : speaking ? "🗣️" : ""}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 rounded-full bg-surface-2 px-3 py-1.5 text-xs ${ringCls}`}>
      <MediaElement stream={stream} streamVersion={streamVersion} muted={isSelf} video={false} />
      <Avatar name={name} size={22} />
      <span className="max-w-28 truncate font-medium">{name}</span>
      <span>{micMuted ? "🔇" : speaking ? "🟢" : "🎙️"}</span>
    </div>
  );
}
