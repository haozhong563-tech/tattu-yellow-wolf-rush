import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { ROWS, COLS, createBoard, matches, legalMoves, buildTurn, buildToolTurn, buildRushTurn } from '../game/model.mjs';
import { planRewards, buildRewardTurn } from '../game/rewards.mjs';

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

// Load the actual scene class with an inert Phaser base. The tested methods run
// unchanged; only graphics/audio/DOM boundaries are replaced with small stubs.
function sceneHarness(seed = 516) {
  const app = { dataset: {} };
  const storage = new Map();
  const source = readFileSync(new URL('../game/scene.mjs', import.meta.url), 'utf8')
    .replace(/^import[^\n]*\n/gm, '')
    .replace('export class ForestScene', 'class ForestScene');
  const ForestScene = vm.runInNewContext(`${source}\nForestScene;`, {
    Phaser: { Scene: class {}, Math: { Between: (a) => a } },
    createBoard, buildTurn, buildToolTurn, buildRushTurn, legalMoves, COLS, planRewards, buildRewardTurn,
    REWARD_NAMES: { hammer: '塔塔重锤', drone: '无人机蜂群', rift: '时空裂隙', overdrive: '觉醒' },
    TRACKS: Array.from({ length: 10 }, (_, index) => ({ name: `Track ${index}` })),
    document: { getElementById: id => id === 'app' ? app : { textContent: '' } },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  });
  const scene = new ForestScene();
  const visual = () => ({ setText() { return this; }, setColor() { return this; }, setVisible() { return this; }, setTexture() { return this; }, setDepth() { return this; }, setDisplaySize() { return this; } });
  Object.assign(scene, {
    alive: true, state: 'idle', board: createBoard(random(seed)), nodes: new Map(), ice: new Set(), iceNodes: new Map(), progress: [0, 0],
    moves: 30, score: 0, best: 0, energy: 0, rushRemaining: 0, rushQueue: [], selected: null,
    runId: 1, pendingRewards: [], rewardStats: { hammer: 0, drone: 0, rift: 0 }, turnSource: 'player', turnCinematicShown: false, completing: false,
    reduced: true, lastAction: 0, lastBlink: 0, hintNodes: [], track: -1, rewardAttacks: [], cinematicCalls: [],
    cellButtons: Array.from({ length: 72 }, () => ({ dataset: {} })),
    selection: visual(), movesText: visual(), scoreText: visual(), goalTexts: [visual(), visual(), visual()],
    fx: { burst() {}, floatText() {}, collect() {}, beam() {}, bomb() {}, nova() {}, celebrate() {}, rushBeat() {}, async windup() {}, async rewardAttack(type, targets, impact) { scene.rewardAttacks.push({ type, targets }); impact?.(); } },
    cinematic: { async play(type, count) { scene.cinematicCalls.push({ type, count }); }, destroy() {} },
    audio: { swap() {}, clear() {}, collect() {}, stopRush() {}, startRush() {}, suspend() {}, resume() {}, win() {}, lose() {}, cinematic() {}, rewardCharge() {}, rewardImpact() {}, destroy() {} },
    stageHero: visual(), rewardTitle: visual(), rewardDetail: visual(),
    cameras: { main: { shake() {} } }, tweens: { add() {}, killTweensOf() {} },
    time: { now: 200, delayedCall(_ms, callback) { callback(); } },
    root: { replaceChildren() {}, querySelector() { return {}; } }, a11y: { inert: false },
    scene: { pause() {}, resume() {}, restart() {} }, resultCalls: [],
    async delay() {}, async tween() {}, clearHint() {}, say(message) { this.message = message; }, showPause() {},
    updateHUD() { this.syncAccessibility(); },
    async moveFrame(board) { this.board = board; },
    async showResult(win) { this.resultCalls.push({ win, moves: this.moves, score: this.score, boardFull: this.board.every(Boolean), pendingRewards: this.pendingRewards.length, rewardStats: { ...this.rewardStats } }); },
    showDialog(html) { this.dialog = html; },
  });
  return { scene, app };
}

