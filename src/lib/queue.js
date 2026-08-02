// The run queue. Plain serialisable data so it can live in chrome.storage and
// survive a browser restart mid-run. Pure functions, unit-tested under node.

export const PENDING = "pending";
export const DONE = "done";
export const SKIPPED = "skipped";
export const FAILED = "failed";

export const DEFAULT_PACING = {
  minDelayMs: 5000,
  maxDelayMs: 10000,
  batchSize: 20,
  batchPauseMs: 60000,
  // A dry run clicks nothing, but it still loads a page per channel — so it
  // still gets a small gap rather than machine-gunning YouTube.
  dryRunDelayMs: 1200,
};

export function createQueue(channels, options = {}) {
  return {
    createdAt: options.now ?? 0,
    mode: options.mode === "assist" ? "assist" : "auto",
    dryRun: Boolean(options.dryRun),
    // Assist mode ignores this — you can't click a window you can't see.
    hideWindow: options.hideWindow !== false,
    pacing: { ...DEFAULT_PACING, ...(options.pacing || {}) },
    status: "idle", // idle | running | paused | finished
    pauseReason: null,
    items: channels.map((channel) => ({
      channel,
      status: PENDING,
      attempts: 0,
      note: null,
    })),
  };
}

export function nextPendingIndex(queue, from = 0) {
  for (let i = from; i < queue.items.length; i++) {
    if (queue.items[i].status === PENDING) return i;
  }
  return -1;
}

function withItem(queue, index, patch) {
  const items = queue.items.slice();
  items[index] = { ...items[index], ...patch };
  return { ...queue, items };
}

export function markDone(queue, index, note = null) {
  return withItem(queue, index, {
    status: DONE,
    note,
    attempts: queue.items[index].attempts + 1,
  });
}

export function markSkipped(queue, index, note = null) {
  return withItem(queue, index, { status: SKIPPED, note });
}

export function markFailed(queue, index, note = null) {
  return withItem(queue, index, {
    status: FAILED,
    note,
    attempts: queue.items[index].attempts + 1,
  });
}

export function setStatus(queue, status, pauseReason = null) {
  return { ...queue, status, pauseReason };
}

// Put every failure back in the pending pile. Their attempt counts are kept so
// a channel that keeps failing is visible as such.
export function retryFailed(queue) {
  const items = queue.items.map((item) =>
    item.status === FAILED ? { ...item, status: PENDING, note: null } : item,
  );
  return { ...queue, items, status: "idle", pauseReason: null };
}

// Used after a dry run: put everything back to pending so the same queue can be
// run for real without rebuilding it.
export function resetAll(queue, patch = {}) {
  const items = queue.items.map((item) => ({ ...item, status: PENDING, note: null }));
  return { ...queue, items, status: "idle", pauseReason: null, ...patch };
}

export function progress(queue) {
  const counts = { total: queue.items.length, pending: 0, done: 0, skipped: 0, failed: 0 };
  for (const item of queue.items) counts[item.status] += 1;
  counts.processed = counts.done + counts.skipped + counts.failed;
  return counts;
}

export function isFinished(queue) {
  return nextPendingIndex(queue) === -1;
}

// How long to wait before the next subscribe. `subscribedSoFar` is the count of
// channels we've actually clicked in this run — every `batchSize` of those, take
// a longer breather. Randomness comes in as a 0..1 value so this stays pure.
export function delayFor(queue, subscribedSoFar, random = 0.5) {
  const { minDelayMs, maxDelayMs, batchSize, batchPauseMs, dryRunDelayMs } = queue.pacing;
  if (queue.dryRun) return dryRunDelayMs ?? DEFAULT_PACING.dryRunDelayMs;
  if (subscribedSoFar > 0 && batchSize > 0 && subscribedSoFar % batchSize === 0) {
    return batchPauseMs;
  }
  const span = Math.max(0, maxDelayMs - minDelayMs);
  return Math.round(minDelayMs + span * random);
}
