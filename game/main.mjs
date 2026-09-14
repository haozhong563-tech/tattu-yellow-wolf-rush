import Phaser from 'phaser';
import { ForestScene } from './scene.mjs';
import './ui.css';

const game = new Phaser.Game({type:Phaser.AUTO,parent:'game',width:720,height:1220,transparent:true,antialias:true,roundPixels:false,powerPreference:'high-performance',scale:{mode:Phaser.Scale.FIT,autoCenter:Phaser.Scale.CENTER_BOTH},fps:{target:60},input:{activePointers:3},scene:[ForestScene],audio:{noAudio:true}});
const showError = () => {
  const host=document.getElementById('overlay-root');
  if(!host.querySelector('.error-panel')){host.innerHTML='<div class="error-panel"><h2>森林正在重新连接</h2><p>游戏资源未加载完整，请刷新后继续。</p><button>重新加载</button></div>';host.querySelector('button').onclick=()=>location.reload();}
};
window.addEventListener('error',event=>{if(event.message&&/phaser|scene|model|Cannot|undefined/i.test(event.message)){console.error('Game error',event.error);showError();}});
window.addEventListener('unhandledrejection',event=>{console.error('Game promise error',event.reason);showError();});
window.addEventListener('pagehide',()=>game.scene.getScene('forest')?.audio?.suspend());
document.addEventListener('visibilitychange',()=>{if(document.hidden)game.scene.getScene('forest')?.pauseGame();});
