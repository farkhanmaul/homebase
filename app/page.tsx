'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Eye, EyeOff, Gamepad2, MousePointer2, RotateCcw } from 'lucide-react';

type Member = {
  id: number;
  name: string;
  sprite: number;
  status: string;
  x: number;
  y: number;
  visible: boolean;
};

const initialMembers: Member[] = [
  { id: 1, name: 'Farkhan', sprite: 0, status: 'Lagi makan mie', x: 26, y: 63, visible: true },
  { id: 2, name: 'Surya', sprite: 1, status: 'Lagi makan mie', x: 86, y: 42, visible: true },
  { id: 3, name: 'Imam', sprite: 2, status: 'Lagi makan mie', x: 26, y: 24, visible: true },
  { id: 4, name: 'Malla', sprite: 3, status: 'Lagi makan mie', x: 62, y: 42, visible: true },
  { id: 5, name: 'Siska', sprite: 4, status: 'Lagi makan mie', x: 40, y: 63, visible: true },
  { id: 6, name: 'Mona', sprite: 5, status: 'Lagi makan mie', x: 40, y: 24, visible: true },
];

const STEP = 2.2;

export default function Home() {
  const [members, setMembers] = useState(initialMembers);
  const [activeId, setActiveId] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const roomRef = useRef<HTMLDivElement>(null);
  const active = useMemo(() => members.find((member) => member.id === activeId)!, [members, activeId]);
  const visibleCount = members.filter((member) => member.visible).length;

  const move = useCallback((dx: number, dy: number) => {
    setMembers((items) => items.map((member) => member.id === activeId ? {
      ...member,
      x: Math.min(94, Math.max(6, member.x + dx)),
      y: Math.min(88, Math.max(14, member.y + dy)),
    } : member));
  }, [activeId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const directions: Record<string, [number, number]> = {
        ArrowUp: [0, -STEP], w: [0, -STEP], W: [0, -STEP],
        ArrowDown: [0, STEP], s: [0, STEP], S: [0, STEP],
        ArrowLeft: [-STEP, 0], a: [-STEP, 0], A: [-STEP, 0],
        ArrowRight: [STEP, 0], d: [STEP, 0], D: [STEP, 0],
      };
      const direction = directions[event.key];
      if (!direction) return;
      event.preventDefault();
      move(...direction);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [move]);

  function moveFromClick(event: React.MouseEvent<HTMLDivElement>) {
    if (!roomRef.current) return;
    const bounds = roomRef.current.getBoundingClientRect();
    const x = Math.min(94, Math.max(6, ((event.clientX - bounds.left) / bounds.width) * 100));
    const y = Math.min(88, Math.max(14, ((event.clientY - bounds.top) / bounds.height) * 100));
    setMembers((items) => items.map((member) => member.id === activeId ? { ...member, x, y } : member));
  }

  function toggleMember(id: number) {
    setMembers((items) => items.map((member) => member.id === id ? { ...member, visible: !member.visible } : member));
  }

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand-mark">NK</div>
      <div className="brand-copy"><strong>NONGKRONG KANTOR</strong><span>static playground • tanpa database</span></div>
      <div className="presence-pill"><i /> {visibleCount} tampil</div>
      <div className="active-pill"><Gamepad2 size={17}/><span>Mengontrol</span><strong>{active.name}</strong></div>
    </header>

    <div className="workspace static-workspace">
      <section className="room-column">
        <div className="room-heading">
          <div><span>BILIK GENG KAMI • LANTAI 6</span><strong>Workstation geng kantor</strong></div>
          <div className="weather-chip"><MousePointer2 size={14}/> klik • WASD • tombol arah</div>
        </div>
        <div className="room-frame controllable" ref={roomRef} onClick={moveFromClick}>
          <img className="room-art" src="room/bilik-geng-v3-960.jpg" alt="Bilik kantor lantai enam dengan enam workstation bersekat dan jendela kota"/>
          <div className="room-tint"/><span className="zone-label window-zone">JENDELA • LANTAI 6</span>
          {members.filter((member) => member.visible).map((member) => <button
            className={`member ${member.id === activeId ? 'controlled' : ''} ${member.id === selectedId ? 'active' : ''}`}
            key={member.id}
            style={{ left: `${member.x}%`, top: `${member.y}%`, '--sprite-x': `${member.sprite * 20}%` } as React.CSSProperties}
            onClick={(event) => { event.stopPropagation(); setSelectedId(selectedId === member.id ? null : member.id); }}
            onDoubleClick={(event) => { event.stopPropagation(); setActiveId(member.id); }}
            aria-label={`${member.name}, ${member.status}. Klik dua kali untuk dikendalikan.`}
          ><span className="status-bubble">🍜 {member.status}</span><span className="sprite-full team-sprite" style={{ backgroundImage: "url('avatar/team-six.png')" }}/><span className="name-tag">{member.name}{member.id === activeId && <small>AKTIF</small>}</span></button>)}
          <div className="room-tip">Klik dua kali karakter untuk memilih • klik lantai untuk bergerak</div>
        </div>
        <div className="movement-bar">
          <div className="dpad" aria-label="Kontrol gerak">
            <button onClick={() => move(0, -STEP)} aria-label="Atas"><ArrowUp/></button>
            <button onClick={() => move(-STEP, 0)} aria-label="Kiri"><ArrowLeft/></button>
            <button onClick={() => move(0, STEP)} aria-label="Bawah"><ArrowDown/></button>
            <button onClick={() => move(STEP, 0)} aria-label="Kanan"><ArrowRight/></button>
          </div>
          <div className="movement-copy"><small>KARAKTER AKTIF</small><strong>{active.name}</strong><span>Gunakan WASD, tombol arah, atau klik area lantai.</span></div>
          <button className="reset-button" onClick={() => setMembers(initialMembers)}><RotateCcw size={16}/> Reset posisi</button>
        </div>
      </section>

      <aside className="people-panel">
        <div className="people-head"><span>KONTROL MANUAL</span><strong>Orang di ruangan</strong><p>Pilih satu orang untuk digerakkan. Sembunyikan yang sedang WFH atau tidak aktif.</p></div>
        <div className="people-list">
          {members.map((member) => <article className={`${member.id === activeId ? 'person-active' : ''} ${!member.visible ? 'person-hidden' : ''}`} key={member.id}>
            <button className="person-select" onClick={() => { setActiveId(member.id); if (!member.visible) toggleMember(member.id); }}>
              <span className="mini-sprite team-sprite" style={{ '--sprite-x': `${member.sprite * 20}%`, backgroundImage: "url('avatar/team-six.png')" } as React.CSSProperties}/>
              <span><strong>{member.name}</strong><small>{member.id === activeId ? 'Sedang dikendalikan' : member.status}</small></span>
            </button>
            <button className={`visibility-toggle ${member.visible ? 'on' : ''}`} role="switch" aria-checked={member.visible} aria-label={`${member.visible ? 'Sembunyikan' : 'Tampilkan'} ${member.name}`} onClick={() => toggleMember(member.id)}><i/><span>{member.visible ? <Eye size={15}/> : <EyeOff size={15}/>}</span></button>
          </article>)}
        </div>
        <div className="static-note"><strong>V1 statis</strong><p>Posisi dan switch kembali ke awal saat halaman direfresh. Nanti bisa ditambahkan penyimpanan lokal tanpa database.</p></div>
      </aside>
    </div>
  </main>;
}
