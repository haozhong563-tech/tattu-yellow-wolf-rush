import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoard, matches, legalMoves, buildTurn, buildToolTurn, buildRushTurn, buildRewardTurn as hitTargets } from '../game/model.mjs';
import { buildRewardTurn, planRewards } from '../game/rewards.mjs';
import { WORLD_PHASES, worldPhase, buildWorldDrop, initialWorldBoard } from '../game/world.mjs';

const HP = { rock: 3, crate: 2, battery: 2, prism: 1 };
const BREAK_SCORE = { rock: 600, crate: 300, battery: 250, prism: 400 };
function random(seed) {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
}
function obstacle(board, index, type, hp = HP[type]) {
  board[index] = { id: `obstacle-${index}-${board[index].id}`, kind: -1, special: null, obstacle: type, hp };
  return board[index];
}
function freeze(board) { board.forEach(Object.freeze); return Object.freeze(board); }
function stable(board) {
  assert.equal(board.length, 72);
  assert.ok(board.every(Boolean));
  assert.equal(new Set(board.map(cell => cell.id)).size, 72);
  for (const cell of board) {
    if (cell.obstacle) { assert.equal(cell.kind, -1); assert.ok(cell.hp >= 1 && cell.hp <= HP[cell.obstacle]); assert.equal(cell.special, null); }
    else assert.ok(Number.isInteger(cell.kind) && cell.kind >= 0 && cell.kind <= 5);
  }
  assert.equal(matches(board).indices.length, 0);
  assert.ok(legalMoves(board).length > 0);
}
function audit(turn) {
  stable(turn.board);
  const counts = [0, 0, 0, 0, 0, 0];
  let totalScore = 0;
  for (const frame of turn.frames) {
    assert.equal(frame.board.length, 72);
    if (frame.type !== 'clear') { assert.ok(frame.board.every(Boolean)); continue; }
    const hits = frame.obstacleHits ?? [];
    const broken = frame.obstacleBroken ?? [];
    assert.equal(new Set(hits.map(hit => hit.cell.id)).size, hits.length);
    assert.equal(new Set(hits.map(hit => hit.index)).size, hits.length);
    assert.equal(new Set(broken.map(hit => hit.cell.id)).size, broken.length);
    for (const hit of hits) {
      assert.equal(hit.beforeHp, hit.cell.hp);
      assert.equal(hit.hp, hit.beforeHp - 1);
      if (hit.hp > 0) { assert.equal(frame.board[hit.index].id, hit.cell.id); assert.equal(frame.board[hit.index].hp, hit.hp); }
      else assert.ok(broken.some(item => item.cell.id === hit.cell.id));
    }
    for (const item of broken) {
      assert.ok(hits.some(hit => hit.cell.id === item.cell.id && hit.hp === 0));
      const special = { crate: 'bomb', battery: 'row', prism: 'nova' }[item.cell.obstacle];
      if (special) {
        const created = frame.created.find(created => created.index === item.index);
        assert.ok(created);
        assert.equal(created.cell.special, special);
        assert.notEqual(created.cell.id, item.cell.id);
        assert.equal(created.cell.obstacle, undefined);
        assert.deepEqual(frame.board[item.index], created.cell);
        assert.equal(frame.activated.some(hit => hit.index === item.index), false, 'A newly produced special cannot activate in the same wave');
      } else assert.equal(frame.board[item.index], null);
    }
    for (const item of frame.cleared) {
      assert.equal(item.cell.obstacle, undefined);
      assert.equal(frame.board[item.index], null);
      counts[item.cell.kind]++;
    }
    assert.equal(frame.chargeBonus, broken.filter(item => item.cell.obstacle === 'battery').length * 12);
    assert.equal(frame.score, frame.cleared.length * 60 * frame.chain + frame.activated.length * 120 + hits.length * 30 + broken.reduce((sum, item) => sum + BREAK_SCORE[item.cell.obstacle], 0));
    totalScore += frame.score;
  }
  assert.deepEqual(turn.cleared, counts);
  assert.equal(turn.cleared.length, 6);
  assert.equal(turn.score, totalScore);
}
function swapFixture() {
  const rng = random(892);
  for (let attempt = 0; attempt < 200; attempt++) {
    const board = createBoard(rng);
    for (const [index, kind] of Object.entries({ 24: 0, 25: 0, 26: 1, 18: 0, 27: 2 })) board[+index].kind = kind;
    if (!matches(board).indices.length) return board;
  }
  throw new Error('Cannot construct initial match fixture');
}

