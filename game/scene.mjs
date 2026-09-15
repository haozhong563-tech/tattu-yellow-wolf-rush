import Phaser from 'phaser';
import { createBoard, buildTurn, buildToolTurn, buildRushTurn, legalMoves, COLS } from './model.mjs';
import { GameAudio, TRACKS } from './audio.mjs';
import { writeStoredValue, persistFinalRecords } from './session-storage.mjs';
import { Effects } from './effects.mjs';
import { planRewards, buildRewardTurn } from './rewards.mjs';
import { HeroCinematic, prepareUltimateTextures, REWARD_NAMES } from './cinematic.mjs';
import { WORLD_PHASES, worldPhase, buildWorldDrop } from './world.mjs';
import { prepareWorldTextures, decorateObstacle, obstacleImpact } from './world-visuals.mjs';
import { RUSH_DURATION_MS, SESSION_LIMIT_MS, createSession, remainingMs, scoreFrame, commitFrame, recordMove, recordReward, finalizeSession, serializeCheckpoint, parseCheckpoint, addLeaderboardEntry, validateLeaderboard } from './session.mjs';
import forestURL from '../public/v3/energy-forest.png';

const W=720,H=1220,CELL=76,BX=56,BY=295;
const COLORS=[0xffd34b,0x42ccec,0xff6860,0x98d846,0xb485f4,0xffa348];
const NAMES=['闪电塔塔','飞行塔塔','竞速塔塔','工程塔塔','星际塔塔','超载塔塔'];
const OBSTACLE_NAMES={rock:'三击矿石',crate:'补给箱',battery:'能量电池',prism:'棱镜晶体'};
const SAVE_KEY='tata-endless-v5-save', RANK_KEY='tata-endless-v5-scores';
const clockText=ms=>{const sec=Math.ceil(Math.max(0,ms)/1000);return `${String(Math.floor(sec/3600)).padStart(2,'0')}:${String(Math.floor(sec/60)%60).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;};
const compactScore=n=>n>=1e8?`${(n/1e8).toFixed(2)}亿`:n>=1e5?`${(n/1e4).toFixed(1)}万`:n.toLocaleString();
const xy=index=>({x:BX+(index%8)*CELL+CELL/2,y:BY+Math.floor(index/8)*CELL+CELL/2});
const safeRead=(key,fallback)=>{try{return localStorage.getItem(key)??fallback;}catch{return fallback;}};
const safeWrite=(key,value)=>writeStoredValue(()=>localStorage,key,value);

export class ForestScene extends Phaser.Scene {
  constructor(){super('forest');}
  preload(){
    this.load.image('forest',forestURL);this.load.image('atlas','./v3/tata-atlas.png');this.load.image('blink-atlas','./v3/tata-blink.png');this.load.image('logo','./tattu-logo.png');this.load.image('hero','./yellow-wolf-runner.png');this.load.image('ultimate-atlas','./v3/tata-ultimate-poses.png');
    this.load.on('progress',n=>{const progress=document.querySelector('#loading progress');if(progress)progress.value=n*100;});
    this.load.on('loaderror',file=>console.error('Asset unavailable',file.src));
  }
  create(){
    document.getElementById('loading')?.remove();this.root=document.getElementById('overlay-root');this.a11y=document.getElementById('accessibility');this.a11y.replaceChildren();this.cellButtons=null;
    Object.assign(document.getElementById('app').dataset,{cinematic:'',attack:'',impact:''});
    this.runId=(this.runId??0)+1;this.alive=true;this.state='intro';this.board=createBoard();this.board[12].special='row';this.board[51].special='bomb';this.nodes=new Map();this.ice=new Set();this.iceNodes=new Map();this.progress=[0,0];this.moves=0;this.score=0;this.energy=0;this.rushRemaining=0;this.rushQueue=[];this.selected=null;this.pendingRewards=[];this.rewardStats={hammer:0,drone:0,rift:0};this.turnSource='player';this.turnCinematicShown=false;this.completing=false;this.track=Number(safeRead('tata-last-track','-1'));this.reduced=safeRead('tata-motion',matchMedia('(prefers-reduced-motion: reduce)').matches?'off':'on')==='off';this.audio=new GameAudio();this.audio.setEnabled(safeRead('tata-sound','on')==='on');this.audio.setHaptics(safeRead('tata-haptic','on')==='on');this.fx=new Effects(this,{reduced:this.reduced});this.lastAction=0;this.lastBlink=0;this.hintNodes=[];this.ambientTweens=[];document.documentElement.dataset.motion=this.reduced?'reduced':'full';
    this.board[43]={id:'starter-rock',kind:-1,special:null,obstacle:'rock',hp:3};this.board[35]={id:'starter-crate',kind:-1,special:null,obstacle:'crate',hp:2};
    if(!legalMoves(this.board).length)this.board=buildToolTurn(this.board,0,'shuffle').board;
    this.session=null;this.worldDropsAt=0;this.phase=worldPhase(0);this.lastClockSecond=-1;this.savedRun=parseCheckpoint(safeRead(SAVE_KEY,''),Date.now());
    try{this.leaderboard=validateLeaderboard(JSON.parse(safeRead(RANK_KEY,'[]')))??[];}catch{this.leaderboard=[];}this.best=this.leaderboard[0]?.score??0;
    this.makeTextures();prepareUltimateTextures(this);prepareWorldTextures(this);this.cinematic=new HeroCinematic(this);this.drawEnvironment();this.drawHUD();this.drawBoard();this.drawControls();
    this.board.forEach((cell,index)=>this.makeTile(cell,index));this.syncAccessibility();this.updateHUD();this.showIntro();
    this.clockTicker=setInterval(()=>this.checkClock(),500);
    this.events.once('shutdown',()=>{clearInterval(this.clockTicker);this.alive=false;this.cinematic.destroy();this.fx.destroy();this.audio.destroy();this.previewAudio?.destroy();this.a11y.replaceChildren();this.root.replaceChildren();});
  }
  makeTextures(){
    this.iconURLs=[];
    // Chroma-key is applied at texture upload, preserving the authored silhouette.
    for(const [atlas,prefix] of [['atlas','wolf'],['blink-atlas','blink']])for(let kind=0;kind<6;kind++){
      const key=`${prefix}-${kind}`;if(!this.textures.exists(key)){
        const source=this.textures.get(atlas).getSourceImage();const surface=this.textures.createCanvas(key,256,256);const ctx=surface.context;
        ctx.drawImage(source,(kind%3)*source.width/3,Math.floor(kind/3)*source.height/2,source.width/3,source.height/2,0,0,256,256);
        const pixels=ctx.getImageData(0,0,256,256),data=pixels.data;
        for(let i=0;i<data.length;i+=4){const r=data[i],g=data[i+1],b=data[i+2];if(g>180&&g-r>130&&g-b>130&&r<90&&b<95)data[i+3]=0;}
        ctx.putImageData(pixels,0,0);surface.refresh();
      }
      if(prefix==='wolf')this.iconURLs.push(this.textures.get(key).getSourceImage().toDataURL());
    }
    if(!this.textures.exists('ice-icon')){const g=this.make.graphics({x:0,y:0,add:false});g.fillStyle(0x81d1ed).fillRoundedRect(4,6,56,54,10);g.fillStyle(0xdafaff).fillRoundedRect(8,3,50,50,9);g.lineStyle(3,0xffffff,.9).strokeRoundedRect(8,3,50,50,9);g.lineStyle(2,0x87cde9).lineBetween(19,8,30,28).lineBetween(30,28,23,40).lineBetween(30,28,48,34);g.generateTexture('ice-icon',66,66);g.destroy();}
  }
  text(x,y,value,size=26,color='#536746',extra={}){return this.add.text(x,y,String(value),{fontFamily:'"Microsoft YaHei", "PingFang SC", Arial, sans-serif',fontSize:`${size}px`,fontStyle:'bold',color,...extra}).setOrigin(.5);}
  panel(x,y,width,height,fill=0xfff5d7,stroke=0xf7e7ae,radius=24,depth=10){const g=this.add.graphics().setDepth(depth);g.fillStyle(0x315c4c,.18).fillRoundedRect(x,y+7,width,height,radius);g.fillStyle(fill).fillRoundedRect(x,y,width,height,radius);g.lineStyle(3,stroke).strokeRoundedRect(x,y,width,height,radius);g.lineStyle(2,0xffffff,.65).strokeRoundedRect(x+4,y+3,width-8,height-8,Math.max(4,radius-4));return g;}
  drawEnvironment(){
    this.add.image(360,610,'forest').setDisplaySize(814,1220).setDepth(-10);
    this.worldTint=this.add.rectangle(360,610,720,1220,0xc5e8c2,.05).setDepth(-9);
    for(let i=0;i<18;i++){const mote=this.add.circle(Phaser.Math.Between(10,710),Phaser.Math.Between(60,1170),Phaser.Math.FloatBetween(1.8,3.5),i%3?0xffef9c:0xf8ffff,.55).setDepth(-2);this.ambientTweens.push(this.tweens.add({targets:mote,y:mote.y-90,x:mote.x+Phaser.Math.Between(-30,30),alpha:.1,duration:Phaser.Math.Between(4500,8000),yoyo:true,repeat:-1,delay:i*190,paused:this.reduced}));}
    this.text(360,35,'TATTU  ·  POWER BEYOND LIMITS',18,'#fff9d4',{letterSpacing:3,stroke:'#527c49',strokeThickness:3}).setDepth(10);
    this.text(360,71,'塔塔 · 无尽能源远征',34,'#fffde7',{stroke:'#517b42',strokeThickness:5}).setDepth(10);
  }
  drawHUD(){
    this.panel(42,100,636,126);this.panel(47,94,346,140,0xfdebc0,0xfff7d8,28,12);
    this.text(222,118,'本局积分 · 无尽挑战',21,'#a07b42').setDepth(13);this.scoreText=this.text(222,166,'0',49,'#53873c',{stroke:'#fff7d6',strokeThickness:3}).setDepth(13);
    this.text(528,119,'距离本局封顶',20,'#9e8b54').setDepth(13);this.clockLabel=this.text(528,157,'12:00:00',31,'#648b40').setDepth(13);
    this.movesText=this.text(528,199,'0 次有效操作',18,'#98895e').setDepth(13);
    this.phaseText=this.text(236,245,this.phase.name,21,'#fffce4',{stroke:'#598d68',strokeThickness:3}).setDepth(11);
    this.phaseProgress=this.text(558,245,'事件 1 / 6',18,'#fffce4',{stroke:'#598d68',strokeThickness:3}).setDepth(11);
    this.energyTrack=this.add.graphics().setDepth(12);this.energyText=this.text(364,274,'消除充能 · 满格开启 5 秒觉醒',18,'#47684b',{stroke:'#fff7d8',strokeThickness:3}).setDepth(13);
    this.add.graphics().setDepth(15).fillStyle(0xfff9df,.94).fillRoundedRect(66,987,588,31,15);
    this.statusText=this.text(360,1002,'无限操作 · 特殊消除破矿石 · 挑战最高分',19,'#56784a').setDepth(16);
    this.rushTimeText=this.text(610,273,'',25,'#995614').setDepth(15);
  }
  drawBoard(){
    this.panel(39,286,642,703,0xd9ead9,0xf1f4d4,26,15);
    const g=this.add.graphics().setDepth(16);g.fillStyle(0x7aaca6).fillRoundedRect(BX-4,BY-4,616,692,17);
    for(let row=0;row<9;row++)for(let col=0;col<8;col++){g.fillStyle((row+col)%2?0xa9ccc2:0xb5d3c8,1).fillRoundedRect(BX+col*CELL+1,BY+row*CELL+1,CELL-2,CELL-2,9);g.fillStyle(0xe5efdd,.26).fillRoundedRect(BX+col*CELL+4,BY+row*CELL+3,CELL-8,10,5);}
    this.ice.forEach(index=>{const p=xy(index),ice=this.add.container(p.x,p.y).setDepth(18),tile=this.add.graphics();tile.fillStyle(0xcef7fc,.56).fillRoundedRect(-35,-35,70,70,10);tile.lineStyle(3,0xebffff,.9).strokeRoundedRect(-35,-35,70,70,10);tile.lineStyle(2,0x74c9e7,.75);tile.beginPath().moveTo(-12,-33).lineTo(-4,-12).lineTo(11,0).lineTo(4,26).strokePath();tile.beginPath().moveTo(11,0).lineTo(31,13).strokePath();ice.add(tile);this.iceNodes.set(index,ice);});
    this.selection=this.add.graphics().setDepth(48).setVisible(false);this.selection.lineStyle(4,0xfffbba).strokeRoundedRect(-36,-36,72,72,13);this.selection.lineStyle(2,0xffc839).strokeRoundedRect(-39,-39,78,78,15);
  }
  makeTile(cell,index,fromAbove=false){
    const p=xy(index),node=this.add.container(p.x,fromAbove?BY-70-(8-Math.floor(index/8))*32:p.y).setDepth(30);node.cell={...cell};node.index=index;node.add(this.add.ellipse(0,25,49,15,0x385c5a,.17));node.icon=this.add.image(0,-2,cell.obstacle?'world-rock':`wolf-${cell.kind}`).setDisplaySize(87,87);node.add(node.icon);node.badge=this.add.container(0,0);node.add(node.badge);this.nodes.set(cell.id,node);this.decorate(node,cell);return node;
  }
  decorate(node,cell){
    if(cell.obstacle){decorateObstacle(this,node,cell);return;}
    const signature=`${cell.kind}:${cell.special??''}`;if(node.signature===signature)return;node.signature=signature;node.special=cell.special;node.icon.setTexture(`wolf-${cell.kind}`).setDisplaySize(87,87);node.badge.removeAll(true);if(!cell.special)return;
    const tint=cell.special==='nova'?0xc27cff:cell.special==='bomb'?0xffa34b:0x36e1ff;
    const glow=this.add.graphics();glow.lineStyle(6,0x19495a,.9).strokeRoundedRect(-35,-35,70,70,15);glow.lineStyle(3,tint).strokeRoundedRect(-35,-35,70,70,15);glow.lineStyle(2,0xffffff,.9).strokeCircle(0,0,32);node.badge.add(glow);
    const plate=this.add.circle(22,22,17,tint).setStrokeStyle(3,0xfffce5);node.badge.add(plate);
    node.badge.add(this.text(22,21,{row:'↔',column:'↕',bomb:'✹',nova:'★'}[cell.special],28,'#183e4c'));
  }
  drawControls(){
    // The former inventory toolbar is gone. This is a non-interactive hero stage.
    this.add.ellipse(142,1170,178,23,0x2b6757,.45).setDepth(18);
    this.stageHero=this.add.image(138,1086,'ultimate-0').setDisplaySize(126,210).setDepth(21);
    this.rewardTitle=this.text(440,1062,'消除核心 · 塔塔参战',27,'#fff4b3',{stroke:'#24534b',strokeThickness:4}).setDepth(22);
    this.rewardDetail=this.text(440,1104,'闪电得重锤 · 爆炸召蜂群',21,'#fffce7',{stroke:'#376956',strokeThickness:3}).setDepth(22);
    this.text(440,1140,'彩虹开裂隙 · 满能量自动觉醒',19,'#e5f9dc',{stroke:'#376956',strokeThickness:3}).setDepth(22);
    this.text(360,1200,'TATTU  ·  POWER BEYOND LIMITS',16,'#fff7c4',{stroke:'#386451',strokeThickness:2}).setDepth(22);
    this.drawGlyph(45,67,'pause');this.drawGlyph(675,67,'help');
    this.addHit('暂停与设置',13,35,64,64,()=>this.pauseGame());
    this.addHit('玩法说明',643,35,64,64,()=>this.openGuide());
  }
  drawGlyph(x,y,type){const g=this.add.graphics().setDepth(24);g.lineStyle(5,0x6f984b).fillStyle(0x83b658);if(type==='hammer'){g.fillStyle(0xc79953).fillRoundedRect(x-4,y-3,9,29,3);g.fillStyle(0x87d8ec).fillRoundedRect(x-24,y-20,46,25,7);g.lineStyle(3,0xf4ffff).strokeRoundedRect(x-24,y-20,46,25,7);}else if(type==='drone'){g.lineStyle(4,0x5d927f).lineBetween(x-22,y-12,x+22,y+12).lineBetween(x+22,y-12,x-22,y+12);[-1,1].forEach(a=>[-1,1].forEach(b=>{g.fillStyle(0x82d2d6).fillEllipse(x+a*24,y+b*12,24,11);g.lineStyle(2,0xfaffdf).strokeEllipse(x+a*24,y+b*12,24,11);}));g.fillStyle(0xf9cf57).fillRoundedRect(x-13,y-10,26,20,7);}else if(type==='bolt'){g.fillStyle(0xf1ab24).fillPoints([{x:x+4,y:y-27},{x:x-19,y:y+5},{x:x-2,y:y+5},{x:x-8,y:y+27},{x:x+21,y:y-8},{x:x+5,y:y-8}],true);}else if(type==='pause'){g.fillStyle(0xfdf1bf).fillRoundedRect(x-22,y-22,44,44,16);g.fillStyle(0x729057).fillRoundedRect(x-9,y-10,6,20,2).fillRoundedRect(x+3,y-10,6,20,2);}else if(type==='help'){g.fillStyle(0xfdf1bf).fillCircle(x,y,22);this.text(x,y,'?',28,'#78925e').setDepth(25);}else{this.text(x,y,'⟳',52,'#74a955').setDepth(25);}}
  addHit(label,x,y,w,h,fn){const b=document.createElement('button');b.ariaLabel=label;b.style.cssText=`left:${x/W*100}%;top:${y/H*100}%;width:${w/W*100}%;height:${h/H*100}%`;b.onclick=fn;this.a11y.appendChild(b);return b;}
  syncAccessibility(){
    if(!this.cellButtons){
      this.cellButtons=[];
      for(let i=0;i<72;i++){
        const p=xy(i),b=this.addHit('',p.x-38,p.y-38,76,76,()=>{});
        let press=null,suppressClickUntil=0;
        b.setAttribute('role','gridcell');b.dataset.index=i;
        b.onclick=()=>{if(performance.now()<suppressClickUntil){suppressClickUntil=0;return;}this.audio.unlock();this.select(i);};
        b.onpointerdown=e=>{suppressClickUntil=0;press={index:i,x:e.clientX,y:e.clientY,pointerId:e.pointerId};b.setPointerCapture(e.pointerId);this.audio.unlock();};
        b.onpointerup=e=>{
          const gesture=press;press=null;
          if(!gesture||gesture.pointerId!==e.pointerId)return;
          const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y,scale=document.getElementById('app').clientWidth/W;
          if(Math.max(Math.abs(dx),Math.abs(dy))<=18*scale)return;
          suppressClickUntil=performance.now()+450;e.preventDefault();
          if(this.state==='rush'||(this.state==='resolving'&&this.rushRemaining>0)){this.select(gesture.index);return;}
          const to=Math.abs(dx)>Math.abs(dy)?gesture.index+(dx>0?1:-1):gesture.index+(dy>0?8:-8);
          if(to>=0&&to<72&&(Math.abs(to-gesture.index)===8||Math.floor(to/8)===Math.floor(gesture.index/8)))this.attempt(gesture.index,to);
        };
        b.onpointercancel=()=>{press=null;suppressClickUntil=0;};
        b.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();this.select(i);return;}const shift={ArrowLeft:-1,ArrowRight:1,ArrowUp:-8,ArrowDown:8}[e.key];if(shift){e.preventDefault();const to=i+shift;if(to>=0&&to<72&&(Math.abs(shift)===8||Math.floor(to/8)===Math.floor(i/8)))this.cellButtons[to].focus();}};
        this.cellButtons.push(b);
      }
    }
    this.cellButtons.forEach((b,i)=>{const cell=this.board[i];b.disabled=this.state!=='idle'&&this.state!=='rush'&&!(this.state==='resolving'&&this.rushRemaining>0);if(!cell)return;b.ariaLabel=`第${Math.floor(i/8)+1}行第${i%8+1}列 ${cell.obstacle?`${OBSTACLE_NAMES[cell.obstacle]} 剩余${cell.hp}次`:NAMES[cell.kind]}${cell.special?' '+{row:'横向闪电',column:'纵向闪电',bomb:'爆炸',nova:'彩虹核心'}[cell.special]:''}`;b.dataset.kind=cell.kind;b.dataset.special=cell.special??'';b.dataset.obstacle=cell.obstacle??'';b.dataset.hp=String(cell.hp??0);b.dataset.id=cell.id;});
    const app=document.getElementById('app');Object.assign(app.dataset,{mode:'endless',state:this.state,score:String(this.score),moves:String(this.moves),energy:String(Math.floor(this.energy)),obstacles:String(this.board.filter(c=>c?.obstacle).length),phase:String(this.phase.index),remaining:String(this.session?Math.ceil(remainingMs(this.session,Date.now())/1000):43200),rush:String(Math.max(0,Math.ceil(this.rushRemaining/1000))),rewards:JSON.stringify(this.rewardStats??{}),pendingRewards:String(this.pendingRewards?.length??0)});
  }
  updateHUD(){
    this.movesText.setText(`${compactScore(this.moves)} 次有效操作`);this.scoreText.setText(compactScore(this.score));this.clockLabel.setText(clockText(this.session?remainingMs(this.session,Date.now()):SESSION_LIMIT_MS));this.phaseText.setText(this.phase.name);this.phaseProgress.setText(`事件 ${this.phase.index+1} / 6 · ${12-this.moves%12}步变化`);
    const g=this.energyTrack;g.clear();g.fillStyle(0x638e75,.55).fillRoundedRect(106,264,490,20,10);g.fillStyle(0xeaffd5,.8).fillRoundedRect(109,267,484,14,7);g.fillStyle(this.rushRemaining?0xffaa39:0xf2ce4b).fillRoundedRect(109,267,Math.max(1,484*(this.rushRemaining?this.rushRemaining/RUSH_DURATION_MS:this.energy/100)),14,7);this.energyText.setText(this.rushRemaining?`${TRACKS[this.track].name}  ·  疯狂点击`:(this.energy>=100?'能量已满 · 塔塔即将觉醒':'消除充能 · 满格自动进入 5 秒觉醒'));this.rushTimeText.setText(this.rushRemaining?`${Math.ceil(this.rushRemaining/1000)}s`:'');
    this.syncAccessibility();
  }
  say(text){this.statusText.setText(text);document.getElementById('announcer').textContent=text;}
  showDialog(html){this.a11y.inert=true;this.root.innerHTML=`<div class="screen-shade"><section class="dialog" role="dialog" aria-modal="true">${html}</section></div>`;const first=this.root.querySelector('button');first?.focus();}
  closeDialog(){this.root.replaceChildren();this.a11y.inert=false;}
  showIntro(){this.showDialog(`<img class="hero" src="./yellow-wolf-runner.png" alt="黄色闪电狼塔塔"><div class="eyebrow">TATA · ENDLESS EXPEDITION</div><h1 class="ribbon">一局 · 无限可能</h1><p>不限步数，不设通关<br>六种事件轮换 · 挑战本机最高分</p><div class="endless-summary"><b>5 秒觉醒</b><b>3 击碎石</b><b>12 小时封顶</b></div>${this.savedRun?`<button class="cta" id="continue-save">继续上次 · ${compactScore(this.savedRun.session.score)}分</button>`:''}<button class="${this.savedRun?'secondary':'cta'}" id="start">${this.savedRun?'放弃旧进度 · 开始新局':'开始无尽挑战'}</button><button class="secondary" id="intro-rank">查看本机最高分</button><p class="muted">12 小时从开局起计算，暂停与离线仍计时<br>稳定回合自动保存 · 刷新可继续</p>`);this.root.querySelector('#start').onclick=()=>this.begin(false);this.root.querySelector('#continue-save')?.addEventListener('click',()=>this.begin(true));this.root.querySelector('#intro-rank').onclick=()=>this.showLeaderboard(()=>this.showIntro());}
  async begin(restore=false){
    if(this.state!=='intro')return;const run=this.runId;this.state='starting';await this.audio.unlock();if(!this.alive||run!==this.runId)return;
    if(restore&&this.savedRun){const saved=this.savedRun;this.session=saved.session;this.board=saved.board;this.energy=saved.state.energy;this.rewardStats={...saved.state.rewardStats};this.worldDropsAt=saved.state.worldDropsAt;this.moves=this.session.moves;this.score=this.session.score;this.phase=worldPhase(this.moves);this.nodes.forEach(n=>n.destroy());this.nodes.clear();this.board.forEach((c,i)=>this.makeTile(c,i));}
    else{this.session=createSession(Date.now());this.savedRun=null;safeWrite(SAVE_KEY,'');}
    this.closeDialog();if(remainingMs(this.session,Date.now())<=0){this.endRun('timeout');return;}
    this.nodes.forEach(n=>{n.y-=780;n.alpha=0;this.tweens.add({targets:n,y:xy(n.index).y,alpha:1,duration:this.reduced?0:400,delay:this.reduced?0:Math.floor(n.index/8)*35,ease:'Back.Out'});});await this.delay(this.reduced?1:720);if(!this.alive||run!==this.runId)return;this.state='idle';this.lastAction=this.time.now;this.applyWorldTheme();this.updateHUD();this.saveProgress();this.say('矿石需要三次爆炸命中！补给箱旁消两次可开箱');this.showHint(true);
  }
  saveProgress(){if(!this.session||this.session.status!=='active'||this.state!=='idle'||this.rushRemaining||this.pendingRewards.length||this.board.some(c=>!c))return;try{const saved=safeWrite(SAVE_KEY,serializeCheckpoint(this.session,this.board,{energy:this.energy,rewardStats:this.rewardStats,worldDropsAt:this.worldDropsAt},Date.now()));if(!saved&&!this.checkpointFailed)this.say('当前浏览器无法保存进度，请不要刷新');this.checkpointFailed=!saved;}catch(error){console.warn('Progress checkpoint unavailable',error.message);}}
  checkClock(){if(!this.alive||!this.session||this.session.status!=='active')return;const left=remainingMs(this.session,Date.now());if(left<=0){this.endRun('timeout');return;}const second=Math.ceil(left/1000);if(second!==this.lastClockSecond){this.lastClockSecond=second;this.clockLabel?.setText(clockText(left));document.getElementById('app').dataset.remaining=String(second);}}
  applyWorldTheme(){const color=Number.parseInt(String(this.phase.color).replace('#',''),16);this.worldTint?.setFillStyle(Number.isFinite(color)?color:0xc5e8c2,.16);}
  async advanceWorld(){
    if(!this.session||this.moves<=this.worldDropsAt)return;const run=this.runId,previous=this.phase.index;this.phase=worldPhase(this.moves);this.worldDropsAt=this.moves;
    if(previous!==this.phase.index){this.applyWorldTheme();this.fx.floatText(this.phase.name,360,440,'#fff5b5',42);this.say(this.phase.subtitle);}
    const drop=buildWorldDrop(this.board,this.moves);if(drop.drops.length){this.state='resolving';this.syncAccessibility();this.fx.floatText('神秘空投！',360,323,'#ffe58c',32);await this.moveFrame(drop.board,320,true);if(!this.alive||run!==this.runId)return;this.say(`${drop.drops.map(d=>OBSTACLE_NAMES[d.cell.obstacle]).join('、')} 已落入棋盘`);}
  }
  delay(ms){return new Promise(resolve=>this.time.delayedCall(this.reduced?Math.min(ms,20):ms,resolve));}
  tween(targets,params){return new Promise(resolve=>this.tweens.add({targets,...params,duration:this.reduced?Math.min(params.duration??1,35):params.duration,onComplete:resolve}));}
  clearHint(){this.hintNodes.forEach(n=>{this.tweens.killTweensOf(n);n.destroy();});this.hintNodes=[];}
  showHint(first=false){if(this.state!=='idle'||this.selected!==null)return;this.clearHint();const core=this.board.findIndex(c=>c.special);if(core>=0){const p=xy(core),ring=this.add.graphics().setDepth(50).setPosition(p.x,p.y);ring.lineStyle(5,0xffe849).strokeRoundedRect(-37,-37,74,74,13);this.hintNodes.push(ring);this.tweens.add({targets:ring,alpha:.15,duration:450,repeat:3,yoyo:true,onComplete:()=>ring.destroy()});this.say('连点两次发光核心，或把它连消，引发塔塔支援！');return;}const moves=legalMoves(this.board);const move=moves.find(m=>buildTurn(this.board,m.a,m.b).frames.find(f=>f.type==='clear')?.created?.length)??moves[0];if(!move)return;for(const i of[move.a,move.b]){const p=xy(i),g=this.add.graphics().setDepth(50);g.lineStyle(4,0xfff8ae).strokeRoundedRect(-35,-35,70,70,12);g.setPosition(p.x,p.y);this.hintNodes.push(g);this.tweens.add({targets:g,alpha:.18,duration:700,repeat:2,yoyo:true,onComplete:()=>g.destroy()});}const a=xy(move.a),b=xy(move.b);const arrow=this.text((a.x+b.x)/2,(a.y+b.y)/2,Math.abs(move.a-move.b)===1?'↔':'↕',42,'#fffbd5',{stroke:'#77984b',strokeThickness:4}).setDepth(60);this.hintNodes.push(arrow);this.tweens.add({targets:arrow,scale:1.13,duration:600,yoyo:true,repeat:3,onComplete:()=>arrow.destroy()});if(first)this.say('试试发光的组合，四连可以制造闪电！');}
  select(index){
    if(this.session&&remainingMs(this.session,Date.now())<=0){this.endRun('timeout');return;}
    if(this.state==='rush'||(this.state==='resolving'&&this.rushRemaining>0)){this.queueRush(index);return;}
    if(this.state!=='idle')return;this.clearHint();this.lastAction=this.time.now;this.audio.tap();
    if(this.board[index]?.obstacle){const c=this.board[index];this.say(`${OBSTACLE_NAMES[c.obstacle]}：还需 ${c.hp} 次${c.obstacle==='rock'||c.obstacle==='prism'?'特效命中':'旁消或特效命中'}`);return;}
    if(this.selected===index){this.selected=null;this.selection.setVisible(false);if(this.board[index].special)this.playTurn(buildToolTurn(this.board,index,'hammer'),true);return;}
    if(this.selected===null){this.selected=index;this.selection.setPosition(xy(index).x,xy(index).y).setVisible(true);const n=this.nodes.get(this.board[index].id);this.tweens.add({targets:n.icon,scaleX:87/256*1.08,scaleY:87/256*.96,duration:95,yoyo:true});if(this.board[index].special)this.say('再点一次引爆核心！也可以与相邻棋子交换');return;}
    this.attempt(this.selected,index);
  }
  attempt(a,b){if(this.state!=='idle')return;if(this.session&&remainingMs(this.session,Date.now())<=0){this.endRun('timeout');return;}this.clearHint();this.lastAction=this.time.now;if(this.board[a]?.obstacle||this.board[b]?.obstacle){this.say('道具占格不能交换，用旁消或爆炸来激活');return;}if(Math.abs(Math.floor(a/8)-Math.floor(b/8))+Math.abs(a%8-b%8)!==1){this.selected=b;this.selection.setPosition(xy(b).x,xy(b).y).setVisible(true);return;}this.selected=null;this.selection.setVisible(false);this.playTurn(buildTurn(this.board,a,b),true);}
  async playTurn(turn,consumeMove=false,fast=false,source='player'){
    if(!this.alive||!turn.frames.length)return;const run=this.runId;this.state='resolving';this.turnSource=source;if(source!=='reward')this.turnCinematicShown=false;
    this.selection.setVisible(false);this.syncAccessibility();if(turn.valid&&consumeMove){this.session=recordMove(this.session);this.moves=this.session.moves;}this.updateHUD();
    const earned=source==='reward'?[]:planRewards(turn,{source});
    for(const frame of turn.frames){if(!this.alive||run!==this.runId)return;if(this.session&&remainingMs(this.session,Date.now())<=0){this.endRun('timeout');return;}
      if(frame.type==='swap'||frame.type==='rollback'){this.audio.swap(frame.type==='swap');await this.moveFrame(frame.board,frame.type==='swap'?150:180);if(frame.type==='rollback')this.say('再找找，三个相同的塔塔要连在一起');}
      else if(frame.type==='clear')await this.clearFrame(frame,fast);
      else if(frame.type==='fall')await this.moveFrame(frame.board,fast?85:260,true);
      else if(frame.type==='shuffle'){this.fx.floatText(source==='reward'?'时空重排！':'能量重组！',360,610,'#fffadc',43);await this.moveFrame(frame.board,source==='reward'?210:360,true);}
    }
    if(!this.alive||run!==this.runId)return;this.board=turn.board;this.lastAction=this.time.now;
    if(source==='reward'){this.updateHUD();return;}
    for(const reward of earned){const pending=this.pendingRewards.find(r=>r.type===reward.type);if(pending)pending.count=Math.min(3,pending.count+reward.count);else this.pendingRewards.push({...reward});}
    this.state=this.rushRemaining>0?'rush':'resolving';this.updateHUD();
    if(this.rushRemaining>0){if(this.rushQueue.length){const next=this.rushQueue.shift();this.queueRush(next);}return;}
    await this.completeTurn(run);
  }
  async completeTurn(run=this.runId){
    if(!this.alive||run!==this.runId||this.completing)return;this.completing=true;
    try{
      while(this.pendingRewards.length&&this.alive&&run===this.runId){
        const reward=this.pendingRewards.shift();this.state='resolving';this.syncAccessibility();
        const turn=buildRewardTurn(this.board,reward,this.board.flatMap((c,i)=>c.obstacle?[i]:[]));
        this.session=recordReward(this.session,reward.type,reward.count);this.rewardStats={...this.session.rewardStats};
        this.rewardTitle?.setText('获得 · '+REWARD_NAMES[reward.type]);this.rewardDetail?.setText(reward.count>1?`${reward.count} 枚核心破裂 · 强化支援`:'特殊消除奖励 · 自动锁定目标');
        this.say(REWARD_NAMES[reward.type]+'已获得，塔塔锁定目标！');
        if(!this.turnCinematicShown){await this.playCinematic(reward.type,reward.count);if(!this.alive||run!==this.runId)return;this.turnCinematicShown=true;}
        if(!this.alive||run!==this.runId)return;
        this.audio.rewardCharge?.(reward.type);
        document.getElementById('app').dataset.attack=reward.type;
        await this.fx.rewardAttack(reward.type,turn.meta.targets.map(xy),()=>{document.getElementById('app').dataset.impact=reward.type;this.audio.rewardImpact?.(reward.type,1+(reward.count-1)*.2);});
        if(!this.alive||run!==this.runId)return;
        document.getElementById('app').dataset.attack='';
        await this.playTurn(turn,false,false,'reward');
        if(!this.alive||run!==this.runId)return;document.getElementById('app').dataset.impact='';
      }
      if(!this.alive||run!==this.runId)return;await this.advanceWorld();if(!this.alive||run!==this.runId)return;this.turnSource='player';this.state='idle';this.lastAction=this.time.now;this.updateHUD();
      this.finishCheck();if(!this.alive)return;
      if(this.energy>=100)await this.startRush();
      else{this.rewardTitle?.setText(this.phase.name);this.rewardDetail?.setText(`本机最佳 ${compactScore(Math.max(this.best,this.score))} · 最长${Math.max(1,this.session.highestChain)}连锁`);this.saveProgress();}
    }finally{if(run===this.runId)this.completing=false;}
  }
  async playCinematic(type,count=1){
    const run=this.runId;this.state='cinematic';document.getElementById('app').dataset.cinematic=type;this.syncAccessibility();
    this.rewardTitle?.setText(REWARD_NAMES[type]+' · 出击');this.rewardDetail?.setText(type==='overdrive'?'能量共鸣 · 5 秒点击即爆':'特殊核心引爆 · 塔塔支援');this.audio.cinematic?.(type);this.stageHero?.setTexture('ultimate-1');
    await this.cinematic.play(type,count);
    if(!this.alive||run!==this.runId)return;this.stageHero?.setTexture('ultimate-0');this.state='resolving';document.getElementById('app').dataset.cinematic='';this.syncAccessibility();
  }
  async moveFrame(board,duration,fall=false){
    const run=this.runId;const ids=new Set(board.filter(Boolean).map(c=>c.id));for(const[id,node]of this.nodes)if(!ids.has(id)){node.destroy();this.nodes.delete(id);}const motions=[];
    board.forEach((cell,index)=>{if(!cell)return;let n=this.nodes.get(cell.id),isNew=!n;if(!n)n=this.makeTile(cell,index,fall);this.decorate(n,cell);n.cell={...cell};const p=xy(index);n.index=index;if(n.x!==p.x||n.y!==p.y||isNew){const distance=Math.abs(n.y-p.y);motions.push(this.tween(n,{x:p.x,y:p.y,alpha:1,duration:fall?duration+Math.min(90,distance*.15):duration,ease:fall?'Cubic.In':'Sine.InOut'}).then(()=>{if(!this.alive||!n.active)return;if(fall&&!this.reduced)this.tweens.add({targets:n.icon,scaleX:n.icon.scaleX*1.08,scaleY:n.icon.scaleY*.9,duration:65,yoyo:true,ease:'Sine.Out'});}));}});
    await Promise.all(motions);if(!this.alive||run!==this.runId)return;this.board=board;
  }
  async clearFrame(frame,fast){
    const run=this.runId;
    if(!fast&&this.turnSource!=='reward'&&frame.activated?.length&&!this.turnCinematicShown){const type=frame.activated.some(a=>a.special==='nova')?'rift':frame.activated.some(a=>a.special==='bomb')?'drone':'hammer';await this.playCinematic(type,Math.min(3,frame.activated.length));if(!this.alive||run!==this.runId)return;this.turnCinematicShown=true;const p=xy(frame.activated[0].index);this.audio.rewardCharge?.(type);await this.fx.windup(p.x,p.y,type);if(!this.alive||run!==this.runId)return;this.audio.rewardImpact?.(type);}
    if(this.session&&remainingMs(this.session,Date.now())<=0){this.endRun('timeout');return;}
    this.audio.clear(frame.chain,!!frame.activated?.length);const dying=[];
    for(const activated of frame.activated??[]){const p=xy(activated.index);if(activated.special==='row'||activated.special==='column')this.fx.beam(p.x,p.y,activated.special);else if(activated.special==='bomb')this.fx.bomb(p.x,p.y);else this.fx.nova(p.x,p.y,(frame.cleared??[]).slice(0,18).map(c=>xy(c.index)));}
    for(const entry of frame.cleared??[]){const p=xy(entry.index),n=this.nodes.get(entry.cell.id);if(n){dying.push(n);if(!fast&&!this.reduced)this.tweens.add({targets:n,scale:1.16,duration:85,yoyo:false});}this.fx.burst(p.x,p.y,COLORS[entry.cell.kind],fast?.68:1);}
    for(const hit of frame.obstacleHits??[]){obstacleImpact(this,this.fx,hit,xy(hit.index));if(hit.hp>0)this.fx.floatText(`${hit.hp} / ${hit.cell.obstacle==='rock'?3:2}`,xy(hit.index).x,xy(hit.index).y-32,'#fff3bd',23);}
    for(const broken of frame.obstacleBroken??[]){const n=this.nodes.get(broken.cell.id);if(n)dying.push(n);const p=xy(broken.index);this.fx.obstacleRelease(broken.cell.obstacle,p.x,p.y);this.fx.floatText(`${OBSTACLE_NAMES[broken.cell.obstacle]}击破！`,p.x,p.y-37,'#ffe488',24);}
    const pointInfo=scoreFrame(frame,{source:this.turnSource,phase:this.phase.index});this.session=commitFrame(this.session,frame,{source:this.turnSource,phase:this.phase.index});this.score=this.session.score;
    if(this.turnSource==='player')this.energy=Math.min(100,this.energy+(frame.cleared?.length??0)*2.3+(frame.chain>1?4:0)+(frame.activated?.length??0)*8+(frame.chargeBonus??0));
    if(pointInfo.points)this.fx.floatText(`+${compactScore(pointInfo.points)}${frame.chain>1?` · 连锁×${pointInfo.breakdown.chainMultiplier}`:''}`,360,229,'#ffec92',25);
    if(frame.chain>1)this.fx.floatText(['','', '漂亮连击！','能量连锁！','超棒！','不可思议！'][Math.min(frame.chain,5)],360,310, '#fffad3',44);
    if(frame.created?.length){for(const created of frame.created){const p=xy(created.index);this.fx.floatText({row:'闪电诞生',column:'闪电诞生',bomb:'爆炸诞生',nova:'彩虹核心'}[created.cell.special],p.x,p.y-35,'#fffbd3',27);}}
    await this.delay(fast?20:100);if(!this.alive||run!==this.runId)return;await Promise.all(dying.filter(n=>n.active).map(n=>this.tween(n,{scale:.2,alpha:0,duration:fast?45:110}).then(()=>{if(!this.alive||run!==this.runId)return;this.nodes.delete(n.cell.id);n.destroy();})));
    if(!this.alive||run!==this.runId)return;
    this.board=frame.board;for(const created of frame.created??[]){const n=this.nodes.get(created.cell.id);if(n)this.decorate(n,created.cell);else this.makeTile(created.cell,created.index);}
    this.scoreText.setText(compactScore(this.score));this.syncAccessibility();
  }
  async startRush(){
    if(this.state!=='idle'||this.energy<100)return;const run=this.runId;this.clearHint();this.selected=null;this.selection.setVisible(false);this.energy=0;
    this.rewardTitle?.setText('能量满格 · 塔塔觉醒');this.rewardDetail?.setText('5 秒点击即爆 · 瞬间释放电力');
    await this.playCinematic('overdrive');if(!this.alive||run!==this.runId)return;
    this.audio.rewardImpact?.('overdrive',1.4);this.fx.nova(360,630,[{x:56,y:295},{x:664,y:295},{x:56,y:979},{x:664,y:979}]);
    this.rushRemaining=RUSH_DURATION_MS;this.rushLastTick=performance.now();this.state='rush';this.track=(this.track+1)%10;safeWrite('tata-last-track',this.track);
    this.audio.startRush(this.track,({strength})=>{if(this.alive&&this.rushRemaining>0)this.fx.rushBeat(strength);});
    this.fx.floatText('觉醒开启！',360,590,'#ffe665',68);this.say('觉醒开始！点击任意图标释放电力');this.updateHUD();
  }
  queueRush(index){if(this.rushRemaining<=0)return;if(this.state==='resolving'){if(this.rushQueue.length<6)this.rushQueue.push(index);return;}if(this.state!=='rush')return;this.playTurn(buildRushTurn(this.board,index),false,true,'rush');}
  finishCheck(){if(this.session&&remainingMs(this.session,Date.now())<=0){this.endRun('timeout');return;}if(this.state==='idle')this.rushQueue=[];this.syncAccessibility();}
  endRun(reason='banked'){
    if(!this.session||this.state==='finished')return;this.session=finalizeSession(this.session,reason,Date.now());this.score=this.session.score;this.moves=this.session.moves;this.state='finished';this.alive=false;this.runId++;this.rushRemaining=0;this.rushQueue=[];this.pendingRewards=[];
    clearInterval(this.clockTicker);this.previewAudio?.destroy();this.audio.stopRush();this.audio.suspend();this.cinematic.destroy();this.fx.destroy();this.clearHint();this.scene.pause();
    this.leaderboard=addLeaderboardEntry(this.leaderboard??[],this.session,Date.now());this.resultStorage=persistFinalRecords(()=>localStorage,RANK_KEY,SAVE_KEY,this.leaderboard);if(this.resultStorage.checkpointCleared)this.savedRun=null;this.best=this.leaderboard[0]?.score??this.score;this.syncAccessibility();this.showResult();
  }
  showResult(){
    const saved=this.resultStorage?.saved!==false,s=this.session,rank=this.leaderboard.findIndex(e=>e.sessionId===s.id)+1;this.showDialog(`<div class="eyebrow">TATA · FINAL SCORE</div><h1 class="ribbon">${!saved?'成绩尚未保存到本机':s.reason==='timeout'?'12 小时挑战完成':'本局成绩已保存'}</h1><div class="big-score">${s.score.toLocaleString()}</div><p>${rank?`本机第 ${rank} 名`:'挑战更高的本机纪录'} · 最佳 ${this.best.toLocaleString()}</p><div class="result-detail">挑战用时 ${clockText(s.endedAt-s.startedAt)}<br>${s.moves.toLocaleString()} 次操作 · ${s.cleared.toLocaleString()} 枚消除<br>击碎 ${s.totalObstacles} 个障碍 · 最长 ${s.highestChain} 连锁</div>${saved?'<button class="cta" id="replay">开启新的无尽挑战</button>':'<p>浏览器存储不可用，请保留本页并重试。<br>下方分数可截图留存，原存档未被删除。</p><button class="cta" id="retry-save">重试保存成绩</button>'}<button class="secondary" id="result-rank">本机最高分 · 前 10 名</button><p class="muted">本机记录不跨设备同步，不代表全网排名</p>`);this.root.querySelector('#replay')?.addEventListener('click',()=>this.restart());this.root.querySelector('#retry-save')?.addEventListener('click',()=>{this.resultStorage=persistFinalRecords(()=>localStorage,RANK_KEY,SAVE_KEY,this.leaderboard);this.showResult();});this.root.querySelector('#result-rank').onclick=()=>this.showLeaderboard(()=>this.showResult());
  }
  showLeaderboard(back){this.showDialog(`<div class="eyebrow">LOCAL HIGH SCORES</div><h2 class="ribbon">本机最高分</h2><div class="local-ranks">${this.leaderboard.length?this.leaderboard.map((e,i)=>`<div><b>${String(i+1).padStart(2,'0')}</b><strong>${e.score.toLocaleString()}</strong><small>${new Date(e.endedAt).toLocaleDateString()} · ${clockText(e.endedAt-e.startedAt)}</small></div>`).join(''):'<p>还没有结算成绩，开始第一场挑战吧！</p>'}</div><button class="cta" id="rank-back">返回</button><p class="muted">只保存本浏览器前 10 名 · 清除浏览器数据会删除记录</p>`);this.root.querySelector('#rank-back').onclick=back;}
  pauseGame(){if(!this.alive||['intro','starting','finished','paused'].includes(this.state))return;if(this.session&&remainingMs(this.session,Date.now())<=0){this.endRun('timeout');return;}this.saveProgress();this.beforePause=this.state;this.state='paused';this.audio.suspend();this.scene.pause();this.syncAccessibility();this.showPause();}
  showPause(){this.showDialog(`<div class="eyebrow">TAKE A LITTLE BREAK</div><h2 class="ribbon">休息一下</h2><div class="settings-row"><span>音乐与音效</span><button id="sound" class="${this.audio.enabled?'':'off'}">${this.audio.enabled?'开启':'关闭'}</button></div><div class="settings-row"><span>手机震动</span><button id="haptic" class="${this.audio.haptics?'':'off'}">${this.audio.haptics?'开启':'关闭'}</button></div><div class="settings-row"><span>舒适动效</span><button id="motion" class="${this.reduced?'':'off'}">${this.reduced?'开启':'关闭'}</button></div><button class="cta" id="resume">继续无尽挑战</button><button class="secondary" id="music">试听 10 首觉醒音乐</button><button class="secondary" id="restart">结束本局并保存成绩</button><p class="muted">暂停冻结棋盘，12 小时封顶时间仍继续<br>刷新续接最近一个完整回合；手机震动取决于设备支持</p>`);
    this.root.querySelector('#sound').onclick=()=>{this.audio.setEnabled(!this.audio.enabled);safeWrite('tata-sound',this.audio.enabled?'on':'off');this.showPause();};this.root.querySelector('#haptic').onclick=()=>{this.audio.setHaptics(!this.audio.haptics);safeWrite('tata-haptic',this.audio.haptics?'on':'off');this.showPause();};this.root.querySelector('#motion').onclick=()=>{this.reduced=!this.reduced;this.fx.setReduced(this.reduced);document.documentElement.dataset.motion=this.reduced?'reduced':'full';this.ambientTweens.forEach(tween=>this.reduced?tween.pause():tween.resume());safeWrite('tata-motion',this.reduced?'off':'on');this.showPause();};this.root.querySelector('#resume').onclick=()=>this.resumeGame();this.root.querySelector('#restart').onclick=()=>this.showRestartConfirm();this.root.querySelector('#music').onclick=()=>this.showMusic();}
  resumeGame(){if(!this.alive)return;if(this.session&&remainingMs(this.session,Date.now())<=0){this.endRun('timeout');return;}this.closeDialog();this.state=this.beforePause??'idle';this.audio.resume();this.rushLastTick=performance.now();this.scene.resume();this.updateHUD();}
  showRestartConfirm(){this.showDialog('<h2 class="ribbon">结算本局成绩？</h2><p>保存当前已获得积分到本机榜单。<br>未完成的连锁和待释放支援将不再继续。</p><button class="cta" id="yes">确认结算</button><button class="secondary" id="no">继续这一局</button>');this.root.querySelector('#yes').onclick=()=>this.endRun('banked');this.root.querySelector('#no').onclick=()=>this.showPause();}
  showMusic(){this.showDialog(`<h2 class="ribbon">塔塔觉醒音乐</h2><p>十段原创电子编曲 · 试听15秒 / 实战5秒</p><div class="music-list">${TRACKS.map((t,i)=>`<button data-track="${i}">${String(i+1).padStart(2,'0')} ${t.name}<br><small>${t.bpm} BPM</small></button>`).join('')}</div><button class="secondary" id="back">返回设置</button>`);this.previewAudio?.destroy();this.previewAudio=new GameAudio();this.root.querySelectorAll('[data-track]').forEach(b=>b.onclick=async()=>{this.root.querySelectorAll('[data-track]').forEach(n=>n.classList.remove('playing'));b.classList.add('playing');await this.previewAudio.unlock();if(this.alive)this.previewAudio?.startRush(Number(b.dataset.track),undefined,15);});this.root.querySelector('#back').onclick=()=>{this.previewAudio.destroy();this.previewAudio=null;this.showPause();};}
  openGuide(){
    if(!this.alive||['intro','starting','finished','paused'].includes(this.state))return;this.pauseGame();if(!this.alive)return;
    this.showDialog('<h2 class="ribbon">无尽挑战 · 玩法与计分</h2><div class="guide-lines"><span>基础消除：</span>交换相邻塔塔，三连消除；四连出闪电、T/L连出爆炸、五连出彩虹。连点两次特殊核心直接引爆。<br><span>三击矿石：</span>只能被爆炸、闪电或支援命中，累计三次摧毁；同一波重复覆盖只扣一次。<br><span>补给箱：</span>旁消或特效命中两次，开出爆炸核心。<br><span>能量电池：</span>两次命中释放闪电核心；玩家操作击破额外补充12点能量。<br><span>棱镜晶体：</span>特效击破后留下彩虹核心。<br><span>持续变化：</span>每3次有效操作有机会空投道具，每12次操作切换一种事件，六种循环，不重置积分。<br><span>5秒觉醒：</span>满能量自动触发，点击任意格即可爆破。支援在觉醒结束后结算。<br><span>计分：</span>棋子100分 / 激活核心200分 / 障碍命中30分；破坏矿石600、箱子300、电池250、晶体400。连锁每层+25%，9连起封顶3倍；事件倍率1–1.5倍。觉醒得分×0.6，自动支援×0.5。<br><span>结束与续玩：</span>不限制操作次数，不设通关。开局12小时后封顶，也可在暂停中主动结算。刷新续接最近完整回合，暂停与离线不会重置截止时间。<br><span>本机记录：</span>仅当前浏览器保存前10名，不是全网排名。</div><button class="cta" id="guide-back">开始冲分</button>');
    this.root.querySelector('#guide-back').onclick=()=>this.resumeGame();
  }
  restart(){clearInterval(this.clockTicker);this.alive=false;this.runId++;this.previewAudio?.destroy();this.audio.destroy();this.cinematic.destroy();this.root.replaceChildren();this.scene.resume();this.scene.restart();}
  update(time,delta){if(!this.alive)return;
    if(this.rushRemaining>0&&this.state!=='paused'){const tick=performance.now(),elapsed=Math.max(0,tick-(this.rushLastTick??tick));this.rushLastTick=tick;this.rushRemaining=Math.max(0,this.rushRemaining-elapsed);if(!this.rushRemaining){this.audio.stopRush();this.rushQueue=[];if(this.state==='rush'){this.state='resolving';this.completeTurn();}this.say('觉醒结束，正在结算支援奖励');}if(!this.board.some(c=>!c))this.updateHUD();}
    if(!this.reduced&&time-this.lastBlink>1800&&['idle','rush'].includes(this.state)){this.lastBlink=time;const cell=this.board[Phaser.Math.Between(0,71)],n=this.nodes.get(cell?.id);if(n?.active&&!cell.obstacle){n.icon.setTexture(`blink-${cell.kind}`);this.time.delayedCall(135,()=>{if(n.active)n.icon.setTexture(`wolf-${cell.kind}`);});this.tweens.add({targets:n.icon,y:-4,duration:650,yoyo:true,ease:'Sine.InOut'});}}
    if(this.state==='idle'&&time-this.lastAction>8500){this.lastAction=time;this.showHint();}
  }
}
