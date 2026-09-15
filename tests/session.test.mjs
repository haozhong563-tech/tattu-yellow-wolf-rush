import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSION_LIMIT_MS, RUSH_DURATION_MS, MAX_SCORE, MAX_COUNTER,
  createSession, remainingMs, scoreFrame, commitFrame, recordMove, recordReward,
  finalizeSession, validateSession, validateBoard, createCheckpoint,
  parseCheckpoint, serializeCheckpoint, addLeaderboardEntry, validateLeaderboard,
  parseLeaderboard, serializeLeaderboard,
} from '../game/session.mjs';
import { GameAudio, TRACKS } from '../game/audio.mjs';

const NOW = 1_750_000_000_000;
const clone = value => JSON.parse(JSON.stringify(value));
const cell = (index, special = null) => ({ id: `tile-${index}`, kind: index % 6, special });
const board = () => Array.from({ length: 72 }, (_, index) => cell(index));
const basicFrame = () => ({ type: 'clear', chain: 1, cleared: [0, 1, 2].map(index => ({ index, cell: cell(index) })), activated: [], obstacleHits: [], obstacleBroken: [] });
const obstacle = (id, type, hp) => ({ id, kind: -1, special: null, obstacle: type, hp });
const sealed = value => {
  const payload = clone(value);
  delete payload.checksum;
  let hash = 0x811c9dc5;
  const text = JSON.stringify(payload);
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return { ...payload, checksum: (hash >>> 0).toString(16).padStart(8, '0') };
};

test('session starts with a fixed 12-hour wall-clock deadline and a five-second rush constant', () => {
  const session = createSession(NOW);
  assert.equal(SESSION_LIMIT_MS, 43_200_000);
  assert.equal(RUSH_DURATION_MS, 5000);
  assert.equal(session.deadline, NOW + SESSION_LIMIT_MS);
  assert.equal(remainingMs(session, NOW), SESSION_LIMIT_MS);
  assert.equal(remainingMs(session, NOW + 3_600_000), 11 * 3_600_000);
  assert.equal(remainingMs(session, session.deadline - 1), 1);
  assert.equal(remainingMs(session, session.deadline), 0);
  assert.equal(remainingMs(session, session.deadline + 1_000_000), 0);
  assert.notEqual(session.id, createSession(NOW).id);
});

test('pause, closing a tab and repeated checkpoints never extend the deadline', () => {
  let session = createSession(NOW);
  const originalDeadline = session.deadline;
  for (const hours of [1, 3, 7, 11]) {
    const now = NOW + hours * 3_600_000;
    const save = createCheckpoint(session, board(), {}, now);
    const restored = parseCheckpoint(JSON.stringify(save), now + 60_000);
    assert.ok(restored);
    session = restored.session;
    assert.equal(session.deadline, originalDeadline);
    assert.equal(remainingMs(session, now + 60_000), originalDeadline - now - 60_000);
  }
  const afterAbsence = NOW + 15 * 3_600_000;
  assert.equal(remainingMs(session, afterAbsence), 0);
  const expired = commitFrame(session, basicFrame(), { now: afterAbsence });
  assert.equal(expired.score, 0);
  assert.equal(expired.status, 'finished');
  assert.equal(expired.reason, 'timeout');
  assert.equal(expired.endedAt, originalDeadline);
});

test('observed time never rolls backward and a rollback cannot restore elapsed time', () => {
  let session = recordMove(createSession(NOW), NOW + 5000);
  session = recordMove(session, NOW + 1000);
  assert.equal(session.lastSeenAt, NOW + 5000);
  assert.equal(remainingMs(session, NOW), SESSION_LIMIT_MS - 5000);
  const checkpoint = createCheckpoint(session, board(), {}, NOW + 6000);
  assert.equal(parseCheckpoint(checkpoint, NOW + 4000), null, 'future save relative to rolled-back clock rejected');
});