test('world phases rotate every twelve operations and expose six stable UI/scoring identities', () => {
  assert.equal(WORLD_PHASES.length, 6);
  assert.deepEqual(WORLD_PHASES.map(phase => phase.index), [0, 1, 2, 3, 4, 5]);
  for (let count = 0; count < 240; count++) {
    const phase = worldPhase(count);
    assert.equal(phase.index, Math.floor(count / 12) % 6);
    assert.ok(phase.id && phase.name && phase.subtitle && /^#[0-9A-Fa-f]{6}$/.test(phase.color));
  }
  assert.equal(worldPhase(-3).index, 0);
  assert.equal(worldPhase(NaN).index, 0);
});

test('drops replace only ordinary top-two-row cells on the three-operation schedule and preserve input', () => {
  const board = createBoard(random(638));
  board[0].special = 'nova';
  board[12].special = 'row';
  freeze(board);
  const before = JSON.stringify(board);
  for (const turns of [0, 1, 2, 4, 5, 7]) {
    const result = buildWorldDrop(board, turns, random(37));
    assert.equal(result.drops.length, 0);
    assert.deepEqual(result.board, board);
  }
  const first = buildWorldDrop(board, 3, random(39));
  assert.ok(first.drops.length >= 1 && first.drops.length <= 2);
  for (const { index, cell } of first.drops) {
    assert.ok(index >= 0 && index < 16);
    assert.equal(board[index].special, null);
    assert.equal(cell.obstacle, 'rock');
    assert.equal(cell.hp, 3);
    assert.equal(cell.kind, -1);
    assert.notEqual(cell.id, board[index].id);
    assert.deepEqual(first.board[index], cell);
  }
  assert.deepEqual(first.board[0], board[0]);
  assert.deepEqual(first.board[12], board[12]);
  assert.equal(JSON.stringify(board), before);
  assert.deepEqual(buildWorldDrop(board, 3, random(39)), first, 'Caller controls scheduling; the planner keeps no hidden once-only state');
  stable(first.board);
  stable(initialWorldBoard(random(538)));
});

test('world drops obey phase types, ten-obstacle cap and safe no-space rejection', () => {
  for (const [turns, expected] of [[3, 'rock'], [12, 'rock'], [24, 'crate'], [36, 'battery'], [48, 'prism']]) {
    const result = buildWorldDrop(createBoard(random(turns)), turns, random(951));
    assert.ok(result.drops.length > 0);
    assert.ok(result.drops.every(drop => drop.cell.obstacle === expected && drop.cell.hp === HP[expected]));
    stable(result.board);
  }
  let board = createBoard(random(445));
  for (let turns = 3; turns <= 60; turns += 3) {
    const result = buildWorldDrop(board, turns, random(turns));
    board = result.board;
    assert.ok(board.filter(cell => cell.obstacle).length <= 10);
    stable(board);
  }
  assert.equal(board.filter(cell => cell.obstacle).length, 10);
  assert.equal(buildWorldDrop(board, 63, random(17)).drops.length, 0);
  const protectedTop = createBoard(random(332));
  for (let i = 0; i < 16; i++) protectedTop[i].special = 'row';
  const rejected = buildWorldDrop(protectedTop, 3, random(151));
  assert.equal(rejected.drops.length, 0);
  assert.deepEqual(rejected.board, protectedTop);
});

test('obstacles occupy real cells, never color-match and cannot be swapped', () => {
  const board = createBoard(random(518));
  for (const index of [0, 1, 2]) obstacle(board, index, 'rock');
  assert.equal(matches(board).indices.includes(0), false);
  assert.equal(matches(board).indices.includes(1), false);
  assert.equal(matches(board).indices.includes(2), false);
  assert.ok(legalMoves(board).every(move => !board[move.a].obstacle && !board[move.b].obstacle));
  const invalid = buildTurn(freeze(board), 2, 3, random(177));
  assert.equal(invalid.valid, false);
  assert.equal(invalid.frames.length, 0);
  assert.deepEqual(invalid.board, board);
});

test('rock requires exactly three separate blast hits and never contributes color collection', () => {
  let board = createBoard(random(433));
  const rock = obstacle(board, 0, 'rock');
  for (let hit = 1; hit <= 3; hit++) {
    const before = JSON.stringify(board);
    const turn = hitTargets(freeze(board), [0, 0], random(284));
    const frame = turn.frames[0];
    assert.equal(frame.obstacleHits.length, 1);
    assert.equal(frame.obstacleHits[0].cell.id, rock.id);
    assert.equal(frame.obstacleHits[0].beforeHp, 4 - hit);
    assert.equal(frame.obstacleHits[0].hp, 3 - hit);
    assert.equal(frame.obstacleBroken.length, hit === 3 ? 1 : 0);
    assert.equal(frame.cleared.length, 0);
    assert.equal(frame.score, hit === 3 ? 630 : 30);
    if (hit < 3) assert.equal(turn.board[0].hp, 3 - hit);
    assert.equal(JSON.stringify(board), before);
    audit(turn);
    board = turn.board;
  }
  assert.equal(board.some(cell => cell.id === rock.id), false);
});

test('ordinary adjacent matching chips crate/battery but cannot damage rock or prism', () => {
  const board = swapFixture();
  obstacle(board, 32, 'rock');
  obstacle(board, 33, 'crate');
  obstacle(board, 34, 'battery');
  obstacle(board, 17, 'prism');
  const turn = buildTurn(board, 18, 26, random(536));
  const first = turn.frames.find(frame => frame.type === 'clear');
  assert.equal(first.activated.length, 0);
  assert.ok(first.cleared.some(item => item.index === 24));
  assert.ok(first.cleared.some(item => item.index === 25));
  assert.ok(first.cleared.some(item => item.index === 26));
  assert.deepEqual(first.obstacleHits.map(hit => [hit.index, hit.beforeHp, hit.hp]), [[33, 2, 1], [34, 2, 1]]);
  assert.equal(first.board[32].hp, 3);
  assert.equal(first.board[17].hp, 1);
  audit(turn);
});

test('overlapping combo beams and nova damage a rock only once in the same clear frame', () => {
  const board = createBoard(random(631));
  obstacle(board, 36, 'rock');
  board[27].special = 'row';
  board[28].special = 'column';
  board[52].special = 'nova';
  const turn = buildTurn(board, 27, 28, random(938));
  const first = turn.frames.find(frame => frame.type === 'clear');
  assert.ok(first.activated.length >= 3);
  assert.equal(first.obstacleHits.filter(hit => hit.index === 36).length, 1);
  assert.equal(first.obstacleHits.find(hit => hit.index === 36).hp, 2);
  audit(turn);
});

test('broken crate/battery/prism create fresh protected special cells and battery charge exactly once', () => {
  for (const [type, special] of [['crate', 'bomb'], ['battery', 'row'], ['prism', 'nova']]) {
    const board = createBoard(random(641));
    const old = obstacle(board, 27, type, 1);
    const turn = hitTargets(board, [27, 27, 27], random(542));
    const first = turn.frames[0];
    assert.equal(first.obstacleBroken.length, 1);
    assert.equal(first.obstacleBroken[0].cell.id, old.id);
    assert.equal(first.created[0].index, 27);
    assert.equal(first.created[0].cell.special, special);
    assert.notEqual(first.created[0].cell.id, old.id);
    assert.equal(first.board[27].special, special);
    assert.equal(first.activated.some(item => item.index === 27), false);
    assert.equal(first.chargeBonus, type === 'battery' ? 12 : 0);
    assert.equal(turn.frames[1].board[27].special, special);
    assert.deepEqual(planRewards(turn), []);
    audit(turn);
  }
});

test('an undamaged rock falls through a genuine hole while retaining its ID and HP', () => {
  const board = createBoard(random(326));
  const rock = obstacle(board, 27, 'rock');
  const turn = hitTargets(board, [35], random(123));
  const clear = turn.frames[0];
  const fall = turn.frames[1];
  assert.equal(clear.board[27].id, rock.id);
  assert.equal(clear.board[35], null);
  assert.equal(clear.obstacleHits.length, 0);
  assert.equal(fall.board[35].id, rock.id);
  assert.equal(fall.board[35].hp, 3);
  assert.notEqual(fall.board[27].id, rock.id);
  audit(turn);
});

test('rush and every earned support type can destroy obstacles without recursive rewards', () => {
  for (const type of ['rush', 'hammer', 'drone', 'rift']) {
    const board = createBoard(random(135));
    const rock = obstacle(board, 27, 'rock', 1);
    const turn = type === 'rush' ? buildRushTurn(board, 27, random(673)) : buildRewardTurn(board, { type, count: 1, origin: 27 }, [], random(673));
    assert.ok(turn.frames.some(frame => frame.obstacleBroken?.some(item => item.cell.id === rock.id)), type);
    if (type !== 'rush') assert.deepEqual(planRewards(turn), []);
    audit(turn);
  }
});

test('deadlock recovery retains normal obstacle HP/identity and repairs only malformed near-solid boards', () => {
  const board = createBoard(random(269));
  for (let i = 0; i < 10; i++) obstacle(board, i, 'rock', i % 3 + 1);
  const expected = board.filter(cell => cell.obstacle).map(cell => ({ ...cell })).sort((a, b) => a.id.localeCompare(b.id));
  const shuffled = buildToolTurn(freeze(board), 0, 'shuffle', random(463));
  assert.deepEqual(shuffled.board.filter(cell => cell.obstacle).sort((a, b) => a.id.localeCompare(b.id)), expected);
  stable(shuffled.board);
  const mostlySolid = createBoard(random(951));
  for (let i = 0; i < 64; i++) obstacle(mostlySolid, i, 'rock', i % 3 + 1);
  const retained = new Map(mostlySolid.filter(cell => cell.obstacle).map(cell => [cell.id, cell.hp]));
  const difficult = buildToolTurn(mostlySolid, 0, 'shuffle', () => 0);
  assert.equal(difficult.board.filter(cell => cell.obstacle).length, 64);
  for (const cell of difficult.board) if (cell.obstacle) assert.equal(cell.hp, retained.get(cell.id));
  stable(difficult.board);
  const solid = Array.from({ length: 72 }, (_, index) => ({ id: `solid-${index}`, kind: -1, special: null, obstacle: 'rock', hp: 3 }));
  const repaired = hitTargets(freeze(solid), [0], random(818));
  assert.equal(repaired.frames[0].obstacleHits[0].hp, 2);
  assert.equal(repaired.frames.at(-1).type, 'shuffle');
  const surviving = repaired.board.filter(cell => cell.obstacle);
  assert.equal(surviving.length, 10);
  assert.equal(surviving.find(cell => cell.id === 'solid-0').hp, 2);
  assert.ok(surviving.every(cell => cell.hp === (cell.id === 'solid-0' ? 2 : 3)));
  audit(repaired);
  const worldRepair = buildWorldDrop(solid, 0, random(231));
  assert.equal(worldRepair.recovered, true);
  assert.equal(worldRepair.drops.length, 0);
  stable(worldRepair.board);
});

test('1500 seeded world turns keep drops, falling obstacles, bonuses and cascades stable', () => {
  const rng = random(0x681913);
  let board = initialWorldBoard(rng);
  const phases = new Set();
  let broken = 0;
  for (let turns = 1; turns <= 1500; turns++) {
    const before = JSON.stringify(board);
    freeze(board);
    const moves = legalMoves(board);
    const move = moves[Math.floor(rng() * moves.length)];
    const turn = buildTurn(board, move.a, move.b, rng);
    assert.equal(turn.valid, true);
    assert.equal(JSON.stringify(board), before);
    audit(turn);
    broken += turn.frames.reduce((sum, frame) => sum + (frame.obstacleBroken?.length ?? 0), 0);
    board = turn.board;
    if (turns % 11 === 0) {
      const rush = buildRushTurn(board, Math.floor(rng() * 72), rng);
      audit(rush);
      board = rush.board;
    }
    if (turns % 17 === 0) {
      const reward = buildRewardTurn(board, { type: ['hammer', 'drone', 'rift'][turns % 3], count: 2, origin: 27 }, [], rng);
      audit(reward);
      assert.deepEqual(planRewards(reward), []);
      board = reward.board;
    }
    const drop = buildWorldDrop(board, turns, rng);
    phases.add(drop.phase.index);
    if (turns % 3) assert.equal(drop.drops.length, 0);
    assert.ok(drop.drops.length <= 2);
    assert.ok(drop.board.filter(cell => cell.obstacle).length <= 10);
    stable(drop.board);
    board = drop.board;
  }
  assert.equal(phases.size, 6);
  assert.ok(broken > 0);
});
