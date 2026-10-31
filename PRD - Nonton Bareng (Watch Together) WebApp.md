# PRD: Nonton Bareng — WebApp Streaming Video Berdua

Versi 1.1 · 31 Oktober 2026 · Status: Draft untuk review

## 1. Ringkasan

**Nonton Bareng** adalah aplikasi web privat untuk dua orang (pengguna dan pasangan) yang memungkinkan menonton video secara sinkron dari jarak jauh. Video dari YouTube dan sumber lain diputar bersamaan di kedua perangkat, dengan kontrol play/pause/seek yang tersinkronisasi, antrean tonton, dan chat ringan. Aplikasi dibangun dengan Next.js fullstack dan di-deploy di Vercel.

**Kata kunci:** privat, sederhana, sinkron, gratis/murah dioperasikan.

## 2. Latar Belakang dan Tujuan

Menonton bersama saat berjauhan sering dilakukan dengan screen share di video call, tetapi kualitasnya buruk dan boros kuota. Aplikasi ini memutar video langsung dari sumbernya di masing-masing perangkat, sehingga kualitas tetap baik dan hanya data sinkronisasi kecil yang dikirim.

**Tujuan produk**

- Dua orang dapat menonton video yang sama dengan selisih waktu kurang dari 2 detik.
- Membuat dan bergabung ke room hanya dengan kode room dan nama panggilan, tanpa akun.
- Mendukung YouTube sebagai sumber utama, dengan arsitektur yang mudah ditambah sumber lain.
- Biaya operasional mendekati nol (memanfaatkan free tier Vercel dan layanan realtime).

**Bukan tujuan (non-goals)**

- Bukan platform streaming publik atau multi-user skala besar.
- Tidak menyimpan, mengunduh, atau me-restream konten milik pihak lain.
- Tidak membypass iklan, DRM, atau pembatasan platform sumber, dan tidak mengintegrasikan situs streaming bajakan.

## 3. Pengguna

| Persona | Deskripsi | Kebutuhan utama |
| --- | --- | --- |
| Pemilik room (Host) | Pengguna yang membuat room | Membuat room, mengundang pasangan, mengatur antrean |
| Tamu (Partner) | Pasangan yang bergabung dengan kode room dan nama panggilan | Bergabung cepat tanpa akun, punya hak kontrol video yang sama dengan host |

Skala awal: 2 pengguna aktif, beberapa room. Desain tetap mendukung hingga sekitar 6 peserta per room tanpa perubahan arsitektur besar.

## 4. User Stories

1. Sebagai pengguna, saya ingin membuat room dan membagikan kode room agar pasangan saya bisa langsung masuk hanya dengan memasukkan namanya.
2. Sebagai pengguna, saya ingin menempel (paste) tautan YouTube agar video langsung diputar di kedua layar.
3. Sebagai pengguna, saya ingin saat salah satu dari kami pause atau seek, layar yang lain ikut menyesuaikan.
4. Sebagai pengguna, saya ingin membuat antrean video agar tidak perlu mencari video berikutnya saat menonton.
5. Sebagai pengguna, saya ingin mengobrol lewat chat, voice call, atau video call, dan mengirim reaksi emoji tanpa menutupi video.
6. Sebagai pengguna, saya ingin aplikasi nyaman dipakai di HP maupun laptop.
7. Sebagai pengguna, saya ingin hanya kami berdua yang bisa masuk ke room kami meski tanpa akun, cukup dengan kode room.

## 5. Ruang Lingkup Fitur

### 5.1 MVP (Fase 1)

| ID | Fitur | Prioritas | Kriteria penerimaan |
| --- | --- | --- | --- |
| F1 | Identitas tanpa akun: isi nama panggilan, sesi anonim dibuat otomatis | P0 | Nama panggilan diingat di perangkat; sesi anonim dipakai untuk mengamankan data room |
| F2 | Buat room dan gabung dengan kode room | P0 | Kode acak minimal 8 karakter dan tidak mudah ditebak; room otomatis terkunci setelah 2 orang masuk, bisa dibuka lagi lewat pengaturan room |
| F3 | Pemutar YouTube (IFrame Player API) | P0 | Video dari URL YouTube biasa, youtu.be, dan playlist dasar dapat diputar |
| F4 | Sinkronisasi play, pause, seek, ganti video | P0 | Selisih waktu antar perangkat kurang dari 2 detik pada koneksi normal |
| F5 | Presence (siapa yang sedang online) | P0 | Status online/offline pasangan tampil real time |
| F6 | Antrean video | P1 | Tambah, hapus, urutkan ulang, dan putar otomatis item berikutnya |
| F7 | Chat teks dan reaksi emoji | P1 | Pesan tampil kurang dari 1 detik; riwayat chat room tersimpan |
| F8 | Tampilan responsif (mobile first) | P1 | Dapat dipakai nyaman di layar 360px hingga desktop |
| F2a | Tipe room: permanen atau sementara | P1 | Dipilih saat membuat room. Permanen: kode tetap dan data disimpan. Sementara: otomatis terhapus setelah 7 hari tanpa aktivitas (angka bisa diubah) |