test('frame scoring applies the documented bounded multipliers and ignores precomputed score', () => {
  const frame = basicFrame();
  frame.chain = 5; frame.score = Infinity;
  assert.equal(scoreFrame(frame).points, 600);
  assert.equal(scoreFrame(frame, { source: 'rush', phase: 5 }).points, 540);
  assert.equal(scoreFrame(frame, { source: 'reward', phase: 5 }).points, 450);
  frame.chain = 1e20;
  const max = scoreFrame(frame, { phase: 1000 });
  assert.equal(max.multiplier, 4.5);
  assert.equal(max.points, 1350);
  assert.equal(max.breakdown.chain, MAX_COUNTER);
  assert.equal(max.breakdown.phase, 5);
  assert.equal(scoreFrame(frame, { source: 'forged' }).points, 0);
  assert.equal(scoreFrame({ type: 'wait', score: 1e12 }).points, 0);
  assert.equal(scoreFrame({ type: 'fall', board: board() }).points, 0);
  assert.equal(scoreFrame({ ...frame, chain: NaN }, { phase: Infinity }).points, 300);
});

test('duplicate cell IDs and positions within a frame score once, including activated specials', () => {
  const first = cell(0, 'row'), second = cell(1, 'bomb');
  const frame = { type: 'clear', chain: 1,
    cleared: [{ index: 0, cell: first }, { index: 5, cell: first }, { index: 1, cell: second }, { index: 1, cell: cell(6) }],
    activated: [{ index: 0, special: 'row' }, { index: 0, special: 'row' }, { index: 1, special: 'bomb' }, { index: 5, special: 'nova' }, { index: 2, special: 'row' }],
  };
  const score = scoreFrame(frame);
  assert.equal(score.breakdown.cleared, 2);
  assert.equal(score.breakdown.specialsActivated, 2);
  assert.equal(score.base, 600);
});

test('obstacle hits and actual destruction score independently without counting obstacles as colors', () => {
  const types = ['rock', 'crate', 'battery', 'prism'];
  const cells = types.map((type, index) => obstacle(`obstacle-${index}`, type, 1));
  const frame = { type: 'clear', chain: 1,
    cleared: cells.map((cell, index) => ({ index, cell })),
    activated: [],
    obstacleHits: cells.map((cell, index) => ({ index, cell, beforeHp: 1, hp: 0 })),
    obstacleBroken: cells.map((cell, index) => ({ index, cell })),
  };
  frame.obstacleHits.push(clone(frame.obstacleHits[0]));
  frame.obstacleBroken.push(clone(frame.obstacleBroken[1]));
  const scored = scoreFrame(frame);
  assert.equal(scored.breakdown.cleared, 0);
  assert.equal(scored.breakdown.obstacleHits, 4);
  assert.deepEqual(scored.breakdown.obstaclesBroken, { rock: 1, crate: 1, battery: 1, prism: 1 });
  assert.equal(scored.breakdown.obstacleHitPoints, 120);
  assert.equal(scored.breakdown.obstacleBreakPoints, 1550);
  assert.equal(scored.points, 1670);
  const rock = obstacle('hard-rock', 'rock', 3);
  assert.equal(scoreFrame({ type: 'clear', obstacleHits: [{ index: 9, cell: rock, beforeHp: 3, hp: 2 }], obstacleBroken: [{ index: 9, cell: rock }] }).points, 30);
  assert.equal(scoreFrame({ type: 'clear', obstacleHits: [{ index: 9, cell: rock, beforeHp: 3, hp: 0 }], obstacleBroken: [{ index: 9, cell: rock }] }).points, 0, 'forged multi-HP hit rejected');
  assert.equal(scoreFrame({ type: 'clear', obstacleBroken: [{ index: 9, cell: rock }] }).points, 0, 'destruction requires a real final hit');
});

test('commitFrame is immutable, counts only explicit frames and never grants passive time points', () => {
  const original = createSession(NOW), frozen = clone(original), frame = basicFrame(), frameBefore = clone(frame);
  let session = commitFrame(original, frame, { now: NOW + 1, phase: 2 });
  assert.equal(session.score, 360);
  assert.equal(session.cleared, 3);
  assert.equal(session.frames, 1);
  assert.equal(session.moves, 0);
  assert.equal(session.highestChain, 1);
  assert.deepEqual(original, frozen);
  assert.deepEqual(frame, frameBefore);
  session = commitFrame(session, { type: 'wait', score: 999999 }, { now: NOW + 3_600_000 });
  assert.equal(session.score, 360);
  assert.equal(session.frames, 1);
  session = recordMove(session, NOW + 3_600_001);
  session = recordReward(session, 'hammer', 3, NOW + 3_600_002);
  assert.equal(session.moves, 1);
  assert.equal(session.rewardStats.hammer, 3);
});

