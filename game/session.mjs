/** Pure local-session accounting. No DOM, storage, timers, or network authority.
 * Checkpoints detect corruption and invalid data; they are not server anti-cheat.
 * Every update returns a new session. Pass wall-clock milliseconds as `now`.
 */
export const SESSION_LIMIT_MS = 12 * 60 * 60 * 1000;
export const RUSH_DURATION_MS = 5000;
export const SESSION_SCHEMA_VERSION = 1;
export const MAX_SCORE = 1_000_000_000_000;
export const MAX_COUNTER = 1_000_000_000;
const MAX_TIME = 8_640_000_000_000_000 - SESSION_LIMIT_MS;
const MAX_SAVE_LENGTH = 256_000;
const OBSTACLES = Object.freeze({ rock: 3, crate: 2, battery: 2, prism: 1 });
const BREAK_POINTS = Object.freeze({ rock: 600, crate: 300, battery: 250, prism: 400 });
const SPECIALS = new Set(['row', 'column', 'bomb', 'nova']);
const REWARDS = ['hammer', 'drone', 'rift'];
const SOURCES = Object.freeze({ player: 1, rush: .6, reward: .5 });
const COUNTERS = ['moves', 'frames', 'cleared', 'rocksBroken', 'totalObstacles', 'obstacleHits', 'specialsActivated'];
const FINISH_REASONS = new Set(['timeout', 'banked', 'quit', 'manual', 'finished', 'completed']);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const timeOK = value => integer(value, 0, MAX_TIME);
const addBounded = (a, b, max = MAX_COUNTER) => Math.min(max, a + b);
const countObject = keys => Object.fromEntries(keys.map(key => [key, 0]));
const obstacleKinds = Object.keys(OBSTACLES);

function clock(now) {
  if (!timeOK(now)) throw new TypeError('Expected finite, non-negative wall-clock milliseconds.');
  return now;
}

