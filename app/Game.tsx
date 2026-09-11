"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Kind = 0 | 1 | 2 | 3 | 4 | 5;
type Special = "row" | "column" | "nova" | null;
type Cell = { id: number; kind: Kind; special: Special };
type Pos = { r: number; c: number };
type Fx = { id: number; x: number; y: number; type: "burst" | "shock" | "spark"; label?: string };
type Tool = "hammer" | "charge" | null;
const ROWS = 9, COLS = 8;
const NAMES = ["塔塔·闪电跑者", "塔塔·FPV 飞手", "塔塔·电池机甲", "塔塔·冠军车手", "塔塔·晶体战甲", "塔塔·黄金超载"];
const CLASSES = ["runner", "pilot", "battery", "racer", "crystal", "overdrive"];
const GOALS = [{kind:0 as Kind,total:12,label:"跑者"},{kind:1 as Kind,total:10,label:"飞手"},{kind:2 as Kind,total:10,label:"机甲"}];
let nextId = 1;
const makeCell = (kind = Math.floor(Math.random() * 6) as Kind): Cell => ({ id: nextId++, kind, special: null });
const copyBoard = (board: Cell[][]) => board.map(row => row.map(cell => ({ ...cell })));
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function findGroups(board: Cell[][]) {
  const groups: Pos[][] = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS;) {
    let end = c + 1; while (end < COLS && board[r][end].kind === board[r][c].kind) end++;
    if (end - c >= 3) groups.push(Array.from({ length: end - c }, (_, i) => ({ r, c: c + i }))); c = end;
  }
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS;) {
    let end = r + 1; while (end < ROWS && board[end][c].kind === board[r][c].kind) end++;
    if (end - r >= 3) groups.push(Array.from({ length: end - r }, (_, i) => ({ r: r + i, c }))); r = end;
  }
  return groups;
}

function hasMove(board: Cell[][]) {
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) for (const [dr, dc] of [[0, 1], [1, 0]]) {
    const rr = r + dr, cc = c + dc; if (rr >= ROWS || cc >= COLS) continue;
    const trial = copyBoard(board); [trial[r][c], trial[rr][cc]] = [trial[rr][cc], trial[r][c]];
    if (findGroups(trial).length) return true;
  }
  return false;
}

function createBoard() {
  let board: Cell[][];
  do {
    board = Array.from({ length: ROWS }, (_, r) => Array.from({ length: COLS }, (_, c) => {
      let tile = makeCell();
      while ((c >= 2 && board?.[r]?.[c - 1]?.kind === tile.kind && board[r][c - 2].kind === tile.kind) || (r >= 2 && board?.[r - 1]?.[c]?.kind === tile.kind && board[r - 2][c].kind === tile.kind)) tile = makeCell();
      return tile;
    }));
  } while (!hasMove(board));
  return board;
}

function useSound() {
  const context = useRef<AudioContext | null>(null), loop = useRef<number | null>(null);
  const get = () => context.current ??= new AudioContext();
  const hit = (strength = 1) => { const ctx = get(), osc = ctx.createOscillator(), gain = ctx.createGain(); osc.type = strength > 2 ? "sawtooth" : "square"; osc.frequency.setValueAtTime(280 + strength * 90, ctx.currentTime); osc.frequency.exponentialRampToValueAtTime(75, ctx.currentTime + .13); gain.gain.setValueAtTime(.025 + strength * .012, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .14); osc.connect(gain).connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + .15); };
  const stop = () => { if (loop.current) window.clearInterval(loop.current); loop.current = null; };
  const rush = (track: number) => { stop(); const ctx = get(), bpms = [148,152,158,162,168,174,180,156,172,186], roots = [48,52,55,58,62,65,69,46,73,41]; let beat = 0; const pulse = () => { const now = ctx.currentTime; [1,1.5,2].forEach((ratio,i) => { const osc=ctx.createOscillator(), gain=ctx.createGain(); osc.type=i?"sawtooth":"square"; osc.frequency.value=roots[track]*ratio*(beat%4===3?2:1); gain.gain.setValueAtTime(i?.012:.035,now+i*.045); gain.gain.exponentialRampToValueAtTime(.001,now+.12+i*.045); osc.connect(gain).connect(ctx.destination); osc.start(now+i*.045); osc.stop(now+.17+i*.045); }); beat++; }; pulse(); loop.current=window.setInterval(pulse,60000/bpms[track]); };
  useEffect(() => stop, []); return { hit, rush, stop };
}