test('all counters and the score saturate safely without unsafe integer overflow', () => {
  const session = createSession(NOW);
  Object.assign(session, { score: MAX_SCORE - 10, cleared: MAX_COUNTER, specialsActivated: MAX_COUNTER, moves: MAX_COUNTER, frames: MAX_COUNTER, highestChain: 9, phase: 5 });
  session.rewardStats.hammer = MAX_COUNTER;
  let next = commitFrame(session, basicFrame(), { phase: 5, now: NOW + 1 });
  next = recordMove(next, NOW + 2);
  next = recordReward(next, 'hammer', 9, NOW + 3);
  assert.equal(next.score, MAX_SCORE);
  assert.equal(next.cleared, MAX_COUNTER);
  assert.equal(next.moves, MAX_COUNTER);
  assert.equal(next.frames, MAX_COUNTER);
  assert.equal(next.rewardStats.hammer, MAX_COUNTER);
  assert.ok(validateSession(next, NOW + 3));
  assert.ok(Number.isSafeInteger(next.score));
});

test('deadline finalization is idempotent and no later frame or move alters a submitted score', () => {
  const live = commitFrame(createSession(NOW), basicFrame(), { now: NOW + 1 });
  const done = finalizeSession(live, 'banked', NOW + 100);
  assert.equal(done.status, 'finished');
  assert.equal(done.reason, 'banked');
  assert.equal(remainingMs(done, NOW + 100), 0);
  assert.deepEqual(finalizeSession(done, 'timeout', NOW + SESSION_LIMIT_MS + 1), done);
  assert.deepEqual(commitFrame(done, basicFrame(), { now: NOW + 101 }), done);
  assert.deepEqual(recordMove(done, NOW + 101), done);
  const expired = finalizeSession(live, 'banked', NOW + SESSION_LIMIT_MS + 1);
  assert.equal(expired.reason, 'timeout');
  assert.equal(expired.endedAt, live.deadline);
});

test('checkpoint round-trip preserves every obstacle HP/special and carries finite UI state', () => {
  const cells = board();
  cells[0] = obstacle('rock-a', 'rock', 3);
  cells[1] = obstacle('crate-a', 'crate', 2);
  cells[2] = obstacle('battery-a', 'battery', 1);
  cells[3] = obstacle('prism-a', 'prism', 1);
  cells[4].special = 'nova'; cells[5].special = 'column';
  cells[6].obstacle = null; cells[6].hp = 0;
  const session = recordMove(createSession(NOW), NOW + 1);
  const state = { energy: 87.2, rewardStats: { hammer: 2, drone: 1, rift: 0 }, worldDropsAt: 1 };
  const serialized = serializeCheckpoint(session, cells, state, NOW + 2);
  const restored = parseCheckpoint(serialized, NOW + 6000);
  assert.ok(restored);
  assert.deepEqual(restored.board, cells);
  assert.deepEqual(restored.state, state);
  assert.equal(restored.session.id, session.id);
  assert.equal(restored.session.deadline, session.deadline);
  assert.ok(parseCheckpoint(serializeCheckpoint(restored, undefined, undefined, NOW + 6000), NOW + 6000));
  restored.board[0].hp = 1;
  assert.equal(cells[0].hp, 3);
});

