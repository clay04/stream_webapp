"use client";

import { getSupabaseBrowser } from "./supabase/client";

const NAME_KEY = "nb:name";
const CLIENT_ID_KEY = "nb:client_id";

/** ID unik per tab browser agar pengujian 2 tab maupun multi-perangkat tidak saling menimpa. */
export function getClientId(): string {
  if (typeof window === "undefined") return "server";
  let id = sessionStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

export function getStoredName(): string {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem(NAME_KEY) ?? localStorage.getItem(NAME_KEY) ?? "";
}

export function storeName(name: string) {
  sessionStorage.setItem(NAME_KEY, name);
  localStorage.setItem(NAME_KEY, name);
}

/** Memastikan ada sesi anonim Supabase, lalu mengembalikan user id. */
export async function ensureSession(): Promise<string> {
  const supabase = getSupabaseBrowser();
  const { data } = await supabase.auth.getSession();
  if (data.session?.user) return data.session.user.id;
  const { data: signed, error } = await supabase.auth.signInAnonymously();
  if (error || !signed.user) {
    throw new Error(error?.message ?? "Gagal membuat sesi anonim. Pastikan Anonymous Sign-in aktif di Supabase.");
  }
  return signed.user.id;
}

/** Sesi anonim + simpan nama panggilan ke perangkat dan tabel profiles. */
export async function ensureIdentity(name: string): Promise<string> {
  const clean = name.trim().slice(0, 32);
  if (!clean) throw new Error("Nama panggilan wajib diisi");
  const userId = await ensureSession();
  storeName(clean);
  const supabase = getSupabaseBrowser();
  const { error } = await supabase
    .from("profiles")
    .upsert({ id: userId, display_name: clean, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  return userId;
}
