# Continuation checkpoint

Backend sesi kantor lokal sudah diimplementasikan di repo ini memakai PocketBase 0.40.4. UI statis tidak diubah dan `public/config.json` tetap `{"apiUrl":""}` sehingga preview GitHub Pages tidak pernah menunjuk ke localhost.

## Sudah ada

- Preview statis: pemilih karakter, Web Locks antar-tab, chat lokal, kanvas ruangan, sprite dua baris.
- `scripts/setup-pocketbase.sh`: mengunduh PocketBase 0.40.4 (linux/darwin, amd64/arm64), memverifikasi `checksums.txt` resmi, idempoten, ke `tools/` yang gitignored. Versi di-hardcode menjadi `0.40.4` dan **tidak bisa** ditimpa lewat env (tidak ada `POCKETBASE_VERSION`). Setelah arsip terverifikasi diekstrak, SHA-256 executable yang terpasang dicatat di `tools/pocketbase.sha256`; tiap invokasi idempoten memverifikasi hash executable, file versi, versi hardcoded, dan `--version` binary sekaligus. Bila salah satu tidak cocok, cache tidak dipercaya dan binary dipasang ulang dari rilis resmi setelah verifikasi `checksums.txt` + arsip.
- `backend/pb_migrations/1789603200_office_schema.js`: koleksi `office_characters` (tepat enam karakter lewat unique index `cid`), `office_messages` (retensi 200 pesan), `office_limits` (rate limit). API rules di-`null` sehingga Web API bawaan tidak dapat membaca koleksi ini.
- `backend/pb_hooks/office.pb.js` + `backend/pb_hooks/office_lib.js`: rute `/api/office/*` dengan claim lease atomik, token acak 48 karakter (disimpan sebagai hash SHA-256, field hidden, tidak pernah dikembalikan), expiry **tetap 90 detik** (konstanta, `OFFICE_LEASE_TTL_MS` diabaikan), pembaruan lewat heartbeat, reclaim setelah expiry, validasi, rate limit, dan CORS terbatas. Untuk `heartbeat` dan `messages`, urutannya: hitung percobaan rate limit per IP (transaksi terpisah yang langsung di-commit), autentikasi `X-Office-Session`, baru parsing body rute; sesi divalidasi ulang di dalam transaksi tulis untuk menutup celah TOCTOU. Karena itu body rusak tanpa sesi sah selalu `401`, bukan `400`. `release` tidak punya body.
- `backend/tests/test_office_api.py`: 36 tes integrasi Python stdlib yang menjalankan binary PocketBase asli pada data dir/port sementara (tanpa mock), termasuk pembuktian kuota rate limit untuk percobaan 400/401/409/429, retensi deterministik saat timestamp seri, TTL lease tetap 90 detik (`OFFICE_LEASE_TTL_MS=600000` tidak memperpanjang, dibuktikan lewat delta expiry di DB tanpa tidur 90 detik), semantik `min()` pada `OFFICE_TEST_LEASE_TTL_MS`, dan autentikasi-sebelum-parsing body.
- `scripts/test-setup-pocketbase.sh`: verifikasi deterministik dan offline untuk logika kepercayaan setup. Menyajikan arsip rilis palsu lewat stub `curl`, lalu membuktikan executable cache pengganti yang tetap mencetak `0.40.4` ditolak dan diganti, cache terverifikasi dipakai ulang tanpa unduhan, dan file versi yang diubah memicu pemasangan ulang.

## Perintah

```bash
npm run backend:setup       # unduh + verifikasi PocketBase 0.40.4 ke tools/
npm run backend:setup:test  # verifikasi offline logika kepercayaan cache (tanpa jaringan)
npm run backend:serve       # serve 127.0.0.1:8090 (migrasi + hooks)
npm run backend:test        # tes integrasi terhadap binary asli
npm run build:pages         # build statis -> dist-pages
```

## Kontrak

`GET characters` -> `{characters:[{id,active,x,y,direction,status}]}`; `POST claim {id}` -> `{token}`; `POST release`; `POST heartbeat {x,y,direction,status}`; `GET messages` -> `{messages:[{id,name,text,time,sprite}]}`; `POST messages {text}`. Semua write selain `claim` butuh header `X-Office-Session`. Server menurunkan karakter/nama/sprite dari token, tidak pernah dari body klien.

## Batasan keamanan

- Memilih nama/karakter bukan identitas; API lokal tanpa login. Siapa pun yang bisa menjangkau port bisa mengklaim karakter kosong; gunakan akses jaringan privat bila butuh privasi.
- Token bearer; server hanya menyimpan hash SHA-256 dan tidak mengembalikannya lewat endpoint list.
- Default listen loopback dengan CORS terbatas pada origin dev. Pembatasan CORS hanya berlaku bila server dijalankan lewat wrapper `npm run backend:serve` (menyetel `--origins`); menjalankan binary `tools/pocketbase` langsung tanpa `--origins` akan mengizinkan semua origin. Jangan ekspos langsung tanpa proxy/autentikasi.
- Rate limit fixed-window per IP dan per rute; setiap percobaan dihitung dan dipersistensikan sebelum autentikasi/validasi sehingga respons 400/401/409 maupun 429 berulang tetap memakai kuota. Untuk `heartbeat`/`messages`, autentikasi sesi dilakukan sebelum parsing body agar pemanggil anonim selalu mendapat `401` (bukan `400`), dan sesi divalidasi ulang di dalam transaksi tulis. Ini membatasi, bukan pengganti autentikasi.
- TTL lease produksi tetap 90 detik dan tidak dapat diubah lewat env. Hanya `OFFICE_TEST_LEASE_TTL_MS` (rentang 200..90000) yang boleh memperpendek, dan itu khusus tes integrasi.
- Retensi chat hanya 200 pesan terakhir, diurutkan dengan sekuens monotonik (`seq`) sehingga deterministik walau beberapa pesan tertulis pada milidetik yang sama.

## Berikutnya

1. Realtime subscription + interpolasi gerak (saat ini polling 2 detik).
2. Sprite empat arah lengkap; lembar sprite sesi ini hanya dua baris.
3. Deploy ke VPS + Cloudflare Tunnel, lalu isi `public/config.json` hanya setelah backend benar-benar diuji (jangan arahkan Pages publik ke localhost).
4. Backup SQLite, akses privat, serta QA browser desktop dan 320px.

Build: `npm run build:pages`. Output: `dist-pages`. GitHub Pages workflow men-deploy push ke `main`.