test('corrupted or forged checkpoints fail structural, deadline, accounting and checksum checks', () => {
  const good = createCheckpoint(createSession(NOW), board(), {}, NOW + 5);
  assert.ok(parseCheckpoint(good, NOW + 10));
  const mutations = [
    cp => { cp.schemaVersion = 99; },
    cp => { cp.session.deadline += 1; },
    cp => { cp.session.startedAt += 1000; cp.session.deadline += 1000; },
    cp => { cp.session.score = 1000; },
    cp => { cp.session.score = Infinity; },
    cp => { cp.session.moves = -1; },
    cp => { cp.session.highestChain = MAX_COUNTER + 1; },
    cp => { cp.session.lastSeenAt = cp.session.deadline + 1; },
    cp => { cp.session.id = ''; },
    cp => { cp.board[5] = null; },
    cp => { cp.board.pop(); },
    cp => { cp.board[5].id = cp.board[4].id; },
    cp => { cp.board[5].kind = 6; },
    cp => { cp.board[5].hp = NaN; },
    cp => { cp.board[5] = obstacle('bad', 'rock', 4); },
    cp => { cp.board[5] = obstacle('bad', 'prism', 2); },
    cp => { cp.board[5] = obstacle('bad', 'unknown', 1); },
    cp => { cp.state.energy = 101; },
    cp => { cp.state.worldDropsAt = 1; },
    cp => { cp.state.rushRemaining = 100; },
    cp => { cp.state.rewardStats.hammer = -1; },
  ];
  for (const mutate of mutations) {
    const altered = clone(good); mutate(altered);
    assert.equal(parseCheckpoint(altered, NOW + 10), null);
    // Even recomputing the non-secret checksum cannot bypass invalid structure.
    assert.equal(parseCheckpoint(sealed(altered), NOW + 10), null);
  }
  const changed = clone(good); changed.board[0].kind = 5;
  assert.equal(parseCheckpoint(changed, NOW + 10), null, 'valid-looking accidental content change fails checksum');
  assert.equal(parseCheckpoint('{broken', NOW), null);
  assert.equal(parseCheckpoint('x'.repeat(256001), NOW), null);
  assert.equal(parseCheckpoint(good, NOW), null, 'future saved timestamp rejected');
});

test('checkpoints refuse unresolved holes and active rush state; expired saves remain readable', () => {
  const session = createSession(NOW), cells = board();
  cells[4] = null;
  assert.equal(validateBoard(cells), null);
  assert.throws(() => createCheckpoint(session, cells, {}, NOW), TypeError);
  assert.throws(() => createCheckpoint(session, board(), { rushRemaining: 1 }, NOW), TypeError);
  const saved = createCheckpoint(session, board(), {}, NOW + 100);
  const restored = parseCheckpoint(saved, NOW + SESSION_LIMIT_MS + 1000);
  assert.ok(restored);
  assert.equal(remainingMs(restored.session, NOW + SESSION_LIMIT_MS + 1000), 0);
  const savedExpired = createCheckpoint(session, board(), {}, NOW + SESSION_LIMIT_MS + 1000);
  assert.equal(savedExpired.session.status, 'finished');
  assert.ok(parseCheckpoint(savedExpired, NOW + SESSION_LIMIT_MS + 1001));
});

test('local leaderboard holds the highest ten and never duplicates/replaces the same session ID', () => {
  let entries = [];
  const finished = [];
  for (let i = 0; i < 15; i++) {
    let session = createSession(NOW);
    for (let n = 0; n <= i; n++) session = commitFrame(session, basicFrame(), { now: NOW + 1 });
    session = finalizeSession(session, 'banked', NOW + 10 + i);
    finished.push(session);
    entries = addLeaderboardEntry(entries, session, NOW + 100);
  }
  assert.equal(entries.length, 10);
  assert.equal(entries[0].score, 4500);
  assert.equal(entries.at(-1).score, 1800);
  const snapshot = clone(entries);
  for (let i = 0; i < 20; i++) entries = addLeaderboardEntry(entries, finished[14], NOW + 100);
  assert.deepEqual(entries, snapshot);
  const fabricatedRevision = { ...finished[14], score: 5000, cleared: 100 };
  assert.deepEqual(addLeaderboardEntry(entries, fabricatedRevision, NOW + 100), snapshot);
  assert.deepEqual(addLeaderboardEntry(entries, createSession(NOW), NOW + 100), snapshot);
  assert.deepEqual(parseLeaderboard(serializeLeaderboard(entries, NOW + 100), NOW + 100), entries);
  assert.equal(validateLeaderboard([...entries, entries[0]], NOW + 100), null);
  const duplicate = clone(entries); duplicate[1].sessionId = duplicate[0].sessionId;
  assert.equal(validateLeaderboard(duplicate, NOW + 100), null);
  const invalid = clone(entries); invalid[0].score = Infinity;
  assert.equal(validateLeaderboard(invalid, NOW + 100), null);
});

