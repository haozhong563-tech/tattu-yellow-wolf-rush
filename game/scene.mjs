import Phaser from 'phaser';
import { createBoard, buildTurn, buildToolTurn, buildRushTurn, legalMoves, COLS } from './model.mjs';
import { GameAudio, TRACKS } from './audio.mjs';
import { Effects } from './effects.mjs';
import { planRewards, buildRewardTurn } from './rewards.mjs';
import { HeroCinematic, prepareUltimateTextures, REWARD_NAMES } from './cinematic.mjs';
import forestURL from '../public/v3/energy-forest.png';

const W=720,H=1220,CELL=76,BX=56,BY=295;
const COLORS=[0xffd34b,0x42ccec,0xff6860,0x98d846,0xb485f4,0xffa348];
const NAMES=['闪电塔塔','飞行塔塔','竞速塔塔','工程塔塔','星际塔塔','超载塔塔'];
const ICE=Array.from({length:18},(_,i)=>(3+Math.floor(i/6))*8+1+i%6);
const xy=index=>({x:BX+(index%8)*CELL+CELL/2,y:BY+Math.floor(index/8)*CELL+CELL/2});
const safeRead=(key,fallback)=>{try{return localStorage.getItem(key)??fallback;}catch{return fallback;}};
const safeWrite=(key,value)=>{try{localStorage.setItem(key,String(value));}catch{}};

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
    this.runId=(this.runId??0)+1;this.alive=true;this.state='intro';this.board=createBoard();this.board[12].special='row';this.board[51].special='bomb';this.nodes=new Map();this.ice=new Set(ICE);this.iceNodes=new Map();this.progress=[0,0];this.moves=30;this.score=0;this.energy=0;this.rushRemaining=0;this.rushQueue=[];this.selected=null;this.pendingRewards=[];this.rewardStats={hammer:0,drone:0,rift:0};this.turnSource='player';this.turnCinematicShown=false;this.completing=false;this.track=Number(safeRead('tata-last-track','-1'));this.best=Number(safeRead('tata-forest-best','0'))||0;this.reduced=safeRead('tata-motion',matchMedia('(prefers-reduced-motion: reduce)').matches?'off':'on')==='off';this.audio=new GameAudio();this.audio.setEnabled(safeRead('tata-sound','on')==='on');this.audio.setHaptics(safeRead('tata-haptic','on')==='on');this.fx=new Effects(this,{reduced:this.reduced});this.lastAction=0;this.lastBlink=0;this.hintNodes=[];this.shownStars=0;this.ambientTweens=[];document.documentElement.dataset.motion=this.reduced?'reduced':'full';
    this.makeTextures();prepareUltimateTextures(this);this.cinematic=new HeroCinematic(this);this.drawEnvironment();this.drawHUD();this.drawBoard();this.drawControls();
    this.board.forEach((cell,index)=>this.makeTile(cell,index));this.syncAccessibility();this.updateHUD();this.showIntro();
    this.events.once('shutdown',()=>{this.alive=false;this.cinematic.destroy();this.fx.destroy();this.audio.destroy();this.previewAudio?.destroy();this.a11y.replaceChildren();this.root.replaceChildren();});
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
    this.add.rectangle(360,610,720,1220,0xc5e8c2,.05).setDepth(-9);
    for(let i=0;i<18;i++){const mote=this.add.circle(Phaser.Math.Between(10,710),Phaser.Math.Between(60,1170),Phaser.Math.FloatBetween(1.8,3.5),i%3?0xffef9c:0xf8ffff,.55).setDepth(-2);this.ambientTweens.push(this.tweens.add({targets:mote,y:mote.y-90,x:mote.x+Phaser.Math.Between(-30,30),alpha:.1,duration:Phaser.Math.Between(4500,8000),yoyo:true,repeat:-1,delay:i*190,paused:this.reduced}));}
    this.text(360,35,'TATTU  ·  POWER BEYOND LIMITS',18,'#fff9d4',{letterSpacing:3,stroke:'#527c49',strokeThickness:3}).setDepth(10);
    this.text(360,71,'塔塔 · 能源森林',36,'#fffde7',{stroke:'#517b42',strokeThickness:5}).setDepth(10);
  }
  drawHUD(){
    this.panel(42,100,636,126);this.panel(54,94,136,140,0xfdebc0,0xfff7d8,28,12);
    this.text(122,119,'剩余步数',22,'#a07b42').setDepth(13);this.movesText=this.text(122,166,30,64,'#6b9941',{stroke:'#fff7d6',strokeThickness:3}).setDepth(13);
    this.text(240,119,'本关目标',21,'#9e8b54').setDepth(13);
    this.goalIcons=[];this.goalTexts=[];
    for(let i=0;i<3;i++){const x=282+i*142;const tex=i===2?'ice-icon':`wolf-${i}`;this.add.ellipse(x,199,104,22,0xe8d49b,.38).setDepth(12);const icon=this.add.image(x-15,161,tex).setDisplaySize(i===2?53:77,i===2?53:77).setDepth(13);this.goalIcons.push(icon);this.goalTexts.push(this.text(x+36,172,18,35,'#648b40',{stroke:'#fff8dd',strokeThickness:3}).setDepth(14));this.text(x,208,['闪电','飞行','冰层'][i],18,'#98895e').setDepth(13);}
    this.scoreTrack=this.add.graphics().setDepth(10);this.scoreText=this.text(111,249,'0',23,'#fffce4',{stroke:'#598d68',strokeThickness:3}).setDepth(11);
    this.add.rectangle(415,246,395,10,0x5f9068,.55).setDepth(10);this.starBar=this.add.rectangle(220,246,1,9,0xffd758).setOrigin(0,.5).setDepth(11);
    this.stars=[340,465,590].map(x=>this.text(x,246,'★',29,'#efefc6',{stroke:'#658458',strokeThickness:3}).setDepth(12));
    this.energyTrack=this.add.graphics().setDepth(12);this.energyText=this.text(392,274,'消除充能 · 满格开启 15 秒超载',18,'#47684b',{stroke:'#fff7d8',strokeThickness:3}).setDepth(13);
    this.add.graphics().setDepth(15).fillStyle(0xfff9df,.94).fillRoundedRect(66,987,588,31,15);
    this.statusText=this.text(360,1002,'收集塔塔，击碎冰层，点亮能源森林',21,'#56784a').setDepth(16);
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
    const p=xy(index),node=this.add.container(p.x,fromAbove?BY-70-(8-Math.floor(index/8))*32:p.y).setDepth(30);node.cell={...cell};node.index=index;node.add(this.add.ellipse(0,25,49,15,0x385c5a,.17));node.icon=this.add.image(0,-2,`wolf-${cell.kind}`).setDisplaySize(87,87);node.add(node.icon);node.badge=this.add.container(0,0);node.add(node.badge);this.nodes.set(cell.id,node);this.decorate(node,cell);return node;
  }
  decorate(node,cell){
    if(node.special===cell.special)return;node.special=cell.special;node.badge.removeAll(true);if(!cell.special)return;
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
    this.cellButtons.forEach((b,i)=>{const cell=this.board[i];b.disabled=this.state!=='idle'&&this.state!=='rush'&&!(this.state==='resolving'&&this.rushRemaining>0);if(!cell)return;b.ariaLabel=`第${Math.floor(i/8)+1}行第${i%8+1}列 ${NAMES[cell.kind]}${cell.special?' '+{row:'横向闪电',column:'纵向闪电',bomb:'爆炸',nova:'彩虹核心'}[cell.special]:''}${this.ice.has(i)?' 冰层':''}`;b.dataset.kind=cell.kind;b.dataset.special=cell.special??'';b.dataset.ice=String(this.ice.has(i));b.dataset.id=cell.id;});
    const app=document.getElementById('app');Object.assign(app.dataset,{state:this.state,score:String(this.score),moves:String(this.moves),energy:String(Math.floor(this.energy)),ice:String(this.ice.size),goals:this.progress.join(','),rush:String(Math.max(0,Math.ceil(this.rushRemaining/1000))),rewards:JSON.stringify(this.rewardStats??{}),pendingRewards:String(this.pendingRewards?.length??0)});
  }
  updateHUD(){
    this.movesText.setText(this.moves).setColor(this.moves<=5?'#da7155':'#6b9941');this.scoreText.setText(this.score.toLocaleString());this.goalTexts.forEach((t,i)=>t.setText(i===2?(this.ice.size||'✓'):(Math.max(0,18-this.progress[i])||'✓')));this.starBar.width=Math.max(1,Math.min(395,this.score/8500*395));this.stars.forEach((s,i)=>s.setColor(this.score>=[1500,4000,8500][i]?'#ffdc46':'#d7e3c6'));
    const g=this.energyTrack;g.clear();g.fillStyle(0x638e75,.55).fillRoundedRect(206,264,390,20,10);g.fillStyle(0xeaffd5,.8).fillRoundedRect(209,267,384,14,7);g.fillStyle(this.rushRemaining?0xffaa39:0xf2ce4b).fillRoundedRect(209,267,Math.max(1,384*(this.rushRemaining?this.rushRemaining/15000:this.energy/100)),14,7);this.energyText.setText(this.rushRemaining?`${TRACKS[this.track].name}  ·  疯狂点击`:(this.energy>=100?'能量已满 · 塔塔即将觉醒':'消除充能 · 满格自动进入 15 秒超载'));this.rushTimeText.setText(this.rushRemaining?`${Math.ceil(this.rushRemaining/1000)}s`:'');
    this.syncAccessibility();
  }
  say(text){this.statusText.setText(text);document.getElementById('announcer').textContent=text;}
  showDialog(html){this.a11y.inert=true;this.root.innerHTML=`<div class="screen-shade"><section class="dialog" role="dialog" aria-modal="true">${html}</section></div>`;const first=this.root.querySelector('button');first?.focus();}
  closeDialog(){this.root.replaceChildren();this.a11y.inert=false;}
  goalPreview(){return `<div class="goal-preview"><div><img src="${this.iconURLs[0]}" alt="闪电塔塔"><b>18</b><small>闪电塔塔</small></div><div><img src="${this.iconURLs[1]}" alt="飞行塔塔"><b>18</b><small>飞行塔塔</small></div><div><i class="ice-preview"></i><b>18</b><small>冰层</small></div></div>`;}
  showIntro(){this.showDialog(`<img class="hero" src="./yellow-wolf-runner.png" alt="黄色闪电狼塔塔"><div class="eyebrow">TATA · ENERGY FOREST</div><h1 class="ribbon">第 1 关 · 点亮森林</h1><p>30 步内完成目标<br>消除特殊核心，召唤塔塔出击！</p>${this.goalPreview()}<button class="cta" id="start">开始闯关</button><p class="muted">三连消除 · 连点两次特殊核心可直接引爆</p>`);this.root.querySelector('#start').onclick=()=>this.begin();}
  async begin(){if(this.state!=='intro')return;this.state='starting';await this.audio.unlock();this.closeDialog();this.nodes.forEach(n=>{n.y-=780;n.alpha=0;this.tweens.add({targets:n,y:xy(n.index).y,alpha:1,duration:this.reduced?0:400,delay:this.reduced?0:Math.floor(n.index/8)*35,ease:'Back.Out'});});await this.delay(this.reduced?1:720);if(!this.alive)return;this.state='idle';this.lastAction=this.time.now;this.say('先连成三个塔塔，收集能量吧！');this.updateHUD();this.showHint(true);}
  delay(ms){return new Promise(resolve=>this.time.delayedCall(this.reduced?Math.min(ms,20):ms,resolve));}
  tween(targets,params){return new Promise(resolve=>this.tweens.add({targets,...params,duration:this.reduced?Math.min(params.duration??1,35):params.duration,onComplete:resolve}));}
  clearHint(){this.hintNodes.forEach(n=>{this.tweens.killTweensOf(n);n.destroy();});this.hintNodes=[];}
  showHint(first=false){if(this.state!=='idle'||this.selected!==null)return;this.clearHint();const core=this.board.findIndex(c=>c.special);if(core>=0){const p=xy(core),ring=this.add.graphics().setDepth(50).setPosition(p.x,p.y);ring.lineStyle(5,0xffe849).strokeRoundedRect(-37,-37,74,74,13);this.hintNodes.push(ring);this.tweens.add({targets:ring,alpha:.15,duration:450,repeat:3,yoyo:true,onComplete:()=>ring.destroy()});this.say('连点两次发光核心，或把它连消，引发塔塔支援！');return;}const moves=legalMoves(this.board);const move=moves.find(m=>buildTurn(this.board,m.a,m.b).frames.find(f=>f.type==='clear')?.created?.length)??moves[0];if(!move)return;for(const i of[move.a,move.b]){const p=xy(i),g=this.add.graphics().setDepth(50);g.lineStyle(4,0xfff8ae).strokeRoundedRect(-35,-35,70,70,12);g.setPosition(p.x,p.y);this.hintNodes.push(g);this.tweens.add({targets:g,alpha:.18,duration:700,repeat:2,yoyo:true,onComplete:()=>g.destroy()});}const a=xy(move.a),b=xy(move.b);const arrow=this.text((a.x+b.x)/2,(a.y+b.y)/2,Math.abs(move.a-move.b)===1?'↔':'↕',42,'#fffbd5',{stroke:'#77984b',strokeThickness:4}).setDepth(60);this.hintNodes.push(arrow);this.tweens.add({targets:arrow,scale:1.13,duration:600,yoyo:true,repeat:3,onComplete:()=>arrow.destroy()});if(first)this.say('试试发光的组合，四连可以制造闪电！');}
  select(index){
    if(this.state==='rush'||(this.state==='resolving'&&this.rushRemaining>0)){this.queueRush(index);return;}
    if(this.state!=='idle')return;this.clearHint();this.lastAction=this.time.now;this.audio.tap();
    if(this.selected===index){this.selected=null;this.selection.setVisible(false);if(this.board[index].special)this.playTurn(buildToolTurn(this.board,index,'hammer'),true);return;}
    if(this.selected===null){this.selected=index;this.selection.setPosition(xy(index).x,xy(index).y).setVisible(true);const n=this.nodes.get(this.board[index].id);this.tweens.add({targets:n.icon,scaleX:87/256*1.08,scaleY:87/256*.96,duration:95,yoyo:true});if(this.board[index].special)this.say('再点一次引爆核心！也可以与相邻棋子交换');return;}
    this.attempt(this.selected,index);
  }
  attempt(a,b){if(this.state!=='idle')return;this.clearHint();this.lastAction=this.time.now;if(Math.abs(Math.floor(a/8)-Math.floor(b/8))+Math.abs(a%8-b%8)!==1){this.selected=b;this.selection.setPosition(xy(b).x,xy(b).y).setVisible(true);return;}this.selected=null;this.selection.setVisible(false);this.playTurn(buildTurn(this.board,a,b),true);}
  async playTurn(turn,consumeMove=false,fast=false,source='player'){
    if(!this.alive||!turn.frames.length)return;const run=this.runId;this.state='resolving';this.turnSource=source;if(source!=='reward')this.turnCinematicShown=false;
    this.selection.setVisible(false);this.syncAccessibility();if(turn.valid&&consumeMove)this.moves--;this.updateHUD();
    const earned=source==='reward'?[]:planRewards(turn,{source});
    for(const frame of turn.frames){if(!this.alive||run!==this.runId)return;
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
        const turn=buildRewardTurn(this.board,reward,[...this.ice]);
        this.rewardStats[reward.type]+=reward.count;
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
      if(!this.alive||run!==this.runId)return;this.turnSource='player';this.state='idle';this.lastAction=this.time.now;this.updateHUD();
      if(this.progress[0]>=18&&this.progress[1]>=18&&this.ice.size===0)this.finishCheck();
      else if(this.energy>=100)await this.startRush();
      else{this.finishCheck();if(this.state==='idle'){this.say('连消特殊核心，继续召唤塔塔支援！');this.rewardTitle?.setText('塔塔待命 · 能量共鸣');this.rewardDetail?.setText('消除特殊核心，再次召唤强力支援');}}
    }finally{if(run===this.runId)this.completing=false;}
  }
  async playCinematic(type,count=1){
    const run=this.runId;this.state='cinematic';document.getElementById('app').dataset.cinematic=type;this.syncAccessibility();
    this.rewardTitle?.setText(REWARD_NAMES[type]+' · 出击');this.rewardDetail?.setText(type==='overdrive'?'能量共鸣 · 15 秒点击即爆':'特殊核心引爆 · 塔塔支援');this.audio.cinematic?.(type);this.stageHero?.setTexture('ultimate-1');
    await this.cinematic.play(type,count);
    if(!this.alive||run!==this.runId)return;this.stageHero?.setTexture('ultimate-0');this.state='resolving';document.getElementById('app').dataset.cinematic='';this.syncAccessibility();
  }
  async moveFrame(board,duration,fall=false){
    const run=this.runId;const ids=new Set(board.filter(Boolean).map(c=>c.id));for(const[id,node]of this.nodes)if(!ids.has(id)){node.destroy();this.nodes.delete(id);}const motions=[];
    board.forEach((cell,index)=>{if(!cell)return;let n=this.nodes.get(cell.id),isNew=!n;if(!n)n=this.makeTile(cell,index,fall);this.decorate(n,cell);n.cell={...cell};const p=xy(index);n.index=index;if(n.x!==p.x||n.y!==p.y||isNew){const distance=Math.abs(n.y-p.y);motions.push(this.tween(n,{x:p.x,y:p.y,alpha:1,duration:fall?duration+Math.min(90,distance*.15):duration,ease:fall?'Cubic.In':'Sine.InOut'}).then(()=>{if(!this.alive||!n.active)return;if(fall&&!this.reduced)this.tweens.add({targets:n.icon,scaleX:87/256*1.08,scaleY:87/256*.9,duration:65,yoyo:true,ease:'Sine.Out'});}));}});
    await Promise.all(motions);if(!this.alive||run!==this.runId)return;this.board=board;
  }
  async clearFrame(frame,fast){
    const run=this.runId;
    if(!fast&&this.turnSource!=='reward'&&frame.activated?.length&&!this.turnCinematicShown){const type=frame.activated.some(a=>a.special==='nova')?'rift':frame.activated.some(a=>a.special==='bomb')?'drone':'hammer';await this.playCinematic(type,Math.min(3,frame.activated.length));if(!this.alive||run!==this.runId)return;this.turnCinematicShown=true;const p=xy(frame.activated[0].index);this.audio.rewardCharge?.(type);await this.fx.windup(p.x,p.y,type);if(!this.alive||run!==this.runId)return;this.audio.rewardImpact?.(type);}
    this.audio.clear(frame.chain,!!frame.activated?.length);const dying=[];const collections=[];let iceCount=0;
    for(const activated of frame.activated??[]){const p=xy(activated.index);if(activated.special==='row'||activated.special==='column')this.fx.beam(p.x,p.y,activated.special);else if(activated.special==='bomb')this.fx.bomb(p.x,p.y);else this.fx.nova(p.x,p.y,(frame.cleared??[]).slice(0,18).map(c=>xy(c.index)));}
    for(const entry of frame.cleared??[]){const p=xy(entry.index),n=this.nodes.get(entry.cell.id);if(n){dying.push(n);if(!fast&&!this.reduced)this.tweens.add({targets:n,scale:1.16,duration:85,yoyo:false});}this.fx.burst(p.x,p.y,COLORS[entry.cell.kind],fast?.68:1);
      if(entry.cell.kind<2){const goal=entry.cell.kind;this.progress[goal]++;if(collections.length<8)collections.push({tex:`wolf-${goal}`,p,goal});}
      if(this.ice.has(entry.index)){this.ice.delete(entry.index);const ice=this.iceNodes.get(entry.index);this.iceNodes.delete(entry.index);if(ice){this.tweens.add({targets:ice,alpha:0,scale:1.22,duration:210,onComplete:()=>ice.destroy()});}this.fx.burst(p.x,p.y,0xb6f5ff,.8);iceCount++;}
    }
    const aliveScore=this.score;this.score+=frame.score??0;if(this.turnSource==='player')this.energy=Math.min(100,this.energy+(frame.cleared?.length??0)*2.3+(frame.chain>1?4:0)+(frame.activated?.length??0)*8);
    if(frame.chain>1)this.fx.floatText(['','', '漂亮连击！','能量连锁！','超棒！','不可思议！'][Math.min(frame.chain,5)],360,310, '#fffad3',44);
    if(frame.created?.length){for(const created of frame.created){const p=xy(created.index);this.fx.floatText({row:'闪电诞生',column:'闪电诞生',bomb:'爆炸诞生',nova:'彩虹核心'}[created.cell.special],p.x,p.y-35,'#fffbd3',27);}}
    collections.forEach(({tex,p,goal},i)=>this.time.delayedCall(fast?0:i*25,()=>this.fx.collect(tex,p.x,p.y,282+goal*142-15,161,()=>{if(this.alive){const icon=this.goalIcons[goal];this.tweens.killTweensOf(icon);icon.setScale(77/256);this.tweens.add({targets:icon,scale:77/256*1.18,duration:80,yoyo:true});this.audio.collect();}})));
    if(iceCount)this.fx.collect('ice-icon',360,630,551,161,()=>{if(this.alive)this.audio.collect();});
    await this.delay(fast?20:100);if(!this.alive||run!==this.runId)return;await Promise.all(dying.filter(n=>n.active).map(n=>this.tween(n,{scale:.2,alpha:0,duration:fast?45:110}).then(()=>{if(!this.alive||run!==this.runId)return;this.nodes.delete(n.cell.id);n.destroy();})));
    if(!this.alive||run!==this.runId)return;
    this.board=frame.board;for(const created of frame.created??[]){const n=this.nodes.get(created.cell.id);if(n)this.decorate(n,created.cell);}
    this.movesText.setText(this.moves);this.scoreText.setText(this.score.toLocaleString());this.goalTexts.forEach((t,i)=>t.setText(i===2?(this.ice.size||'✓'):(Math.max(0,18-this.progress[i])||'✓')));
    if(aliveScore<1500&&this.score>=1500)this.fx.floatText('第一颗星！',360,236,'#ffe177',25);
  }
  async startRush(){
    if(this.state!=='idle'||this.energy<100)return;const run=this.runId;this.clearHint();this.selected=null;this.selection.setVisible(false);this.energy=0;
    this.rewardTitle?.setText('能量满格 · 塔塔觉醒');this.rewardDetail?.setText('15 秒点击即爆 · 无需消耗步数');
    await this.playCinematic('overdrive');if(!this.alive||run!==this.runId)return;
    this.audio.rewardImpact?.('overdrive',1.4);this.fx.nova(360,630,[{x:56,y:295},{x:664,y:295},{x:56,y:979},{x:664,y:979}]);
    this.rushRemaining=15000;this.state='rush';this.track=(this.track+1)%10;safeWrite('tata-last-track',this.track);
    this.audio.startRush(this.track,({strength})=>{if(this.alive&&this.rushRemaining>0)this.fx.rushBeat(strength);});
    this.fx.floatText('觉醒开启！',360,590,'#ffe665',68);this.say('觉醒开始！点击任意图标释放电力');this.updateHUD();
  }
  queueRush(index){if(this.rushRemaining<=0)return;if(this.state==='resolving'){if(this.rushQueue.length<6)this.rushQueue.push(index);return;}if(this.state!=='rush')return;this.playTurn(buildRushTurn(this.board,index),false,true,'rush');}
  finishCheck(){if(this.state!=='idle')return;this.rushQueue=[];if(this.progress[0]>=18&&this.progress[1]>=18&&this.ice.size===0){this.state='won';this.showResult(true);}else if(this.moves===0){this.state='lost';this.showResult(false);}else if(this.ice.size===1&&this.progress.every(v=>v>=18)){this.say('只剩最后一块冰！特殊核心可以召唤精准支援');}this.syncAccessibility();}
  async showResult(win){this.audio.stopRush();this.rushRemaining=0;this.clearHint();this.syncAccessibility();if(win){this.score+=this.moves*60;this.best=Math.max(this.best,this.score);safeWrite('tata-forest-best',this.best);this.audio.win();this.fx.celebrate();this.fx.floatText('森林点亮啦！',360,560,'#fff7bd',60);}else this.audio.lose();this.updateHUD();await this.delay(win?850:250);if(!this.alive)return;const stars=win?Math.max(1,[1500,4000,8500].filter(n=>this.score>=n).length):0;
    this.showDialog(`<div class="eyebrow">${win?'ENERGY RESTORED':'ONE MORE TRY'}</div><h1 class="ribbon">${win?'闯关成功！':'就差一点点'}</h1><div class="result-stars">${[0,1,2].map(n=>`<span class="${n<stars?'earned':''}">★</span>`).join('')}</div><div class="big-score">${this.score.toLocaleString()}</div><p>${win?'塔塔为森林注入了满满能量！':'塔塔等你再试一次，优先制造四连与五连。'}</p><p class="result-detail">${win?`剩余步数奖励 +${this.moves*60} · 最佳 ${this.best.toLocaleString()}`:`还需 ${Math.max(0,18-this.progress[0])} 个闪电 · ${Math.max(0,18-this.progress[1])} 个飞行 · ${this.ice.size} 块冰`}</p><button class="cta" id="replay">${win?'再玩一次 · 挑战三星':'重新挑战'}</button><button class="secondary" id="result-guide">消除小技巧</button>`);this.root.querySelector('#replay').onclick=()=>this.restart();this.root.querySelector('#result-guide').onclick=()=>this.openGuide(true);}
  pauseGame(){if(!this.alive||['intro','starting','won','lost','paused'].includes(this.state))return;this.beforePause=this.state;this.state='paused';this.audio.suspend();this.scene.pause();this.syncAccessibility();this.showPause();}
  showPause(){this.showDialog(`<div class="eyebrow">TAKE A LITTLE BREAK</div><h2 class="ribbon">休息一下</h2><div class="settings-row"><span>音乐与音效</span><button id="sound" class="${this.audio.enabled?'':'off'}">${this.audio.enabled?'开启':'关闭'}</button></div><div class="settings-row"><span>手机震动</span><button id="haptic" class="${this.audio.haptics?'':'off'}">${this.audio.haptics?'开启':'关闭'}</button></div><div class="settings-row"><span>舒适动效</span><button id="motion" class="${this.reduced?'':'off'}">${this.reduced?'开启':'关闭'}</button></div><button class="cta" id="resume">继续闯关</button><button class="secondary" id="music">试听 10 首超载音乐</button><button class="secondary" id="restart">重新开始本关</button><p class="muted">震动效果取决于设备与浏览器支持</p>`);
    this.root.querySelector('#sound').onclick=()=>{this.audio.setEnabled(!this.audio.enabled);safeWrite('tata-sound',this.audio.enabled?'on':'off');this.showPause();};this.root.querySelector('#haptic').onclick=()=>{this.audio.setHaptics(!this.audio.haptics);safeWrite('tata-haptic',this.audio.haptics?'on':'off');this.showPause();};this.root.querySelector('#motion').onclick=()=>{this.reduced=!this.reduced;this.fx.setReduced(this.reduced);document.documentElement.dataset.motion=this.reduced?'reduced':'full';this.ambientTweens.forEach(tween=>this.reduced?tween.pause():tween.resume());safeWrite('tata-motion',this.reduced?'off':'on');this.showPause();};this.root.querySelector('#resume').onclick=()=>this.resumeGame();this.root.querySelector('#restart').onclick=()=>this.showRestartConfirm();this.root.querySelector('#music').onclick=()=>this.showMusic();}
  resumeGame(){this.closeDialog();this.state=this.beforePause??'idle';this.audio.resume();this.scene.resume();this.updateHUD();}
  showRestartConfirm(){this.showDialog('<h2 class="ribbon">重新开始本关？</h2><p>本局进度将重置，最高分会保留。</p><button class="cta" id="yes">重新挑战</button><button class="secondary" id="no">继续这一局</button>');this.root.querySelector('#yes').onclick=()=>this.restart();this.root.querySelector('#no').onclick=()=>this.showPause();}
  showMusic(){this.showDialog(`<h2 class="ribbon">塔塔超载音乐</h2><p>十段原创电子编曲 · 每段 15 秒</p><div class="music-list">${TRACKS.map((t,i)=>`<button data-track="${i}">${String(i+1).padStart(2,'0')} ${t.name}<br><small>${t.bpm} BPM</small></button>`).join('')}</div><button class="secondary" id="back">返回设置</button>`);this.previewAudio?.destroy();this.previewAudio=new GameAudio();this.root.querySelectorAll('[data-track]').forEach(b=>b.onclick=async()=>{this.root.querySelectorAll('[data-track]').forEach(n=>n.classList.remove('playing'));b.classList.add('playing');await this.previewAudio.unlock();this.previewAudio.startRush(Number(b.dataset.track));});this.root.querySelector('#back').onclick=()=>{this.previewAudio.destroy();this.previewAudio=null;this.showPause();};}
  openGuide(result=false){if(!this.alive)return;if(result){if(!['won','lost'].includes(this.state)||!this.root.querySelector('#replay'))return;}else{if(['intro','starting','won','lost','paused'].includes(this.state))return;this.pauseGame();}const savedResult=result?this.root.firstElementChild:null;this.showDialog(`<h2 class="ribbon">塔塔的消除秘诀</h2><div class="guide-lines"><span>三连：</span>交换相邻塔塔，让三个同色相连。<br><span>四连：</span>合成闪电，击穿整行或整列。<br><span>T / L 连：</span>合成爆炸，清除周围区域。<br><span>五连：</span>合成彩虹，交换后清除一种颜色。<br><span>特效互换：</span>两种特效组合释放更强能量！<br><span>冰层：</span>消除上面的塔塔即可击碎。<br><span>核心引爆：</span>连点两次发光核心，消耗一步直接引爆。<br><span>支援奖励：</span>消除闪电得重锤，爆炸得蜂群，彩虹得裂隙，自动攻击冰层。<br><span>觉醒：</span>满能量自动进入，15 秒点击即爆。</div><button class="cta" id="guide-back">知道了</button>`);this.root.querySelector('#guide-back').onclick=()=>{if(result){this.root.replaceChildren(savedResult);this.root.querySelector('#result-guide')?.focus();}else this.resumeGame();};}
  restart(){this.alive=false;this.runId++;this.previewAudio?.destroy();this.audio.destroy();this.cinematic.destroy();this.root.replaceChildren();this.scene.resume();this.scene.restart();}
  update(time,delta){if(!this.alive)return;
    if(this.rushRemaining>0&&this.state!=='paused'){this.rushRemaining=Math.max(0,this.rushRemaining-Math.min(delta,100));if(!this.rushRemaining){this.audio.stopRush();this.rushQueue=[];if(this.state==='rush'){this.state='resolving';this.completeTurn();}this.say('觉醒结束，正在结算支援奖励');}if(!this.board.some(c=>!c))this.updateHUD();}
    if(!this.reduced&&time-this.lastBlink>1800&&['idle','rush'].includes(this.state)){this.lastBlink=time;const cell=this.board[Phaser.Math.Between(0,71)],n=this.nodes.get(cell?.id);if(n?.active){n.icon.setTexture(`blink-${cell.kind}`);this.time.delayedCall(135,()=>{if(n.active)n.icon.setTexture(`wolf-${cell.kind}`);});this.tweens.add({targets:n.icon,y:-4,duration:650,yoyo:true,ease:'Sine.InOut'});}}
    if(this.state==='idle'&&time-this.lastAction>8500){this.lastAction=time;this.showHint();}
  }
}
