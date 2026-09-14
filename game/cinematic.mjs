import Phaser from 'phaser';

export const REWARD_NAMES={hammer:'雷霆重锤',drone:'蜂群轰炸',rift:'时空裂隙',overdrive:'塔塔 · 觉醒'};
const PALETTES={hammer:0xffce52,drone:0x50efff,rift:0xc28aff,overdrive:0xffb334};

// Runtime sprite preparation: keep the generated source unchanged, key its green
// backdrop and remove disconnected pieces of neighboring atlas poses.
export function prepareUltimateTextures(scene){
  const source=scene.textures.get('ultimate-atlas').getSourceImage();
  const regions=[[0,170,550,830],[518,0,475,866],[993,315,543,709]];
  regions.forEach(([x,y,w,h],index)=>{
    const key=`ultimate-${index}`;if(scene.textures.exists(key))return;
    const surface=scene.textures.createCanvas(key,384,640),ctx=surface.context;
    const scale=Math.min(384/w,640/h);ctx.drawImage(source,x,y,w,h,(384-w*scale)/2,(640-h*scale)/2,w*scale,h*scale);
    const pixels=ctx.getImageData(0,0,384,640),d=pixels.data,n=384*640,seen=new Uint8Array(n),queue=new Int32Array(n);let largest=[];
    for(let p=0;p<n;p++){const i=p*4;if(d[i+1]>170&&d[i+1]-d[i]>100&&d[i+1]-d[i+2]>100&&d[i]<130&&d[i+2]<130)d[i+3]=0;}
    for(let p=0;p<n;p++){
      if(seen[p]||d[p*4+3]<32)continue;let head=0,tail=1;queue[0]=p;seen[p]=1;
      while(head<tail){const q=queue[head++],col=q%384;for(const next of[col?q-1:-1,col<383?q+1:-1,q-384,q+384])if(next>=0&&next<n&&!seen[next]&&d[next*4+3]>=32){seen[next]=1;queue[tail++]=next;}}
      if(tail>largest.length)largest=Array.from(queue.subarray(0,tail));
    }
    const keep=new Uint8Array(n);largest.forEach(p=>keep[p]=1);for(let p=0;p<n;p++)if(!keep[p])d[p*4+3]=0;
    ctx.putImageData(pixels,0,0);surface.refresh();
  });
}

/** Finite, pausable three-pose attack cut-in; no global clock or CSS animation. */
export class HeroCinematic{
  constructor(scene){this.scene=scene;this.dead=false;this.jobs=new Set();this.nodes=new Set();this.playing=false;}
  own(node){this.nodes.add(node);return node;}
  remove(node){this.nodes.delete(node);if(node?.active)node.destroy();}
  tween(targets,config){
    if(this.dead)return Promise.resolve();
    return new Promise(resolve=>{let complete=false;const job={handle:null,finish:()=>{if(complete)return;complete=true;this.jobs.delete(job);resolve();}};this.jobs.add(job);job.handle=this.scene.tweens.add({targets,...config,onComplete:job.finish});});
  }
  wait(ms){if(this.dead)return Promise.resolve();return new Promise(resolve=>{const job={handle:null,finish:()=>{this.jobs.delete(job);resolve();}};this.jobs.add(job);job.handle=this.scene.time.delayedCall(ms,job.finish);});}
  async play(type='hammer',count=1){
    if(this.dead||this.playing)return;this.playing=true;
    const s=this.scene,color=PALETTES[type]??PALETTES.hammer,reduced=s.reduced;
    const backdrop=this.own(s.add.rectangle(360,610,720,1220,0x06162a,0).setDepth(145));
    const layer=this.own(s.add.container(0,0).setDepth(160));
    const panel=s.add.graphics();panel.fillStyle(0x102a45,.97).fillPoints([{x:0,y:410},{x:720,y:318},{x:720,y:844},{x:0,y:920}],true);panel.lineStyle(5,color).lineBetween(0,410,720,318).lineBetween(0,920,720,844);layer.add(panel);
    const pattern=s.add.graphics();pattern.lineStyle(2,color,.15);for(let i=0;i<14;i++)pattern.lineBetween(-120+i*77,410,-330+i*77,900);layer.add(pattern);
    const halo=s.add.graphics();halo.lineStyle(5,color,.5).strokeCircle(0,0,184);halo.lineStyle(2,0xffffff,.28).strokeCircle(0,0,161);halo.setPosition(229,631);layer.add(halo);
    const hero=s.add.image(175,655,'ultimate-0').setScale(.77);layer.add(hero);
    const label=(x,y,text,size,tint)=>s.add.text(x,y,text,{fontFamily:'Microsoft YaHei, Arial, sans-serif',fontSize:`${size}px`,fontStyle:'bold',color:tint,stroke:'#08172a',strokeThickness:5}).setOrigin(.5);
    const kicker=label(492,514,type==='overdrive'?'OVERDRIVE AWAKENING':'SPECIAL CLEAR REWARD',17,'#cee4f4');
    const title=label(492,581,REWARD_NAMES[type],type==='overdrive'?36:45,'#fff1b3');
    const sub=label(492,636,type==='overdrive'?'15 秒 · 点击即爆':count>1?`${count} 枚核心 · 强化支援`:'核心破裂 · 支援已获得',21,'#def5ff');
    const stroke=s.add.rectangle(492,685,215,4,color);layer.add([kicker,title,sub,stroke]);
    const sparks=s.add.graphics();sparks.lineStyle(3,color,.8);for(let i=0;i<16;i++){const a=i*Math.PI/8;const r=90+(i%3)*40;sparks.lineBetween(230+Math.cos(a)*r,650+Math.sin(a)*r,230+Math.cos(a)*(r+75),650+Math.sin(a)*(r+75));}layer.addAt(sparks,2);
    if(reduced){backdrop.setAlpha(.18);hero.setTexture('ultimate-2');await this.wait(240);}else{
      layer.x=-760;await Promise.all([this.tween(layer,{x:0,duration:165,ease:'Cubic.Out'}),this.tween(backdrop,{alpha:.65,duration:140})]);if(this.dead)return;
      await this.tween(hero,{x:205,y:680,scale:.81,angle:-7,duration:110,ease:'Sine.In'});if(this.dead)return;
      hero.setTexture('ultimate-1').setAngle(0);await Promise.all([this.tween(hero,{x:227,y:564,scale:.91,duration:190,ease:'Cubic.Out'}),this.tween(halo,{angle:58,scale:1.14,duration:190})]);if(this.dead)return;
      await this.wait(75);if(this.dead)return;
      hero.setTexture('ultimate-2');await this.tween(hero,{x:248,y:699,scale:1.03,duration:95,ease:'Cubic.In'});if(this.dead)return;
      s.cameras.main.shake(95,.004);stroke.setScale(1.25,2);await this.wait(115);
    }
    if(!this.dead)await Promise.all([this.tween(layer,{x:reduced?0:760,alpha:0,duration:reduced?90:170,ease:'Cubic.In'}),this.tween(backdrop,{alpha:0,duration:190})]);
    this.remove(layer);this.remove(backdrop);this.playing=false;
  }
  destroy(){if(this.dead)return;this.dead=true;for(const job of[...this.jobs]){job.handle?.stop?.();job.handle?.remove?.(false);job.finish();}for(const node of[...this.nodes])this.remove(node);this.playing=false;}
}
