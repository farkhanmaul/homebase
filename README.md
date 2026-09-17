# Nongkrong Kantor

Prototipe interaktif ruang virtual pixel-art untuk geng kantor kecil. Fokus versi ini: ruangan, delapan avatar, status, perpindahan spot, chat lokal, editor avatar, dan tampilan responsif.

## Menjalankan lokal

```bash
npm install
npm run dev
```

Build produksi: `npm run build`.

State lokal di `app/page.tsx` sengaja sederhana agar mudah diganti dengan PocketBase (`users`, `messages`, dan `allowed_members`). Google OAuth, realtime, persistence, access rules, heartbeat presence, backup, serta Cloudflare Tunnel adalah fase backend/deployment berikutnya.

Background kantor dibuat khusus dengan OpenAI ImageGen. Aset karakter LPC belum disertakan; catat lisensi dan atribusi setiap layer sebelum menambahnya.
