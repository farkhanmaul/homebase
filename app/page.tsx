'use client';

import { useEffect, useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { LogOut, MessageCircle, Send, X } from 'lucide-react';
import { Dialog } from '@base-ui/react/dialog';
import {
  OfficeSession,
  mergeMessages,
  reduceChatPoll,
  type ChatPollState,
  type Occupant,
  type OfficeMessage,
} from '../lib/office-session';
import { officeMap, zoneAt, type Direction } from '../lib/office-map';
import { moveWithCollision } from '../lib/office-navigation';
import type { ViewportBox, ViewportMode } from '../lib/office-viewport';
import { resolveCamera } from '../lib/office-camera';
import { playerAtPoint, screenToWorld } from '../lib/office-interaction';
import {
  INITIAL_INTERACTION_STATE,
  applyInteraction,
  describeInteraction,
  drawInteractionState,
  isBlockedWithDoors,
  standOnMove,
  type InteractionState,
} from '../lib/office-interactions';
import { applyAvailability, resetActorToSeat } from '../lib/office-spawn';
import { actorPresentationScale, assetUrl, canvasBackingSize, createWorldCanvas, drawActors, drawWorldCrop, worldRenderScale } from '../lib/office-renderer';
import { BILIK_ZONE_IMAGE_SRC } from '../lib/office-game-ops';
import './office.css';

type Player = { id: number; name: string; sprite: number; x: number; y: number; direction: Direction; walking: boolean; status: string; online: boolean; sitting: boolean };

// Initial positions and facing come from the manifest seats, not from the page.
const INITIAL: Player[] = officeMap.seats.map(seat => ({
  id: seat.cid,
  name: seat.character,
  sprite: seat.cid - 1,
  x: seat.x,
  y: seat.y,
  direction: seat.direction,
  walking: false,
  status: 'Available',
  online: false,
  sitting: false,
}));
const MOBILE_BREAKPOINT = 860;
const HINT = 'WASD / panah · E interaksi · R reset';

export default function Home() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const players = useRef<Player[]>(INITIAL.map(p => ({ ...p })));
  const session = useRef(new OfficeSession());
  const keys = useRef(new Set<string>());
  const camera = useRef({ x: 0, y: 0 });
  // The current camera crop in world units, mirrored for the pointer mapping so
  // the canvas backing store can be DPR-sized without affecting hit tests.
  const cameraView = useRef({ width: 0, height: 0 });
  const activeId = useRef<number | null>(null);
  const chatInput = useRef<HTMLTextAreaElement>(null);
  const blockedInput = useRef(false);
  const chatPoll = useRef<ChatPollState>({ initialized: false, seq: 0 });
  // One pure interaction state for the local actor: sit/stand, the held drink,
  // open fridges and closed doors. It is committed only by E / the shared action
  // button, so the animation frame reads it but never rebuilds it.
  const interaction = useRef<InteractionState>({ ...INITIAL_INTERACTION_STATE });
  // Mirrors the last contextual action label pushed to React so the frame loop
  // only re-renders when the available action actually changes.
  const actionRef = useRef('Interaksi');
  // The canvas CSS box, kept up to date by a ResizeObserver so the animation
  // frame never has to read layout.
  const canvasBox = useRef<ViewportBox>({ width: 0, height: 0 });
  // Mirrors the last zone pushed to React so the animation frame only re-renders
  // when the player actually crosses into another zone.
  const zoneRef = useRef('');
  const [active, setActive] = useState<number | null>(null);
  const [available, setAvailable] = useState<Occupant[]>([]);
  const [ready, setReady] = useState(false);
  const [remote, setRemote] = useState(false);
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<OfficeMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('Available');
  const [hint, setHint] = useState(HINT);
  const [announcement, setAnnouncement] = useState('');
  const [zone, setZone] = useState('');
  // The UI-visible mirror of the interaction ref: the action button label and the
  // held-drink / open-fridge / closed-door status chips.
  const [interactionState, setInteractionState] = useState<InteractionState>(() => ({ ...INITIAL_INTERACTION_STATE }));
  const [actionLabel, setActionLabel] = useState('Interaksi');
  const me = active ? INITIAL[active - 1] : undefined;
  const selectedName = selected !== null ? INITIAL[selected - 1].name : 'Profil';
  const selectedStatus = selected !== null
    ? (selected === active ? status : available.find(row => row.id === selected)?.status || 'Available')
    : '';

  // One reset path for claim, explicit reset and a cleared server session.
  const resetInteraction = () => {
    interaction.current = { ...INITIAL_INTERACTION_STATE };
    actionRef.current = 'Interaksi';
    setInteractionState(interaction.current);
    setActionLabel('Interaksi');
  };

  useEffect(() => { blockedInput.current = selected !== null || chatOpen; }, [selected, chatOpen]);

  useEffect(() => {
    let disposed = false, busy = false;
    const office = session.current;
    // One recovery path for every dead session: the session notifies on any 401
    // or explicit release, so send()/leave()/heartbeat all reset the same UI
    // state without each call site re-implementing it.
    const unsubscribe = office.onSessionCleared(() => {
      if (disposed) return;
      activeId.current = null;
      setActive(null);
      setSelected(null);
      setChatOpen(false);
      setDraft('');
      resetInteraction();
    });
    async function sync() {
      if (busy) return; busy = true;
      try {
        const rows = await office.availability();
        if (disposed) return;
        setAvailable(rows);
        // Presence always syncs; backend coordinates only move an ACTIVE remote.
        // An inactive row can never overwrite the manifest seat, and the local
        // active player is never overwritten by its own availability echo.
        players.current = applyAvailability(players.current, rows, activeId.current);
        if (office.api && office.id) {
          const p = players.current[office.id - 1];
          await office.heartbeat({ x: p.x, y: p.y, direction: p.direction, status: p.status });
          const incoming = await office.messages(chatPoll.current.seq);
          if (!disposed) {
            const result = reduceChatPoll(chatPoll.current, incoming);
            chatPoll.current = result.state;
            if (incoming.length) setMessages(prev => mergeMessages(prev, incoming));
            if (result.announcement) setAnnouncement(result.announcement);
          }
        }
        if (!disposed) setError('');
      } catch (e) {
        if (disposed) return;
        setError(e instanceof Error ? e.message : 'Koneksi terputus.');
      }
      finally { busy = false; }
    }
    void office.configure().then(() => { if (!disposed) { setRemote(!!office.api); setReady(true); void sync(); } }).catch(() => setError('Konfigurasi kantor tidak dapat dimuat. Muat ulang halaman.'));
    const timer = setInterval(() => { if (!document.hidden) void sync(); }, 2000);
    return () => { disposed = true; unsubscribe(); clearInterval(timer); office.releaseLock?.(); };
  }, []);

  async function enter(id: number) {
    setPending(id); setError('');
    try {
      await session.current.claim(id);
      activeId.current = id;
      resetInteraction();
      // A claim always starts on the assigned seat, no matter what coordinates
      // the backend last reported for this character.
      players.current[id - 1] = resetActorToSeat(players.current[id - 1], officeMap, id);
      players.current[id - 1].online = true;
      setActive(id); setStatus(players.current[id - 1].status);
      if (session.current.api) {
        const p = players.current[id - 1];
        try { await session.current.heartbeat({ x: p.x, y: p.y, direction: p.direction, status: p.status }); }
        // The claim succeeded, so the local session is kept. The 2s sync loop
        // retries the heartbeat; the claim is never replayed.
        catch (e) { setError(e instanceof Error ? e.message : 'Posisi awal belum tersimpan; kantor akan mencoba lagi.'); }
      }
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Gagal masuk.'); }
    finally { setPending(null); }
  }
  async function leave() {
    keys.current.clear();
    const id = activeId.current;
    try { await session.current.release(); if (id) players.current[id - 1].online = false; }
    catch { setError('Belum dapat melepas sesi. Coba lagi; sesi server juga kedaluwarsa otomatis.'); }
  }
  // E/X and the on-screen action button share this one commit: it resolves the
  // single contextual action from the pure module and applies its transition.
  function interact() {
    const id = activeId.current;
    if (!id) return;
    const p = players.current[id - 1];
    const { state, result } = applyInteraction(officeMap, interaction.current, { cid: id, x: p.x, y: p.y });
    interaction.current = state;
    setInteractionState(state);
    p.sitting = state.sitting;
    if (result.seat) { p.x = result.seat.x; p.y = result.seat.y; p.direction = result.seat.direction; }
    if (result.action === 'pulang') { p.status = 'Pulang'; setStatus('Pulang'); }
    setHint(result.hint);
    if (result.announce) setAnnouncement(result.announce);
  }
  // The single reset path shared by the Reset posisi button and the R shortcut:
  // back to the assigned seat, standing and idle, keys cleared. An API-backed
  // session heartbeats the exact reset position immediately so the server seat
  // is authoritative at once; the local reset stands even if that fails because
  // the 2s sync retries it. Only the active player can be reset.
  async function resetPosition() {
    const id = activeId.current;
    if (!id) return;
    keys.current.clear();
    resetInteraction();
    players.current[id - 1] = resetActorToSeat(players.current[id - 1], officeMap, id);
    setHint(`Posisi direset ke kursimu · ${HINT}`);
    setAnnouncement('Posisi direset ke kursimu.');
    if (session.current.api) {
      const p = players.current[id - 1];
      try { await session.current.heartbeat({ x: p.x, y: p.y, direction: p.direction, status: p.status }); }
      // The reset is kept locally and the 2s sync retries the heartbeat; the
      // claim is never replayed.
      catch (e) { setError(e instanceof Error ? e.message : 'Posisi reset belum tersimpan; kantor akan mencoba lagi.'); }
    }
  }
  useEffect(() => {
    const sheet = new Image(); sheet.src = 'avatar/team-six.png';
    // The whole static world is painted once into an offscreen canvas; each frame
    // only blits the camera crop and the avatars.
    let world = createWorldCanvas(officeMap);
    // The Bilik Geng Kami raster underlay is preloaded once. Until it arrives (or
    // if it fails — the error path is silent) the vector art underneath shows.
    // Its single load repaints the static world once; no asset is touched per
    // frame and no geometry is rebuilt.
    const zoneArt = new Image();
    zoneArt.onload = () => { world = createWorldCanvas(officeMap, new Map([[BILIK_ZONE_IMAGE_SRC, zoneArt]])); };
    zoneArt.src = assetUrl(BILIK_ZONE_IMAGE_SRC);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduced = motion.matches;
    const onMotion = () => { reduced = motion.matches; };
    motion.addEventListener('change', onMotion);
    // Track the real CSS box so the frame loop never reads layout from the DOM.
    // resolveCamera still runs every frame: it is lightweight math that follows
    // the moving actor and the desktop/mobile mode each time it is called.
    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver((entries) => {
          const entry = entries[0];
          if (!entry) return;
          canvasBox.current = { width: entry.contentRect.width, height: entry.contentRect.height };
        })
      : null;
    const observed = canvas.current;
    if (observer && observed) observer.observe(observed);

    let handle = 0, last = performance.now();
    const clear = () => keys.current.clear();
    function onDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(e.target.tagName))) return;
      if (!activeId.current) return;
      if (e.key === 'Escape') { setSelected(null); setChatOpen(false); clear(); return; }
      if (blockedInput.current) return;
      if (e.key === 'Enter') { e.preventDefault(); if (innerWidth < MOBILE_BREAKPOINT) setChatOpen(true); else chatInput.current?.focus(); clear(); return; }
      const key = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) { e.preventDefault(); keys.current.add(key); }
      if (!e.repeat && key === 'r') { e.preventDefault(); void resetPosition(); return; }
      if (!e.repeat && ['e', 'x'].includes(key)) interact();
    }
    const onUp = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    function frame(now: number) {
      const dt = Math.min((now - last) / 1000, .04); last = now;
      const target = canvas.current, ctx = target?.getContext('2d');
      if (!target || !ctx || document.hidden) { handle = requestAnimationFrame(frame); return; }
      const activeIdNow = activeId.current;
      const p = activeIdNow ? players.current[activeIdNow - 1] : null;
      if (activeIdNow && p) {
        let dx = 0, dy = 0;
        if (!blockedInput.current) {
          if (keys.current.has('a') || keys.current.has('arrowleft')) dx--;
          if (keys.current.has('d') || keys.current.has('arrowright')) dx++;
          if (keys.current.has('w') || keys.current.has('arrowup')) dy--;
          if (keys.current.has('s') || keys.current.has('arrowdown')) dy++;
        }
        p.walking = !!(dx || dy);
        if (p.walking) {
          // Movement stands the actor: clear the interaction seat anchor too, so
          // a later E sits fresh instead of thinking it is still seated.
          if (interaction.current.sitting) {
            const stood = standOnMove(interaction.current);
            interaction.current = stood;
            setInteractionState(stood);
          }
          p.sitting = false; p.direction = dx ? dx < 0 ? 'left' : 'right' : dy < 0 ? 'up' : 'down';
          const speed = 125 * dt / (Math.hypot(dx, dy) || 1);
          const moved = moveWithCollision(
            { x: p.x, y: p.y },
            { x: dx * speed, y: dy * speed },
            (x, y) => isBlockedWithDoors(officeMap, x, y, interaction.current),
          );
          p.x = moved.x; p.y = moved.y;
        }
        // Keep the shared action button naming the current contextual action.
        // Only re-render when it actually changes, so the frame stays allocation-free.
        const described = describeInteraction(officeMap, interaction.current, { cid: activeIdNow, x: p.x, y: p.y });
        if (described.label !== actionRef.current) { actionRef.current = described.label; setActionLabel(described.label); }
      }
      // The backing size matches the container aspect, so CSS 100% x 100% fills
      // the box without object-fit letterboxing. It is DPR-aware: the bitmap is
      // sized to the CSS box in device pixels, so the browser never upscales it
      // (the source of the previously soft actors/world). One world->device
      // transform lets every op keep drawing in world units.
      const mode: ViewportMode = innerWidth < MOBILE_BREAKPOINT ? 'mobile' : 'desktop';
      const { camera: cam, view: camView } = resolveCamera(officeMap, canvasBox.current, mode, p ? { x: p.x, y: p.y } : { x: 0, y: 0 });
      const backing = canvasBackingSize(camView, canvasBox.current, window.devicePixelRatio || 1);
      if (target.width !== backing.w || target.height !== backing.h) { target.width = backing.w; target.height = backing.h; }
      cameraView.current = { width: camView.w, height: camView.h };
      const renderScale = worldRenderScale(camView, backing);
      ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
      camera.current = cam;
      // Hold the avatars/labels/ring at a constant CSS size: the camera crop
      // maps camView.w world px onto the box's CSS width, so this factor
      // converts the authored CSS sizes into world px for the current zoom.
<<<<<<< HEAD
      const actorScale = actorPresentationScale(camView.w, canvasBox.current.width);
      drawWorldCrop(ctx, world, cam, camView);
=======
      const actorScale = actorPresentationScale(cameraView.w, canvasBox.current.width);
      drawWorldCrop(ctx, world, cam, cameraView);
      drawInteractionState(ctx, officeMap, interaction.current, cam);
>>>>>>> eb06170 ([verified] feat: add office interactions and muted light controls)
      drawActors(ctx, players.current, { camera: cam, activeId: activeId.current, sheet, now, reducedMotion: reduced, scale: actorScale });
      // Only touch React state when the zone actually changes.
      const zoneName = p ? zoneAt(officeMap, p.x, p.y)?.name ?? '' : '';
      if (zoneRef.current !== zoneName) { zoneRef.current = zoneName; setZone(zoneName); }
      handle = requestAnimationFrame(frame);
    }
    addEventListener('keydown', onDown); addEventListener('keyup', onUp); addEventListener('blur', clear); document.addEventListener('visibilitychange', clear); handle = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(handle); observer?.disconnect(); motion.removeEventListener('change', onMotion); removeEventListener('keydown', onDown); removeEventListener('keyup', onUp); removeEventListener('blur', clear); document.removeEventListener('visibilitychange', clear); };
  }, []);

  async function send(e: SyntheticEvent) {
    e.preventDefault(); const text = draft.trim(); if (!text || text.length > 500 || !activeId.current) return;
    const p = players.current[activeId.current - 1];
    try {
      if (session.current.api) {
        await session.current.sendMessage(text);
        const incoming = await session.current.messages(chatPoll.current.seq);
        if (incoming.length) { setMessages(prev => mergeMessages(prev, incoming)); chatPoll.current = reduceChatPoll(chatPoll.current, incoming).state; }
      }
      else setMessages(rows => [...rows, { id: Date.now(), seq: rows.length + 1, name: p.name, sprite: p.sprite, text, time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) }].slice(-200));
      setDraft('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Pesan gagal dikirim.'); }
  }
  const chat = <><header><small>SATU RUANG, SATU GENG</small><h2>Obrolan kantor</h2></header><div className="office-messages" aria-label="Riwayat obrolan">{!messages.length && <p className="empty-chat">Belum ada obrolan.<br />Mulai dengan menyapa geng 👋</p>}{messages.map(m => <article key={m.id}><b>{m.name}<time>{m.time}</time></b><p>{m.text}</p></article>)}</div><form onSubmit={send}><textarea ref={chatInput} aria-label="Pesan ke geng" disabled={!active} maxLength={500} value={draft} placeholder="Tulis pesan ke geng…" onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} /><button disabled={!active || !draft.trim()} aria-label="Kirim pesan"><Send size={20}/></button></form></>;
  // Visible interaction state: the held drink, any fridge left open and the
  // number of doors the actor closed. Empty when nothing is held/altered.
  const statusChips: string[] = [];
  if (interactionState.holdingDrink) statusChips.push('Membawa minum');
  if (interactionState.openFridgeIds.length) statusChips.push('Kulkas terbuka');
  if (interactionState.closedDoorIds.length) statusChips.push(`${interactionState.closedDoorIds.length} pintu tertutup`);
  const presenceCount = available.filter(p => p.active).length || (active ? 1 : 0);
  return <main className="office-app">
    <output className="sr-only" aria-live="polite">{announcement}</output>
    <output className="sr-only" aria-live="polite">{zone ? `Zona aktif: ${zone}` : ''}</output>
    <header className="office-header"><span className="office-logo">NK</span><div><strong>Nongkrong Kantor</strong><small>Bilik Geng Kami / Blugreen · Lt. 6</small></div><span className="office-presence" aria-label={`${presenceCount} di kantor`}><span aria-hidden="true">● {presenceCount}<span className="office-presence-label"> di kantor</span></span></span>{active && <button onClick={() => void leave()}><LogOut size={16}/><span>Keluar</span></button>}</header>
    <div className="office-layout"><section className="office-world"><div className="office-caption"><span>{zone || 'Ruang utama'}</span><small>{remote ? 'Kantor bersama' : 'Preview lokal · sesi antartab'}</small></div>{statusChips.length > 0 && <ul className="office-state" aria-label="Status interaksi">{statusChips.map(chip => <li key={chip}>{chip}</li>)}</ul>}<div className="office-canvas-wrap"><canvas ref={canvas} aria-label="Peta kantor, kontrol WASD atau tombol arah" onClick={e => {
      const c = e.currentTarget, rect = c.getBoundingClientRect();
      const point = screenToWorld({ x: e.clientX, y: e.clientY }, { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, cameraView.current, camera.current);
      const found = playerAtPoint(players.current, point); if (found !== null) { keys.current.clear(); setSelected(found); }
    }}/></div>
    <ul className="office-roster" aria-label="Daftar penghuni kantor">{INITIAL.map(p => {
      const row = available.find(entry => entry.id === p.id);
      return <li key={p.id}><button type="button" onClick={() => setSelected(p.id)}>{p.name} · {row?.status || 'Available'} · {row?.active ? 'Online' : 'Offline'}</button></li>;
    })}</ul>
    <footer className="office-controls"><div><small>KARAKTERMU</small><strong>{me?.name || 'Pilih karakter untuk masuk'}</strong></div><span>{hint}</span><button disabled={!active} onClick={() => { keys.current.clear(); setSelected(active); }}>Status</button><button disabled={!active} onClick={interact} aria-label={`Aksi: ${actionLabel}`}>{actionLabel} <kbd>E</kbd></button><button className="open-mobile-chat" aria-label="Buka obrolan kantor" onClick={() => setChatOpen(true)}><MessageCircle size={18}/></button></footer><fieldset className="office-dpad"><legend className="sr-only">Kontrol gerak</legend><div className="office-dpad-row"><button aria-label="Gerak atas" onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); if (active) keys.current.add('w'); }} onPointerUp={() => keys.current.delete('w')} onPointerCancel={() => keys.current.delete('w')}>↑</button></div><div className="office-dpad-row"><button aria-label="Gerak kiri" onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); if (active) keys.current.add('a'); }} onPointerUp={() => keys.current.delete('a')} onPointerCancel={() => keys.current.delete('a')}>←</button><button aria-label="Gerak bawah" onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); if (active) keys.current.add('s'); }} onPointerUp={() => keys.current.delete('s')} onPointerCancel={() => keys.current.delete('s')}>↓</button><button aria-label="Gerak kanan" onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); if (active) keys.current.add('d'); }} onPointerUp={() => keys.current.delete('d')} onPointerCancel={() => keys.current.delete('d')}>→</button></div></fieldset></section><aside className="office-chat">{chat}</aside></div>
    {error && <div className="office-error" role="alert">{error}</div>}
    <Dialog.Root open={!active} disablePointerDismissal><Dialog.Portal><Dialog.Backdrop className="entry-backdrop"/><Dialog.Popup className="entry-popup"><small className="entry-eyebrow">BLUGREEN / LANTAI 6</small><Dialog.Title className="entry-title">Selamat datang di bilik.</Dialog.Title><Dialog.Description className="entry-description">Siapa yang datang hari ini? Pilih karaktermu dan langsung bergabung.</Dialog.Description><div className="character-grid">{INITIAL.map(p => {
      const busy = available.some(row => row.id === p.id && row.active);
      return <button disabled={!ready || busy || pending !== null} key={p.id} onClick={() => void enter(p.id)}><span className="entry-character" style={{ backgroundImage: "url('avatar/team-six.png')", backgroundPosition: `${p.sprite * 20}% 0%` }}/><strong>{p.name}</strong><small className={busy ? 'taken' : ''}>{pending === p.id ? 'Masuk…' : busy ? 'Sedang di kantor' : 'Tersedia'}</small></button>;
    })}</div><p className="entry-note">{remote ? 'Satu karakter untuk satu sesi. Karakter dilepas setelah keluar atau sesi berakhir.' : 'Preview: ketersediaan terkoordinasi antartab browser ini. Sesi bersama antarperangkat menunggu server kantor.'}</p></Dialog.Popup></Dialog.Portal></Dialog.Root>
    <Dialog.Root open={selected !== null} onOpenChange={open => { if (!open) setSelected(null); }}><Dialog.Portal><Dialog.Backdrop className="entry-backdrop"/><Dialog.Popup className="profile-popup"><Dialog.Close className="close-panel" aria-label="Tutup"><X/></Dialog.Close><Dialog.Title>{selectedName}</Dialog.Title><Dialog.Description>{selectedStatus}</Dialog.Description>{selected === active && <label>Statusmu<input maxLength={80} value={status} onChange={e => setStatus(e.target.value)}/><button onClick={() => { if (activeId.current) players.current[activeId.current - 1].status = status.trim() || 'Available'; setSelected(null); }}>Simpan status</button></label>}{selected === active && <button type="button" className="reset-position" onClick={() => { void resetPosition(); setSelected(null); }}>Reset posisi</button>}</Dialog.Popup></Dialog.Portal></Dialog.Root>
    <Dialog.Root open={chatOpen} onOpenChange={setChatOpen}><Dialog.Portal><Dialog.Backdrop className="entry-backdrop"/><Dialog.Popup className="chat-popup"><Dialog.Title className="sr-only">Chat kantor</Dialog.Title><Dialog.Close className="close-panel" aria-label="Tutup"><X/></Dialog.Close>{chat}</Dialog.Popup></Dialog.Portal></Dialog.Root>
  </main>;
}
