"use client";

import type { PresenceMeta } from "@/lib/types";

export function Avatar({ name, online = true, size = 32 }: { name: string; online?: boolean; size?: number }) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) % 360;
  return (
    <span
      className={`relative grid shrink-0 place-items-center rounded-full font-semibold text-white ${online ? "" : "opacity-40"}`}
      style={{ width: size, height: size, background: `hsl(${hash} 65% 45%)`, fontSize: size * 0.42 }}
      title={name}
    >
      {initial}
      {online && (
        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg bg-emerald-400" />
      )}
    </span>
  );
}

export default function PresenceBar({ online, selfId }: { online: PresenceMeta[]; selfId: string }) {
  const partnerOnline = online.some((p) => p.userId !== selfId);
  return (
    <div className="flex items-center gap-2" aria-label="Peserta online">
      <div className="flex -space-x-2">
        {online.map((p) => (
          <Avatar key={p.userId} name={p.name} />
        ))}
      </div>
      <span className="hidden text-xs text-muted sm:inline">
        {partnerOnline ? `${online.length} online` : "Menunggu pasangan…"}
      </span>
    </div>
  );
}