test('100000 mixed-source frames retain exact bounded integer scores and immutable inputs', () => {
  let session = createSession(NOW), expected = 0, expectedClears = 0;
  const frames = Array.from({ length: 12 }, (_, index) => ({ ...basicFrame(), chain: index + 1 }));
  const before = clone(frames);
  for (let index = 0; index < 100000; index++) {
    const options = { source: ['player', 'rush', 'reward'][index % 3], phase: Math.min(5, Math.floor(index / 16000)), now: NOW + index * 100 };
    const frame = frames[index % frames.length];
    expected = Math.min(MAX_SCORE, expected + scoreFrame(frame, options).points);
    expectedClears += 3;
    session = commitFrame(session, frame, options);
    if (options.source === 'player') session = recordMove(session, options.now);
  }
  assert.equal(session.score, expected);
  assert.equal(session.cleared, expectedClears);
  assert.equal(session.frames, 100000);
  assert.equal(session.moves, 33334);
  assert.equal(session.highestChain, 12);
  assert.equal(session.deadline, NOW + SESSION_LIMIT_MS);
  assert.ok(Number.isSafeInteger(session.score));
  assert.ok(validateSession(session, NOW + 10_000_000));
  assert.deepEqual(frames, before);
});

function param() { return { value: 0, cancelScheduledValues() {}, setTargetAtTime() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }; }
class AudioNodeMock {
  constructor() { for (const key of ['gain', 'frequency', 'Q', 'detune', 'pan', 'delayTime', 'threshold', 'knee', 'ratio', 'attack', 'release']) this[key] = param(); }
  connect() {} disconnect() {} start() {} stop() {}
}
class AudioContextMock {
  constructor() { this.currentTime = 0; this.state = 'suspended'; this.sampleRate = 8000; this.destination = new AudioNodeMock(); }
  createGain() { return new AudioNodeMock(); } createDynamicsCompressor() { return new AudioNodeMock(); }
  createDelay() { return new AudioNodeMock(); } createBiquadFilter() { return new AudioNodeMock(); }
  createStereoPanner() { return new AudioNodeMock(); } createOscillator() { return new AudioNodeMock(); }
  createBufferSource() { return new AudioNodeMock(); } createWaveShaper() { return new AudioNodeMock(); }
  createBuffer(channels, size) { return { getChannelData: () => new Float32Array(size) }; }
  async resume() { this.state = 'running'; } async suspend() { this.state = 'suspended'; } async close() { this.state = 'closed'; }
}

test('audio defaults to five seconds, supports explicit fifteen-second auditions and clears scheduling', async () => {
  const previous = globalThis.AudioContext;
  globalThis.AudioContext = AudioContextMock;
  const audio = new GameAudio();
  try {
    await audio.unlock();
    assert.equal(TRACKS.length, 10);
    for (let track = 0; track < 10; track++) {
      audio.startRush(track); await Promise.resolve(); await Promise.resolve();
      assert.equal(audio._music.duration, 5);
      audio.context.currentTime = audio._music.start + 5.01;
      audio._tick();
      assert.equal(audio._music, null); assert.equal(audio._scheduler, null);
      assert.equal(audio._beatTimers.size, 0); assert.equal(audio._voices.size, 0);
    }
    audio.startRush(2, undefined, 15); await Promise.resolve(); await Promise.resolve();
    audio.context.currentTime = audio._music.start + 6;
    audio._tick(); assert.equal(audio._music.duration, 15);
    audio.suspend(); await audio.resume(); assert.ok(audio._music.elapsed >= 6);
    audio.context.currentTime = audio._music.start + 15.01;
    audio._tick(); assert.equal(audio._music, null);
    audio.startRush(0, undefined, Infinity); await Promise.resolve(); await Promise.resolve(); assert.equal(audio._music.duration, 5);
  } finally {
    audio.destroy();
    if (previous === undefined) delete globalThis.AudioContext; else globalThis.AudioContext = previous;
  }
  assert.equal(audio._voices.size, 0); assert.equal(audio._scheduler, null);
});
