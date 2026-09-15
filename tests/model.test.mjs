import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { ROWS, COLS, createBoard, matches, legalMoves, buildTurn, buildToolTurn, buildRushTurn } from '../game/model.mjs';
import { planRewards, buildRewardTurn } from '../game/rewards.mjs';
import * as sessionAPI from '../game/session.mjs';
import * as worldAPI from '../game/world.mjs';
import * as storageAPI from '../game/session-storage.mjs';

function random(seed) {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
}
function freeze(board) { board.forEach(Object.freeze); return Object.freeze(board); }
function stable(board) {
  assert.equal(board.length, ROWS * COLS);
  assert.ok(board.every(cell => cell && cell.kind >= 0 && cell.kind < 6));
  assert.equal(new Set(board.map(cell => cell.id)).size, ROWS * COLS);
  assert.equal(matches(board).indices.length, 0);
  assert.ok(legalMoves(board).length > 0);
}
function audit(turn) {
  stable(turn.board);
  const counted = [0, 0, 0, 0, 0, 0];
  let points = 0;
  for (const frame of turn.frames) {
    assert.equal(frame.board.length, ROWS * COLS);
    const live = frame.board.filter(Boolean);
    assert.equal(new Set(live.map(cell => cell.id)).size, live.length);
    if (frame.type !== 'clear') assert.equal(live.length, ROWS * COLS);
    if (frame.type === 'clear') {
      assert.equal(new Set(frame.cleared.map(item => item.index)).size, frame.cleared.length);
      assert.equal(new Set(frame.activated.map(item => item.index)).size, frame.activated.length);
      for (const item of frame.cleared) { assert.equal(frame.board[item.index], null); counted[item.cell.kind]++; }
      for (const item of frame.created) assert.deepEqual(frame.board[item.index], item.cell);
      points += frame.score;
    }
  }
  assert.deepEqual(turn.cleared, counted);
  assert.equal(turn.score, points);
}
function boardWithPatch(patch) {
  // Freeze known local geometry while searching away unrelated initial matches.
  const rng = random(981);
  for (let attempt = 0; attempt < 500; attempt++) {
    const board = createBoard(rng);
    for (const [index, kind] of Object.entries(patch)) board[+index].kind = kind;
    if (!matches(board).indices.length) return board;
  }
  throw new Error('Fixture must start without existing matches.');
}

test('initial boards have unique IDs, no automatic matches and at least one real move', () => {
  for (let seed = 0; seed < 100; seed++) stable(createBoard(random(seed)));
  stable(createBoard(() => 0));
  stable(createBoard(() => 1));
});

test('valid swap resolves clears, records every score and leaves input/frame snapshots independent', () => {
  const rng = random(31);
  const board = freeze(createBoard(rng));
  const original = JSON.stringify(board);
  const { a, b } = legalMoves(board)[0];
  const turn = buildTurn(board, a, b, rng);
  assert.equal(turn.valid, true);
  assert.equal(turn.frames[0].type, 'swap');
  assert.ok(turn.cleared.reduce((a, b) => a + b) >= 3);
  audit(turn);
  const firstSnapshot = JSON.stringify(turn.frames[0]);
  turn.board[0].kind = (turn.board[0].kind + 1) % 6;
  assert.equal(JSON.stringify(turn.frames[0]), firstSnapshot);
  assert.equal(JSON.stringify(board), original);
});

test('invalid adjacent swaps visibly roll back and non-adjacent swaps do nothing', () => {
  const board = createBoard(random(59));
  const legal = new Set(legalMoves(board).map(({ a, b }) => `${a},${b}`));
  let pair;
  for (let a = 0; a < board.length - 1; a++) {
    if (a % COLS < COLS - 1 && !legal.has(`${a},${a + 1}`)) { pair = [a, a + 1]; break; }
  }
  const turn = buildTurn(freeze(board), ...pair, random(4));
  assert.equal(turn.valid, false);
  assert.deepEqual(turn.frames.map(frame => frame.type), ['swap', 'rollback']);
  assert.deepEqual(turn.board, board);
  assert.equal(turn.score, 0);
  assert.equal(buildTurn(board, 7, 8).valid, false);
  assert.equal(buildTurn(board, 0, 16).frames.length, 0);
  audit(turn);
});

