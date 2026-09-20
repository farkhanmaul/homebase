# Homebase — Nongkrong Kantor

Prototipe kantor virtual pixel-art: satu lantai kantor `1920×960` world px, enam karakter tetap, duduk/berdiri, ambil minuman, pintu interaktif, chat, presence antartab, dan tampilan responsif desktop/mobile. Live di GitHub Pages:

**https://farkhanmaul.github.io/homebase/**

Dokumen ini ringkasan teknis lengkap proyek saat penutupan (rilis `39d5b1b`, 2026-09-20). Untuk handoff operasional VPS/infrastruktur, lihat `docs/REMOTE-HANDOFF.md`; untuk keputusan peta lama, `docs/final-office-map.md`; QC rilis V2, `docs/reviews/room-detail-v2-qc.md`.

## Arsitektur

```text
app/        page.tsx (runtime game, satu file) + office.css + globals.css
lib/        modul murni tanpa DOM: map, navigasi, interaksi, renderer, camera, viewport, session, spawn
backend/    migrasi + hooks PocketBase (JavaScript hooks)
scripts/    generator map/art/preview (TS via node --experimental-strip-types, Py via Pillow)
tests/      node:test murni (tanpa DOM): 262 test frontend + 58 test backend
public/     aset runtime: avatar/team-six.png, room/bilik-geng-zone.png, config.json
```

- **Frontend:** React 19 + vinext untuk dev/build; artifact produksi dibangun lewat Vite (`vite.pages.config.ts`) dengan base `/homebase/`.
- **Authoritative map:** `lib/office-map.json` (generated, byte-locked oleh test) dari generator `scripts/build-approved-office-map.ts`. Semua geometry — zones, walls, openings, seats, hotspots, furniture — hidup di sini; UI dan collision tidak pernah hardcode koordinat.
- **Backend:** PocketBase 0.40.4 (executable pinned + checksum, gitignored di `tools/`) dengan migrasi koleksi `office_*` dan hooks Go-ish JS di `backend/pb_hooks`. Endpoint publik dibungkus proxy; URL di `public/config.json`.
- **Tidak ada dependency baru untuk game logic:** semua renderer/collision/interaksi tulisan tangan di atas canvas 2D.

## Runtime game (app/page.tsx)

Satu loop `requestAnimationFrame`:

1. Input keyboard (WASD/panah, E interaksi, R reset) + D-pad mobile.
2. Gerak melalui `moveWithCollision` — swept, `MAX_MOVEMENT_SUBSTEP = 1`, axis-separated sliding; footprint aktor `18×12` feet-anchored.
3. Interaksi lewat `applyInteraction` (murni, deterministic): prioritas kandidat terdekat — kursi sendiri > sumber minuman > hotspot bernama > pintu. Semua via E dan tombol aksi yang sama.
4. Render: blit crop kamera dari world canvas statis (dipaint sekali), overlay interaksi runtime (pintu tertutup, kulkas terbuka), lalu `drawActors`.
5. Presence: polling 2 detik; heartbeat `{x,y,direction,status}`; token sesi bearer, server menyimpan hash SHA-256.

Layering: world statis → overlay interaksi → aktor → nameplate. `prefers-reduced-motion` menghentikan gait animasi.

## Rilis V2 (current): room-detail

Pemutakhiran besar terakhir, dirilis dari `feat/room-detail-v2` via PR #1:

- **Material:** satu bahasa karpet granular untuk area kerja/pantry/server/meeting/koridor; pengecualian hanya lobby, resepsionis, toilet, wastafel.
- **Detail per ruang (Batch 1–4):** Meeting 1, HRGA, Komisaris, PM, IT, Direktur Finance; Desk Collection + Tele/CS/CA (bank konstruksi, divider, ritme kabel, stasiun deterministik); front-of-house (sofa, resepsionis, sirkulasi); pantry, Meeting 2, service core.
- **Koreksi user (Batch A–C):** semua kursi hitam armless termasuk raster Bilik; tiang Bilik putih; satu kloset per toilet menghadap atas menempel dinding bawah; wastafel terbuka dari utara (sink + kaca saja); satu stool pantry; side-chair Desk Collection tidak lagi menimpa meja.
- **Kualitas:** peta locked-by-hash di test; painted ops 10.634/12.000; JS gzip ~108 KiB/115; CSS gzip ~30 KiB/35; artifact Pages ~1,4 MiB/5.