### 5.2 Fase 2

| ID | Fitur | Prioritas |
| --- | --- | --- |
| F9 | Pemutar file MP4/HLS milik sendiri lewat tautan langsung, tanpa fitur upload (prioritas pertama), disusul Vimeo, Twitch, dan SoundCloud (via adapter pemutar) | P1 |
| F10 | Riwayat tontonan dan daftar favorit/watchlist bersama | P2 |
| F11 | Pencarian video YouTube di dalam aplikasi (YouTube Data API) | P2 |
| F12 | Pengingat jadwal nonton (notifikasi atau tautan kalender) | P3 |
| F13 | Voice call dan video call di dalam room (WebRTC lewat LiveKit atau Daily) | P1 |
| F13a | Mode tonton manual untuk layanan berlangganan (Netflix, Vidio, dll.): hitung mundur bersama, voice call, chat, dan reaksi. Video diputar di aplikasi masing-masing tanpa sinkronisasi otomatis, karena pemutar layanan tersebut tidak bisa dikontrol dari luar | P2 |
| F13b | Screen sharing dengan audio sebagai alternatif untuk MP4 atau sumber yang tidak bisa di-embed (WebRTC lewat LiveKit atau Daily). Paling andal di Chrome atau Edge desktop dengan opsi bagikan audio tab; browser HP umumnya belum mendukung; konten ber-DRM seperti Netflix tampil hitam | P2 |

### 5.3 Fase 3 (opsional)

| ID | Fitur | Catatan |
| --- | --- | --- |
| F14 | PWA agar bisa dipasang di layar utama HP | Ditunda: belum dibutuhkan saat ini |
| F16 | Tema dan kustomisasi room | Estetika personal |

## 6. Alur Pengguna Utama

1. Pengguna membuka aplikasi, mengisi nama panggilan, lalu menekan **Buat Room**.
2. Sistem membuat room dan menampilkan kode room untuk dibagikan.
3. Pasangan membuka aplikasi, mengisi nama dan kode room, lalu masuk ke room.
4. Salah satu menempel URL video, video dimuat di kedua perangkat, lalu diputar bersamaan.
5. Kontrol dari salah satu pihak (play, pause, seek) disiarkan ke pihak lain dan diterapkan.
6. Video selesai, item berikutnya di antrean diputar otomatis.

## 7. Arsitektur Teknis

### 7.1 Keputusan penting: realtime di Vercel

Fungsi serverless Vercel **tidak cocok untuk koneksi WebSocket yang persisten**. Karena itu, lapisan realtime harus memakai layanan eksternal, bukan route handler Next.js. Pilihan yang direkomendasikan:

| Opsi | Kelebihan | Kekurangan |
| --- | --- | --- |
| **Supabase (Auth + Postgres + Realtime)** — direkomendasikan | Satu layanan untuk auth, database, dan realtime (Broadcast + Presence); free tier cukup | Ketergantungan pada satu vendor |
| Ably atau Pusher | Realtime sangat andal, SDK matang | Perlu auth dan database terpisah |
| PartyKit atau Liveblocks | Cocok untuk state room kolaboratif | Tambahan layanan yang perlu dipelajari |

### 7.2 Tech stack yang disarankan

| Lapisan | Pilihan |
| --- | --- |
| Framework | Next.js (App Router) dengan TypeScript |
| UI | Tailwind CSS + shadcn/ui |
| Pemutar video | react-player atau YouTube IFrame Player API langsung; dibungkus adapter agar sumber lain mudah ditambah |
| State klien | Zustand atau React state + hooks |
| Auth | Supabase Anonymous Sign-in (tanpa akun; nama panggilan disimpan di profil) |
| Database | Supabase Postgres (dengan Row Level Security) |
| Realtime | Supabase Realtime (Broadcast untuk event player, Presence untuk status online) |
| Validasi | Zod |
| Hosting | Vercel (Preview per pull request, Production dari branch utama) |
| Observability | Vercel Analytics dan log; Sentry opsional |
| Voice dan video call | LiveKit Cloud atau Daily (WebRTC); token akses dibuat di Route Handler Next.js |
| Sumber file MP4 | Tautan langsung ke file yang disimpan sendiri, tanpa upload ke aplikasi; tautan harus bisa diakses langsung oleh browser (bukan halaman pratinjau seperti Google Drive biasa) |
| Pembersihan room sementara | Vercel Cron memanggil Route Handler setiap hari untuk menghapus room sementara yang tidak aktif |

### 7.3 Gambaran arsitektur

