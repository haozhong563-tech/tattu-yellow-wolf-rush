import { createBoard, buildToolTurn, legalMoves, matches } from './model.mjs';

export const WORLD_PHASES = Object.freeze([
  { index: 0, id: 'ore', name: '雷岩矿场', subtitle: '三次强击 · 击碎雷岩', color: '#E9B455' },
  { index: 1, id: 'ice', name: '极光冰川', subtitle: '冰晶坠落 · 电力破障', color: '#72DDEB' },
  { index: 2, id: 'supply', name: '空投补给站', subtitle: '拆开补给 · 引爆连锁', color: '#CBA074' },
  { index: 3, id: 'battery', name: '电芯工厂', subtitle: '击破电池 · 储蓄能量', color: '#A7E56A' },
  { index: 4, id: 'prism', name: '棱镜星港', subtitle: '释放棱镜 · 点燃彩虹', color: '#C093F4' },
  { index: 5, id: 'storm', name: '超载风暴', subtitle: '混合空投 · 无限冲分', color: '#FF9670' },
].map(phase => Object.freeze(phase)));

const TYPES = [['rock'], ['rock'], ['crate'], ['battery'], ['prism'], ['rock', 'crate', 'battery', 'prism']];
const HP = { rock: 3, crate: 2, battery: 2, prism: 1 };
const clone = board => board.map(cell => ({ ...cell }));
const pick = (rng, count) => Math.min(count - 1, Math.max(0, Math.floor((Number(rng()) || 0) * count)));
const turnCount = turns => Math.max(0, Math.floor(Number(turns) || 0));

/** Every twelve completed player operations advances the scenery by one phase. */
export function worldPhase(turns = 0) {
  const count = turnCount(turns);
  return WORLD_PHASES[(Number.isFinite(count) ? Math.floor(count / 12) : 0) % WORLD_PHASES.length];
}

/**
 * Pure drop planner: the caller owns once-per-turn scheduling. Existing pieces
 * and obstacles are untouched; only eligible ordinary cells in the top two rows
 * may be replaced. A rejected candidate can never remove the last legal move.
 */
export function buildWorldDrop(board, turns, rng = Math.random) {
  const count = turnCount(turns);
  const phase = worldPhase(count);
  let working = clone(board);
  const drops = [];
  let recovered = false;
  if (matches(working).indices.length || !legalMoves(working).length) {
    working = buildToolTurn(working, 0, 'shuffle', rng).board;
    recovered = true;
  }
  if (!Number.isFinite(count) || count === 0 || count % 3 !== 0) return { board: working, drops, phase, recovered };
  const capacity = Math.max(0, 10 - working.filter(cell => cell.obstacle).length);
  const requested = Math.min(capacity, 1 + pick(rng, 2));
  const candidates = Array.from({ length: 16 }, (_, index) => index).filter(index => working[index] && !working[index].obstacle && !working[index].special);
  for (let index = candidates.length - 1; index > 0; index--) {
    const other = pick(rng, index + 1);
    [candidates[index], candidates[other]] = [candidates[other], candidates[index]];
  }
  for (const index of candidates) {
    if (drops.length >= requested) break;
    const types = TYPES[phase.index];
    const obstacle = types[pick(rng, types.length)];
    const original = working[index];
    const cell = { id: `world-${count}-${index}-${original.id}`, kind: -1, special: null, obstacle, hp: HP[obstacle] };
    working[index] = cell;
    if (matches(working).indices.length || !legalMoves(working).length) { working[index] = original; continue; }
    drops.push({ index, cell: { ...cell } });
  }
  return { board: clone(working), drops, phase, recovered };
}

/** A playable board with its first small ore drop already visible. */
export function initialWorldBoard(rng = Math.random) {
  return buildWorldDrop(createBoard(rng), 3, rng).board;
}
