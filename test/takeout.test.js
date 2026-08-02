import test from "node:test";
import assert from "node:assert/strict";

import { parseCsv, parseTakeoutCsv } from "../src/lib/takeout.js";
import { dedupe } from "../src/lib/channels.js";

const ID_A = "UCabcdefghijklmnopqrstuv";
const ID_B = "UCzyxwvutsrqponmlkjihgf";

test("csv: quoted fields, embedded commas, escaped quotes", () => {
  const rows = parseCsv('a,"b,still b","he said ""hi"""\n1,2,3\n');
  assert.deepEqual(rows, [
    ["a", "b,still b", 'he said "hi"'],
    ["1", "2", "3"],
  ]);
});

test("csv: CRLF line endings and a trailing newline", () => {
  assert.deepEqual(parseCsv("a,b\r\nc,d\r\n"), [
    ["a", "b"],
    ["c", "d"],
  ]);
});

test("csv: a leading byte order mark doesn't poison the first header", () => {
  const rows = parseCsv("﻿Channel Id,Channel Url,Channel Title\n");
  assert.equal(rows[0][0], "Channel Id");
});

test("takeout: the real column layout parses", () => {
  const csv = [
    "Channel Id,Channel Url,Channel Title",
    `${ID_A},http://www.youtube.com/channel/${ID_A},Tom Scott`,
    `${ID_B},http://www.youtube.com/channel/${ID_B},"Scott, Tom"`,
  ].join("\n");

  const rows = parseTakeoutCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].channelId, ID_A);
  assert.equal(rows[0].title, "Tom Scott");
  assert.equal(rows[1].title, "Scott, Tom");
});

test("takeout: columns are matched by name, not position", () => {
  const csv = ["Channel Title,Channel Id", `Reordered,${ID_A}`].join("\n");
  const rows = parseTakeoutCsv(csv);
  assert.equal(rows[0].channelId, ID_A);
  assert.equal(rows[0].title, "Reordered");
});

test("takeout: a headerless file falls back to the documented order", () => {
  const csv = `${ID_A},http://www.youtube.com/channel/${ID_A},No Header Here`;
  const rows = parseTakeoutCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].channelId, ID_A);
});

test("takeout: blank lines and rows with no identity are dropped", () => {
  const csv = ["Channel Id,Channel Url,Channel Title", "", `${ID_A},,Fine`, ",,Nothing useful"].join("\n");
  const rows = parseTakeoutCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].channelId, ID_A);
});

test("takeout output feeds straight into the channel pipeline", () => {
  const csv = [
    "Channel Id,Channel Url,Channel Title",
    `${ID_A},http://www.youtube.com/channel/${ID_A},Tom Scott`,
  ].join("\n");

  const channels = dedupe(parseTakeoutCsv(csv));
  assert.equal(channels.length, 1);
  assert.equal(channels[0].url, `https://www.youtube.com/channel/${ID_A}`);
  assert.equal(channels[0].title, "Tom Scott");
});

test("an empty file yields nothing rather than throwing", () => {
  assert.deepEqual(parseTakeoutCsv(""), []);
  assert.deepEqual(parseTakeoutCsv("\n\n"), []);
});
