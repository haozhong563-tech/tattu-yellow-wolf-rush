/** Small storage boundary for local progress and final scores.
 * Pass a Storage object or a getter (() => localStorage); the latter also catches
 * browsers that deny access to the localStorage property itself.
 */
const resolveStorage = storageOrGetter => typeof storageOrGetter === 'function' ? storageOrGetter() : storageOrGetter;

/** Never claim a write succeeded when storage is blocked or over quota. */
export function writeStoredValue(storageOrGetter, key, value) {
  try {
    resolveStorage(storageOrGetter).setItem(key, String(value));
    return true;
  } catch { return false; }
}

/** Persist final records before removing the last recoverable checkpoint.
 * A failed record write leaves that checkpoint untouched. Retrying is safe:
 * callers pass their already-deduplicated final leaderboard, not a new session.
 * If clearing fails after the record write, saved remains true; the caller can
 * report success because the score is durable and retry clearing independently.
 */
export function persistFinalRecords(storageOrGetter, rankKey, saveKey, entries) {
  let storage;
  try {
    storage = resolveStorage(storageOrGetter);
    storage.setItem(rankKey, JSON.stringify(entries));
  } catch { return { saved: false, checkpointCleared: false }; }
  try {
    storage.removeItem(saveKey);
    return { saved: true, checkpointCleared: true };
  } catch { return { saved: true, checkpointCleared: false }; }
}
