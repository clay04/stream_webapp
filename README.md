# Nonton Bareng 🍿

Aplikasi web privat untuk dua orang (pengguna & pasangan) agar bisa menonton video secara sinkron dari jarak jauh — dibangun sesuai **PRD v1.1**.

## Fitur yang Tersedia

- **F1 · Identitas Tanpa Akun**: Cukup isi nama panggilan; sesi anonim Supabase dibuat otomatis dan nama disimpan di perangkat (`localStorage` + tabel `profiles`).
- **F2 & F2a · Buat & Gabung Room (Permanen / Sementara)**:
  - Kode room acak 10 karakter (alfabet tanpa karakter ambigu `0/O/1/I/L`).
  - Otomatis terkunci setelah 2 orang bergabung (bisa dibuka/dikunci ulang di tab **Info**).
  - Pilihan tipe **Permanen** atau **Sementara** (otomatis dibersihkan setelah 7 hari tanpa aktivitas lewat Vercel Cron).
  - Rate limit berlapis (memori + tabel `join_attempts` di Postgres) untuk mencegah tebak kode.
- **F3 & F9 · Pemutar Video dengan Arsitektur Adapter**:
  - **YouTube IFrame Player API** resmi (mendukung URL `youtube.com/watch`, `youtu.be`, `shorts`, `live`, dan `playlist`).
  - **HTML5 Video + HLS (`hls.js`)** untuk tautan langsung ke file video milik sendiri (`.mp4`, `.webm`, `.m3u8`).
  - Deteksi error embed (kode 101/150) dengan tombol **Buka di sumber asli** dan hitung mundur lewati otomatis.
- **F4 · Sinkronisasi Playback Setara (Peer-to-Peer State)**:
  - Semua peserta setara (siapa pun bisa play, pause, seek, ganti video, atau ubah kecepatan).
  - Kalibrasi jam klien-server (`/api/time`) untuk menghitung posisi target `position + (now - sentAt)`.
  - Pencegahan loop (`suppressUntil`), heartbeat tiap 5 detik dari pengirim aktif, koreksi drift (>1,5 dtk), permintaan state saat baru bergabung, gerbang interaksi autoplay (**Gabung dan mulai**), dan indikator buffering pasangan.
- **F5 · Presence Realtime**: Status online/offline dan indikator buffering pasangan tampil langsung melalui Supabase Realtime Presence.
- **F6 · Antrean Video**: Tambah (putar sekarang atau masuk antrean), ambil judul & thumbnail otomatis lewat YouTube oEmbed (`/api/metadata`), ubah urutan, hapus, bersihkan yang sudah ditonton, dan putar otomatis video berikutnya saat selesai.
- **F7 · Chat Teks & Reaksi Emoji Melayang**: Pesan tersimpan di Postgres dan disiarkan via Broadcast (<1 detik), dilengkapi reaksi emoji melayang di atas video.
- **F8 · Responsif & Mode Fokus**: Layout desktop (pemutar di kiri, panel di kanan) dan mobile-first (pemutar di atas, tab Antrean/Chat/Info di bawah), ditambah **Mode Fokus** dan layar penuh.

---

## Persiapan Supabase

1. Buat project baru di [Supabase](https://supabase.com) (disarankan region **Southeast Asia (Singapore)**).
2. Buka **Authentication → Providers → Anonymous Sign-Ins**, lalu aktifkan **Enable Anonymous Sign-ins**.
3. Buka **Project Settings → Realtime**, pastikan **Allow public access** atau **Enable Realtime** aktif (migrasi sudah menyiapkan RLS pada `realtime.messages` untuk channel privat `room:<id>`).
4. Buka **SQL Editor**, tempel seluruh isi file [`supabase/migrations/0001_init.sql`](./supabase/migrations/0001_init.sql), lalu jalankan (**Run**).

---

## Menjalankan Secara Lokal

1. Salin variabel lingkungan:
   ```bash
   cp .env.example .env.local
   ```
2. Isi `.env.local` dengan `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, dan `SUPABASE_SERVICE_ROLE_KEY` dari **Project Settings → API** di Supabase.
3. Jalankan server pengembangan:
   ```bash
   npm run dev
   ```
4. Buka `http://localhost:3000` di dua jendela browser (satu normal, satu incognito) untuk menguji sinkronisasi berdua.

---

## Deploy ke Vercel

1. Hubungkan repositori ke Vercel.
2. Tambahkan semua variabel dari `.env.example` di **Project Settings → Environment Variables**.
3. [`vercel.json`](./vercel.json) sudah mengatur:
   - Region fungsi serverless di Singapura (`sin1`).
   - Cron harian (`/api/cron/cleanup`) untuk menghapus room sementara yang tidak aktif selama `TEMP_ROOM_TTL_DAYS` (default 7 hari).

