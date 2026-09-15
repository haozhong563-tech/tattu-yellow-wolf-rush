/** Pure, deterministic match-three rules. No browser or rendering dependencies. */
export const ROWS = 9;
export const COLS = 8;
const SIZE = ROWS * COLS;
const KINDS = 6;
const MAX_CASCADES = 24;
const OBSTACLE_HP = { rock: 3, crate: 2, battery: 2, prism: 1 };
const OBSTACLE_SCORE = { rock: 600, crate: 300, battery: 250, prism: 400 };
let nextId = 0;

const copyCell = cell => cell ? { ...cell } : null;
const snapshot = board => board.map(copyCell);
const row = index => Math.floor(index / COLS);
const col = index => index % COLS;
const inBounds = index => Number.isInteger(index) && index >= 0 && index < SIZE;
const adjacent = (a, b) => inBounds(a) && inBounds(b) && Math.abs(row(a) - row(b)) + Math.abs(col(a) - col(b)) === 1;
const pick = (rng, count) => Math.min(count - 1, Math.max(0, Math.floor((Number(rng()) || 0) * count)));
const zeroCounts = () => Array(KINDS).fill(0);
const matchKind = cell => cell && !cell.obstacle ? cell.kind : undefined;

function assertBoard(board) {
  if (!Array.isArray(board) || board.length !== SIZE || board.some(cell => !cell || (cell.obstacle ? !OBSTACLE_HP[cell.obstacle] || !Number.isInteger(cell.hp) || cell.hp < 1 || cell.hp > OBSTACLE_HP[cell.obstacle] : !Number.isInteger(cell.kind) || cell.kind < 0 || cell.kind >= KINDS))) {
    throw new TypeError(`Expected a full ${COLS} by ${ROWS} board with normal colors or valid live obstacles.`);
  }
  if (new Set(board.map(cell => cell.id)).size !== SIZE) throw new TypeError('Each cell must have a unique id.');
}

function freshCell(rng, existingIds = new Set(), kind = pick(rng, KINDS)) {
  let id;
  do { id = `cell-${++nextId}`; } while (existingIds.has(id));
  existingIds.add(id);
  return { id, kind, special: null };
}

/** Returns all contiguous horizontal/vertical runs and their unique indices. */
export function matches(board) {
  const groups = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS;) {
      const start = r * COLS + c;
      const kind = matchKind(board[start]);
      let end = c + 1;
      while (kind !== undefined && end < COLS && matchKind(board[r * COLS + end]) === kind) end++;
      if (kind !== undefined && end - c >= 3) groups.push({ kind, orientation: 'row', indices: Array.from({ length: end - c }, (_, n) => start + n) });
      c = end;
    }
  }
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS;) {
      const start = r * COLS + c;
      const kind = matchKind(board[start]);
      let end = r + 1;
      while (kind !== undefined && end < ROWS && matchKind(board[end * COLS + c]) === kind) end++;
      if (kind !== undefined && end - r >= 3) groups.push({ kind, orientation: 'column', indices: Array.from({ length: end - r }, (_, n) => start + n * COLS) });
      r = end;
    }
  }
  return { indices: [...new Set(groups.flatMap(group => group.indices))].sort((a, b) => a - b), groups };
}

function isSpecialSwap(a, b) {
  return a.special === 'nova' || b.special === 'nova' || Boolean(a.special && b.special);
}

/** Each move is {a,b}, a pair of adjacent flat board indices. */
export function legalMoves(board) {
  const moves = [];
  const working = board.slice();
  for (let a = 0; a < SIZE; a++) {
    const neighbors = [];
    if (col(a) + 1 < COLS) neighbors.push(a + 1);
    if (row(a) + 1 < ROWS) neighbors.push(a + COLS);
    for (const b of neighbors) {
      if (!working[a] || !working[b] || working[a].obstacle || working[b].obstacle) continue;
      if (isSpecialSwap(working[a], working[b])) { moves.push({ a, b }); continue; }
      if (working[a].kind === working[b].kind) continue;
      [working[a], working[b]] = [working[b], working[a]];
      const found = matches(working).indices;
      if (found.includes(a) || found.includes(b)) moves.push({ a, b });
      [working[a], working[b]] = [working[b], working[a]];
    }
  }
  return moves;
}

