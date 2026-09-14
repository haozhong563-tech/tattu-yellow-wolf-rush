import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoard, legalMoves, matches, buildTurn, buildRewardTurn as resolveTargets } from '../game/model.mjs';
import { planRewards, buildRewardTurn } from '../game/rewards.mjs';

function random(seed) {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
}
function freeze(board) { board.forEach(Object.freeze); return Object.freeze(board); }
function snapshot(board) { return board.map(cell => ({ ...cell })); }
function clearFrame(entries) {
  return { type: 'clear', cleared: entries.map(([index, id, special]) => ({ index, cell: { id, kind: 0, special } })), activated: entries.map(([index, _id, special]) => ({ index, special })) };
}
function audit(turn) {
  assert.equal(turn.valid, true);
  assert.equal(turn.board.length, 72);
  assert.ok(turn.board.every(Boolean));
  assert.equal(new Set(turn.board.map(cell => cell.id)).size, 72);
  assert.equal(matches(turn.board).indices.length, 0);
  assert.ok(legalMoves(turn.board).length > 0);
  const counts = [0, 0, 0, 0, 0, 0];
  let score = 0;
  let chains = 0;
  for (const frame of turn.frames) {
    if (frame.type !== 'clear') assert.ok(frame.board.every(Boolean));
    else {
      chains++;
      assert.equal(frame.chain, chains);
      assert.equal(new Set(frame.cleared.map(item => item.index)).size, frame.cleared.length);
      for (const item of frame.cleared) { assert.equal(frame.board[item.index], null); counts[item.cell.kind]++; }
      score += frame.score;
    }
  }
  assert.deepEqual(turn.cleared, counts);
  assert.equal(turn.score, score);
  assert.equal(turn.combo, chains);
  assert.equal(turn.rewardGenerated, true);
  assert.equal(turn.meta.source, 'reward');
  assert.deepEqual(planRewards(turn), []);
}
function area(center) {
  const result = [];
  const r = Math.floor(center / 8), c = center % 8;
  for (let y = Math.max(0, r - 1); y <= Math.min(8, r + 1); y++) for (let x = Math.max(0, c - 1); x <= Math.min(7, c + 1); x++) result.push(y * 8 + x);
  return result;
}

test('activated row/column, bomb and nova earn grouped props with caps and stable origins', () => {
  const turn = { valid: true, frames: [clearFrame([[2, 'a', 'row'], [4, 'b', 'column'], [8, 'c', 'bomb'], [12, 'd', 'nova']]), clearFrame([[17, 'e', 'row'], [22, 'f', 'row'], [31, 'g', 'bomb']])] };
  assert.deepEqual(planRewards(turn), [{ type: 'hammer', count: 3, origin: 2 }, { type: 'drone', count: 2, origin: 8 }, { type: 'rift', count: 1, origin: 12 }]);
  const before = JSON.stringify(turn);
  const first = planRewards(turn);
  first[0].count = 999;
  assert.equal(JSON.stringify(turn), before);
  assert.equal(planRewards(turn)[0].count, 3);
});

test('overlapping activation reports deduplicate by cell ID, not changing board position', () => {
  const turn = { valid: true, frames: [clearFrame([[2, 'same', 'row'], [2, 'same', 'row']]), clearFrame([[8, 'same', 'column'], [2, 'different', 'row']])] };
  assert.deepEqual(planRewards(turn), [{ type: 'hammer', count: 2, origin: 2 }]);
});

test('ordinary matches, newly created specials, invalid moves and unmatched activation reports award nothing', () => {
  assert.deepEqual(planRewards({ valid: false, frames: [clearFrame([[0, 'a', 'nova']])] }), []);
  assert.deepEqual(planRewards({ valid: true, frames: [{ type: 'clear', cleared: [], activated: [{ index: 20, special: 'row' }], created: [{ index: 0, cell: { id: 'a', kind: 0, special: 'row' } }] }] }), []);
  const board = createBoard(random(629));
  const turn = legalMoves(board).map(move => buildTurn(board, move.a, move.b, random(172))).find(turn => !turn.frames.some(frame => frame.activated?.length));
  assert.ok(turn);
  assert.ok(turn.cleared.reduce((a, b) => a + b) >= 3);
  assert.deepEqual(planRewards(turn), []);
});

test('reward provenance and explicit API source prevent recursive free rewards', () => {
  const frames = [clearFrame([[0, 'a', 'row'], [4, 'b', 'nova']])];
  assert.equal(planRewards({ valid: true, frames }).length, 2);
  assert.equal(planRewards({ valid: true, frames }, { source: 'rush' }).length, 2);
  assert.deepEqual(planRewards({ valid: true, frames }, { source: 'reward' }), []);
  assert.deepEqual(planRewards({ valid: true, frames, rewardGenerated: true }), []);
  assert.deepEqual(planRewards({ valid: true, frames, meta: { source: 'reward' } }), []);
  const board = createBoard(random(827));
  board[28].special = 'nova';
  const lowLevel = resolveTargets(board, [28], random(187));
  assert.ok(lowLevel.frames.some(frame => frame.activated?.length));
  assert.deepEqual(planRewards(lowLevel), []);
});