test('scene counts every cascade before deciding victory on the final allowed move', async () => {
  const { scene } = sceneHarness();
  const rng = random(427);
  let turn;
  for (let attempt = 0; attempt < 100; attempt++) {
    const move = legalMoves(scene.board)[0];
    turn = buildTurn(scene.board, move.a, move.b, rng);
    if (turn.combo > 1) break;
    scene.board = turn.board;
  }
  assert.ok(turn.combo > 1);
  const clearFrames = turn.frames.filter(frame => frame.type === 'clear');
  const lastClear = clearFrames.at(-1);
  const earlier = new Set(clearFrames.slice(0, -1).flatMap(frame => frame.cleared.map(item => item.index)));
  const finalIce = lastClear.cleared.find(item => !earlier.has(item.index)) ?? lastClear.cleared[0];
  scene.ice = new Set([finalIce.index]);
  scene.progress = [18, 18];
  scene.moves = 1;
  await scene.playTurn(turn, true);
  assert.equal(scene.moves, 0);
  assert.equal(scene.score, turn.score);
  assert.equal(scene.state, 'won');
  assert.equal(scene.resultCalls.length, 1);
  assert.equal(scene.resultCalls[0].win, true);
  assert.equal(scene.resultCalls[0].boardFull, true);
  assert.deepEqual(scene.progress, [18 + turn.cleared[0], 18 + turn.cleared[1]]);
  stable(scene.board);
  scene.finishCheck();
  assert.equal(scene.resultCalls.length, 1, 'A completed result must not be issued twice');
});

test('scene leaves the last move intact after rollback and loses only after a valid unresolved move', async () => {
  const { scene } = sceneHarness(113);
  scene.moves = 1;
  const legal = legalMoves(scene.board);
  const legalKeys = new Set(legal.map(move => `${move.a},${move.b}`));
  const invalidA = scene.board.findIndex((_, a) => a % 8 < 7 && !legalKeys.has(`${a},${a + 1}`));
  await scene.playTurn(buildTurn(scene.board, invalidA, invalidA + 1), true);
  assert.equal(scene.moves, 1);
  assert.equal(scene.state, 'idle');
  assert.equal(scene.resultCalls.length, 0);
  scene.ice = new Set(Array.from({ length: 72 }, (_, index) => index));
  const move = legalMoves(scene.board)[0];
  await scene.playTurn(buildTurn(scene.board, move.a, move.b, random(654)), true);
  assert.equal(scene.moves, 0);
  assert.equal(scene.state, 'lost');
  assert.equal(scene.resultCalls[0].win, false);
  stable(scene.board);
});

test('rush expiry during an in-flight clear waits for settlement and drops queued taps', async () => {
  const { scene } = sceneHarness(879);
  scene.state = 'resolving';
  scene.rushRemaining = 20;
  scene.rushQueue = [20, 21];
  const full = scene.board;
  scene.board = scene.board.map((cell, index) => index === 0 ? null : cell);
  scene.update(200, 40);
  assert.equal(scene.rushRemaining, 0);
  assert.equal(scene.rushQueue.length, 0);
  assert.equal(scene.state, 'resolving');
  assert.equal(scene.resultCalls.length, 0);
  scene.board = full;
  scene.progress = [18, 18];
  scene.moves = 7;
  const turn = buildRushTurn(scene.board, 27, random(871));
  await scene.playTurn(turn, false, true);
  assert.equal(scene.moves, 7, 'Rush taps must not consume moves');
  assert.equal(scene.state, 'won');
  assert.equal(scene.resultCalls.length, 1);
  assert.equal(scene.resultCalls[0].boardFull, true);
  stable(scene.board);
});

test('rush queues bounded input without reading an incomplete board and pause preserves its timer', () => {
  const { scene } = sceneHarness();
  scene.state = 'resolving';
  scene.rushRemaining = 5000;
  const full = scene.board;
  scene.board = Array(72).fill(null);
  for (let index = 0; index < 20; index++) scene.queueRush(index);
  assert.equal(scene.rushQueue.length, 6);
  scene.board = full;
  scene.state = 'rush';
  scene.pauseGame();
  assert.equal(scene.state, 'paused');
  scene.update(200, 1000);
  assert.equal(scene.rushRemaining, 5000);
  scene.resumeGame();
  assert.equal(scene.state, 'rush');
  assert.equal(scene.rushRemaining, 5000);
});

test('pause and resume are safe while the current animation snapshot has empty cells', () => {
  const { scene } = sceneHarness();
  scene.state = 'resolving';
  scene.board[0] = null;
  assert.doesNotThrow(() => scene.pauseGame());
  assert.equal(scene.state, 'paused');
  assert.equal(scene.cellButtons[0].disabled, true);
  assert.doesNotThrow(() => scene.resumeGame());
  assert.equal(scene.state, 'resolving');
});

test('victory step bonus is reflected in accessible score as well as the result dialog', async () => {
  const { scene, app } = sceneHarness();
  delete scene.showResult;
  scene.state = 'won';
  scene.score = 1000;
  scene.moves = 4;
  await scene.showResult(true);
  assert.equal(scene.score, 1240);
  assert.equal(app.dataset.score, '1240');
  assert.ok(scene.dialog.includes('1,240'));
});