- **Klien (Next.js):** merender UI, memuat pemutar, mengirim dan menerima event sinkronisasi lewat channel realtime per room.
- **Server (Route Handlers / Server Actions):** membuat room, validasi kode room, penerbitan token voice/video call, mengambil metadata video (judul, thumbnail) via oEmbed atau YouTube Data API, serta operasi antrean dan chat yang perlu disimpan.
- **Supabase:** otorisasi dan penyimpanan data; channel realtime dibatasi hanya untuk anggota room.

## 8. Desain Sinkronisasi Playback

Prinsip: **semua peserta setara** (siapa pun boleh mengontrol), state dianggap sebagai "video X, status play/pause, posisi P pada waktu T".

1. **Event** yang disiarkan: `play`, `pause`, `seek`, `change_video`, `rate_change`. Setiap event membawa `videoId`, `position`, `sentAt` (timestamp), dan `senderId`.
2. **Penerapan:** penerima menghitung posisi target = `position + (now - sentAt)` jika status play, lalu memanggil seek jika selisih lebih dari ambang batas.
3. **Cegah loop:** event yang dipicu oleh sinkronisasi ditandai (flag `remote`) agar tidak disiarkan ulang.
4. **Koreksi drift:** heartbeat ringan tiap 5 detik dari pengirim aktif; penerima menyesuaikan jika selisih lebih dari 1,5 detik.
5. **Join di tengah jalan:** peserta baru meminta state terkini dari peserta yang sedang online; jika tidak ada, memakai state terakhir yang tersimpan di database.
6. **Autoplay:** browser memblokir autoplay dengan suara, jadi tampilkan tombol "Gabung dan mulai" untuk memicu interaksi pengguna pertama.
7. **Buffering:** jika salah satu pihak buffering, tampilkan indikator dan opsional jeda otomatis pihak lain.

## 9. Model Data (Postgres)

| Tabel | Kolom utama |
| --- | --- |
| `profiles` | id (uid sesi anonim), display\_name |
| `rooms` | id, owner\_id, name, room\_code, is\_locked, type (permanent/temporary), last\_active\_at, created\_at |
| `room_members` | room\_id, user\_id, role, joined\_at |
| `queue_items` | id, room\_id, source (youtube/vimeo/url), source\_id, title, thumbnail, position, added\_by, played\_at |
| `room_state` | room\_id, current\_item\_id, status, position, updated\_at, updated\_by |
| `messages` | id, room\_id, user\_id, body, created\_at |

Row Level Security: pengguna hanya dapat membaca dan menulis data room tempat dia menjadi anggota. Keanggotaan dibuat di server setelah kode room diverifikasi.

## 10. Persyaratan Non-Fungsional

| Aspek | Target |
| --- | --- |
| Latensi event sinkronisasi | Kurang dari 500 ms pada koneksi normal |
| Toleransi drift | Kurang dari 2 detik |
| Ketersediaan | Mengikuti SLA Vercel dan Supabase (tanpa SLA khusus) |
| Keamanan | HTTPS, RLS, kode room acak (minimal 8 karakter), batas laju (rate limit) pada endpoint gabung room agar kode tidak bisa ditebak |
| Performa | LCP kurang dari 2,5 detik; pemutar dimuat lazy |
| Aksesibilitas | Kontras memadai, navigasi keyboard, label ARIA pada kontrol utama |
| Privasi | Data minimal; pengguna dapat menghapus room dan seluruh isinya |

## 11. Legal dan Kebijakan Platform

- Gunakan **YouTube IFrame Player API** resmi. Jangan mengunduh, mengekstrak stream, atau menyembunyikan pemutar atau iklan karena melanggar Ketentuan Layanan YouTube.
- Sebagian video tidak boleh di-embed oleh pemiliknya; tampilkan pesan yang jelas dan sediakan tombol "Buka di YouTube".
- Konten ber-DRM (Netflix, Disney+, dan sejenisnya) tidak dapat diputar lewat embed; screen share pun biasanya tampil hitam. Tidak masuk cakupan produk ini.
- Untuk Twitch, parameter `parent` pada embed wajib diisi dengan domain deployment.
- Karena penggunaan bersifat privat dan non-komersial, risiko rendah, tetapi tetap hormati batas kuota YouTube Data API bila fitur pencarian dipakai.

**Situs streaming bajakan (misalnya LK21 dan sejenisnya) tidak didukung.** Situs tersebut menayangkan film tanpa izin pemegang hak cipta, jadi mengintegrasikannya sama saja dengan membantu pelanggaran hak cipta. Selain itu, situs semacam ini biasanya penuh iklan berbahaya dan memblokir embed. Alternatif legal: video YouTube yang diunggah atau dijual resmi oleh pemiliknya, Vimeo, Twitch, file video milik sendiri (MP4/HLS), atau menonton layanan berlangganan resmi di aplikasi masing-masing sambil terhubung lewat voice call di room.

