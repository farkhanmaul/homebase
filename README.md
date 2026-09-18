# Nongkrong Kantor

Prototipe interaktif ruang virtual pixel-art untuk geng kantor kecil. Fokus versi ini: ruangan, enam avatar tetap, status, perpindahan spot, chat lokal, dan tampilan responsif.

## Menjalankan lokal

```bash
npm install
npm run dev
```

Build produksi: `npm run build`.

State lokal di `app/page.tsx` tetap menjadi mode preview. Shared session memakai backend PocketBase lokal di bawah ini. Google OAuth, realtime penuh, backup, serta Cloudflare Tunnel masih fase berikutnya.

## Backend lokal (PocketBase)

Backend sesi kantor berjalan sebagai executable PocketBase 0.40.4 di VPS (diunduh ke `tools/` yang gitignored) dengan migrasi di `backend/pb_migrations` dan hooks di `backend/pb_hooks`. Frontend GitHub Pages membaca endpoint publik dari `public/config.json`. Deployment sementara memakai Cloudflare Quick Tunnel; URL dapat berubah bila service tunnel direstart, jadi named tunnel tetap diperlukan untuk URL produksi yang permanen.

```bash
npm run backend:setup       # unduh + verifikasi checksum resmi PocketBase 0.40.4, idempoten
npm run backend:setup:test  # bukti offline: cache yang dipalsukan ditolak & dipasang ulang
npm run backend:serve       # serve di 127.0.0.1:8090 dengan migrasi + hooks
npm run backend:test        # tes integrasi Python stdlib terhadap binary PocketBase asli
```

Versi PocketBase di-hardcode ke 0.40.4 (tidak ada override `POCKETBASE_VERSION`). Setup mencatat SHA-256 executable ke `tools/pocketbase.sha256` dan memverifikasinya bersama file versi serta `--version` pada setiap invokasi; bila ada yang tidak cocok, binary dipasang ulang dari rilis resmi.

Override: `OFFICE_HTTP_ADDR`, `OFFICE_ALLOWED_ORIGINS`, `POCKETBASE_DATA_DIR`, dan batas laju `OFFICE_{CLAIM,RELEASE,HEARTBEAT,MESSAGE}_{LIMIT,WINDOW_MS}`. TTL lease produksi tetap 90 detik dan tidak dapat diubah lewat env; `OFFICE_TEST_LEASE_TTL_MS` hanya untuk tes dan dibatasi (200..90000 ms) sehingga hanya bisa memperpendek lease.

Kontrak di `/api/office/`: `GET characters` -> `{characters:[{id,active,x,y,direction,status}]}`, `POST claim {id}` -> `{token}`, `POST release`, `POST heartbeat {x,y,direction,status}`, `GET messages` -> `{messages:[{id,name,text,time,sprite}]}`, `POST messages {text}`. Semua penulisan selain `claim` memerlukan header `X-Office-Session`; server menurunkan karakter/nama/sprite dari token, bukan dari body.

### Batasan keamanan

- Memilih nama/karakter bukan identitas: siapa pun yang bisa menjangkau API dapat mengklaim karakter yang kosong.
- Sesi memakai bearer token acak; server hanya menyimpan hash SHA-256 dan tidak pernah mengembalikannya lewat endpoint list.
- Server hanya listen di loopback dengan CORS terbatas; jangan ekspos langsung ke jaringan publik. Pembatasan CORS hanya berlaku bila server dijalankan lewat wrapper `npm run backend:serve` (script `scripts/serve-pocketbase.sh`) yang menyetel flag `--origins`. Menjalankan binary `tools/pocketbase` langsung tanpa `--origins` akan mengizinkan semua origin.
- Chat disimpan maksimum 200 pesan terakhir dan laju tulis dibatasi; ini bukan pengganti autentikasi. `heartbeat` dan `messages` mengautentikasi sesi sebelum parsing body, jadi body rusak tanpa sesi sah menghasilkan `401` (bukan `400`).
- Belum realtime: klien masih polling posisi tiap 2 detik.

Background kantor dibuat khusus dengan OpenAI ImageGen. Aset karakter LPC belum disertakan; catat lisensi dan atribusi setiap layer sebelum menambahnya.