test('four creates a line, five creates a nova, T intersection creates a bomb', () => {
  const cases = [
    { patch: { 24: 0, 25: 0, 26: 1, 27: 0, 18: 0, 23: 3, 28: 2 }, a: 18, b: 26, special: 'row' },
    { patch: { 24: 0, 25: 0, 26: 1, 27: 0, 28: 0, 18: 0, 29: 2 }, a: 18, b: 26, special: 'nova' },
    { patch: { 25: 0, 26: 1, 27: 0, 18: 0, 34: 0, 42: 0 }, a: 18, b: 26, special: 'bomb' },
  ];
  for (const { patch, a, b, special } of cases) {
    const board = boardWithPatch(patch);
    const turn = buildTurn(board, a, b, random(329));
    assert.equal(turn.valid, true);
    const firstClear = turn.frames.find(frame => frame.type === 'clear');
    assert.ok(firstClear.created.some(item => item.index === b && item.cell.special === special), special);
    assert.equal(firstClear.board[b].id, board[a].id);
    audit(turn);
  }
});

test('line + line swap creates a cross and recursively activates a remote bomb', () => {
  const board = createBoard(random(67));
  board[27].special = 'row';
  board[28].special = 'row';
  board[52].special = 'bomb';
  const turn = buildTurn(board, 27, 28, random(8));
  const clear = turn.frames.find(frame => frame.type === 'clear');
  const indices = new Set(clear.cleared.map(item => item.index));
  for (let c = 0; c < COLS; c++) assert.ok(indices.has(24 + c));
  for (let r = 0; r < ROWS; r++) assert.ok(indices.has(r * COLS + 4));
  assert.ok(clear.activated.some(item => item.index === 52 && item.special === 'bomb'));
  assert.ok(indices.has(51) && indices.has(53));
  audit(turn);
});

test('nova + color clears that color; nova + line activates each target color; nova pair clears all', () => {
  for (const partnerSpecial of [null, 'column', 'nova']) {
    const board = createBoard(random(119));
    board[27].special = 'nova';
    board[28].special = partnerSpecial;
    const targetKind = board[28].kind;
    const turn = buildTurn(board, 27, 28, random(201));
    const clear = turn.frames.find(frame => frame.type === 'clear');
    const indices = new Set(clear.cleared.map(item => item.index));
    const swapped = turn.frames[0].board;
    for (let i = 0; i < swapped.length; i++) if (swapped[i].kind === targetKind) assert.ok(indices.has(i));
    if (partnerSpecial === 'nova') assert.equal(indices.size, 72);
    if (partnerSpecial === 'column') assert.ok(clear.activated.filter(item => item.special === 'column').length > 1);
    audit(turn);
  }
});

test('bomb combinations expand beyond an ordinary single blast', () => {
  for (const special of ['bomb', 'row']) {
    const board = createBoard(random(532));
    board[27].special = 'bomb';
    board[28].special = special;
    const turn = buildTurn(board, 27, 28, random(76));
    const clear = turn.frames.find(frame => frame.type === 'clear');
    assert.ok(clear.cleared.length >= 25);
    audit(turn);
  }
});

test('tools and rush resolve exact first-hit shapes; shuffle preserves cells and specials', () => {
  const rng = random(321);
  const board = freeze(createBoard(rng));
  for (const [tool, index, count] of [['hammer', 27, 1], ['bomb', 27, 9], ['bomb', 0, 4]]) {
    const turn = buildToolTurn(board, index, tool, rng);
    assert.equal(turn.valid, true);
    assert.equal(turn.frames[0].cleared.length, count);
    audit(turn);
  }
  const rush = buildRushTurn(board, 27, rng);
  assert.equal(rush.frames[0].cleared.length, 9);
  audit(rush);
  const specialBoard = createBoard(rng);
  specialBoard[21].special = 'nova';
  specialBoard[43].special = 'row';
  const shuffled = buildToolTurn(freeze(specialBoard), -1, 'shuffle', rng);
  assert.deepEqual(shuffled.board.slice().sort((a, b) => a.id.localeCompare(b.id)), specialBoard.slice().sort((a, b) => a.id.localeCompare(b.id)));
  audit(shuffled);
  assert.equal(buildToolTurn(board, -1, 'hammer').valid, false);
});

