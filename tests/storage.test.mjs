import test from 'node:test';
import assert from 'node:assert/strict';
import { writeStoredValue, persistFinalRecords } from '../game/session-storage.mjs';

const RANK_KEY = 'tata-endless-v5-scores';
const SAVE_KEY = 'tata-endless-v5-save';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  const calls = [];
  return {
    values, calls,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { calls.push(['set', key, value]); values.set(key, value); },
    removeItem(key) { calls.push(['remove', key]); values.delete(key); },
  };
}

test('progress writes return success and preserve string storage semantics', () => {
  const storage = memoryStorage();
  assert.equal(writeStoredValue(storage, SAVE_KEY, 123), true);
  assert.equal(storage.getItem(SAVE_KEY), '123');
  assert.equal(writeStoredValue(() => storage, SAVE_KEY, 'checkpoint'), true);
  assert.equal(storage.getItem(SAVE_KEY), 'checkpoint');
});

test('blocked storage access and quota failures return failure, not a false success', () => {
  const denied = () => { throw new Error('SecurityError'); };
  assert.equal(writeStoredValue(denied, SAVE_KEY, 'checkpoint'), false);
  assert.equal(writeStoredValue(null, SAVE_KEY, 'checkpoint'), false);
  assert.equal(writeStoredValue({ setItem() { throw new Error('QuotaExceededError'); } }, SAVE_KEY, 'checkpoint'), false);
  assert.deepEqual(persistFinalRecords(denied, RANK_KEY, SAVE_KEY, []), { saved: false, checkpointCleared: false });
});

test('final record write succeeds before the checkpoint is removed', () => {
  const storage = memoryStorage({ [SAVE_KEY]: 'recoverable checkpoint' });
  const entries = [{ sessionId: 'tata-same-session', score: 4500 }];
  assert.deepEqual(persistFinalRecords(storage, RANK_KEY, SAVE_KEY, entries), { saved: true, checkpointCleared: true });
  assert.equal(storage.getItem(RANK_KEY), JSON.stringify(entries));
  assert.equal(storage.getItem(SAVE_KEY), null);
  assert.deepEqual(storage.calls.map(call => call.slice(0, 2)), [['set', RANK_KEY], ['remove', SAVE_KEY]]);
});

test('a full quota never causes the last checkpoint or existing ranks to be erased', () => {
  const storage = memoryStorage({ [SAVE_KEY]: 'recoverable checkpoint', [RANK_KEY]: 'old ranks' });
  const originalSet = storage.setItem;
  let overQuota = true;
  storage.setItem = (key, value) => {
    if (overQuota) throw new Error('QuotaExceededError');
    originalSet(key, value);
  };
  const entries = [{ sessionId: 'tata-same-session', score: 9000 }];
  assert.deepEqual(persistFinalRecords(() => storage, RANK_KEY, SAVE_KEY, entries), { saved: false, checkpointCleared: false });
  assert.equal(storage.getItem(SAVE_KEY), 'recoverable checkpoint');
  assert.equal(storage.getItem(RANK_KEY), 'old ranks');
  assert.equal(storage.calls.length, 0);
  overQuota = false;
  assert.deepEqual(persistFinalRecords(() => storage, RANK_KEY, SAVE_KEY, entries), { saved: true, checkpointCleared: true });
  assert.deepEqual(JSON.parse(storage.getItem(RANK_KEY)), entries);
  assert.equal(storage.getItem(SAVE_KEY), null);
});

test('a repeated final-save retry writes the same score once, not a duplicate', () => {
  const storage = memoryStorage();
  const entries = [{ sessionId: 'tata-same-session', score: 8000 }];
  persistFinalRecords(storage, RANK_KEY, SAVE_KEY, entries);
  persistFinalRecords(storage, RANK_KEY, SAVE_KEY, entries);
  assert.deepEqual(JSON.parse(storage.getItem(RANK_KEY)), entries);
});

test('a checkpoint-clear failure does not misreport an already durable score', () => {
  const storage = memoryStorage({ [SAVE_KEY]: 'recoverable checkpoint' });
  storage.removeItem = () => { throw new Error('clear denied'); };
  const entries = [{ sessionId: 'tata-same-session', score: 5000 }];
  assert.deepEqual(persistFinalRecords(storage, RANK_KEY, SAVE_KEY, entries), { saved: true, checkpointCleared: false });
  assert.equal(storage.getItem(RANK_KEY), JSON.stringify(entries));
  assert.equal(storage.getItem(SAVE_KEY), 'recoverable checkpoint');
});

test('serialization failure preserves the recoverable checkpoint', () => {
  const storage = memoryStorage({ [SAVE_KEY]: 'recoverable checkpoint' });
  const circular = []; circular.push(circular);
  assert.deepEqual(persistFinalRecords(storage, RANK_KEY, SAVE_KEY, circular), { saved: false, checkpointCleared: false });
  assert.equal(storage.getItem(SAVE_KEY), 'recoverable checkpoint');
  assert.equal(storage.calls.length, 0);
});