function makeId(now) {
  const random = globalThis.crypto?.randomUUID?.() ?? `${now.toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `tata-${random}`;
}

const idOK = value => typeof value === 'string' && /^tata-[A-Za-z0-9_-]{8,110}$/.test(value);
const cellIdOK = value => typeof value === 'string' && value.length > 0 && value.length <= 128;

export function createSession(now = Date.now()) {
  now = clock(now);
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    id: makeId(now), startedAt: now, deadline: now + SESSION_LIMIT_MS, lastSeenAt: now,
    status: 'active', endedAt: null, reason: null,
    score: 0, moves: 0, frames: 0, cleared: 0, highestChain: 0,
    rocksBroken: 0, totalObstacles: 0, obstacleHits: 0, specialsActivated: 0,
    obstaclesBroken: countObject(obstacleKinds), rewardStats: countObject(REWARDS), phase: 0,
  };
}

function checkedCounts(value, keys) {
  if (!isObject(value) || keys.some(key => !integer(value[key], 0, MAX_COUNTER))) return null;
  return Object.fromEntries(keys.map(key => [key, value[key]]));
}

/** Returns a normalized copy or null. A changed deadline is always invalid. */
export function validateSession(value, now = Date.now()) {
  if (!timeOK(now) || !isObject(value) || value.schemaVersion !== SESSION_SCHEMA_VERSION || !idOK(value.id)) return null;
  if (!timeOK(value.startedAt) || value.startedAt > now || value.deadline !== value.startedAt + SESSION_LIMIT_MS) return null;
  if (!integer(value.lastSeenAt, value.startedAt, value.deadline) || value.lastSeenAt > now) return null;
  if (!['active', 'finished'].includes(value.status) || !integer(value.score, 0, MAX_SCORE)) return null;
  if (COUNTERS.some(key => !integer(value[key], 0, MAX_COUNTER)) || !integer(value.highestChain, 0, MAX_COUNTER) || !integer(value.phase, 0, 5)) return null;
  const broken = checkedCounts(value.obstaclesBroken, obstacleKinds), rewards = checkedCounts(value.rewardStats, REWARDS);
  if (!broken || !rewards || value.rocksBroken !== broken.rock || value.totalObstacles !== Math.min(MAX_COUNTER, obstacleKinds.reduce((sum, type) => sum + broken[type], 0))) return null;
  if (value.totalObstacles > value.obstacleHits || value.specialsActivated > value.cleared) return null;
  // Reject an invented score with no corresponding gameplay accounting.
  const rawMaximum = value.cleared * 100 + value.specialsActivated * 200 + value.obstacleHits * 30 + obstacleKinds.reduce((sum, type) => sum + broken[type] * BREAK_POINTS[type], 0);
  if (value.score > Math.min(MAX_SCORE, Math.floor(rawMaximum * 4.5))) return null;
  if (value.status === 'active') {
    if (value.endedAt !== null || value.reason !== null) return null;
  } else {
    if (!integer(value.endedAt, value.startedAt, value.deadline) || value.endedAt > now || !FINISH_REASONS.has(value.reason)) return null;
    if (value.lastSeenAt < value.endedAt || (value.reason === 'timeout' && value.endedAt !== value.deadline)) return null;
  }
  return {
    schemaVersion: SESSION_SCHEMA_VERSION, id: value.id, startedAt: value.startedAt, deadline: value.deadline,
    lastSeenAt: value.lastSeenAt, status: value.status, endedAt: value.endedAt, reason: value.reason,
    score: value.score, ...Object.fromEntries(COUNTERS.map(key => [key, value[key]])),
    highestChain: value.highestChain, obstaclesBroken: broken, rewardStats: rewards, phase: value.phase,
  };
}

function requireSession(value) {
  // Validating against its last observed timestamp permits checking expiration
  // separately and never silently grants time after a wall-clock rollback.
  const result = validateSession(value, Math.max(value?.lastSeenAt ?? 0, value?.startedAt ?? 0));
  if (!result) throw new TypeError('Invalid game session.');
  return result;
}

export function remainingMs(session, now = Date.now()) {
  if (!timeOK(now) || !isObject(session) || session.status !== 'active' || session.deadline !== session.startedAt + SESSION_LIMIT_MS) return 0;
  if (!timeOK(session.startedAt) || !integer(session.lastSeenAt, session.startedAt, session.deadline)) return 0;
  return Math.max(0, Math.min(SESSION_LIMIT_MS, session.deadline - Math.max(now, session.lastSeenAt, session.startedAt)));
}

function effectiveNow(session, now) { return Math.max(clock(now), session.lastSeenAt, session.startedAt); }

export function finalizeSession(session, reason = 'banked', now = Date.now()) {
  const next = requireSession(session);
  if (next.status === 'finished') return next;
  const observed = effectiveNow(next, now);
  const expired = observed >= next.deadline;
  if (!expired && !FINISH_REASONS.has(reason)) throw new TypeError('Unknown session finish reason.');
  next.status = 'finished';
  next.reason = expired ? 'timeout' : reason === 'timeout' ? 'banked' : reason;
  next.endedAt = Math.min(observed, next.deadline);
  next.lastSeenAt = next.endedAt;
  return next;
}

function readySession(session, now) {
  const next = requireSession(session);
  if (next.status === 'finished') return next;
  const observed = effectiveNow(next, now);
  if (observed >= next.deadline) return finalizeSession(next, 'timeout', observed);
  next.lastSeenAt = observed;
  return next;
}

function blankScore(source = 'player', phase = 0, chain = 1) {
  return { points: 0, base: 0, multiplier: 0, breakdown: {
    source, phase, chain, chainMultiplier: 1, sourceMultiplier: SOURCES[source] ?? 0, stageMultiplier: 1,
    cleared: 0, clearPoints: 0, specialsActivated: 0, specialPoints: 0,
    obstacleHits: 0, obstacleHitPoints: 0, obstaclesBroken: countObject(obstacleKinds), obstacleBreakPoints: 0,
  } };
}

/** Score only actual clear-frame events; never trusts frame.score or wall time.
 * Ordinary clears:100, activated special:200, obstacle hit:30, destroyed obstacle
 * rock:600/crate:300/battery:250/prism:400; all share bounded multipliers.
 */
export function scoreFrame(frame, { source = 'player', phase = 0 } = {}) {
  const stage = Number.isFinite(phase) ? Math.max(0, Math.min(5, Math.floor(phase))) : 0;
  const chain = Number.isFinite(frame?.chain) ? Math.max(1, Math.min(MAX_COUNTER, Math.floor(frame.chain))) : 1;
  if (frame?.type !== 'clear' || !Object.hasOwn(SOURCES, source)) return blankScore(source, stage, chain);
  const cleared = new Map(), byIndex = new Map();
  for (const item of Array.isArray(frame.cleared) ? frame.cleared : []) {
    const cell = item?.cell;
    if (!cellIdOK(cell?.id) || !integer(cell.kind, 0, 5) || cell.obstacle || !integer(item.index, 0, 71) || cleared.has(cell.id) || byIndex.has(item.index)) continue;
    cleared.set(cell.id, cell); byIndex.set(item.index, cell);
  }
  const activated = new Set();
  for (const item of Array.isArray(frame.activated) ? frame.activated : []) {
    const cell = item?.cell?.id ? cleared.get(item.cell.id) : byIndex.get(item?.index);
    if (cell && SPECIALS.has(item?.special) && cell.special === item.special) activated.add(cell.id);
  }
  const hits = new Map(), hitIndices = new Set();
  for (const item of Array.isArray(frame.obstacleHits) ? frame.obstacleHits : []) {
    const cell = item?.cell, type = cell?.obstacle;
    if (!cellIdOK(cell?.id) || !Object.hasOwn(OBSTACLES, type ?? '') || cell.kind !== -1 || cell.special !== null || !integer(item.index, 0, 71)) continue;
    if (cleared.has(cell.id) || byIndex.has(item.index) || hits.has(cell.id) || hitIndices.has(item.index)) continue;
    if (!integer(cell.hp, 1, OBSTACLES[type]) || item.beforeHp !== cell.hp || item.hp !== item.beforeHp - 1) continue;
    hits.set(cell.id, { type, hp: item.hp, index: item.index }); hitIndices.add(item.index);
  }
  const broken = countObject(obstacleKinds), brokenIds = new Set();
  for (const item of Array.isArray(frame.obstacleBroken) ? frame.obstacleBroken : []) {
    const cell = item?.cell, hit = hits.get(cell?.id);
    if (!hit || hit.hp !== 0 || hit.index !== item.index || hit.type !== cell.obstacle || brokenIds.has(cell.id)) continue;
    brokenIds.add(cell.id); broken[hit.type]++;
  }
  const clearPoints = cleared.size * 100, specialPoints = activated.size * 200;
  const obstacleHitPoints = hits.size * 30;
  const obstacleBreakPoints = obstacleKinds.reduce((sum, type) => sum + broken[type] * BREAK_POINTS[type], 0);
  const base = clearPoints + specialPoints + obstacleHitPoints + obstacleBreakPoints;
  const chainMultiplier = 1 + .25 * (Math.min(chain, 9) - 1), sourceMultiplier = SOURCES[source], stageMultiplier = 1 + stage * .1;
  const multiplier = chainMultiplier * sourceMultiplier * stageMultiplier;
  return {
    points: Math.min(MAX_SCORE, Math.round(base * multiplier)), base, multiplier,
    breakdown: { source, phase: stage, chain, chainMultiplier, sourceMultiplier, stageMultiplier,
      cleared: cleared.size, clearPoints, specialsActivated: activated.size, specialPoints,
      obstacleHits: hits.size, obstacleHitPoints, obstaclesBroken: broken, obstacleBreakPoints },
  };
}

/** Commits one clear frame. Returns a new session; does not count a player move. */
export function commitFrame(session, frame, options = {}) {
  const next = readySession(session, options.now ?? Date.now());
  if (next.status !== 'active') return next;
  const scored = scoreFrame(frame, { source: options.source ?? 'player', phase: options.phase ?? next.phase });
  if (frame?.type !== 'clear' || scored.base === 0) return next;
  const b = scored.breakdown;
  next.score = addBounded(next.score, scored.points, MAX_SCORE);
  next.frames = addBounded(next.frames, 1);
  next.cleared = addBounded(next.cleared, b.cleared);
  next.specialsActivated = addBounded(next.specialsActivated, b.specialsActivated);
  next.highestChain = Math.max(next.highestChain, b.chain);
  next.obstacleHits = addBounded(next.obstacleHits, b.obstacleHits);
  for (const type of obstacleKinds) next.obstaclesBroken[type] = addBounded(next.obstaclesBroken[type], b.obstaclesBroken[type]);
  next.rocksBroken = next.obstaclesBroken.rock;
  next.totalObstacles = Math.min(MAX_COUNTER, obstacleKinds.reduce((sum, type) => sum + next.obstaclesBroken[type], 0));
  next.phase = b.phase;
  return next;
}

/** Call only for a valid player exchange/core action, not cascades or support. */
export function recordMove(session, now = Date.now()) {
  const next = readySession(session, now);
  if (next.status === 'active') next.moves = addBounded(next.moves, 1);
  return next;
}

export function recordReward(session, type, count = 1, now = Date.now()) {
  const next = readySession(session, now);
  if (next.status === 'active' && REWARDS.includes(type) && integer(count, 1, MAX_COUNTER)) next.rewardStats[type] = addBounded(next.rewardStats[type], count);
  return next;
}

/** Validate/clone a full settled board, preserving known obstacle/HP fields. */
export function validateBoard(board) {
  if (!Array.isArray(board) || board.length !== 72) return null;
  const ids = new Set(), result = [];
  for (const cell of board) {
    if (!isObject(cell) || !cellIdOK(cell.id) || ids.has(cell.id)) return null;
    ids.add(cell.id);
    if (cell.obstacle !== undefined && cell.obstacle !== null) {
      if (!Object.hasOwn(OBSTACLES, cell.obstacle) || cell.kind !== -1 || cell.special !== null || !integer(cell.hp, 1, OBSTACLES[cell.obstacle])) return null;
      result.push({ id: cell.id, kind: -1, special: null, obstacle: cell.obstacle, hp: cell.hp });
    } else {
      if (!integer(cell.kind, 0, 5) || !(cell.special === null || SPECIALS.has(cell.special))) return null;
      if (cell.hp !== undefined && cell.hp !== 0) return null;
      const copy = { id: cell.id, kind: cell.kind, special: cell.special };
      if (Object.hasOwn(cell, 'obstacle')) copy.obstacle = null;
      if (Object.hasOwn(cell, 'hp')) copy.hp = cell.hp;
      result.push(copy);
    }
  }
  return result;
}

function checkpointState(value, session) {
  if (!isObject(value) || !Number.isFinite(value.energy) || value.energy < 0 || value.energy > 100 || !integer(value.worldDropsAt, 0, session.moves)) return null;
  if (value.rushRemaining !== undefined && value.rushRemaining !== 0) return null;
  const rewards = checkedCounts(value.rewardStats, REWARDS);
  return rewards ? { energy: value.energy, rewardStats: rewards, worldDropsAt: value.worldDropsAt } : null;
}

function checksum(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Save only after the scene has settled and outside rush/cinematic resolution. */
export function createCheckpoint(session, board, state = {}, now = Date.now()) {
  now = clock(now);
  const current = readySession(session, now), cells = validateBoard(board);
  if (!cells) throw new TypeError('Checkpoint requires 72 non-empty cells with unique IDs and valid obstacle HP.');
  const ui = checkpointState({ energy: 0, rewardStats: current.rewardStats, worldDropsAt: 0, ...state }, current);
  if (!ui) throw new TypeError('Invalid checkpoint state; save only a settled, non-rush board.');
  const payload = { schemaVersion: SESSION_SCHEMA_VERSION, savedAt: Math.max(now, current.lastSeenAt), session: current, board: cells, state: ui };
  return { ...payload, checksum: checksum(JSON.stringify(payload)) };
}

/** Accepts checkpoint JSON/object; returns a normalized checkpoint or null.
 * Expired but otherwise sound checkpoints remain readable for final settlement.
 */
export function parseCheckpoint(input, now = Date.now()) {
  if (!timeOK(now)) return null;
  let value;
  try {
    if (typeof input === 'string') {
      if (input.length > MAX_SAVE_LENGTH) return null;
      value = JSON.parse(input);
    } else value = input;
    if (!isObject(value) || value.schemaVersion !== SESSION_SCHEMA_VERSION || !timeOK(value.savedAt) || value.savedAt > now) return null;
    const session = validateSession(value.session, now), board = validateBoard(value.board);
    if (!session || !board || value.savedAt < session.lastSeenAt || value.savedAt < session.startedAt) return null;
    const state = checkpointState(value.state, session);
    if (!state) return null;
    const payload = { schemaVersion: SESSION_SCHEMA_VERSION, savedAt: value.savedAt, session, board, state };
    if (typeof value.checksum !== 'string' || value.checksum !== checksum(JSON.stringify(payload))) return null;
    return { ...payload, checksum: value.checksum };
  } catch { return null; }
}

/** Either serializeCheckpoint(checkpoint) or (session, board, state, now). */
export function serializeCheckpoint(sessionOrCheckpoint, board, state = {}, now = Date.now()) {
  const checkpoint = board === undefined ? parseCheckpoint(sessionOrCheckpoint, now) : createCheckpoint(sessionOrCheckpoint, board, state, now);
  if (!checkpoint) throw new TypeError('Cannot serialize an invalid checkpoint.');
  return JSON.stringify(checkpoint);
}

function leaderboardEntry(session) {
  return { sessionId: session.id, score: session.score, startedAt: session.startedAt, endedAt: session.endedAt,
    moves: session.moves, cleared: session.cleared, highestChain: session.highestChain, rocksBroken: session.rocksBroken, totalObstacles: session.totalObstacles, reason: session.reason };
}

/** Local-device records only. Unknown or invalid entries reject the payload. */
export function validateLeaderboard(value, now = Date.now()) {
  if (!timeOK(now) || !Array.isArray(value) || value.length > 10) return null;
  const ids = new Set(), entries = [];
  for (const entry of value) {
    if (!isObject(entry) || !idOK(entry.sessionId) || ids.has(entry.sessionId) || !integer(entry.score, 0, MAX_SCORE)) return null;
    if (!timeOK(entry.startedAt) || !integer(entry.endedAt, entry.startedAt, entry.startedAt + SESSION_LIMIT_MS) || entry.endedAt > now || !FINISH_REASONS.has(entry.reason)) return null;
    if (entry.reason === 'timeout' && entry.endedAt !== entry.startedAt + SESSION_LIMIT_MS) return null;
    if (['moves', 'cleared', 'rocksBroken', 'totalObstacles', 'highestChain'].some(key => !integer(entry[key], 0, MAX_COUNTER)) || entry.rocksBroken > entry.totalObstacles) return null;
    ids.add(entry.sessionId);
    entries.push(Object.fromEntries(['sessionId', 'score', 'startedAt', 'endedAt', 'moves', 'cleared', 'highestChain', 'rocksBroken', 'totalObstacles', 'reason'].map(key => [key, entry[key]])));
  }
  return entries.sort((a, b) => b.score - a.score || a.endedAt - b.endedAt || a.sessionId.localeCompare(b.sessionId));
}

/** A session ID has one final entry; a repeated submission never replaces it. */
export function addLeaderboardEntry(entries, session, now = Date.now()) {
  const ranked = validateLeaderboard(entries, now) ?? [];
  const complete = validateSession(session, now);
  if (!complete || complete.status !== 'finished' || ranked.some(entry => entry.sessionId === complete.id)) return ranked;
  ranked.push(leaderboardEntry(complete));
  return ranked.sort((a, b) => b.score - a.score || a.endedAt - b.endedAt || a.sessionId.localeCompare(b.sessionId)).slice(0, 10);
}

export function parseLeaderboard(input, now = Date.now()) {
  try {
    if (typeof input === 'string' && input.length > 32_000) return null;
    return validateLeaderboard(typeof input === 'string' ? JSON.parse(input) : input, now);
  } catch { return null; }
}

export function serializeLeaderboard(entries, now = Date.now()) {
  const value = validateLeaderboard(entries, now);
  if (!value) throw new TypeError('Invalid local leaderboard.');
  return JSON.stringify(value);
}