test('completeTurn drains every earned reward before declaring victory, without consuming moves or charging energy', async () => {
  const { scene } = sceneHarness(423);
  scene.progress = [18, 18];
  scene.ice = new Set([27]);
  scene.moves = 12;
  scene.energy = 35;
  scene.pendingRewards = [{ type: 'hammer', count: 1, origin: 27 }, { type: 'drone', count: 1, origin: 43 }];
  await scene.completeTurn();
  assert.equal(scene.state, 'won');
  assert.equal(scene.pendingRewards.length, 0);
  assert.deepEqual(scene.rewardStats, { hammer: 1, drone: 1, rift: 0 });
  assert.equal(scene.rewardAttacks.length, 2);
  assert.equal(scene.cinematicCalls.length, 1, 'A grouped turn should not repeat its character entrance');
  assert.equal(scene.moves, 12);
  assert.equal(scene.energy, 35);
  assert.equal(scene.resultCalls.length, 1);
  assert.equal(scene.resultCalls[0].pendingRewards, 0);
  assert.deepEqual(scene.resultCalls[0].rewardStats, { hammer: 1, drone: 1, rift: 0 });
  assert.ok(scene.score > 0);
  assert.equal(scene.completing, false);
  stable(scene.board);
});

test('an earned attack can trigger a nova without recursively earning another reward', async () => {
  const { scene } = sceneHarness(443);
  scene.board[27].special = 'nova';
  scene.ice = new Set([27, 35]);
  scene.progress = [18, 18];
  scene.moves = 11;
  scene.energy = 21;
  scene.pendingRewards = [{ type: 'hammer', count: 1, origin: 27 }];
  const executed = [];
  const realPlayTurn = scene.playTurn.bind(scene);
  scene.playTurn = async (turn, consume, fast, source) => { executed.push({ turn, source }); return realPlayTurn(turn, consume, fast, source); };
  await scene.completeTurn();
  assert.equal(executed.length, 1);
  assert.equal(executed[0].source, 'reward');
  assert.ok(executed[0].turn.frames.some(frame => frame.activated?.some(item => item.special === 'nova')));
  assert.equal(scene.pendingRewards.length, 0);
  assert.deepEqual(scene.rewardStats, { hammer: 1, drone: 0, rift: 0 });
  assert.equal(scene.energy, 21);
  assert.equal(scene.moves, 11);
  assert.equal(scene.state, 'won');
  stable(scene.board);
});

test('rush earns support during taps but queues it until the timer expires', async () => {
  const { scene } = sceneHarness(302);
  scene.board[27].special = 'row';
  scene.state = 'rush';
  scene.rushRemaining = 5000;
  scene.ice = new Set(Array.from({ length: 72 }, (_, index) => index));
  scene.moves = 9;
  const turn = buildRushTurn(scene.board, 27, random(551));
  const earned = planRewards(turn, { source: 'rush' });
  assert.ok(earned.length > 0);
  await scene.playTurn(turn, false, true, 'rush');
  assert.equal(scene.state, 'rush');
  assert.deepEqual(JSON.parse(JSON.stringify(scene.pendingRewards)), earned);
  assert.equal(scene.rewardAttacks.length, 0);
  assert.equal(scene.cinematicCalls.length, 0);
  assert.equal(scene.energy, 0, 'Rush clears must not refill their own energy meter');
  assert.equal(scene.moves, 9);
  const realCompleteTurn = scene.completeTurn.bind(scene);
  let completion;
  scene.completeTurn = (...args) => (completion = realCompleteTurn(...args));
  scene.rushRemaining = 1;
  scene.update(5010, 2);
  assert.ok(completion);
  await completion;
  assert.equal(scene.pendingRewards.length, 0);
  for (const reward of earned) assert.equal(scene.rewardStats[reward.type], reward.count);
  assert.equal(scene.rewardAttacks.length, earned.length);
  assert.equal(scene.rushRemaining, 0);
  assert.equal(scene.energy, 0);
  assert.equal(scene.moves, 9);
  assert.ok(['idle', 'won'].includes(scene.state));
  stable(scene.board);
});

