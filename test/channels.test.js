import test from "node:test";
import assert from "node:assert/strict";

import {
  channelUrl,
  dedupe,
  diffChannels,
  displayName,
  isUsable,
  normaliseHandle,
  normaliseTitle,
  parseChannelUrl,
  toChannel,
} from "../src/lib/channels.js";

const ID_A = "UCabcdefghijklmnopqrstuv";
const ID_B = "UCzyxwvutsrqponmlkjihgf";

test("handles are stripped and lowercased", () => {
  assert.equal(normaliseHandle("@Veritasium"), "veritasium");
  assert.equal(normaliseHandle("  @@Foo "), "foo");
  assert.equal(normaliseHandle(""), null);
  assert.equal(normaliseHandle(null), null);
});

test("titles squash to a comparable form", () => {
  assert.equal(normaliseTitle("Tom Scott"), "tomscott");
  assert.equal(normaliseTitle("TOM  SCOTT!"), "tomscott");
  assert.equal(normaliseTitle("Beyoncé"), "beyonce");
  assert.equal(normaliseTitle("!!!"), null);
});

test("channel URLs parse in every shape YouTube uses", () => {
  assert.deepEqual(parseChannelUrl(`/channel/${ID_A}`), { channelId: ID_A, handle: null });
  assert.deepEqual(parseChannelUrl(`https://www.youtube.com/channel/${ID_A}`), {
    channelId: ID_A,
    handle: null,
  });
  assert.deepEqual(parseChannelUrl("/@Veritasium"), { channelId: null, handle: "veritasium" });
  assert.deepEqual(parseChannelUrl("/c/SomeName"), { channelId: null, handle: "somename" });
  assert.deepEqual(parseChannelUrl("/user/OldSchool"), { channelId: null, handle: "oldschool" });
  assert.deepEqual(parseChannelUrl("/watch?v=x"), { channelId: null, handle: null });
  assert.deepEqual(parseChannelUrl(""), { channelId: null, handle: null });
});

test("a malformed channel id is not accepted as one", () => {
  assert.equal(parseChannelUrl("/channel/nonsense").channelId, null);
});

test("toChannel prefers the id and always produces a usable URL", () => {
  const channel = toChannel({ url: `/channel/${ID_A}`, title: "  Thing  " });
  assert.equal(channel.channelId, ID_A);
  assert.equal(channel.title, "Thing");
  assert.equal(channel.url, `https://www.youtube.com/channel/${ID_A}`);

  const byHandle = toChannel({ url: "/@thing" });
  assert.equal(byHandle.url, "https://www.youtube.com/@thing");
  assert.equal(channelUrl({ channelId: null, handle: null }), null);
});

test("channels without any identity are dropped", () => {
  assert.equal(isUsable(toChannel({ title: "Just a name" })), false);
  assert.deepEqual(dedupe([{ title: "Just a name" }]), []);
});

test("dedupe collapses the same channel seen twice", () => {
  const out = dedupe([
    { channelId: ID_A, title: "One" },
    { url: `/channel/${ID_A}`, title: "One again" },
    { url: "/@two", title: "Two" },
    { url: "/@Two", title: "Two" },
  ]);
  assert.equal(out.length, 2);
});

test("dedupe keeps two different channels that share a title", () => {
  const out = dedupe([
    { channelId: ID_A, title: "News" },
    { channelId: ID_B, title: "News" },
  ]);
  assert.equal(out.length, 2);
});

test("diff matches on id, then handle, then title", () => {
  const source = [
    { channelId: ID_A, title: "By id" },
    { url: "/@byhandle", title: "By handle" },
    { url: "/@renamed-since", title: "By title" },
    { channelId: ID_B, title: "Genuinely new" },
  ];
  const existing = [
    { url: `/channel/${ID_A}`, title: "Different title, same id" },
    { url: "/@byhandle", title: "Whatever" },
    { url: "/@some-new-handle", title: "By Title!" },
  ];

  const missing = diffChannels(source, existing);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].channelId, ID_B);
});

test("diff on an empty account returns everything", () => {
  const source = [{ channelId: ID_A, title: "A" }, { url: "/@b", title: "B" }];
  assert.equal(diffChannels(source, []).length, 2);
});

test("displayName falls back through title, handle, id", () => {
  assert.equal(displayName({ title: "Title", handle: "h", channelId: ID_A }), "Title");
  assert.equal(displayName({ title: null, handle: "h", channelId: ID_A }), "@h");
  assert.equal(displayName({ title: null, handle: null, channelId: ID_A }), ID_A);
  assert.equal(displayName({}), "Unknown channel");
});