## 12. Desain dan UX

- **Layout desktop:** pemutar di kiri (lebar dominan), panel samping untuk antrean dan chat.
- **Layout mobile:** pemutar di atas, tab untuk Antrean, Chat, dan Info di bawahnya.
- **Mode fokus:** sembunyikan panel untuk menonton layar penuh; reaksi emoji tampil melayang.
- **Komponen utama:** pemutar, bar kontrol bersama, input tempel URL, kartu antrean, avatar presence, bubble chat.
- Tema gelap sebagai default, dengan sentuhan personal (warna, nama room, emoji).

## 13. Milestone

| Tahap | Cakupan | Estimasi (paruh waktu) |
| --- | --- | --- |
| M0 | Setup repo, Next.js, Tailwind, Supabase, deploy awal ke Vercel | 1 hari |
| M1 | Identitas anonim, buat dan masuk room dengan kode, presence | 2 hari |
| M2 | Pemutar YouTube + sinkronisasi dasar | 3 hari |
| M3 | Antrean, chat, reaksi, responsif mobile | 3 hari |
| M4 | Uji berdua, perbaikan drift, polesan UI, rilis MVP | 2 hari |
| M5 | Fase 2 (pemutar MP4 sendiri, voice/video call, mode tonton manual, sumber legal lain, riwayat tontonan) | 1 sampai 2 minggu |

## 14. Metrik Keberhasilan

- Selisih sinkronisasi median kurang dari 1 detik pada sesi nyata.
- Waktu dari membuka aplikasi sampai video diputar bersama kurang dari 30 detik.
- Setidaknya 90% sesi berjalan tanpa perlu muat ulang halaman.
- Biaya bulanan Rp0 sampai di bawah Rp100.000 (di luar domain).

## 15. Risiko dan Mitigasi

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| Drift atau lag sinkronisasi | Pengalaman buruk | Heartbeat, ambang koreksi, indikator buffering |
| Autoplay diblokir browser | Video tidak mulai | Tombol interaksi awal sebelum memutar |
| Video tidak bisa di-embed | Item antrean gagal | Deteksi error pemutar, lewati otomatis, tautan ke sumber asli |
| Batas free tier Supabase atau Vercel | Layanan terhenti | Pantau penggunaan; skala penggunaan kecil sehingga risiko rendah |
| Latensi dari Indonesia ke region server | Event terasa lambat | Pilih region Singapura untuk Supabase dan fungsi Vercel |
| Perubahan kebijakan atau API YouTube | Fitur rusak | Bungkus pemutar dengan adapter, ikuti pembaruan dokumentasi resmi |
| Kode room ditebak orang asing | Privasi room bocor | Kode panjang dan acak, rate limit, room terkunci setelah 2 orang masuk |
| Echo saat voice call sambil memutar video | Suara pasangan terganggu | Sarankan headset; turunkan volume video otomatis saat ada yang bicara |

## 16. Keputusan Produk dan Pertanyaan Terbuka

Semua pertanyaan awal sudah dijawab dan keputusannya diterapkan ke bagian lain dokumen ini.

| Pertanyaan | Keputusan |
| --- | --- |
| Siapa yang boleh mengontrol video? | Semua peserta setara. |
| Perlu login akun? | Tidak. Cukup kode room dan nama panggilan (sesi anonim). |
| Sumber non-YouTube yang diprioritaskan? | Situs bajakan seperti LK21 tidak didukung (lihat bagian 11). Sumber yang legal: Vimeo, Twitch, MP4/HLS milik sendiri. |
| Voice dan video call? | Ya, masuk Fase 2 (F13) lewat LiveKit atau Daily. |
| PWA? | Ditunda (F14). |
| Room permanen atau sementara? | Keduanya, dipilih saat membuat room (F2a). |
| Sumber legal yang diprioritaskan? | File MP4 milik sendiri dulu, lalu Vimeo, Twitch, SoundCloud (F9). |
| Ada langganan layanan resmi? | Ya. Disediakan mode tonton manual dengan voice call (F13a). |
| Cara memasukkan file MP4? | Tempel tautan langsung, tanpa upload. Alternatifnya share screen dengan audio (F13b). |
| Masa simpan room sementara? | 7 hari tanpa aktivitas. |

Tidak ada pertanyaan terbuka lagi. Dua catatan teknis dari keputusan terakhir:

1. Pemutar MP4 memakai elemen video HTML5, sehingga tautannya harus mengarah ke file video langsung dan mendukung pemutaran sebagian (HTTP range) agar seek berjalan baik.
2. Share screen dengan audio hanya cocok sebagai cadangan: kualitas bergantung pada koneksi pengirim, dan tidak bisa dipakai untuk Netflix atau layanan ber-DRM lainnya.