test('cascades are sequential, refill gravity preserves surviving column order, and pathological RNG terminates', () => {
  const rng = random(1002);
  let board = createBoard(rng);
  let cascading;
  for (let attempt = 0; attempt < 100; attempt++) {
    const { a, b } = legalMoves(board)[0];
    const turn = buildTurn(board, a, b, rng);
    if (turn.combo >= 2) { cascading = turn; break; }
    board = turn.board;
  }
  assert.ok(cascading, 'Expected a natural cascade in seeded play');
  const clears = cascading.frames.filter(frame => frame.type === 'clear');
  assert.deepEqual(clears.map(frame => frame.chain), Array.from({ length: clears.length }, (_, i) => i + 1));
  for (let i = 0; i < cascading.frames.length - 1; i++) {
    const clear = cascading.frames[i];
    if (clear.type !== 'clear') continue;
    const fall = cascading.frames[i + 1];
    assert.equal(fall.type, 'fall');
    for (let c = 0; c < COLS; c++) {
      const survivors = Array.from({ length: ROWS }, (_, r) => clear.board[r * COLS + c]).filter(Boolean).map(cell => cell.id);
      const settled = Array.from({ length: survivors.length }, (_, r) => fall.board[(ROWS - survivors.length + r) * COLS + c].id);
      assert.deepEqual(settled, survivors);
    }
  }
  audit(cascading);
  const pathological = buildRushTurn(createBoard(random(2)), 27, () => 0);
  assert.ok(pathological.frames.length <= 49);
  audit(pathological);
});

test('1000 seeded moves maintain stable playable boards, accounting and snapshot immutability', () => {
  const rng = random(0xa48c01);
  let board = createBoard(rng);
  for (let index = 0; index < 1000; index++) {
    const before = JSON.stringify(board);
    freeze(board);
    let turn;
    if (index % 37 === 0) turn = buildRushTurn(board, Math.floor(rng() * 72), rng);
    else if (index % 19 === 0) turn = buildToolTurn(board, Math.floor(rng() * 72), 'bomb', rng);
    else if (index % 13 === 0) turn = buildToolTurn(board, -1, 'shuffle', rng);
    else {
      const moves = legalMoves(board);
      const move = moves[Math.floor(rng() * moves.length)];
      turn = buildTurn(board, move.a, move.b, rng);
    }
    assert.equal(turn.valid, true);
    assert.equal(JSON.stringify(board), before);
    audit(turn);
    board = turn.board;
  }
});

test('every ordered special pair resolves once per activated cell and remains playable', () => {
  const specials = ['row', 'column', 'bomb', 'nova'];
  for (const first of specials) for (const second of specials) {
    const board = createBoard(random(3701));
    board[27].special = first;
    board[28].special = second;
    const turn = buildTurn(freeze(board), 27, 28, random(447));
    assert.equal(turn.valid, true, `${first} + ${second}`);
    const clear = turn.frames.find(frame => frame.type === 'clear');
    assert.ok(clear.cleared.some(item => item.index === 27));
    assert.ok(clear.cleared.some(item => item.index === 28));
    assert.ok(clear.activated.some(item => item.index === 27 && item.special === second));
    assert.ok(clear.activated.some(item => item.index === 28 && item.special === first));
    assert.equal(new Set(clear.activated.map(item => item.index)).size, clear.activated.length);
    audit(turn);
  }
});

test('nova + ordinary tile clears exactly its target color plus the nova, in either swap order', () => {
  for (const novaIndex of [27, 28]) {
    const board = createBoard(random(829));
    board[novaIndex].special = 'nova';
    const targetKind = board[novaIndex === 27 ? 28 : 27].kind;
    const turn = buildTurn(board, 27, 28, random(671));
    const swapped = turn.frames[0].board;
    const expected = swapped.flatMap((cell, index) => cell.kind === targetKind || cell.special === 'nova' ? [index] : []);
    assert.deepEqual(turn.frames.find(frame => frame.type === 'clear').cleared.map(item => item.index), expected);
    audit(turn);
  }
});

test('four vertical cells create a column special and shuffling repairs a known deadlock', () => {
  const board = boardWithPatch({ 10: 0, 18: 0, 26: 1, 34: 0, 25: 0, 2: 2, 42: 2 });
  const turn = buildTurn(board, 25, 26, random(120));
  assert.ok(turn.frames.find(frame => frame.type === 'clear').created.some(item => item.index === 26 && item.cell.special === 'column'));
  audit(turn);
  const deadlock = Array.from({ length: 72 }, (_, index) => ({ id: `deadlock-${index}`, kind: (Math.floor(index / 8) * 2 + index % 8) % 6, special: null }));
  assert.equal(matches(deadlock).indices.length, 0);
  assert.equal(legalMoves(deadlock).length, 0);
  const repaired = buildToolTurn(freeze(deadlock), 0, 'shuffle', random(977));
  assert.equal(repaired.frames[0].type, 'shuffle');
  audit(repaired);
  assert.deepEqual(repaired.board.map(cell => cell.id).sort(), deadlock.map(cell => cell.id).sort());
});