export function createBoard(rng = Math.random) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const board = [];
    const ids = new Set();
    for (let index = 0; index < SIZE; index++) {
      const forbidden = new Set();
      if (col(index) >= 2 && board[index - 1].kind === board[index - 2].kind) forbidden.add(board[index - 1].kind);
      if (row(index) >= 2 && board[index - COLS].kind === board[index - 2 * COLS].kind) forbidden.add(board[index - COLS].kind);
      const available = Array.from({ length: KINDS }, (_, kind) => kind).filter(kind => !forbidden.has(kind));
      board.push(freshCell(rng, ids, available[pick(rng, available.length)]));
    }
    if (legalMoves(board).length) return board;
  }
  // A pathological supplied RNG must not prevent a playable initial board.
  return createBoard(fallbackRandom(0x713c41));
}

function fallbackRandom(seed) {
  let value = seed >>> 0;
  return () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function shuffledBoard(board, rng) {
  let working = snapshot(board);
  const fallback = fallbackRandom(0x2c9861);
  // Only malformed almost-solid input receives replacement pieces. Normal
  // deadlocks keep every obstacle's identity, type and remaining HP intact.
  if (working.filter(cell => !cell.obstacle).length < 4) {
    const repair = createBoard(fallback);
    let retained = 0;
    working = working.map((cell, index) => cell.obstacle && retained++ >= 10 ? repair[index] : cell);
  }
  for (let attempt = 0; attempt < 1200; attempt++) {
    const random = attempt < 120 ? rng : fallback;
    for (let i = SIZE - 1; i > 0; i--) {
      const j = pick(random, i + 1);
      [working[i], working[j]] = [working[j], working[i]];
    }
    if (!matches(working).indices.length && legalMoves(working).length) return working;
  }
  // An extreme color imbalance may not admit a stable permutation. Reserve a
  // guaranteed swap shape, preserving all remaining obstacles and their HP,
  // then repair only ordinary colors without introducing natural matches.
  const reserved = new Map([[0, 0], [1, 1], [2, 0], [COLS + 1, 0]]);
  for (const index of reserved.keys()) {
    if (!working[index].obstacle) continue;
    const source = working.findIndex((cell, candidate) => !cell.obstacle && !reserved.has(candidate));
    [working[index], working[source]] = [working[source], working[index]];
  }
  for (let index = 0; index < SIZE; index++) {
    if (working[index].obstacle) continue;
    if (reserved.has(index)) { working[index] = { ...working[index], kind: reserved.get(index) }; continue; }
    const forbidden = new Set();
    if (col(index) >= 2 && matchKind(working[index - 1]) !== undefined && matchKind(working[index - 1]) === matchKind(working[index - 2])) forbidden.add(working[index - 1].kind);
    if (row(index) >= 2 && matchKind(working[index - COLS]) !== undefined && matchKind(working[index - COLS]) === matchKind(working[index - 2 * COLS])) forbidden.add(working[index - COLS].kind);
    // The one reserved value later in this row must also remain unmatched.
    if (index === COLS && !working[COLS + 2].obstacle && reserved.get(COLS + 1) === 0) forbidden.add(0);
    const available = Array.from({ length: KINDS }, (_, kind) => kind).filter(kind => !forbidden.has(kind));
    working[index] = { ...working[index], kind: available[pick(fallback, available.length)] };
  }
  return working;
}

function clusters(groups) {
  const result = [];
  for (const group of groups) {
    const intersections = result.filter(cluster => group.indices.some(index => cluster.indices.has(index)));
    const merged = { groups: [group], indices: new Set(group.indices) };
    for (const cluster of intersections) {
      merged.groups.push(...cluster.groups);
      cluster.indices.forEach(index => merged.indices.add(index));
      result.splice(result.indexOf(cluster), 1);
    }
    result.push(merged);
  }
  return result;
}

function planSpecials(board, groups, preferred = []) {
  const created = [];
  for (const cluster of clusters(groups)) {
    const long = cluster.groups.find(group => group.indices.length >= 5);
    const crossing = cluster.groups.some(group => group.orientation === 'row') && cluster.groups.some(group => group.orientation === 'column');
    const four = cluster.groups.find(group => group.indices.length === 4);
    const special = long ? 'nova' : crossing ? 'bomb' : four ? four.orientation : null;
    if (!special) continue;
    const middle = (long || four || cluster.groups[0]).indices[Math.floor((long || four || cluster.groups[0]).indices.length / 2)];
    const crossingIndices = [...cluster.indices].filter(index => cluster.groups.filter(group => group.indices.includes(index)).length > 1);
    const candidates = [...preferred, ...crossingIndices, middle, ...cluster.indices];
    const index = candidates.find(index => cluster.indices.has(index) && board[index] && !board[index].special);
    if (index !== undefined) created.push({ index, cell: { ...board[index], special } });
  }
  return created;
}

function area(index, radius = 1) {
  const indices = [];
  for (let r = Math.max(0, row(index) - radius); r <= Math.min(ROWS - 1, row(index) + radius); r++) {
    for (let c = Math.max(0, col(index) - radius); c <= Math.min(COLS - 1, col(index) + radius); c++) indices.push(r * COLS + c);
  }
  return indices;
}

function line(index, orientation, thickness = 0) {
  const result = [];
  for (let i = 0; i < SIZE; i++) {
    if (orientation === 'row' ? Math.abs(row(i) - row(index)) <= thickness : Math.abs(col(i) - col(index)) <= thickness) result.push(i);
  }
  return result;
}

function specialSeeds(board, a, b) {
  const first = board[a];
  const second = board[b];
  const seeds = new Set([a, b]);
  const overrides = new Map();
  if (first.special === 'nova' && second.special === 'nova') {
    board.forEach((_, index) => seeds.add(index));
  } else if (first.special === 'nova' || second.special === 'nova') {
    const novaIndex = first.special === 'nova' ? a : b;
    const partner = novaIndex === a ? second : first;
    // An explicitly swapped nova clears the partner's color, not its own color.
    overrides.set(novaIndex, { special: 'nova', kind: partner.kind });
    board.forEach((cell, index) => {
      if (cell.obstacle || cell.kind !== partner.kind) return;
      seeds.add(index);
      if (partner.special && !cell.special) overrides.set(index, { special: partner.special, kind: cell.kind });
    });
  } else if (first.special === 'bomb' && second.special === 'bomb') {
    area(b, 2).forEach(index => seeds.add(index));
  } else if (first.special === 'bomb' || second.special === 'bomb') {
    [...line(b, 'row', 1), ...line(b, 'column', 1)].forEach(index => seeds.add(index));
  } else {
    [...line(b, 'row'), ...line(b, 'column')].forEach(index => seeds.add(index));
  }
  return { seeds, overrides, blast: true };
}

function expandClears(board, seeds, protectedIndices, overrides = new Map(), blast = false) {
  const pending = [...seeds].map(index => ({ index, blast }));
  const cleared = new Set();
  const obstacleDamage = new Set();
  const activated = [];
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const { index, blast: directBlast } = pending[cursor];
    if (!inBounds(index) || cleared.has(index) || protectedIndices.has(index) || !board[index]) continue;
    if (board[index].obstacle) {
      if (directBlast || ['crate', 'battery'].includes(board[index].obstacle)) obstacleDamage.add(index);
      continue;
    }
    cleared.add(index);
    const special = overrides.get(index)?.special || board[index].special;
    if (!special) continue;
    activated.push({ index, special });
    if (special === 'row' || special === 'column') pending.push(...line(index, special).map(index => ({ index, blast: true })));
    if (special === 'bomb') pending.push(...area(index).map(index => ({ index, blast: true })));
    if (special === 'nova') {
      const kind = overrides.get(index)?.kind ?? board[index].kind;
      board.forEach((cell, target) => { if (cell?.obstacle || cell?.kind === kind) pending.push({ index: target, blast: true }); });
    }
  }
  for (const index of cleared) {
    for (const neighbor of [index - COLS, index + COLS, ...(col(index) > 0 ? [index - 1] : []), ...(col(index) < COLS - 1 ? [index + 1] : [])]) {
      if (inBounds(neighbor) && ['crate', 'battery'].includes(board[neighbor]?.obstacle)) obstacleDamage.add(neighbor);
    }
  }
  return { indices: [...cleared].sort((a, b) => a - b), activated, obstacleDamage: [...obstacleDamage].sort((a, b) => a - b) };
}