test('hammer auto-targets 2–4 distinct ice cells atomically, with no inventory or mutation', () => {
  for (const count of [1, 2, 3]) {
    const board = freeze(createBoard(random(192)));
    const before = JSON.stringify(board);
    const ice = new Set([18, 19, 20, 21, 34, 35]);
    const iceBefore = [...ice];
    const reward = Object.freeze({ type: 'hammer', count, origin: 19 });
    const turn = buildRewardTurn(board, reward, ice, random(18));
    const first = turn.frames[0];
    assert.equal(first.type, 'clear');
    assert.equal(turn.meta.targets.length, count + 1);
    assert.equal(new Set(turn.meta.targets).size, count + 1);
    assert.ok(turn.meta.targets.every(index => ice.has(index)));
    assert.deepEqual(first.cleared.map(item => item.index), [...turn.meta.targets].sort((a, b) => a - b));
    assert.equal('inventory' in turn, false);
    assert.equal(JSON.stringify(board), before);
    assert.deepEqual([...ice], iceBefore);
    audit(turn);
  }
});

test('drone chooses high-ice 3×3 centers and covers two separate ice clusters when stacked', () => {
  const board = freeze(createBoard(random(122)));
  const ice = new Set([...area(18), ...area(53)]);
  for (const count of [1, 2, 3]) {
    const turn = buildRewardTurn(board, { type: 'drone', count, origin: 18 }, ice, random(91));
    assert.equal(turn.meta.targets.length, Math.min(2, count));
    const expected = [...new Set(turn.meta.targets.flatMap(area))].sort((a, b) => a - b);
    assert.deepEqual(turn.frames[0].cleared.map(item => item.index), expected);
    assert.equal(expected.filter(index => ice.has(index)).length, count === 1 ? 9 : 18);
    audit(turn);
  }
});

test('rift visibly shuffles first, then clears a full cross without double-counting scores', () => {
  const board = freeze(createBoard(random(551)));
  const before = JSON.stringify(board);
  const ice = new Set([25, 26, 27, 28, 29, 30, 33, 34, 35, 36, 37, 38, 41, 42, 43, 44, 45, 46]);
  const turn = buildRewardTurn(board, { type: 'rift', count: 3, origin: 34 }, ice, random(919));
  assert.equal(turn.frames[0].type, 'shuffle');
  assert.equal(turn.frames[1].type, 'clear');
  assert.equal(matches(turn.frames[0].board).indices.length, 0);
  assert.deepEqual(snapshot(turn.frames[0].board).sort((a, b) => a.id.localeCompare(b.id)), snapshot(board).sort((a, b) => a.id.localeCompare(b.id)));
  const center = turn.meta.targets[0];
  assert.ok(ice.has(center));
  const expected = Array.from({ length: 72 }, (_, i) => i).filter(i => Math.floor(i / 8) === Math.floor(center / 8) || i % 8 === center % 8);
  assert.equal(expected.length, 16);
  assert.deepEqual(turn.frames[1].cleared.map(item => item.index), expected);
  assert.equal(JSON.stringify(board), before);
  audit(turn);
  const early = JSON.stringify(turn.frames[0]);
  turn.board[0].kind = (turn.board[0].kind + 1) % 6;
  turn.meta.targets[0] = 71;
  assert.equal(JSON.stringify(turn.frames[0]), early);
});

test('zero/negative/invalid reward quantities perform no action and require no inventory state', () => {
  const board = freeze(createBoard(random(742)));
  for (const reward of [{ type: 'hammer', count: 0 }, { type: 'drone', count: -1 }, { type: 'rift', count: NaN }, { type: 'unknown', count: 1 }, null]) {
    const turn = buildRewardTurn(board, reward, [], random(143));
    assert.equal(turn.valid, false);
    assert.equal(turn.frames.length, 0);
    assert.equal(turn.score, 0);
    assert.deepEqual(turn.board, board);
    assert.deepEqual(planRewards(turn), []);
  }
});

test('reward hits may activate existing specials but never award recursively; 150 seeded rewards stay playable', () => {
  const rng = random(37921);
  let board = createBoard(rng);
  for (let iteration = 0; iteration < 150; iteration++) {
    if (iteration % 3 === 0) board[34].special = ['row', 'column', 'bomb', 'nova'][iteration % 4];
    const before = JSON.stringify(board);
    freeze(board);
    const reward = { type: ['hammer', 'drone', 'rift'][iteration % 3], count: 1 + iteration % 3, origin: 34 };
    const turn = buildRewardTurn(board, reward, new Set([26, 27, 28, 34, 35, 36, 42, 43, 44]), rng);
    assert.equal(JSON.stringify(board), before);
    audit(turn);
    board = turn.board;
  }
});
