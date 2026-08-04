"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Kind = 0 | 1 | 2 | 3 | 4 | 5;
type Special = "line" | "drone" | null;
type Cell = { id: number; kind: Kind; special: Special; debris?: boolean };
type Pos = { r: number; c: number };

const ROWS = 9, COLS = 8;
const PETS = [
  { face: "🐺", name: "黄狼", cls: "wolf" }, { face: "🐯", name: "电池虎", cls: "tiger" },
  { face: "🐥", name: "桨叶鸭", cls: "duck" }, { face: "🦊", name: "能量狐", cls: "fox" },
  { face: "🐝", name: "赛旗蜂", cls: "bee" }, { face: "🐷", name: "无人机豚", cls: "pig" },
] as const;
let uid = 1;
const cell = (kind = Math.floor(Math.random() * 6) as Kind): Cell => ({ id: uid++, kind, special: null });
const clone = (b: Cell[][]) => b.map(row => row.map(x => ({ ...x })));

function matches(b: Cell[][]) {
  const groups: Pos[][] = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS;) {
    if (b[r][c].debris) { c++; continue; }
    let e = c + 1; while (e < COLS && !b[r][e].debris && b[r][e].kind === b[r][c].kind) e++;
    if (e - c >= 3) groups.push(Array.from({ length: e - c }, (_, i) => ({ r, c: c + i })));
    c = e;
  }
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS;) {
    if (b[r][c].debris) { r++; continue; }
    let e = r + 1; while (e < ROWS && !b[e][c].debris && b[e][c].kind === b[r][c].kind) e++;
    if (e - r >= 3) groups.push(Array.from({ length: e - r }, (_, i) => ({ r: r + i, c })));
    r = e;
  }
  return groups;
}
function playable(b: Cell[][]) {
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) for (const [dr, dc] of [[1,0],[0,1]]) {
    const rr=r+dr, cc=c+dc; if(rr>=ROWS||cc>=COLS||b[r][c].debris||b[rr][cc].debris) continue;
    const t=clone(b); [t[r][c],t[rr][cc]]=[t[rr][cc],t[r][c]]; if(matches(t).length) return true;
  } return false;
}
function freshBoard() {
  let b: Cell[][];
  do {
    b = Array.from({length:ROWS}, (_,r)=>Array.from({length:COLS}, (_,c)=>{
      let x=cell(); while((c>1&&b?.[r]?.[c-1]?.kind===x.kind&&b[r][c-2].kind===x.kind)||(r>1&&b?.[r-1]?.[c]?.kind===x.kind&&b[r-2][c].kind===x.kind)) x=cell(); return x;
    }));
  } while(!playable(b)); return b;
}

function useAudio() {
  const ctx = useRef<AudioContext|null>(null); const timer = useRef<number|null>(null);
  const ensure=()=>ctx.current ??= new AudioContext();
  const blip=(power=1)=>{ const a=ensure(), o=a.createOscillator(), g=a.createGain(); o.type="square"; o.frequency.setValueAtTime(260+power*90,a.currentTime); o.frequency.exponentialRampToValueAtTime(80,a.currentTime+.11); g.gain.setValueAtTime(.06,a.currentTime); g.gain.exponentialRampToValueAtTime(.001,a.currentTime+.12); o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime+.12); };
  const startRush=(track:number)=>{ const a=ensure(); stopRush(); const bpms=[150,156,162,168,174,180,145,158,172,185], scales=[[55,82],[58,87],[62,93],[65,98],[69,104],[73,110],[49,73],[52,78],[46,69],[41,62]]; let n=0; const beat=()=>{ const t=a.currentTime, [bass,lead]=scales[track]; [0,.08,.16].forEach((d,i)=>{const o=a.createOscillator(),g=a.createGain();o.type=i?"sawtooth":"square";o.frequency.value=(i?lead:bass)*(n%4===3?1.5:1);g.gain.setValueAtTime(i?.018:.05,t+d);g.gain.exponentialRampToValueAtTime(.001,t+d+.1);o.connect(g).connect(a.destination);o.start(t+d);o.stop(t+d+.11)});n++;}; beat(); timer.current=window.setInterval(beat,60000/bpms[track]); };
  const stopRush=()=>{if(timer.current){clearInterval(timer.current);timer.current=null;}};
  useEffect(()=>()=>stopRush(),[]); return {blip,startRush,stopRush};
}

