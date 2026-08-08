import test from "node:test";
import assert from "node:assert/strict";

import { scrapeSubscriptions } from "../src/inject/scrape.js";

// The scraper normally runs inside a YouTube tab, so these tests stand up just
// enough of a DOM to exercise it under plain node.
//
// This file exists because of a real bug: avatars were read from the rendered
// <img>, which YouTube lazy-loads, so exports came back with titles and handles
// intact but the picture missing on most rows (526 of 552 in one real export).

const ID_A = "UCabcdefghijklmnopqrstuv";
const ID_B = "UCzyxwvutsrqponmlkjihgf";

/** A stand-in for one ytd-channel-renderer element. */
function fakeChannelElement({ data = null, href = null, img = null, titleText = null }) {
  return {
    data,
    querySelector(selector) {
      if (selector === "img") return img;
      if (selector.includes("channel-title") || selector.includes("#text")) {
        return titleText ? { textContent: titleText } : null;
      }
      return href ? { getAttribute: () => href } : null;
    },
  };
}

function fakeImg(attrs) {
  return { getAttribute: (name) => attrs[name] ?? null };
}

/** Installs a fake document/window for the duration of one scrape. */
async function scrapeWith(elements) {
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    location: globalThis.location,
  };

  let scrolledTo = null;
  globalThis.document = {
    documentElement: { scrollHeight: 1000 },
    querySelectorAll: (selector) =>
      selector.startsWith("ytd-browse") ? [] : elements,
  };
  globalThis.window = {
    scrollTo: (_x, y) => {
      scrolledTo = y;
    },
  };
  globalThis.location = { href: "https://www.youtube.com/feed/channels" };

  try {
    const result = await scrapeSubscriptions({ settleTicks: 1, tickMs: 0 });
    return { result, scrolledTo };
  } finally {
    Object.assign(globalThis, previous);
  }
}

test("avatars come from YouTube's data, not the lazy-loaded <img>", async () => {
  // The picture is present in the data even though the row never rendered.
  const element = fakeChannelElement({
    data: {
      channelId: ID_A,
      title: { simpleText: "Tom Scott" },
      thumbnail: {
        thumbnails: [
          { url: "https://yt3.ggpht.com/small=s48", width: 48 },
          { url: "https://yt3.ggpht.com/big=s176", width: 176 },
        ],
      },
    },
    img: fakeImg({ src: "" }),
  });

  const { result } = await scrapeWith([element]);

  assert.equal(result.ok, true);
  assert.equal(result.items.length, 1);
  // Biggest thumbnail wins — a caller can always request a smaller crop.
  assert.equal(result.items[0].avatar, "https://yt3.ggpht.com/big=s176");
});

test("protocol-relative avatars are made absolute", async () => {
  const element = fakeChannelElement({
    data: {
      channelId: ID_A,
      title: { simpleText: "Tom Scott" },
      thumbnail: { thumbnails: [{ url: "//yt3.ggpht.com/abc=s176", width: 176 }] },
    },
  });

  const { result } = await scrapeWith([element]);
  assert.equal(result.items[0].avatar, "https://yt3.ggpht.com/abc=s176");
});

test("falls back to the <img> when the data has no thumbnail", async () => {
  const element = fakeChannelElement({
    data: { channelId: ID_A, title: { simpleText: "Tom Scott" } },
    img: fakeImg({ src: "https://yt3.ggpht.com/from-dom=s88" }),
  });

  const { result } = await scrapeWith([element]);
  assert.equal(result.items[0].avatar, "https://yt3.ggpht.com/from-dom=s88");
});

test("reads a lazy-loader's data-src when src is a placeholder", async () => {
  const element = fakeChannelElement({
    data: { channelId: ID_A, title: { simpleText: "Tom Scott" } },
    img: fakeImg({ src: "data:image/gif;base64,placeholder", "data-src": "//yt3.ggpht.com/real=s88" }),
  });

  const { result } = await scrapeWith([element]);
  assert.equal(result.items[0].avatar, "https://yt3.ggpht.com/real=s88");
});

test("a missing avatar is null rather than an unusable string", async () => {
  const element = fakeChannelElement({
    data: { channelId: ID_A, title: { simpleText: "Tom Scott" } },
    img: fakeImg({ src: "" }),
  });

  const { result } = await scrapeWith([element]);
  assert.equal(result.items[0].avatar, null);
});

test("captures every channel before scrolling back to the top", async () => {
  // Scrolling home before capture was the other half of the bug: it put almost
  // every row off screen, so even loaded images were gone by capture time.
  const elements = [
    fakeChannelElement({
      data: {
        channelId: ID_A,
        title: { simpleText: "Tom Scott" },
        thumbnail: { thumbnails: [{ url: "https://yt3.ggpht.com/a=s176", width: 176 }] },
      },
    }),
    fakeChannelElement({
      data: {
        channelId: ID_B,
        title: { simpleText: "Veritasium" },
        thumbnail: { thumbnails: [{ url: "https://yt3.ggpht.com/b=s176", width: 176 }] },
      },
    }),
  ];

  const { result, scrolledTo } = await scrapeWith(elements);

  assert.equal(result.items.length, 2);
  assert.equal(result.items.every((i) => i.avatar !== null), true);
  assert.equal(scrolledTo, 0, "should return the page to the top when finished");
});

test("still exports a channel with no data object at all", async () => {
  // Renderer names change under us; a rough row beats dropping the channel.
  const element = fakeChannelElement({
    data: null,
    href: `/channel/${ID_A}`,
    titleText: "Tom Scott",
  });

  const { result } = await scrapeWith([element]);
  assert.equal(result.items[0].url, `/channel/${ID_A}`);
  assert.equal(result.items[0].title, "Tom Scott");
});
