'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Download, Edit3, Eye, EyeOff, Gamepad2, RotateCcw, Save, Settings2, Upload, X } from 'lucide-react';

type Activity = 'work' | 'noodle' | 'coffee' | 'chat' | 'wave' | 'sleep' | 'leave' | 'wfh';
type Direction = 'front' | 'back' | 'left' | 'right';
type Member = { id:number; name:string; sprite:number; x:number; y:number; visible:boolean; activity:Activity; direction:Direction; reaction?:string };
type SceneState = { members:Member[]; activeId:number };

const HOME: Member[] = [
  {id:1,name:'Farkhan',sprite:0,x:26,y:63,visible:true,activity:'noodle',direction:'back'},
  {id:2,name:'Surya',sprite:1,x:86,y:42,visible:true,activity:'noodle',direction:'left'},
  {id:3,name:'Imam',sprite:2,x:26,y:24,visible:true,activity:'noodle',direction:'front'},
  {id:4,name:'Malla',sprite:3,x:62,y:42,visible:true,activity:'noodle',direction:'left'},
  {id:5,name:'Siska',sprite:4,x:40,y:63,visible:true,activity:'noodle',direction:'back'},
  {id:6,name:'Mona',sprite:5,x:40,y:24,visible:true,activity:'noodle',direction:'front'},
];
const SEATS = [{x:26,y:63},{x:86,y:42},{x:26,y:24},{x:62,y:42},{x:40,y:63},{x:40,y:24}];
const BLOCKS = [{x1:18,y1:29,x2:49,y2:58},{x1:49,y1:32,x2:58,y2:54},{x1:75,y1:34,x2:83,y2:55}];
const ACTIVITY: Record<Activity,{label:string;icon:string}> = {
  work:{label:'Fokus kerja',icon:'🎯'}, noodle:{label:'Makan mie',icon:'🍜'}, coffee:{label:'Ngopi',icon:'☕'}, chat:{label:'Ngobrol',icon:'💬'},
  wave:{label:'Dadah',icon:'👋'}, sleep:{label:'Tidur',icon:'💤'}, leave:{label:'Pulang',icon:'🚪'}, wfh:{label:'WFH',icon:'🏠'},
};
const STEP=2.2, STORE='nongkrong-kantor-v2';

