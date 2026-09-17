'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { LogOut, MessageCircle, Send, X } from 'lucide-react';
import { Dialog } from '@base-ui/react/dialog';
import { OfficeSession, type Occupant } from '../lib/office-session';
import './office.css';

type Direction = 'up' | 'down' | 'left' | 'right';
type Player = { id: number; name: string; sprite: number; x: number; y: number; direction: Direction; walking: boolean; status: string; online: boolean; sitting: boolean };
type Message = { id: number; name: string; text: string; time: string; sprite: number };
const SEATS = [{ x: 250, y: 365 }, { x: 865, y: 258 }, { x: 250, y: 142 }, { x: 600, y: 258 }, { x: 390, y: 365 }, { x: 390, y: 142 }];
const NAMES = ['Farkhan', 'Surya', 'Imam', 'Malla', 'Siska', 'Mona'];
const INITIAL: Player[] = NAMES.map((name, i) => ({ id: i + 1, name, sprite: i, ...SEATS[i], direction: i === 0 || i === 4 ? 'up' : i === 1 || i === 3 ? 'left' : 'down', walking: false, status: 'Available', online: false, sitting: false }));
const BLOCKS = [{ x: 174, y: 156, w: 300, h: 182 }, { x: 474, y: 156, w: 85, h: 182 }, { x: 745, y: 190, w: 82, h: 110 }];
const inWall = (x: number, y: number) => x < 28 || x > 932 || y < 102 || y > 490 || BLOCKS.some(b => x + 9 > b.x && x - 9 < b.x + b.w && y + 4 > b.y && y - 4 < b.y + b.h);