function refill(board, rng) {
  const result = Array(SIZE).fill(null);
  const ids = new Set(board.filter(Boolean).map(cell => cell.id));
  for (let c = 0; c < COLS; c++) {
    let targetRow = ROWS - 1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (board[r * COLS + c]) result[targetRow-- * COLS + c] = copyCell(board[r * COLS + c]);
    }
    while (targetRow >= 0) result[targetRow-- * COLS + c] = freshCell(rng, ids);
  }
  return result;
}

function result(board, valid = false, frames = []) {
  return { valid, frames, board: snapshot(board), cleared: zeroCounts(), score: 0, combo: 0 };
}

function resolve(board, rng, frames = [], first = null, preferred = []) {
  let working = snapshot(board);
  const outcome = result(working, true, frames);
  for (let chain = 1; chain <= MAX_CASCADES; chain++) {
    const found = matches(working);
    const forced = chain === 1 ? first : null;
    if (!forced && !found.indices.length) break;
    const created = forced ? [] : planSpecials(working, found.groups, chain === 1 ? preferred : []);
    const protectedIndices = new Set(created.map(item => item.index));
    const expanded = expandClears(working, forced?.seeds || new Set(found.indices), protectedIndices, forced?.overrides, forced?.blast);
    const cleared = expanded.indices.map(index => ({ index, cell: copyCell(working[index]) }));
    const obstacleHits = [];
    const obstacleBroken = [];
    let chargeBonus = 0;
    const ids = new Set(working.filter(Boolean).map(cell => cell.id));
    for (const index of expanded.obstacleDamage) {
      const cell = copyCell(working[index]);
      const hp = cell.hp - 1;
      obstacleHits.push({ index, cell: copyCell(cell), beforeHp: cell.hp, hp });
      if (hp > 0) { working[index] = { ...cell, hp }; continue; }
      obstacleBroken.push({ index, cell: copyCell(cell) });
      const special = { crate: 'bomb', battery: 'row', prism: 'nova' }[cell.obstacle];
      working[index] = null;
      if (special) created.push({ index, cell: { ...freshCell(rng, ids), special } });
      if (cell.obstacle === 'battery') chargeBonus += 12;
    }
    created.forEach(item => { working[item.index] = copyCell(item.cell); });
    cleared.forEach(({ index, cell }) => { outcome.cleared[cell.kind]++; working[index] = null; });
    const score = cleared.length * 60 * chain + expanded.activated.length * 120 + obstacleHits.length * 30 + obstacleBroken.reduce((sum, item) => sum + OBSTACLE_SCORE[item.cell.obstacle], 0);
    outcome.score += score;
    outcome.combo = chain;
    outcome.frames.push({ type: 'clear', board: snapshot(working), cleared, activated: expanded.activated.map(item => ({ ...item })), created: created.map(item => ({ index: item.index, cell: copyCell(item.cell) })), obstacleHits, obstacleBroken, chargeBonus, chain, score });
    working = refill(working, rng);
    outcome.frames.push({ type: 'fall', board: snapshot(working), chain });
  }
  // Both pathological cascades and natural deadlocks recover to a stable board.
  if (matches(working).indices.length || !legalMoves(working).length) {
    working = shuffledBoard(working, rng);
    outcome.frames.push({ type: 'shuffle', board: snapshot(working) });
  }
  outcome.board = snapshot(working);
  return outcome;
}