export default function Game() {
  const [ready,setReady]=useState(false), [board,setBoard]=useState<Cell[][]>(()=>createBoard()), [selected,setSelected]=useState<Pos|null>(null), [busy,setBusy]=useState(false);
  const [score,setScore]=useState(0), [best,setBest]=useState(0), [combo,setCombo]=useState(0), [energy,setEnergy]=useState(0), [rushTime,setRushTime]=useState(0), [track,setTrack]=useState(0);
  const [paused,setPaused]=useState(false), [message,setMessage]=useState("交换相邻棋子，完成能源站任务"), [fx,setFx]=useState<Fx[]>([]), [shake,setShake]=useState(0);
  const [moves,setMoves]=useState(30), [progress,setProgress]=useState([0,0,0]), [result,setResult]=useState<"win"|"lose"|null>(null), [tool,setTool]=useState<Tool>(null), [tools,setTools]=useState({hammer:3,charge:2,shuffle:2}), [showGuide,setShowGuide]=useState(true);
  const boardRef=useRef(board), pointer=useRef<{pos:Pos;x:number;y:number}|null>(null), suppressClick=useRef(false), sound=useSound();
  useEffect(()=>{boardRef.current=board},[board]);
  useEffect(()=>{setBest(Number(localStorage.getItem("tattu-wolf-best")||0));setReady(true)},[]);
  useEffect(()=>{if(!rushTime||paused)return;const timer=window.setInterval(()=>setRushTime(time=>Math.max(0,time-1)),1000);return()=>window.clearInterval(timer)},[rushTime>0,paused]);
  useEffect(()=>{if(!rushTime)sound.stop()},[rushTime]);
  const updateScore=(amount:number)=>setScore(old=>{const value=old+amount;setBest(previous=>{const next=Math.max(previous,value);localStorage.setItem("tattu-wolf-best",String(next));return next});return value});
  const effect=(type:Fx["type"],label?:string,x=innerWidth/2,y=innerHeight/2)=>{const id=Date.now()+Math.random();setFx(items=>[...items,{id,x,y,type,label}].slice(-16));setShake(value=>value+1);window.setTimeout(()=>setFx(items=>items.filter(item=>item.id!==id)),720)};

  async function resolve(start:Cell[][],chain=1):Promise<void>{
    const groups=findGroups(start);
    if(!groups.length){if(!hasMove(start)){setMessage("没有可消除组合，能量阵列已自动重排");effect("shock","自动重排");await sleep(280);const fresh=createBoard();boardRef.current=fresh;setBoard(fresh)}setCombo(0);setBusy(false);return}
    const clear=new Map<string,Pos>();groups.flat().forEach(pos=>clear.set(`${pos.r}-${pos.c}`,pos));const largest=Math.max(...groups.map(group=>group.length)),next=copyBoard(start),specialGroup=groups.find(group=>group.length===largest)!;
    if(largest>=4){const anchor=specialGroup[Math.floor(specialGroup.length/2)];next[anchor.r][anchor.c].special=largest>=5?"nova":specialGroup[0].r===specialGroup[1].r?"row":"column";clear.delete(`${anchor.r}-${anchor.c}`)}
    for(const pos of [...clear.values()]){const special=next[pos.r][pos.c].special;if(special==="row")for(let c=0;c<COLS;c++)clear.set(`${pos.r}-${c}`,{r:pos.r,c});if(special==="column")for(let r=0;r<ROWS;r++)clear.set(`${r}-${pos.c}`,{r,c:pos.c});if(special==="nova")for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++)if(next[r][c].kind===next[pos.r][pos.c].kind)clear.set(`${r}-${c}`,{r,c})}
    const counts=[0,0,0];for(const pos of clear.values()){const gi=GOALS.findIndex(goal=>goal.kind===next[pos.r][pos.c].kind);if(gi>=0)counts[gi]++}setProgress(old=>{const value=old.map((n,i)=>Math.min(GOALS[i].total,n+counts[i]));if(value.every((n,i)=>n>=GOALS[i].total))setResult(previous=>previous??"win");return value});
    const points=clear.size*12*chain;updateScore(points);setEnergy(old=>Math.min(100,old+clear.size*3+chain*4));setCombo(chain);setMessage(chain>1?`连击 ×${chain} · 能量持续超载`:largest>=5?"能量核心已生成":largest===4?"电弧棋子已生成":`消除 ${clear.size} 枚棋子`);effect(largest>=5?"shock":largest===4?"spark":"burst",chain>1?`COMBO ×${chain}`:`+${points}`);sound.hit(Math.min(4,chain+(largest>=4?1:0)));if(navigator.vibrate)navigator.vibrate(largest>=4?[45,25,75]:25);await sleep(190);
    const cleared=new Set(clear.keys()),fallen=Array.from({length:ROWS},()=>Array<Cell>(COLS));for(let c=0;c<COLS;c++){const keep:Cell[]=[];for(let r=ROWS-1;r>=0;r--)if(!cleared.has(`${r}-${c}`))keep.push(next[r][c]);for(let r=ROWS-1;r>=0;r--)fallen[r][c]=keep[ROWS-1-r]??makeCell()}
    boardRef.current=fallen;setBoard(fallen);await sleep(220);await resolve(fallen,chain+1);
  }

  async function activate(from:Pos,to:Pos,clientX?:number,clientY?:number){
    if(busy||paused||result)return;
    if(rushTime){const next=copyBoard(boardRef.current);next[to.r][to.c]=makeCell();boardRef.current=next;setBoard(next);const points=100+Math.floor(Math.random()*201);updateScore(points);effect("shock",`暴击 +${points}`,clientX,clientY);sound.hit(4);if(navigator.vibrate)navigator.vibrate([35,20,60]);return}
    if(Math.abs(from.r-to.r)+Math.abs(from.c-to.c)!==1){setSelected(to);return}
    setBusy(true);setSelected(null);const next=copyBoard(boardRef.current);[next[from.r][from.c],next[to.r][to.c]]=[next[to.r][to.c],next[from.r][from.c]];boardRef.current=next;setBoard(next);await sleep(150);
    if(!findGroups(next).length){[next[from.r][from.c],next[to.r][to.c]]=[next[to.r][to.c],next[from.r][from.c]];boardRef.current=next;setBoard(copyBoard(next));setMessage("这个交换不能形成消除");effect("spark","能量回弹");sound.hit(1);setBusy(false);return}setMoves(old=>{const value=Math.max(0,old-1);if(value===0)window.setTimeout(()=>setResult(previous=>previous??"lose"),900);return value});await resolve(next)
  }

  const clickTile=(pos:Pos,event:React.MouseEvent)=>{if(suppressClick.current){suppressClick.current=false;return}if(busy||paused||result)return;if(tool){const next=copyBoard(boardRef.current);if(tool==="hammer"){next[pos.r][pos.c]=makeCell();setTools(old=>({...old,hammer:old.hammer-1}));updateScore(80);effect("burst","重锤破坏",event.clientX,event.clientY)}else{next[pos.r][pos.c].special="nova";setTools(old=>({...old,charge:old.charge-1}));effect("shock","能量核心",event.clientX,event.clientY)}boardRef.current=next;setBoard(next);setTool(null);sound.hit(4);if(navigator.vibrate)navigator.vibrate([45,20,70]);return}if(rushTime){void activate(pos,pos,event.clientX,event.clientY);return}if(!selected){setSelected(pos);setMessage("已选中，点击相邻棋子完成交换");sound.hit(1);return}if(selected.r===pos.r&&selected.c===pos.c){setSelected(null);return}void activate(selected,pos,event.clientX,event.clientY)};
  const startRush=()=>{if(energy<100||rushTime)return;const nextTrack=Math.floor(Math.random()*10);setTrack(nextTrack);setEnergy(0);setRushTime(15);setMessage("15 秒黄狼超载：疯狂点击任意棋子");effect("shock","OVERDRIVE");sound.rush(nextTrack);if(navigator.vibrate)navigator.vibrate([100,50,100,50,180])};
  const shuffle=()=>{if(!tools.shuffle||busy||result)return;const fresh=createBoard();boardRef.current=fresh;setBoard(fresh);setTools(old=>({...old,shuffle:old.shuffle-1}));setSelected(null);setMessage("塔塔已重排能量阵列");effect("shock","全盘重排");sound.hit(3)};
  const restart=()=>{const fresh=createBoard();boardRef.current=fresh;setBoard(fresh);setScore(0);setCombo(0);setEnergy(0);setRushTime(0);setBusy(false);setPaused(false);setSelected(null);setMoves(30);setProgress([0,0,0]);setResult(null);setTool(null);setTools({hammer:3,charge:2,shuffle:2});setMessage("新能量阵列已启动")};
  const tiles=useMemo(()=>board.flat(),[board]);
  if(!ready)return <main className="game boot"><img src="./tattu-logo.png" alt="TATTU"/><b>黄狼极速无限消</b><span>能量阵列启动中</span></main>;
  return <main className={`game ${shake%2?"shake-a":"shake-b"} ${rushTime?"is-rush":""}`}><img className="arena" src="./tattu-cartoon-arena-v1.png" alt=""/><div className="vignette"/><div className="speed-lines"/><div className="arena-bolts"><i/><i/><i/></div><div className="ambient-sparks">{Array.from({length:14},(_,n)=><i key={n} style={{"--n":n} as React.CSSProperties}/>)}</div>
    <section className="hud"><header><img src="./tattu-logo.png" alt="TATTU"/><div><small>能源站 · 第 1 关</small><strong>{score.toLocaleString()}</strong><em>最高 {best.toLocaleString()}</em></div><b>{moves}<small>剩余步数</small></b></header><div className="status"><strong>塔塔能源突围</strong><span>{message}</span></div>
      <div className="missions">{GOALS.map((goal,i)=><div key={goal.kind} className={CLASSES[goal.kind]}><i/><span><b>{Math.max(0,goal.total-progress[i])}</b><small>{goal.label}</small></span></div>)}<em className={combo>1?"hot":""}>×{combo}<small>COMBO</small></em></div>
      <div className="energy"><button onClick={startRush} disabled={energy<100||!!rushTime}><b>{rushTime?`${rushTime}s`:`${energy}%`}</b><span>{rushTime?"暴击全消":"黄狼超载"}</span></button><div><i style={{width:`${rushTime?100:energy}%`}}/></div><small>{rushTime?`劲爆轨道 ${track+1}/10 · 点击越快得分越高`:"连续消除积满能量，开启 15 秒狂暴点击"}</small></div>
      <div className="board-frame"><div className="board" role="grid" aria-label="8列9行三消棋盘">{tiles.map((tile,index)=>{const pos={r:Math.floor(index/COLS),c:index%COLS};return <button key={tile.id} role="gridcell" aria-label={`${NAMES[tile.kind]}${tile.special?"特殊棋子":""}`} className={`tile ${CLASSES[tile.kind]} ${tile.special??""} ${selected?.r===pos.r&&selected.c===pos.c?"selected":""}`} onPointerDown={e=>{pointer.current={pos,x:e.clientX,y:e.clientY}}} onPointerUp={e=>{const start=pointer.current;pointer.current=null;if(!start)return;const dx=e.clientX-start.x,dy=e.clientY-start.y;if(Math.max(Math.abs(dx),Math.abs(dy))<18)return;const to=Math.abs(dx)>Math.abs(dy)?{r:start.pos.r,c:start.pos.c+(dx>0?1:-1)}:{r:start.pos.r+(dy>0?1:-1),c:start.pos.c};if(to.r>=0&&to.r<ROWS&&to.c>=0&&to.c<COLS){suppressClick.current=true;e.preventDefault();void activate(start.pos,to,e.clientX,e.clientY)}}} onClick={e=>clickTile(pos,e)}><i/><span>{tile.special==="row"?"↔":tile.special==="column"?"↕":tile.special==="nova"?"✦":""}</span></button>})}</div></div>
      <div className="toolbelt"><button className={tool==="hammer"?"active":""} disabled={!tools.hammer} onClick={()=>setTool(tool==="hammer"?null:"hammer")}><i>⚡</i><span>电能锤</span><b>{tools.hammer}</b></button><button className={tool==="charge"?"active":""} disabled={!tools.charge} onClick={()=>setTool(tool==="charge"?null:"charge")}><i>✦</i><span>充能核</span><b>{tools.charge}</b></button><button disabled={!tools.shuffle} onClick={shuffle}><i>⟳</i><span>重排</span><b>{tools.shuffle}</b></button></div>
      <footer><button onClick={()=>setPaused(value=>!value)}>{paused?"继续":"暂停"}</button><span>{tool?"请选择一个塔塔图标": "滑动或点选相邻棋子"}</span><button onClick={restart}>重新开始</button></footer></section>
    {rushTime>0&&<div className="rush-banner"><small>TATTU HIGH VOLTAGE</small><b>OVERDRIVE</b><span>全盘暴击 · 15 秒</span></div>}{fx.map(item=><div key={item.id} className={`fx ${item.type}`} style={{left:item.x,top:item.y}}><i/><b>{item.label}</b>{Array.from({length:10},(_,n)=><span key={n} style={{"--n":n} as React.CSSProperties}/>)}</div>)}
    {showGuide&&<div className="guide" onClick={()=>setShowGuide(false)}><div><img src="./yellow-wolf-runner.png" alt="塔塔"/><small>TATA ENERGY MISSION</small><h2>塔塔能源突围</h2><p>滑动相邻塔塔图标，连成三个即可消除。完成上方三项目标，并积满电力进入 15 秒全盘暴击。</p><button>点击启动</button></div></div>}
    {paused&&<div className="modal"><div><small>ENERGY HOLD</small><h2>游戏已暂停</h2><button onClick={()=>setPaused(false)}>继续挑战</button></div></div>}
    {result&&<div className={`modal result ${result}`}><div><small>{result==="win"?"MISSION COMPLETE":"ENERGY DEPLETED"}</small><h2>{result==="win"?"能源站突破成功":"步数耗尽"}</h2><div className="stars">{[1,2,3].map(n=><i key={n} className={score>=n*900?"on":""}>★</i>)}</div><b>{score.toLocaleString()} 分</b><p>{result==="win"?"塔塔已收集全部能源组件！":"再试一次，优先制造四连与五连特效。"}</p><button onClick={restart}>{result==="win"?"挑战下一轮":"重新挑战"}</button></div></div>}
  </main>;
}
