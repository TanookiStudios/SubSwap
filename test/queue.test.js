import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PACING,
  DONE,
  FAILED,
  PENDING,
  SKIPPED,
  createQueue,
  delayFor,
  isFinished,
  markDone,
  markFailed,
  markSkipped,
  nextPendingIndex,
  progress,
  resetAll,
  retryFailed,
  setStatus,
} from "../src/lib/queue.js";

const channels = [
  { channelId: "UCaaaaaaaaaaaaaaaaaaaaaa", title: "A" },
  { channelId: "UCbbbbbbbbbbbbbbbbbbbbbb", title: "B" },
  { channelId: "UCcccccccccccccccccccccc", title: "C" },
];

test("a new queue is all pending", () => {
  const queue = createQueue(channels);
  assert.equal(queue.items.length, 3);
  assert.ok(queue.items.every((item) => item.status === PENDING));
  assert.equal(queue.status, "idle");
  assert.equal(nextPendingIndex(queue), 0);
  assert.equal(isFinished(queue), false);
});

test("mode defaults to auto and only accepts assist as an alternative", () => {
  assert.equal(createQueue(channels).mode, "auto");
  assert.equal(createQueue(channels, { mode: "assist" }).mode, "assist");
  assert.equal(createQueue(channels, { mode: "nonsense" }).mode, "auto");
});

test("marking is immutable — the original queue is untouched", () => {
  const queue = createQueue(channels);
  const after = markDone(queue, 0);
  assert.equal(queue.items[0].status, PENDING);
  assert.equal(after.items[0].status, DONE);
  assert.equal(after.items[0].attempts, 1);
});

test("the cursor walks past everything already handled", () => {
  let queue = createQueue(channels);
  queue = markDone(queue, 0);
  assert.equal(nextPendingIndex(queue), 1);
  queue = markSkipped(queue, 1, "already subscribed");
  assert.equal(nextPendingIndex(queue), 2);
  queue = markFailed(queue, 2, "no button");
  assert.equal(nextPendingIndex(queue), -1);
  assert.equal(isFinished(queue), true);
});

test("progress counts every bucket", () => {
  let queue = createQueue(channels);
  queue = markDone(queue, 0);
  queue = markFailed(queue, 2, "nope");
  const counts = progress(queue);
  assert.deepEqual(counts, {
    total: 3,
    pending: 1,
    done: 1,
    skipped: 0,
    failed: 1,
    processed: 2,
  });
});

test("retryFailed re-queues only the failures and keeps attempt counts", () => {
  let queue = createQueue(channels);
  queue = markDone(queue, 0);
  queue = markSkipped(queue, 1);
  queue = markFailed(queue, 2, "nope");
  queue = retryFailed(queue);

  assert.equal(queue.items[0].status, DONE);
  assert.equal(queue.items[1].status, SKIPPED);
  assert.equal(queue.items[2].status, PENDING);
  assert.equal(queue.items[2].attempts, 1, "attempt history survives so repeat failures are visible");
  assert.equal(nextPendingIndex(queue), 2);
});

test("resetAll puts a finished dry run back to the start", () => {
  let queue = createQueue(channels, { dryRun: true });
  queue = markDone(queue, 0);
  queue = markDone(queue, 1);
  queue = markFailed(queue, 2, "nope");
  queue = resetAll(queue, { dryRun: false });

  assert.equal(queue.dryRun, false);
  assert.equal(progress(queue).pending, 3);
  assert.equal(nextPendingIndex(queue), 0);
});

test("pause and resume survive a round trip through JSON", () => {
  let queue = createQueue(channels);
  queue = markDone(queue, 0);
  queue = setStatus(queue, "paused", "rate limited");

  const revived = JSON.parse(JSON.stringify(queue));
  assert.equal(revived.status, "paused");
  assert.equal(revived.pauseReason, "rate limited");
  assert.equal(nextPendingIndex(revived), 1, "resuming carries on from the first pending item");
  assert.equal(progress(revived).done, 1);
});

test("pacing: random spans the configured window", () => {
  const queue = createQueue(channels, { pacing: { minDelayMs: 4000, maxDelayMs: 9000 } });
  assert.equal(delayFor(queue, 1, 0), 4000);
  assert.equal(delayFor(queue, 1, 1), 9000);
  assert.equal(delayFor(queue, 1, 0.5), 6500);
});

test("pacing: a long break lands every batchSize subscribes", () => {
  const queue = createQueue(channels, {
    pacing: { batchSize: 20, batchPauseMs: 60000, minDelayMs: 5000, maxDelayMs: 5000 },
  });
  assert.equal(delayFor(queue, 19, 0.5), 5000);
  assert.equal(delayFor(queue, 20, 0.5), 60000);
  assert.equal(delayFor(queue, 40, 0.5), 60000);
  assert.equal(delayFor(queue, 0, 0.5), 5000, "no break before anything has been clicked");
});

test("pacing: dry runs still leave a small gap", () => {
  const queue = createQueue(channels, { dryRun: true });
  assert.equal(delayFor(queue, 5, 0.5), DEFAULT_PACING.dryRunDelayMs);
  assert.ok(DEFAULT_PACING.dryRunDelayMs > 0);
});

test("pacing: a batchSize of zero disables the long break", () => {
  const queue = createQueue(channels, {
    pacing: { batchSize: 0, minDelayMs: 3000, maxDelayMs: 3000 },
  });
  assert.equal(delayFor(queue, 40, 0.5), 3000);
});
