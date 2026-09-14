/** Pure, deterministic match-three rules. No browser or rendering dependencies. */
export const ROWS = 9;
export const COLS = 8;
const SIZE = ROWS * COLS;
const KINDS = 6;
const MAX_CASCADES = 24;
let nextId = 0;

const copyCell = cell => cell ? { ...cell } : null;
const snapshot = board => board.map(copyCell);
const row = index => Math.floor(index / COLS);
const col = index => index % COLS;
const inBounds = index => Number.isInteger(index) && index >= 0 && index < SIZE;
const adjacent = (a, b) => inBounds(a) && inBounds(b) && Math.abs(row(a) - row(b)) + Math.abs(col(a) - col(b)) === 1;
const pick = (rng, count) => Math.min(count - 1, Math.max(0, Math.floor((Number(rng()) || 0) * count)));
const zeroCounts = () => Array(KINDS).fill(0);

function assertBoard(board) {
  if (!Array.isArray(board) || board.length !== SIZE || board.some(cell => !cell || !Number.isInteger(cell.kind) || cell.kind < 0 || cell.kind >= KINDS)) {
    throw new TypeError(`Expected a full ${COLS} by ${ROWS} board with kinds 0 through ${KINDS - 1}.`);
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
      const kind = board[start]?.kind;
      let end = c + 1;
      while (kind !== undefined && end < COLS && board[r * COLS + end]?.kind === kind) end++;
      if (kind !== undefined && end - c >= 3) groups.push({ kind, orientation: 'row', indices: Array.from({ length: end - c }, (_, n) => start + n) });
      c = end;
    }
  }
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS;) {
      const start = r * COLS + c;
      const kind = board[start]?.kind;
      let end = r + 1;
      while (kind !== undefined && end < ROWS && board[end * COLS + c]?.kind === kind) end++;
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
      if (!working[a] || !working[b]) continue;
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
  const working = snapshot(board);
  const fallback = fallbackRandom(0x2c9861);
  for (let attempt = 0; attempt < 1200; attempt++) {
    const random = attempt < 120 ? rng : fallback;
    for (let i = SIZE - 1; i > 0; i--) {
      const j = pick(random, i + 1);
      [working[i], working[j]] = [working[j], working[i]];
    }
    if (!matches(working).indices.length && legalMoves(working).length) return working;
  }
  // Extremely imbalanced externally supplied boards cannot always be shuffled.
  // Preserve identities/specials and repair their colors as a last resort.
  const colors = createBoard(fallback);
  return working.map((cell, index) => ({ ...cell, kind: colors[index].kind }));
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
      if (cell.kind !== partner.kind) return;
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
  return { seeds, overrides };
}

function expandClears(board, seeds, protectedIndices, overrides = new Map()) {
  const pending = [...seeds];
  const cleared = new Set();
  const activated = [];
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const index = pending[cursor];
    if (!inBounds(index) || cleared.has(index) || protectedIndices.has(index) || !board[index]) continue;
    cleared.add(index);
    const special = overrides.get(index)?.special || board[index].special;
    if (!special) continue;
    activated.push({ index, special });
    if (special === 'row' || special === 'column') pending.push(...line(index, special));
    if (special === 'bomb') pending.push(...area(index));
    if (special === 'nova') {
      const kind = overrides.get(index)?.kind ?? board[index].kind;
      board.forEach((cell, target) => { if (cell?.kind === kind) pending.push(target); });
    }
  }
  return { indices: [...cleared].sort((a, b) => a - b), activated };
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
    const expanded = expandClears(working, forced?.seeds || new Set(found.indices), protectedIndices, forced?.overrides);
    const cleared = expanded.indices.map(index => ({ index, cell: copyCell(working[index]) }));
    created.forEach(item => { working[item.index] = copyCell(item.cell); });
    cleared.forEach(({ index, cell }) => { outcome.cleared[cell.kind]++; working[index] = null; });
    const score = cleared.length * 60 * chain + expanded.activated.length * 120;
    outcome.score += score;
    outcome.combo = chain;
    outcome.frames.push({ type: 'clear', board: snapshot(working), cleared, activated: expanded.activated.map(item => ({ ...item })), created: created.map(item => ({ index: item.index, cell: copyCell(item.cell) })), chain, score });
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
  if (!adjacent(a, b)) return result(board);
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
  return resolve(board, rng, [], { seeds });
}

/** Rush taps produce an immediate local burst and then resolve all falls/chains. */
export function buildRushTurn(board, index, rng = Math.random) {
  assertBoard(board);
  if (!inBounds(index)) return result(board);
  return resolve(board, rng, [], { seeds: new Set(area(index)) });
}

/** Low-level atomic reward hit. Public reward selection lives in rewards.mjs. */
export function buildRewardTurn(board, targetIndices, rng = Math.random) {
  assertBoard(board);
  const seeds = new Set(Array.from(targetIndices ?? []).filter(inBounds));
  const outcome = seeds.size ? resolve(board, rng, [], { seeds }) : result(board);
  // Keep the provenance even when a caller uses this lower-level entry point.
  outcome.rewardGenerated = true;
  return outcome;
}