// Actual endless scene methods; rendering and browser boundaries are inert.
function sceneHarness(seed = 516) {
  const app={dataset:{}},storage=new Map();
  const source=readFileSync(new URL('../game/scene.mjs',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'').replace('export class ForestScene','class ForestScene');
  const ForestScene=vm.runInNewContext(source+'\nForestScene;',{
    Phaser:{Scene:class{},Math:{Between:a=>a}},createBoard,buildTurn,buildToolTurn,buildRushTurn,legalMoves,COLS,planRewards,buildRewardTurn,
    ...sessionAPI,...worldAPI,...storageAPI,obstacleImpact(){},decorateObstacle(){},
    REWARD_NAMES:{hammer:'重锤',drone:'轰炸',rift:'裂隙',overdrive:'觉醒'},TRACKS:Array.from({length:10},()=>({name:'track'})),
    Date,performance:{now:()=>app.tick??0},clearInterval(){},setInterval(){return 1;},
    document:{getElementById:id=>id==='app'?app:{textContent:''}},
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
  });
  const scene=new ForestScene();
  const visual=()=>({active:true,setText(){return this;},setColor(){return this;},setVisible(){return this;},setTexture(){return this;},setDepth(){return this;},setDisplaySize(){return this;},setPosition(){return this;},setScale(){return this;},destroy(){this.active=false;}});
  Object.assign(scene,{
    alive:true,state:'idle',session:sessionAPI.createSession(Date.now()),board:createBoard(random(seed)),nodes:new Map(),ice:new Set(),iceNodes:new Map(),progress:[0,0],
    moves:0,score:0,best:0,energy:0,rushRemaining:0,rushQueue:[],selected:null,worldDropsAt:0,phase:worldAPI.worldPhase(0),leaderboard:[],
    runId:1,pendingRewards:[],rewardStats:{hammer:0,drone:0,rift:0},turnSource:'player',turnCinematicShown:false,completing:false,
    reduced:true,lastAction:0,lastBlink:0,hintNodes:[],track:-1,rewardAttacks:[],cinematicCalls:[],resultCalls:[],
    cellButtons:Array.from({length:72},()=>({dataset:{}})),selection:visual(),movesText:visual(),scoreText:visual(),clockLabel:visual(),phaseText:visual(),
    fx:{burst(){},floatText(){},collect(){},beam(){},bomb(){},nova(){},obstacleRelease(){},destroy(){},celebrate(){},rushBeat(){},async windup(){},async rewardAttack(type,targets,impact){scene.rewardAttacks.push({type,targets});impact?.();}},
    cinematic:{async play(type,count){scene.cinematicCalls.push({type,count});},destroy(){}},
    audio:{tap(){},swap(){},clear(){},collect(){},stopRush(){},startRush(){},suspend(){},resume(){},cinematic(){},rewardCharge(){},rewardImpact(){},destroy(){}},
    stageHero:visual(),rewardTitle:visual(),rewardDetail:visual(),cameras:{main:{shake(){}}},tweens:{add(){},killTweensOf(){}},
    time:{now:200,delayedCall(_ms,fn){fn();}},root:{replaceChildren(){},querySelector(){return {onclick:null};}},a11y:{inert:false},
    scene:{pause(){},resume(){},restart(){}},async delay(){},async tween(){},clearHint(){},say(text){this.message=text;},showPause(){},applyWorldTheme(){},
    updateHUD(){this.syncAccessibility();},async moveFrame(board){this.board=board;},decorate(){},
    makeTile(cell,index){const n=Object.assign(visual(),{cell,index,icon:visual()});this.nodes.set(cell.id,n);return n;},
    showResult(){this.resultCalls.push({score:this.score,state:this.state,session:this.session});},showDialog(html){this.dialog=html;},
  });
  return {scene,app,storage};
}

test('rush uses actual monotonic elapsed time even when frames arrive at 5 FPS',async()=>{
  const {scene,app}=sceneHarness();scene.energy=100;await scene.startRush();
  let completions=0;scene.completeTurn=()=>{completions++;};
  for(let i=1;i<=25;i++){app.tick=i*200;scene.update(i*200,100);}
  assert.equal(scene.rushRemaining,0);assert.equal(completions,1);
});

test('paused time does not consume the five second rush on resume',async()=>{
  const {scene,app}=sceneHarness();scene.energy=100;await scene.startRush();
  app.tick=1000;scene.update(1000,100);assert.equal(scene.rushRemaining,4000);
  scene.pauseGame();app.tick=91000;scene.resumeGame();app.tick=91500;scene.update(1500,100);
  assert.equal(scene.rushRemaining,3500);
});

test('endless scene counts valid moves upward and never wins from old goal totals',async()=>{
  const {scene}=sceneHarness();scene.progress=[999,999];scene.moves=0;const m=legalMoves(scene.board)[0];
  await scene.playTurn(buildTurn(scene.board,m.a,m.b,random(427)),true);
  assert.equal(scene.moves,1);assert.equal(scene.session.moves,1);assert.ok(scene.score>0);assert.equal(scene.resultCalls.length,0);
  assert.ok(['idle','rush'].includes(scene.state));scene.finishCheck();assert.equal(scene.resultCalls.length,0);
});
test('invalid swaps grant no points, energy or operation progression',async()=>{
  const {scene}=sceneHarness(113);const keys=new Set(legalMoves(scene.board).map(m=>m.a+','+m.b));
  const a=scene.board.findIndex((_,i)=>i%8<7&&!keys.has(i+','+(i+1)));
  await scene.playTurn(buildTurn(scene.board,a,a+1),true);assert.equal(scene.score,0);assert.equal(scene.moves,0);assert.equal(scene.energy,0);assert.equal(scene.state,'idle');
});
test('five-second automatic awakening follows full player energy, without a button',async()=>{
  const {scene}=sceneHarness();scene.energy=100;await scene.completeTurn();assert.equal(scene.state,'rush');assert.equal(scene.rushRemaining,5000);assert.equal(scene.energy,0);
  assert.ok(scene.cinematicCalls.some(c=>c.type==='overdrive'));assert.equal(scene.resultCalls.length,0);
});
test('earned support clears award reduced score but do not recursively charge or award',async()=>{
  const {scene}=sceneHarness();scene.pendingRewards=[{type:'hammer',count:2,origin:27},{type:'drone',count:1,origin:35}];scene.energy=21;
  await scene.completeTurn();assert.equal(scene.state,'idle');assert.equal(scene.pendingRewards.length,0);assert.equal(scene.rewardStats.hammer,2);assert.equal(scene.rewardStats.drone,1);
  assert.equal(scene.rewardAttacks.length,2);assert.equal(scene.moves,0);assert.equal(scene.energy,21);assert.ok(scene.score>0);assert.equal(scene.resultCalls.length,0);stable(scene.board);
});
test('rush input is capped and its five-second clock freezes while paused',()=>{
  const {scene}=sceneHarness();scene.state='resolving';scene.rushRemaining=5000;for(let i=0;i<50;i++)scene.queueRush(i%72);assert.equal(scene.rushQueue.length,6);
  scene.pauseGame();scene.update(300,90);assert.equal(scene.rushRemaining,5000);assert.equal(scene.state,'paused');scene.resumeGame();assert.equal(scene.state,'resolving');
});
test('rush support waits until expiration, then settles on a full board',async()=>{
  const {scene}=sceneHarness();scene.board[27].special='row';scene.state='rush';scene.rushRemaining=3000;
  await scene.playTurn(buildRushTurn(scene.board,27,random(551)),false,true,'rush');assert.ok(scene.pendingRewards.length);assert.equal(scene.rewardAttacks.length,0);assert.equal(scene.moves,0);assert.equal(scene.energy,0);
  scene.rushRemaining=0;await scene.completeTurn();assert.equal(scene.pendingRewards.length,0);assert.ok(scene.rewardAttacks.length);assert.equal(scene.state,'idle');stable(scene.board);
});
test('expiry during a clear rejects subsequent points and locks the final local record',async()=>{
  const {scene}=sceneHarness();const m=legalMoves(scene.board)[0];await scene.playTurn(buildTurn(scene.board,m.a,m.b),true);const points=scene.score;
  scene.session={...scene.session,startedAt:Date.now()-sessionAPI.SESSION_LIMIT_MS-1000,deadline:Date.now()-1000,lastSeenAt:Date.now()-2000};
  scene.session.deadline=scene.session.startedAt+sessionAPI.SESSION_LIMIT_MS;scene.state='paused';scene.checkClock();
  assert.equal(scene.state,'finished');assert.equal(scene.alive,false);assert.equal(scene.score,points);assert.equal(scene.resultCalls.length,1);assert.equal(scene.leaderboard.length,1);
  scene.endRun('timeout');assert.equal(scene.leaderboard.length,1);assert.equal(scene.resultCalls.length,1);
});
test('manual settlement keeps the exact score without old remaining-step bonuses',async()=>{
  const {scene}=sceneHarness();const m=legalMoves(scene.board)[0];await scene.playTurn(buildTurn(scene.board,m.a,m.b),true);const points=scene.score;
  scene.endRun('banked');assert.equal(scene.score,points);assert.equal(scene.session.reason,'banked');assert.equal(scene.leaderboard[0].score,points);assert.equal(scene.rushRemaining,0);
});
test('stable save preserves the board, obstacle HP, score and fixed deadline',async()=>{
  const {scene,storage}=sceneHarness();scene.board[43]={id:'rock-test',kind:-1,special:null,obstacle:'rock',hp:2};scene.saveProgress();
  const restored=sessionAPI.parseCheckpoint(storage.get('tata-endless-v5-save'),Date.now());assert.ok(restored);assert.equal(restored.board[43].hp,2);assert.equal(restored.session.deadline,scene.session.deadline);
  scene.state='resolving';scene.board[0]=null;scene.saveProgress();assert.equal(sessionAPI.parseCheckpoint(storage.get('tata-endless-v5-save'),Date.now()).board[0].kind>=0,true);
});
test('world drops happen at most once per effective player move and rotate six phases',async()=>{
  const {scene}=sceneHarness();for(let i=0;i<3;i++)scene.session=sessionAPI.recordMove(scene.session);scene.moves=3;await scene.advanceWorld();
  const first=JSON.stringify(scene.board);assert.ok(scene.board.some(c=>c.obstacle));await scene.advanceWorld();assert.equal(JSON.stringify(scene.board),first);
  scene.moves=12;await scene.advanceWorld();assert.equal(scene.phase.index,1);
});
test('obstacle hit rendering does not access a wolf-minus-one icon or old collection goals',async()=>{
  const {scene}=sceneHarness();scene.board[27]={id:'rock-x',kind:-1,special:null,obstacle:'rock',hp:3};const t=buildToolTurn(scene.board,27,'bomb',random(731));
  await scene.playTurn(t,false,false,'reward');assert.equal(scene.board.find(c=>c.id==='rock-x').hp,2);assert.ok(scene.score>0);
});
test('hero stage retains only top pause and help hit targets',()=>{
  const {scene}=sceneHarness();const v=()=>({setDepth(){return this;},setDisplaySize(){return this;}});scene.add={ellipse:v,image:v};scene.text=v;scene.drawGlyph=()=>{};
  const hits=[];scene.addHit=(label,x,y)=>hits.push({label,x,y});scene.drawControls();assert.deepEqual(hits.map(h=>h.label),['暂停与设置','玩法说明']);assert.ok(hits.every(h=>h.y<100));assert.equal(scene.chooseTool,undefined);
});
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
test('old clear callbacks cannot replace a new board or add points after run invalidation',async()=>{
  const {scene}=sceneHarness();const m=legalMoves(scene.board)[0],f=buildTurn(scene.board,m.a,m.b).frames.find(f=>f.type==='clear');const gate=deferred();scene.delay=()=>gate.promise;
  const clearing=scene.clearFrame(f,true),board=createBoard(random(321));scene.runId++;scene.board=board;scene.score=0;scene.state='intro';gate.resolve();await clearing;assert.equal(scene.board,board);assert.equal(scene.score,0);assert.equal(scene.state,'intro');
});
test('cancelled reward cinematic cannot start attacks in a new run',async()=>{
  const {scene}=sceneHarness();scene.pendingRewards=[{type:'hammer',count:1,origin:27}];const gate=deferred();scene.cinematic.play=()=>gate.promise;
  const pending=scene.completeTurn();scene.runId++;scene.state='intro';scene.completing=false;scene.pendingRewards=[];scene.turnCinematicShown=false;gate.resolve();await pending;
  assert.equal(scene.state,'intro');assert.equal(scene.rewardAttacks.length,0);assert.equal(scene.completing,false);
});
test('restart invalidates pending promises before queued Phaser scene creation',()=>{
  const {scene}=sceneHarness();const run=scene.runId;let queued=false;scene.scene.restart=()=>queued=true;scene.restart();assert.ok(queued);assert.ok(!scene.alive&&scene.runId>run);
});
