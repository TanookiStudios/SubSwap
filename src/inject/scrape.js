// Injected into the YouTube tab via chrome.scripting.executeScript({ func }).
//
// IMPORTANT: the function below is stringified before injection, so it must be
// entirely self-contained — no imports, no references to anything outside its
// own body. It runs in the MAIN world so it can read YouTube's Polymer data
// (`element.data`), which an isolated content script cannot see.

export async function scrapeSubscriptions(options) {
  const opts = options || {};
  const settleTicks = opts.settleTicks || 3;
  const tickMs = opts.tickMs || 700;
  const timeoutMs = opts.timeoutMs || 90000;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ITEM_SELECTOR = "ytd-channel-renderer, ytd-grid-channel-renderer";
  const countItems = () => document.querySelectorAll(ITEM_SELECTOR).length;

  // Scroll until the list stops growing. That handles YouTube's lazy
  // pagination without us having to know anything about continuations.
  const deadline = Date.now() + timeoutMs;
  let stable = 0;
  let last = -1;
  let timedOut = false;
  while (stable < settleTicks) {
    if (Date.now() > deadline) {
      timedOut = true;
      break;
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
    await sleep(tickMs);
    const n = countItems();
    if (n === last) stable += 1;
    else {
      stable = 0;
      last = n;
    }
  }
  window.scrollTo(0, 0);

  const readText = (node) => {
    if (!node) return null;
    if (typeof node === "string") return node.trim() || null;
    if (typeof node.simpleText === "string") return node.simpleText.trim() || null;
    if (Array.isArray(node.runs)) {
      const joined = node.runs.map((r) => r.text || "").join("").trim();
      return joined || null;
    }
    return null;
  };

  const results = [];
  const elements = document.querySelectorAll(ITEM_SELECTOR);

  for (const el of elements) {
    const data = el.data || (el.__data && el.__data.data) || null;
    let channelId = null;
    let title = null;

    if (data) {
      channelId =
        data.channelId ||
        (data.navigationEndpoint &&
          data.navigationEndpoint.browseEndpoint &&
          data.navigationEndpoint.browseEndpoint.browseId) ||
        null;
      title = readText(data.title);
    }

    const link = el.querySelector(
      'a#main-link, a[href^="/@"], a[href^="/channel/"], a[href^="/c/"], a[href^="/user/"]',
    );
    const href = link ? link.getAttribute("href") : null;
    if (!title) {
      const titleEl = el.querySelector("#channel-title, #text, yt-formatted-string#text");
      title = titleEl ? titleEl.textContent.trim() : null;
    }
    const img = el.querySelector("img");

    if (!channelId && !href) continue;
    results.push({
      channelId,
      title,
      url: href,
      avatar: img ? img.getAttribute("src") : null,
    });
  }

  // Belt and braces: if the renderer names have changed under us, fall back to
  // scanning channel links inside the page body. Better a rough list than none.
  if (results.length === 0) {
    const anchors = document.querySelectorAll(
      'ytd-browse a[href^="/@"], ytd-browse a[href^="/channel/UC"]',
    );
    for (const a of anchors) {
      const href = a.getAttribute("href");
      // Skip links that carry a sub-path (/@name/videos and friends).
      if (!href || href.split("/").filter(Boolean).length > 2) continue;
      const text = (a.getAttribute("title") || a.textContent || "").trim();
      results.push({ channelId: null, title: text || null, url: href, avatar: null });
    }
  }

  return {
    ok: results.length > 0,
    timedOut,
    domCount: elements.length,
    items: results,
    url: location.href,
  };
}