## Menjalankan lokal

```bash
npm install
npm run dev            # dev server (vinext)
npm run test:frontend  # 262 test node:test
npm run lint           # oxlint
npx tsc --noEmit
npm run build:pages    # artifact dist-pages/
npm run backend:setup  # unduh+verifikasi PocketBase 0.40.4 (idempoten)
npm run backend:serve  # serve 127.0.0.1:8090
npm run backend:test   # 58 test integrasi
```

Test murni Node — tidak perlu browser untuk suite. `npm run preview:map` meregenerasi preview SVG/PNG `docs/previews/`.

## Deployment (GitHub Pages)

- Workflow: `.github/workflows/pages.yml` — `verify` (lint, tsc, test frontend+backend, build Pages) lalu `deploy`.
- Trigger: push ke `main`. Artifact di-upload via `actions/upload-pages-artifact`.
- **Base path wajib `/homebase/`** — asset URL produksi relative; test `tests/vite-pages-assets.test.ts` mengunci bahwa CSS/JS tidak mereferensikan aset di luar allowlist runtime: `avatar/team-six.png`, `room/bilik-geng-zone.png`, `config.json`, `favicon.svg`, `robots.txt`, `.nojekyll`.
- Rollback: redeploy commit sebelumnya. Baseline sebelum V2: `e630d262`; rollback kandidat lebih awal: `d25f1f4b`.

## Backend & API

Kontrak `/api/office/` (via proxy): `GET characters`, `POST claim {id}` → `{token}`, `POST release`, `POST heartbeat {x,y,direction,status}`, `GET messages`, `POST messages {text}`. Semua tulisan selain claim wajib header `X-Office-Session`; server menurunkan identitas dari token, bukan body.

- TTL lease 90 detik; 401 menghapus sesi lokal dan subscriber page membersihkan interaksi.
- Rate limit per action via env `OFFICE_*_{LIMIT,WINDOW_MS}`; chat max 200 pesan.
- Server loopback + CORS ketat via wrapper `npm run backend:serve`; Quick Tunnel untuk endpoint publik sementara — named tunnel belum dipasang.
- Setup pinned + SHA-256 terverifikasi setiap invoke; `backend:setup:test` membuktikan cache palsu ditolak.

## Konvensi & keputusan penting

- **Map adalah sumber kebenaran.** Jangan edit `lib/office-map.json` manual — ubah generator, jalankan, commit hasilnya; test hash akan gagal bila drift.
- Raster Bilik diregenerasi via `scripts/generate-bilik-zone-art.py`; bottom 6 row transparan agar dinding/pintu terlihat.
- Furniture decorative (kursi/sofa) bukan collider; hard furniture solid. Depth skirt maksimal 2 px selatan, tidak mengubah collision.
- Game ops melarang text/debug di production canvas; review ops terpisah untuk QA.
- Kursi selalu hitam armless di seluruh kantor (kontrak test).
- Tidak ada sprite LPC eksternal; aset karakter `team-six.png` custom. CSS tidak boleh mereferensikan aset legacy di luar allowlist (regression test aktif).

## Masalah yang diketahui & langkah lanjut (backlog)

- **Belum realtime:** polling 2 detik; realtime butuh SSE/websocket di proxy.
- **Endpoint publik via Quick Tunnel** — URL berubah saat restart; named tunnel + domain permanen belum.
- **Avatar state visual** (duduk/minum/pose berbeda) dan **indikator lokasi aktif** sempat dimulai (`feat/location-avatar-states`) namun di-scope-out saat penutupan; belum ada di produksi. Ide implementasi: resolver murni dari `InteractionState` + overlay canvas deterministik, hindari aset sprite baru di luar allowlist Pages.
- OAuth Google, backup terjadwal, multiplayer>6 — belum dimulai.
