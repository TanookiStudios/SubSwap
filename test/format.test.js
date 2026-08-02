import test from "node:test";
import assert from "node:assert/strict";

import { humanDuration } from "../src/lib/format.js";

test("seconds, with the singular handled", () => {
  assert.equal(humanDuration(0), "0 seconds");
  assert.equal(humanDuration(1), "1 second");
  assert.equal(humanDuration(30), "30 seconds");
  assert.equal(humanDuration(89), "89 seconds");
});

test("minutes take over at a sensible point", () => {
  assert.equal(humanDuration(90), "2 minutes");
  assert.equal(humanDuration(600), "10 minutes");
  assert.equal(humanDuration(60), "60 seconds");
});

test("it never says something daft like 60 minutes", () => {
  assert.equal(humanDuration(59 * 60), "59 minutes");
  assert.equal(humanDuration(3599), "1 hour");
  assert.equal(humanDuration(3600), "1 hour");
  assert.equal(humanDuration(90 * 60), "1.5 hours");
});

test("big numbers lose the decimal", () => {
  assert.equal(humanDuration(10 * 3600), "10 hours");
  assert.equal(humanDuration(37 * 3600), "37 hours");
});

test("negatives and rubbish don't produce nonsense", () => {
  assert.equal(humanDuration(-500), "0 seconds");
});

test("a realistic run reads well", () => {
  // 200 channels at the 30-seconds-each estimate.
  assert.equal(humanDuration(200 * 30), "1.7 hours");
  assert.equal(humanDuration(12 * 30), "6 minutes");
});