test('a final move that fills energy gets automatic overdrive before defeat is checked', async () => {
  const { scene } = sceneHarness(929);
  scene.moves = 1;
  scene.energy = 99;
  scene.ice = new Set(Array.from({ length: 72 }, (_, index) => index));
  const move = legalMoves(scene.board)[0];
  await scene.playTurn(buildTurn(scene.board, move.a, move.b, random(762)), true);
  assert.equal(scene.moves, 0);
  assert.ok(scene.ice.size > 0);
  assert.equal(scene.state, 'rush');
  assert.equal(scene.rushRemaining, 15000);
  assert.equal(scene.energy, 0);
  assert.equal(scene.resultCalls.length, 0);
  assert.ok(scene.cinematicCalls.some(call => call.type === 'overdrive'));
  const realCompleteTurn = scene.completeTurn.bind(scene);
  let completion;
  scene.completeTurn = (...args) => (completion = realCompleteTurn(...args));
  scene.rushRemaining = 1;
  scene.update(200, 2);
  await completion;
  assert.equal(scene.state, 'lost');
  assert.equal(scene.resultCalls.length, 1);
  assert.equal(scene.resultCalls[0].win, false);
});

test('the hero stage has only top pause/help hits and no free bottom inventory buttons', () => {
  const { scene } = sceneHarness();
  const visual = () => ({ setDepth() { return this; }, setDisplaySize() { return this; } });
  scene.add = { ellipse: visual, image: visual };
  scene.text = visual;
  scene.drawGlyph = () => {};
  const hits = [];
  scene.addHit = (label, x, y, width, height) => hits.push({ label, x, y, width, height });
  scene.drawControls();
  assert.deepEqual(hits.map(hit => hit.label), ['暂停与设置', '玩法说明']);
  assert.ok(hits.every(hit => hit.y < 100));
  assert.equal('tools' in scene, false);
  assert.equal(typeof scene.chooseTool, 'undefined');
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('clearFrame cannot write an old null snapshot after a new run starts', async () => {
  const { scene } = sceneHarness(732);
  const move = legalMoves(scene.board)[0];
  const frame = buildTurn(scene.board, move.a, move.b, random(727)).frames.find(frame => frame.type === 'clear');
  const gate = deferred();
  scene.delay = () => gate.promise;
  const clearing = scene.clearFrame(frame, true);
  const newBoard = createBoard(random(384));
  scene.runId++;
  scene.board = newBoard;
  scene.score = 0;
  scene.progress = [0, 0];
  scene.state = 'intro';
  gate.resolve();
  await clearing;
  assert.equal(scene.board, newBoard);
  assert.equal(scene.score, 0);
  assert.deepEqual(scene.progress, [0, 0]);
  assert.equal(scene.state, 'intro');
});

test('moveFrame cannot replace a new board when an old fall finishes', async () => {
  const { scene } = sceneHarness(642);
  delete scene.moveFrame;
  scene.decorate = () => {};
  scene.nodes = new Map(scene.board.map((cell, index) => [cell.id, { cell: { ...cell }, index, x: 0, y: 0, active: true, icon: {}, destroy() {} }]));
  const gate = deferred();
  scene.tween = () => gate.promise;
  const oldBoard = scene.board.map(cell => ({ ...cell }));
  const falling = scene.moveFrame(oldBoard, 200, true);
  const newBoard = createBoard(random(934));
  scene.runId++;
  scene.board = newBoard;
  scene.state = 'intro';
  gate.resolve();
  await falling;
  assert.equal(scene.board, newBoard);
  assert.equal(scene.state, 'intro');
});

test('completeTurn cinematic cancellation cannot set flags or rewards in a new run', async () => {
  const { scene } = sceneHarness(998);
  scene.pendingRewards = [{ type: 'hammer', count: 1, origin: 27 }];
  const gate = deferred();
  scene.cinematic.play = () => gate.promise;
  const completing = scene.completeTurn();
  assert.equal(scene.state, 'cinematic');
  const newBoard = createBoard(random(734));
  scene.runId++;
  scene.board = newBoard;
  scene.state = 'intro';
  scene.turnCinematicShown = false;
  scene.completing = false;
  scene.pendingRewards = [];
  scene.rewardStats = { hammer: 0, drone: 0, rift: 0 };
  gate.resolve();
  await completing;
  assert.equal(scene.board, newBoard);
  assert.equal(scene.state, 'intro');
  assert.equal(scene.turnCinematicShown, false);
  assert.equal(scene.completing, false);
  assert.deepEqual(scene.rewardStats, { hammer: 0, drone: 0, rift: 0 });
  assert.equal(scene.rewardAttacks.length, 0);
});

test('restart immediately invalidates callbacks before Phaser queues scene creation', () => {
  const { scene } = sceneHarness();
  const run = scene.runId;
  let queued = false;
  scene.scene.restart = () => { queued = true; };
  scene.restart();
  assert.ok(queued);
  assert.ok(!scene.alive || scene.runId !== run, 'Old promises must become invalid before the queued restart executes');
});
