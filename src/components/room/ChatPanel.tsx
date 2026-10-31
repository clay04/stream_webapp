"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { ChatMessage } from "@/lib/types";
import { REACTIONS } from "./ControlBar";

interface Props {
  roomId: string;
  userId: string;
  messages: ChatMessage[];
  names: Record<string, string>;
  onSent: (m: ChatMessage) => void;
  onReact: (emoji: string) => void;
}

function time(iso: string) {
  return new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

export default function ChatPanel({ roomId, userId, messages, names, onSent, onReact }: Props) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    const { data, error: err } = await getSupabaseBrowser()
      .from("messages")
      .insert({ room_id: roomId, user_id: userId, body: text.slice(0, 1000) })
      .select()
      .single();
    setSending(false);
    if (err) {
      setError("Pesan gagal terkirim");
      return;
    }
    setBody("");
    onSent(data as ChatMessage);
  }

  return (
    <div className="flex h-full flex-col">
      <div ref={listRef} className="scrollbar-thin flex-1 space-y-2 overflow-y-auto p-3" aria-live="polite">
        {messages.length === 0 && <p className="pt-6 text-center text-sm text-muted">Belum ada pesan. Sapa duluan 👋</p>}
        {messages.map((m) => {
          const mine = m.user_id === userId;
          return (
            <div key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
                  mine ? "rounded-br-sm bg-accent-strong text-white" : "rounded-bl-sm bg-surface-2"
                }`}
              >
                {m.body}
              </div>
              <span className="mt-0.5 px-1 text-[10px] text-muted">
                {mine ? "Kamu" : names[m.user_id] ?? "Pasangan"} · {time(m.created_at)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex gap-1 border-t border-border px-2 pt-2">
        {REACTIONS.map((r) => (
          <button
            key={r}
            onClick={() => onReact(r)}
            className="grid h-8 flex-1 place-items-center rounded-lg text-lg hover:bg-surface-2"
            aria-label={`Kirim reaksi ${r}`}
          >
            {r}
          </button>
        ))}
      </div>
      <form onSubmit={send} className="flex gap-2 p-2">
        <label htmlFor="chat-input" className="sr-only">
          Pesan
        </label>
        <input
          id="chat-input"
          value={body}
          maxLength={1000}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Tulis pesan…"
          autoComplete="off"
          className="min-w-0 flex-1 rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={!body.trim() || sending}
          className="rounded-xl bg-accent-strong px-4 text-sm font-semibold text-white hover:bg-accent disabled:opacity-50"
        >
          Kirim
        </button>
      </form>
      {error && (
        <p role="alert" className="px-3 pb-2 text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