export default function Game(){
  const [board,setBoard]=useState<Cell[][]>(()=>freshBoard()); const [selected,setSelected]=useState<Pos|null>(null);
  const [score,setScore]=useState(0); const [best,setBest]=useState(0); const [combo,setCombo]=useState(0); const [maxCombo,setMaxCombo]=useState(0);
  const [energy,setEnergy]=useState(0); const [rush,setRush]=useState(0); const [track,setTrack]=useState(0); const [paused,setPaused]=useState(false); const [over,setOver]=useState(false);
  const [flash,setFlash]=useState(0); const [message,setMessage]=useState("交换相邻动物，点燃能量链"); const [crit,setCrit]=useState<{id:number,x:number,y:number,text:string}[]>([]);
  const busy=useRef(false), audio=useAudio();
  useEffect(()=>{setBest(Number(localStorage.getItem("tattu-wolf-best")||0));},[]);
  useEffect(()=>{if(rush<=0)return; const t=setInterval(()=>setRush(v=>v-1),1000); return()=>clearInterval(t)},[rush>0]);
  useEffect(()=>{if(rush===0) audio.stopRush();},[rush]);
  const addScore=(n:number)=>setScore(s=>{const v=s+n; setBest(b=>{const nb=Math.max(b,v);localStorage.setItem("tattu-wolf-best",String(nb));return nb});return v});
  const burst=useCallback((label:string, strong=false)=>{setMessage(label);setFlash(f=>f+1); if(strong&&navigator.vibrate) navigator.vibrate([45,25,80]); audio.blip(strong?3:1);},[]);

  async function settle(start:Cell[][], chain=0){
    let b=clone(start), groups=matches(b); if(!groups.length){setBoard(b);busy.current=false;if(!playable(b)){setOver(true);setMessage("电量耗尽 · 极速挑战结束");}return;}
    const gone=new Map<string,Pos>(); groups.flat().forEach(p=>gone.set(`${p.r}-${p.c}`,p)); const biggest=Math.max(...groups.map(g=>g.length));
    const multiplier=biggest>=5?2:biggest===4?1.5:1, cm=chain>=3?1.8:chain===2?1.4:chain===1?1.2:1; addScore(Math.round(gone.size*10*multiplier*cm));
    setCombo(chain+1);setMaxCombo(m=>Math.max(m,chain+1));setEnergy(e=>Math.min(100,e+gone.size*2+chain*5)); burst(chain?`⚡ ${chain+1} 连锁 · 电压攀升`:`能量释放 +${gone.size*10}`,biggest>=4);
    if(biggest>=4){const anchor=groups.find(g=>g.length===biggest)![Math.floor(biggest/2)]; const keep=b[anchor.r][anchor.c];keep.special=biggest>=5?"drone":"line";gone.delete(`${anchor.r}-${anchor.c}`);}
    gone.forEach(({r,c})=>{b[r][c]=null as unknown as Cell}); setBoard(clone(b)); await new Promise(x=>setTimeout(x,220));
    for(let c=0;c<COLS;c++){const vals=[] as Cell[];for(let r=ROWS-1;r>=0;r--)if(b[r][c])vals.push(b[r][c]);for(let r=ROWS-1;r>=0;r--)b[r][c]=vals[ROWS-1-r]||cell();}
    if(score>10000&&Math.random()<.12){const r=Math.floor(Math.random()*ROWS),c=Math.floor(Math.random()*COLS);b[r][c]={...cell(),debris:true};}
    setBoard(clone(b));await new Promise(x=>setTimeout(x,240));return settle(b,chain+1);
  }
  const triggerRush=()=>{if(energy<100||rush)return;const t=Math.floor(Math.random()*10);setTrack(t);setEnergy(0);setRush(15);setMessage(`⚠ OVERDRIVE 轨道 ${String(t+1).padStart(2,"0")} · 全盘点击消除`);audio.startRush(t);if(navigator.vibrate)navigator.vibrate([100,40,100,40,180]);};
  const clickCell=async(r:number,c:number,e:React.MouseEvent)=>{
    if(paused||over||busy.current)return;
    if(rush>0){const n=100+Math.floor(Math.random()*201),t=clone(board);t[r][c]=cell();addScore(n);setEnergy(v=>Math.min(100,v+2));setBoard(t);setCrit(q=>[...q,{id:Date.now()+Math.random(),x:e.clientX,y:e.clientY,text:`暴击 +${n}`}].slice(-8));setTimeout(()=>setCrit(q=>q.slice(1)),620);burst("暴击连发 · 点击全消",true);return;}
    if(board[r][c].debris)return;
    if(board[r][c].special){busy.current=true;const t=clone(board),special=t[r][c].special,targets:Pos[]=[];if(special==="line")for(let i=0;i<ROWS;i++)targets.push({r:i,c});else for(let rr=Math.max(0,r-1);rr<=Math.min(ROWS-1,r+1);rr++)for(let cc=Math.max(0,c-1);cc<=Math.min(COLS-1,c+1);cc++)targets.push({r:rr,c:cc});targets.forEach(p=>t[p.r][p.c]=cell());addScore(targets.length*25);setEnergy(v=>Math.min(100,v+28));setBoard(t);burst(special==="line"?"横纵电池爆破":"FPV 无人机范围轰炸",true);busy.current=false;return;}
    if(!selected){setSelected({r,c});return;} const near=Math.abs(selected.r-r)+Math.abs(selected.c-c)===1;if(!near){setSelected({r,c});return;}
    busy.current=true;const t=clone(board),a=selected;[t[a.r][a.c],t[r][c]]=[t[r][c],t[a.r][a.c]];setBoard(t);setSelected(null);await new Promise(x=>setTimeout(x,140));
    if(!matches(t).length){[t[a.r][a.c],t[r][c]]=[t[r][c],t[a.r][a.c]];setBoard(t);burst("未接通 · 能量回弹");busy.current=false;return;}await settle(t,0);
  };
  const restart=()=>{setBoard(freshBoard());setScore(0);setCombo(0);setMaxCombo(0);setEnergy(0);setRush(0);setOver(false);setPaused(false);setMessage("新能量阵列已接通");};
  const cells=useMemo(()=>board.flat(),[board]);
  return <main className={`game ${flash%2?"flash-a":"flash-b"} ${rush?"rush":""}`}>
    <div className="world"><i/><i/><i/><div className="vanish"/></div><div className="scanlines"/><div className="speedline s1"/><div className="speedline s2"/>
    <section className="shell">
      <header><img src="/tattu-logo.png" alt="TATTU"/><div className="score"><small>本局能量值</small><strong>{score.toLocaleString()}</strong><span>BEST {best.toLocaleString()}</span></div><div className="combo"><small>COMBO</small><b>×{combo}</b></div></header>
      <div className="mission"><span>黄狼极速无限消</span><em>{message}</em></div>
      <div className="overdrive"><button onClick={triggerRush} disabled={energy<100||!!rush}><span>{rush?`${rush}s`:`${energy}%`}</span><b>{rush?"点击全消":"过载暴击"}</b></button><div><i style={{width:`${rush?100:energy}%`}}/></div><small>{rush?`原创劲爆轨道 ${track+1}/10 · 暴击震动已开启`:"连续消除积满能量，开启 15 秒高强度点击全消"}</small></div>
      <div className="board-wrap"><div className="corner tl"/><div className="corner tr"/><div className="corner bl"/><div className="corner br"/><div className="board" role="grid" aria-label="8列9行消除棋盘">
        {cells.map((x,i)=>{const r=Math.floor(i/COLS),c=i%COLS,p=PETS[x.kind];return <button key={x.id} role="gridcell" aria-label={x.debris?"电池残骸":`${p.name}${x.special?"特殊道具":""}`} onClick={e=>clickCell(r,c,e)} className={`tile ${p.cls} ${selected?.r===r&&selected.c===c?"selected":""} ${x.special||""} ${x.debris?"debris":""}`}><span className="tile-glass"/><b>{x.debris?"▰":p.face}</b><small>{x.debris?"残骸":x.special==="line"?"⚡ CROSS":x.special==="drone"?"⌁ FPV":p.name}</small>{x.kind===0&&!x.debris&&<i>T</i>}</button>})}
      </div></div>
      <footer><button onClick={()=>setPaused(v=>!v)}>{paused?"▶ 继续":"Ⅱ 暂停"}</button><div><b>能量阵列稳定</b><span>8×9 · 无尽冲分 · 死局即结算</span></div><button onClick={()=>setMessage(`本机最高 ${best.toLocaleString()} · 黄狼极速飞手`)}>排行榜</button></footer>
    </section>
    {rush>0&&<div className="rush-title"><small>TATTU HYPER VOLTAGE</small><b>OVERDRIVE</b><span>点击所有方块 · 暴击全消</span></div>}
    {crit.map(x=><div className="crit" key={x.id} style={{left:x.x,top:x.y}}>{x.text}</div>)}
    {paused&&<div className="modal"><div><small>ENERGY HOLD</small><h2>系统已暂停</h2><p>能量阵列已冻结</p><button onClick={()=>setPaused(false)}>继续挑战</button></div></div>}
    {over&&<div className="modal"><div><small>POWER DEPLETED</small><h2>电量耗尽</h2><p>极速挑战结束</p><dl><div><dt>本局得分</dt><dd>{score.toLocaleString()}</dd></div><div><dt>历史最高</dt><dd>{best.toLocaleString()}</dd></div><div><dt>最高连击</dt><dd>×{maxCombo}</dd></div></dl><button onClick={restart}>再来一局</button><button className="ghost" onClick={()=>setMessage("分数已记录至本地排行榜")}>提交排行榜</button></div></div>}
  </main>
}