export default function Home() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const players = useRef<Player[]>(INITIAL.map(p => ({ ...p })));
  const session = useRef(new OfficeSession());
  const keys = useRef(new Set<string>());
  const camera = useRef({ x: 0, y: 0 });
  const activeId = useRef<number | null>(null);
  const chatInput = useRef<HTMLTextAreaElement>(null);
  const blockedInput = useRef(false);
  const [active, setActive] = useState<number | null>(null);
  const [available, setAvailable] = useState<Occupant[]>([]);
  const [ready, setReady] = useState(false);
  const [remote, setRemote] = useState(false);
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('Available');
  const [hint, setHint] = useState('WASD / panah · E untuk duduk');
  const me = active ? players.current[active - 1] : undefined;
  blockedInput.current = selected !== null || chatOpen;

  useEffect(() => {
    let disposed = false, busy = false;
    async function sync() {
      if (busy) return; busy = true;
      try {
        const rows = await session.current.availability();
        if (disposed) return;
        setAvailable(rows);
        rows.forEach(row => {
          const p = players.current[row.id - 1]; if (!p) return;
          p.online = row.active;
          if (row.id !== activeId.current && Number.isFinite(row.x) && Number.isFinite(row.y)) { p.x = row.x!; p.y = row.y!; p.status = row.status || 'Available'; p.direction = (row.direction || 'down') as Direction; }
        });
        if (session.current.api && session.current.id) {
          const p = players.current[session.current.id - 1];
          await session.current.request('heartbeat', { x: p.x, y: p.y, direction: p.direction, status: p.status });
          const data = await session.current.request('messages');
          if (!disposed) setMessages(data.messages);
        }
        if (!disposed) setError('');
      } catch (e) { if (!disposed) setError(e instanceof Error ? e.message : 'Koneksi terputus.'); }
      finally { busy = false; }
    }
    void session.current.configure().then(() => { if (!disposed) { setRemote(!!session.current.api); setReady(true); void sync(); } }).catch(() => setError('Konfigurasi kantor tidak dapat dimuat. Muat ulang halaman.'));
    const timer = setInterval(() => { if (!document.hidden) void sync(); }, 2000);
    return () => { disposed = true; clearInterval(timer); session.current.releaseLock?.(); };
  }, []);

  async function enter(id: number) {
    setPending(id); setError('');
    try { await session.current.claim(id); activeId.current = id; players.current[id - 1].online = true; setActive(id); setStatus(players.current[id - 1].status); }
    catch (e) { setError(e instanceof Error ? e.message : 'Gagal masuk.'); }
    finally { setPending(null); }
  }
  async function leave() {
    keys.current.clear();
    try { await session.current.release(); if (activeId.current) players.current[activeId.current - 1].online = false; activeId.current = null; setActive(null); setSelected(null); }
    catch { setError('Belum dapat melepas sesi. Coba lagi; sesi server juga kedaluwarsa otomatis.'); }
  }
  function interact() {
    if (!activeId.current) return;
    const p = players.current[activeId.current - 1], seat = SEATS[p.id - 1];
    if (Math.hypot(p.x - seat.x, p.y - seat.y) < 48) { p.x = seat.x; p.y = seat.y; p.sitting = !p.sitting; setHint(p.sitting ? 'Sedang duduk · bergerak untuk berdiri' : 'Kembali berdiri'); }
    else if (p.y > 450 && p.x > 200 && p.x < 300) { p.status = 'Pulang'; setStatus('Pulang'); setHint('Klik Keluar untuk melepas karakter.'); }
    else setHint('Dekati kursimu lalu tekan E.');
  }
  useEffect(() => {
    const map = new Image(), sheet = new Image(); map.src = 'room/bilik-geng-v4.png'; sheet.src = 'avatar/team-six.png';
    let handle = 0, last = performance.now();
    const clear = () => keys.current.clear();
    function onDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(e.target.tagName))) return;
      if (!activeId.current) return;
      if (e.key === 'Escape') { setSelected(null); setChatOpen(false); clear(); return; }
      if (blockedInput.current) return;
      if (e.key === 'Enter') { e.preventDefault(); if (innerWidth < 860) setChatOpen(true); else chatInput.current?.focus(); clear(); return; }
      const key = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) { e.preventDefault(); keys.current.add(key); }
      if (!e.repeat && ['e', 'x'].includes(key)) interact();
    }
    const onUp = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    function frame(now: number) {
      const dt = Math.min((now - last) / 1000, .04); last = now;
      const target = canvas.current, ctx = target?.getContext('2d');
      if (!target || !ctx || document.hidden) { handle = requestAnimationFrame(frame); return; }
      const p = activeId.current ? players.current[activeId.current - 1] : null;
      if (p) {
        let dx = 0, dy = 0;
        if (!blockedInput.current) {
          if (keys.current.has('a') || keys.current.has('arrowleft')) dx--;
          if (keys.current.has('d') || keys.current.has('arrowright')) dx++;
          if (keys.current.has('w') || keys.current.has('arrowup')) dy--;
          if (keys.current.has('s') || keys.current.has('arrowdown')) dy++;
        }
        p.walking = !!(dx || dy);
        if (p.walking) {
          p.sitting = false; p.direction = dx ? dx < 0 ? 'left' : 'right' : dy < 0 ? 'up' : 'down';
          const speed = 125 * dt / (Math.hypot(dx, dy) || 1);
          if (!inWall(p.x + dx * speed, p.y)) p.x += dx * speed;
          if (!inWall(p.x, p.y + dy * speed)) p.y += dy * speed;
        }
      }
      const width = innerWidth < 860 ? 560 : 960, height = innerWidth < 860 ? 360 : 540;
      if (target.width !== width) { target.width = width; target.height = height; }
      const cam = { x: p ? Math.max(0, Math.min(960 - width, p.x - width / 2)) : 0, y: p ? Math.max(0, Math.min(540 - height, p.y - height / 2)) : 0 }; camera.current = cam;
      ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, width, height);
      if (map.complete && map.naturalWidth) ctx.drawImage(map, cam.x / 960 * map.naturalWidth, cam.y / 540 * map.naturalHeight, width / 960 * map.naturalWidth, height / 540 * map.naturalHeight, 0, 0, width, height);
      if (sheet.complete && sheet.naturalWidth) players.current.filter(person => person.online).sort((a, b) => a.y - b.y).forEach(person => {
        const cw = sheet.naturalWidth / 6, ch = sheet.naturalHeight / 2, f = person.walking && !matchMedia('(prefers-reduced-motion: reduce)').matches ? Math.floor(now / 180) % 2 : 0;
        const w = person.id === 2 ? 40 : 34, h = person.sitting ? 46 : person.id === 1 ? 62 : 56, x = person.x - cam.x, y = person.y - cam.y;
        ctx.save(); if (person.direction === 'left') { ctx.translate(x + w / 2, y - h); ctx.scale(-1, 1); ctx.drawImage(sheet, cw * person.sprite, ch * f, cw, ch, 0, 0, w, h); } else ctx.drawImage(sheet, cw * person.sprite, ch * f, cw, ch, x - w / 2, y - h, w, h); ctx.restore();
        ctx.font = 'bold 11px sans-serif'; const label = person.name + (person.id === activeId.current ? ' · kamu' : ''), tw = ctx.measureText(label).width;
        ctx.fillStyle = '#17283b'; ctx.fillRect(x - tw / 2 - 5, y + 2, tw + 10, 18); ctx.fillStyle = '#fff6df'; ctx.fillText(label, x - tw / 2, y + 15);
        if (person.id === activeId.current) { ctx.strokeStyle = '#f6ca65'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(x, y, 21, 6, 0, 0, Math.PI * 2); ctx.stroke(); }
      });
      handle = requestAnimationFrame(frame);
    }
    addEventListener('keydown', onDown); addEventListener('keyup', onUp); addEventListener('blur', clear); document.addEventListener('visibilitychange', clear); handle = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(handle); removeEventListener('keydown', onDown); removeEventListener('keyup', onUp); removeEventListener('blur', clear); document.removeEventListener('visibilitychange', clear); };
  }, []);

  async function send(e: FormEvent) {
    e.preventDefault(); const text = draft.trim(); if (!text || text.length > 500 || !activeId.current) return;
    const p = players.current[activeId.current - 1];
    try {
      if (session.current.api) { await session.current.request('messages', { text }); setMessages((await session.current.request('messages')).messages); }
      else setMessages(rows => [...rows, { id: Date.now(), name: p.name, sprite: p.sprite, text, time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) }].slice(-200));
      setDraft('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Pesan gagal dikirim.'); }
  }
  const chat = <><header><small>SATU RUANG, SATU GENG</small><h2>Obrolan kantor</h2></header><div className="office-messages">{!messages.length && <p className="empty-chat">Belum ada obrolan.<br />Mulai dengan menyapa geng 👋</p>}{messages.map(m => <article key={m.id}><b>{m.name}<time>{m.time}</time></b><p>{m.text}</p></article>)}</div><form onSubmit={send}><textarea ref={chatInput} aria-label="Pesan ke geng" disabled={!active} maxLength={500} value={draft} placeholder="Tulis pesan ke geng…" onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} /><button disabled={!active || !draft.trim()} aria-label="Kirim pesan"><Send size={20}/></button></form></>;
  return <main className="office-app">
    <header className="office-header"><span className="office-logo">NK</span><div><strong>Nongkrong Kantor</strong><small>Bilik Geng Kami / Blugreen · Lt. 6</small></div><span className="office-presence">● {available.filter(p => p.active).length || (active ? 1 : 0)} di kantor</span>{active && <button onClick={() => void leave()}><LogOut size={16}/><span>Keluar</span></button>}</header>
    <div className="office-layout"><section className="office-world"><div className="office-caption"><span>RUANG UTAMA</span><small>{remote ? 'Kantor bersama' : 'Preview lokal · sesi antartab'}</small></div><div className="office-canvas-wrap"><canvas ref={canvas} aria-label="Peta kantor, kontrol WASD atau tombol arah" onClick={e => {
      const c = e.currentTarget, rect = c.getBoundingClientRect(), scale = Math.min(rect.width / c.width, rect.height / c.height);
      const x = (e.clientX - rect.left - (rect.width - c.width * scale) / 2) / scale + camera.current.x, y = (e.clientY - rect.top - (rect.height - c.height * scale) / 2) / scale + camera.current.y;
      const found = players.current.find(p => p.online && Math.abs(p.x - x) < 25 && y > p.y - 65 && y < p.y + 20); if (found) { keys.current.clear(); setSelected(found.id); }
    }}/></div><footer className="office-controls"><div><small>KARAKTERMU</small><strong>{me?.name || 'Pilih karakter untuk masuk'}</strong></div><span>{hint}</span><button disabled={!active} onClick={() => { keys.current.clear(); setSelected(active); }}>Status</button><button disabled={!active} onClick={interact}>Duduk <kbd>E</kbd></button><button className="open-mobile-chat" onClick={() => setChatOpen(true)}><MessageCircle size={18}/></button></footer><div className="office-dpad">{[['w','↑'],['a','←'],['s','↓'],['d','→']].map(([key,label]) => <button key={key} aria-label={`Gerak ${label}`} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); if (active) keys.current.add(key); }} onPointerUp={() => keys.current.delete(key)} onPointerCancel={() => keys.current.delete(key)}>{label}</button>)}<button onClick={interact}>E</button></div></section><aside className="office-chat">{chat}</aside></div>
    {error && <div className="office-error" role="alert">{error}</div>}
    <Dialog.Root open={!active} disablePointerDismissal><Dialog.Portal><Dialog.Backdrop className="entry-backdrop"/><Dialog.Popup className="entry-popup"><small className="entry-eyebrow">BLUGREEN / LANTAI 6</small><Dialog.Title className="entry-title">Selamat datang di bilik.</Dialog.Title><Dialog.Description className="entry-description">Siapa yang datang hari ini? Pilih karaktermu dan langsung bergabung.</Dialog.Description><div className="character-grid">{INITIAL.map(p => {
      const busy = available.some(row => row.id === p.id && row.active);
      return <button disabled={!ready || busy || pending !== null} key={p.id} onClick={() => void enter(p.id)}><span className="entry-character" style={{ backgroundImage: "url('avatar/team-six.png')", backgroundPosition: `${p.sprite * 20}% 0%` }}/><strong>{p.name}</strong><small className={busy ? 'taken' : ''}>{pending === p.id ? 'Masuk…' : busy ? 'Sedang di kantor' : 'Tersedia'}</small></button>;
    })}</div><p className="entry-note">{remote ? 'Satu karakter untuk satu sesi. Karakter dilepas setelah keluar atau sesi berakhir.' : 'Preview: ketersediaan terkoordinasi antartab browser ini. Sesi bersama antarperangkat menunggu server kantor.'}</p></Dialog.Popup></Dialog.Portal></Dialog.Root>
    <Dialog.Root open={selected !== null} onOpenChange={open => { if (!open) setSelected(null); }}><Dialog.Portal><Dialog.Backdrop className="entry-backdrop"/><Dialog.Popup className="profile-popup"><Dialog.Close className="close-panel" aria-label="Tutup"><X/></Dialog.Close><Dialog.Title>{selected ? players.current[selected - 1].name : 'Profil'}</Dialog.Title><Dialog.Description>{selected ? players.current[selected - 1].status : ''}</Dialog.Description>{selected === active && <label>Statusmu<input maxLength={80} value={status} onChange={e => setStatus(e.target.value)}/><button onClick={() => { if (activeId.current) players.current[activeId.current - 1].status = status.trim() || 'Available'; setSelected(null); }}>Simpan status</button></label>}</Dialog.Popup></Dialog.Portal></Dialog.Root>
    <Dialog.Root open={chatOpen} onOpenChange={setChatOpen}><Dialog.Portal><Dialog.Backdrop className="entry-backdrop"/><Dialog.Popup className="chat-popup"><Dialog.Title className="sr-only">Chat kantor</Dialog.Title><Dialog.Close className="close-panel" aria-label="Tutup"><X/></Dialog.Close>{chat}</Dialog.Popup></Dialog.Portal></Dialog.Root>
  </main>;
}
