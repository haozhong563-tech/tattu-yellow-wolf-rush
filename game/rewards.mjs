import { ROWS, COLS, buildRewardTurn as resolveTargets, buildToolTurn } from './model.mjs';

const SIZE = ROWS * COLS;
const TYPES = ['hammer', 'drone', 'rift'];
const SPECIAL_REWARD = { row: 'hammer', column: 'hammer', bomb: 'drone', nova: 'rift' };
const validIndex = index => Number.isInteger(index) && index >= 0 && index < SIZE;
const row = index => Math.floor(index / COLS);
const col = index => index % COLS;
const distance = (a, b) => Math.abs(row(a) - row(b)) + Math.abs(col(a) - col(b));

/**
 * Specials award physical props only when actually activated and cleared.
 * A cell can earn at most once, even if overlapping beams report it repeatedly.
 * This module has no inventory, persistent state, clocks, or browser dependency.
 */
export function planRewards(turn, { source = 'player' } = {}) {
  if (!turn?.valid || !['player', 'rush'].includes(source) || turn.rewardGenerated || turn.meta?.source === 'reward') return [];
  const seen = new Set();
  const rewards = new Map();
  for (const frame of turn.frames ?? []) {
    if (frame.type !== 'clear') continue;
    const cleared = new Map((frame.cleared ?? []).map(item => [item.index, item.cell]));
    for (const activated of frame.activated ?? []) {
      const cell = cleared.get(activated.index);
      const type = SPECIAL_REWARD[activated.special];
      if (!type || !cell || cell.id === undefined || cell.id === null || seen.has(cell.id)) continue;
      seen.add(cell.id);
      const reward = rewards.get(type);
      if (reward) reward.count = Math.min(3, reward.count + 1);
      else rewards.set(type, { type, count: 1, origin: activated.index });
    }
  }
  return [...rewards.values()];
}

function neighborhood(center) {
  const result = [];
  for (let r = Math.max(0, row(center) - 1); r <= Math.min(ROWS - 1, row(center) + 1); r++) {
    for (let c = Math.max(0, col(center) - 1); c <= Math.min(COLS - 1, col(center) + 1); c++) result.push(r * COLS + c);
  }
  return result;
}

function cross(center) {
  return Array.from({ length: SIZE }, (_, index) => index).filter(index => row(index) === row(center) || col(index) === col(center));
}

function rankCell(board, index, ice, origin) {
  return (ice.has(index) ? 1000 : 0) + (board[index].obstacle ? 750 : 0) + (board[index].special ? 30 : 0) + (!board[index].obstacle && board[index].kind < 2 ? 12 : 0) - distance(index, origin) * .01;
}

function hammerTargets(board, count, ice, origin) {
  return Array.from({ length: SIZE }, (_, index) => index)
    .sort((a, b) => rankCell(board, b, ice, origin) - rankCell(board, a, ice, origin) || a - b)
    .slice(0, Math.min(4, count + 1));
}

function areaScore(board, indices, ice, covered, origin, center) {
  let score = 0;
  for (const index of indices) {
    if (covered.has(index)) continue;
    score += (ice.has(index) ? 1000 : 0) + (board[index].obstacle ? 750 : 0) + (board[index].special ? 30 : 0) + (!board[index].obstacle && board[index].kind < 2 ? 12 : 0) + 1;
  }
  return score - distance(center, origin) * .01;
}

function droneTargets(board, count, ice, origin) {
  const centers = [];
  const covered = new Set();
  for (let n = 0; n < Math.min(2, count); n++) {
    let chosen = null;
    let best = -Infinity;
    for (let center = 0; center < SIZE; center++) {
      if (centers.includes(center)) continue;
      const area = neighborhood(center);
      const score = areaScore(board, area, ice, covered, origin, center);
      if (score > best) { chosen = center; best = score; }
    }
    centers.push(chosen);
    neighborhood(chosen).forEach(index => covered.add(index));
  }
  return { targets: centers, indices: [...covered].sort((a, b) => a - b) };
}

function riftTarget(board, ice, origin) {
  const important = new Set([...ice, ...board.flatMap((cell, index) => cell.obstacle ? [index] : [])]);
  const candidates = important.size ? [...important] : Array.from({ length: SIZE }, (_, index) => index);
  return candidates.sort((a, b) => areaScore(board, cross(b), ice, new Set(), origin, b) - areaScore(board, cross(a), ice, new Set(), origin, a) || a - b)[0];
}

/**
 * Public automatic-reward API. Targets are cell indices (hammer impact cells,
 * drone blast centers, or a rift cross center), ready for the scene to animate.
 * All targeted hits happen atomically before gravity. Rifts first shuffle.
 */
export function buildRewardTurn(board, reward, iceIndices = [], rng = Math.random) {
  const count = Math.floor(Number(reward?.count ?? 1));
  const type = reward?.type;
  const origin = validIndex(reward?.origin) ? reward.origin : 0;
  if (!TYPES.includes(type) || !Number.isFinite(count) || count <= 0) {
    const outcome = resolveTargets(board, [], rng);
    outcome.meta = { source: 'reward', type: type ?? null, count: 0, origin, targets: [], clearTargets: [] };
    return outcome;
  }
  const strength = Math.min(3, count);
  const ice = new Set(Array.from(iceIndices ?? []).filter(validIndex));
  let working = board;
  let before = [];
  let targets;
  let indices;
  if (type === 'hammer') {
    targets = hammerTargets(working, strength, ice, origin);
    indices = [...targets];
  } else if (type === 'drone') {
    ({ targets, indices } = droneTargets(working, strength, ice, origin));
  } else {
    const shuffled = buildToolTurn(board, 0, 'shuffle', rng);
    working = shuffled.board;
    before = shuffled.frames;
    const center = riftTarget(working, ice, origin);
    targets = [center];
    indices = cross(center);
  }
  const outcome = resolveTargets(working, indices, rng);
  outcome.frames = [...before, ...outcome.frames];
  outcome.meta = { source: 'reward', type, count: strength, origin, targets: [...targets], clearTargets: [...indices] };
  return outcome;
}