export function buildTurn(board, a, b, rng = Math.random) {
  assertBoard(board);
  if (!adjacent(a, b) || board[a].obstacle || board[b].obstacle) return result(board);
  const working = snapshot(board);
  [working[a], working[b]] = [working[b], working[a]];
  const frames = [{ type: 'swap', board: snapshot(working) }];
  if (isSpecialSwap(working[a], working[b])) return resolve(working, rng, frames, specialSeeds(working, a, b));
  const found = matches(working);
  if (board[a].kind === board[b].kind || !found.indices.some(index => index === a || index === b)) {
    frames.push({ type: 'rollback', board: snapshot(board) });
    return result(board, false, frames);
  }
  return resolve(working, rng, frames, null, [b, a]);
}

/** Tools: hammer clears one cell; bomb clears its 3x3 neighborhood; shuffle has no target. */
export function buildToolTurn(board, index, tool, rng = Math.random) {
  assertBoard(board);
  if (tool === 'shuffle') {
    const shuffled = shuffledBoard(board, rng);
    return result(shuffled, true, [{ type: 'shuffle', board: snapshot(shuffled) }]);
  }
  if (!inBounds(index) || !['hammer', 'bomb'].includes(tool)) return result(board);
  const seeds = new Set(tool === 'bomb' ? area(index) : [index]);
  return resolve(board, rng, [], { seeds, blast: tool === 'bomb' });
}

/** Rush taps produce an immediate local burst and then resolve all falls/chains. */
export function buildRushTurn(board, index, rng = Math.random) {
  assertBoard(board);
  if (!inBounds(index)) return result(board);
  return resolve(board, rng, [], { seeds: new Set(area(index)), blast: true });
}

/** Low-level atomic reward hit. Public reward selection lives in rewards.mjs. */
export function buildRewardTurn(board, targetIndices, rng = Math.random) {
  assertBoard(board);
  const seeds = new Set(Array.from(targetIndices ?? []).filter(inBounds));
  const outcome = seeds.size ? resolve(board, rng, [], { seeds, blast: true }) : result(board);
  // Keep the provenance even when a caller uses this lower-level entry point.
  outcome.rewardGenerated = true;
  return outcome;
}