export default function Home(){
  const [members,setMembers]=useState(HOME); const [activeId,setActiveId]=useState(1); const [selectedId,setSelectedId]=useState<number|null>(null);
  const [editMode,setEditMode]=useState(false); const [manageOpen,setManageOpen]=useState(false); const [doorOpen,setDoorOpen]=useState(false); const [hydrated,setHydrated]=useState(false);
  const roomRef=useRef<HTMLDivElement>(null); const fileRef=useRef<HTMLInputElement>(null);
  const active=useMemo(()=>members.find(m=>m.id===activeId)??members[0],[members,activeId]); const visibleCount=members.filter(m=>m.visible).length;

  useEffect(()=>{try{const raw=localStorage.getItem(STORE);if(raw){const saved=JSON.parse(raw) as SceneState;setMembers(saved.members);setActiveId(saved.activeId)}}catch{}setHydrated(true)},[]);
  useEffect(()=>{if(hydrated)localStorage.setItem(STORE,JSON.stringify({members,activeId}))},[members,activeId,hydrated]);

  const blocked=(x:number,y:number)=>BLOCKS.some(b=>x>b.x1&&x<b.x2&&y>b.y1&&y<b.y2);
  const setActivity=(id:number,activity:Activity)=>{setMembers(items=>items.map(m=>m.id===id?{...m,activity,visible:activity!=='wfh'}:m));setSelectedId(null)};
  const move=useCallback((dx:number,dy:number)=>{setMembers(items=>items.map(m=>{if(m.id!==activeId)return m;const x=Math.min(94,Math.max(6,m.x+dx)),y=Math.min(88,Math.max(14,m.y+dy));if(!editMode&&blocked(x,y))return m;const direction:Direction=Math.abs(dx)>Math.abs(dy)?(dx<0?'left':'right'):(dy<0?'back':'front');if(y>84&&x>18&&x<31)setDoorOpen(true);return{...m,x,y,direction,activity:m.activity==='sleep'?'work':m.activity}}))},[activeId,editMode]);
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement)return;const map:Record<string,[number,number]>={ArrowUp:[0,-STEP],w:[0,-STEP],W:[0,-STEP],ArrowDown:[0,STEP],s:[0,STEP],S:[0,STEP],ArrowLeft:[-STEP,0],a:[-STEP,0],A:[-STEP,0],ArrowRight:[STEP,0],d:[STEP,0],D:[STEP,0]};if(map[e.key]){e.preventDefault();move(...map[e.key])}};addEventListener('keydown',onKey);return()=>removeEventListener('keydown',onKey)},[move]);

  function roomClick(e:React.MouseEvent<HTMLDivElement>){if(!roomRef.current)return;const r=roomRef.current.getBoundingClientRect();let x=((e.clientX-r.left)/r.width)*100,y=((e.clientY-r.top)/r.height)*100;const seat=SEATS.find(s=>Math.hypot(s.x-x,s.y-y)<7);if(seat){x=seat.x;y=seat.y}x=Math.min(94,Math.max(6,x));y=Math.min(88,Math.max(14,y));if(!editMode&&blocked(x,y))return;setMembers(items=>items.map(m=>m.id===activeId?{...m,x,y,activity:'work'}:m));if(y>84&&x>18&&x<31)setDoorOpen(true)}
  function toggle(id:number){setMembers(items=>items.map(m=>m.id===id?{...m,visible:!m.visible}:m))}
  function react(id:number,reaction:string){setMembers(items=>items.map(m=>m.id===id?{...m,reaction}:m));setTimeout(()=>setMembers(items=>items.map(m=>m.id===id?{...m,reaction:undefined}:m)),1800)}
  function preset(name:string){if(name==='lunch')setMembers(HOME);if(name==='focus')setMembers(HOME.map(m=>({...m,activity:'work',visible:true})));if(name==='sleep')setMembers(HOME.map((m,i)=>({...m,activity:i%2?'sleep':'work'})));if(name==='home')setMembers(HOME.map(m=>({...m,activity:'wfh',visible:false})))}
  function download(){const blob=new Blob([JSON.stringify({members,activeId},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='bilik-geng-config.json';a.click();URL.revokeObjectURL(a.href)}
  function upload(e:React.ChangeEvent<HTMLInputElement>){const file=e.target.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{try{const state=JSON.parse(String(reader.result)) as SceneState;setMembers(state.members);setActiveId(state.activeId)}catch{alert('File konfigurasi tidak valid.')}};reader.readAsText(file)}

  return <main className="app-shell">
    <header className="topbar"><div className="brand-mark">NK</div><div className="brand-copy"><strong>NONGKRONG KANTOR</strong><span>static playground • tersimpan otomatis</span></div><div className="presence-pill"><i/> {visibleCount} tampil</div><div className="active-pill"><Gamepad2 size={17}/><span>Mengontrol</span><strong>{active.name}</strong></div><button className="mobile-manage" onClick={()=>setManageOpen(true)}><Settings2/></button></header>
    <div className="workspace static-workspace">
      <section className="room-column"><div className="room-heading"><div><span>BILIK GENG KAMI • LANTAI 6</span><strong>{editMode?'Mode edit posisi aktif':'Workstation geng kantor'}</strong></div><div className="weather-chip">{editMode?'Klik bebas untuk mengatur posisi':'Klik hotspot • WASD • panah'}</div></div>
        <div className={`room-frame controllable ${editMode?'editing':''}`} ref={roomRef} onClick={roomClick}><img className="room-art" src="room/bilik-geng-v3-960.jpg" alt="Bilik kantor enam workstation"/><div className="room-tint"/><span className="zone-label window-zone">JENDELA • LANTAI 6</span>
          {members.filter(m=>m.visible).map(m=><button key={m.id} className={`member controlled-${m.id===activeId} activity-${m.activity} face-${m.direction}`} style={{left:`${m.x}%`,top:`${m.y}%`,'--sprite-x':`${m.sprite*20}%`} as React.CSSProperties} onClick={e=>{e.stopPropagation();setSelectedId(selectedId===m.id?null:m.id)}} onDoubleClick={e=>{e.stopPropagation();setActiveId(m.id)}}>
            {m.reaction&&<span className="reaction">{m.reaction}</span>}<span className="status-bubble">{ACTIVITY[m.activity].icon} {ACTIVITY[m.activity].label}</span><span className="sprite-full team-sprite" style={{backgroundImage:"url('avatar/team-six.png')"}}/><span className="activity-prop">{ACTIVITY[m.activity].icon}</span><span className="name-tag">{m.name}{m.id===activeId&&<small>AKTIF</small>}</span>
            {selectedId===m.id&&<span className="quick-menu" onClick={e=>e.stopPropagation()}>{(Object.keys(ACTIVITY) as Activity[]).map(a=><button key={a} onClick={()=>setActivity(m.id,a)} title={ACTIVITY[a].label}>{ACTIVITY[a].icon}</button>)}<i/>{['❤️','😂','🔥','👍'].map(r=><button key={r} onClick={()=>react(m.id,r)}>{r}</button>)}</span>}
          </button>)}
          <button className="door-hotspot" onClick={e=>{e.stopPropagation();setDoorOpen(true)}}>🚪</button><div className="room-tip">Klik karakter untuk aktivitas • dua kali untuk memilih • klik kursi untuk snap</div>
        </div>
        <div className="movement-bar"><div className="dpad"><button onClick={()=>move(0,-STEP)}><ArrowUp/></button><button onClick={()=>move(-STEP,0)}><ArrowLeft/></button><button onClick={()=>move(0,STEP)}><ArrowDown/></button><button onClick={()=>move(STEP,0)}><ArrowRight/></button></div><div className="movement-copy"><small>KARAKTER AKTIF</small><strong>{active.name}</strong><span>{ACTIVITY[active.activity].icon} {ACTIVITY[active.activity].label}</span></div><button className={`reset-button ${editMode?'selected-tool':''}`} onClick={()=>setEditMode(v=>!v)}><Edit3 size={16}/> Edit</button><button className="reset-button" onClick={()=>{setMembers(HOME);setActiveId(1)}}><RotateCcw size={16}/> Reset</button></div>
      </section>
      <PeoplePanel open={manageOpen} close={()=>setManageOpen(false)} members={members} activeId={activeId} setActiveId={setActiveId} toggle={toggle} preset={preset} download={download} upload={()=>fileRef.current?.click()}/>
    </div>
    <input ref={fileRef} hidden type="file" accept="application/json" onChange={upload}/>
    {doorOpen&&<div className="modal-backdrop"><section className="corridor-modal"><button onClick={()=>setDoorOpen(false)}><X/></button><span>🚪</span><h2>Keluar ke lorong?</h2><p>Transisi pintu sudah siap. Ruang lorong akan menjadi area berikutnya yang kita bangun.</p><div><button onClick={()=>setDoorOpen(false)}>Tetap di bilik</button><button disabled>Masuk lorong • segera</button></div></section></div>}
  </main>;
}

function PeoplePanel({open,close,members,activeId,setActiveId,toggle,preset,download,upload}:{open:boolean;close:()=>void;members:Member[];activeId:number;setActiveId:(id:number)=>void;toggle:(id:number)=>void;preset:(p:string)=>void;download:()=>void;upload:()=>void}){
  return <aside className={`people-panel ${open?'panel-open':''}`}><button className="panel-close" onClick={close}><X/></button><div className="people-head"><span>KONTROL MANUAL</span><strong>Orang di ruangan</strong><p>Pilih karakter, atur visibilitas, atau gunakan preset adegan.</p></div><div className="scene-presets"><button onClick={()=>preset('lunch')}>🍜 Makan</button><button onClick={()=>preset('focus')}>🎯 Fokus</button><button onClick={()=>preset('sleep')}>💤 Lembur</button><button onClick={()=>preset('home')}>🏠 WFH</button></div><div className="people-list">{members.map(m=><article className={`${m.id===activeId?'person-active':''} ${!m.visible?'person-hidden':''}`} key={m.id}><button className="person-select" onClick={()=>{setActiveId(m.id);if(!m.visible)toggle(m.id)}}><span className="mini-sprite team-sprite" style={{'--sprite-x':`${m.sprite*20}%`,backgroundImage:"url('avatar/team-six.png')"} as React.CSSProperties}/><span><strong>{m.name}</strong><small>{ACTIVITY[m.activity].icon} {m.id===activeId?'Sedang dikendalikan':ACTIVITY[m.activity].label}</small></span></button><button className={`visibility-toggle ${m.visible?'on':''}`} role="switch" aria-checked={m.visible} onClick={()=>toggle(m.id)}><i/><span>{m.visible?<Eye size={15}/>:<EyeOff size={15}/>}</span></button></article>)}</div><div className="config-actions"><button onClick={download}><Download/> Export</button><button onClick={upload}><Upload/> Import</button></div><div className="static-note"><strong><Save size={14}/> Tersimpan lokal</strong><p>Posisi, aktivitas, dan visibility otomatis disimpan di browser ini.</p></div></aside>
}
