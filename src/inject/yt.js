// Injected into a channel page via chrome.scripting.executeScript({ func }).
//
// Same rule as scrape.js: stringified before injection, so it must be entirely
// self-contained. Runs in the MAIN world so it can read Polymer state.
//
// One function handles every action so the button-finding logic exists once.
//
//   probe     -> what is the state of this channel's subscribe button?
//   click     -> press it
//   highlight -> assist mode: scroll to it, ring it, show the banner
//   clear     -> remove anything we added to the page

export function ytAction(action, options) {
  const opts = options || {};
  const OVERLAY_ID = "subswap-overlay";
  const STYLE_ID = "subswap-style";
  const RING_CLASS = "subswap-ring";

  // ---------------------------------------------------------------- finding

  // Only the header button counts. There are subscribe buttons all over a
  // YouTube page (recommended channels, comments) and clicking the wrong one
  // would subscribe to something we never asked for.
  const HEADER_SCOPES = [
    "#channel-header",
    "ytd-c4-tabbed-header-renderer",
    "yt-page-header-renderer",
    "#page-header",
    "ytd-channel-page-header-view-model",
  ];
  const BUTTON_SELECTOR = [
    "ytd-subscribe-button-renderer button",
    "yt-subscribe-button-view-model button",
    "#subscribe-button button",
    "#subscribe-button-shape button",
  ].join(", ");
  const RENDERER_SELECTOR = "ytd-subscribe-button-renderer, yt-subscribe-button-view-model";
  const BELL_SELECTOR = [
    "ytd-subscription-notification-toggle-button-renderer",
    "yt-subscription-notification-toggle-button-view-model",
    "#notification-preference-button",
  ].join(", ");

  function findScope() {
    for (const selector of HEADER_SCOPES) {
      const el = document.querySelector(selector);
      if (el && el.querySelector(RENDERER_SELECTOR + ", " + BUTTON_SELECTOR)) return el;
    }
    return null;
  }

  function findParts() {
    const scope = findScope();
    const root = scope || document;
    const renderer = root.querySelector(RENDERER_SELECTOR);
    const button =
      (renderer && renderer.querySelector("button")) || root.querySelector(BUTTON_SELECTOR);
    const bell = root.querySelector(BELL_SELECTOR);
    return { scope, renderer, button, bell, scoped: Boolean(scope) };
  }

  // ----------------------------------------------------------------- state

  // Ordered most trustworthy first. The top two are language-independent,
  // which matters — matching the word "Subscribe" breaks on any other locale.
  function readSubscribed(parts) {
    const { renderer, button, bell } = parts;

    if (renderer) {
      const data = renderer.data || (renderer.__data && renderer.__data.data) || null;
      if (data && typeof data.subscribed === "boolean") {
        return { subscribed: data.subscribed, via: "polymer-data" };
      }
      if (renderer.hasAttribute("subscribed")) {
        return { subscribed: true, via: "subscribed-attribute" };
      }
    }

    // The notification bell only exists once you're subscribed.
    if (bell) return { subscribed: true, via: "bell-present" };

    if (button) {
      const label = (button.getAttribute("aria-label") || "").toLowerCase();
      const text = (button.textContent || "").trim().toLowerCase();
      if (/^unsubscribe|^subscribed/.test(label) || text === "subscribed") {
        return { subscribed: true, via: "aria-label" };
      }
      if (/^subscribe/.test(label) || text === "subscribe") {
        return { subscribed: false, via: "aria-label" };
      }
      // Subscribed buttons open a menu; unsubscribed ones just act.
      if (button.getAttribute("aria-haspopup") === "true") {
        return { subscribed: true, via: "aria-haspopup" };
      }
    }
    return { subscribed: null, via: "unknown" };
  }

  // YouTube throws a toast when it rate-limits you. Surfacing it lets the
  // manager stop the run instead of hammering away at a wall.
  function readToast() {
    const toast = document.querySelector("tp-yt-paper-toast[opened], yt-notification-action-renderer");
    if (!toast) return null;
    const text = (toast.textContent || "").trim();
    return text ? text.slice(0, 200) : null;
  }

  function takeSignal() {
    const signal = window.__subswapSignal || null;
    window.__subswapSignal = null;
    return signal;
  }

  function snapshot() {
    const parts = findParts();
    const state = readSubscribed(parts);
    return {
      found: Boolean(parts.button),
      scoped: parts.scoped,
      subscribed: state.subscribed,
      via: state.via,
      label: parts.button ? (parts.button.getAttribute("aria-label") || "").slice(0, 120) : null,
      toast: readToast(),
      signal: takeSignal(),
      url: location.href,
      // A deleted or renamed channel lands on an error page.
      missingChannel: Boolean(document.querySelector("yt-page-error-view-model, #error-page")),
    };
  }

  // -------------------------------------------------------------- overlay

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      "@keyframes subswap-pulse {",
      "  0%   { box-shadow: 0 0 0 0 rgba(255,80,80,.85); }",
      "  70%  { box-shadow: 0 0 0 12px rgba(255,80,80,0); }",
      "  100% { box-shadow: 0 0 0 0 rgba(255,80,80,0); }",
      "}",
      "." + RING_CLASS + " {",
      "  animation: subswap-pulse 1.4s ease-out infinite;",
      "  border-radius: 999px !important;",
      "  outline: 3px solid rgba(255,80,80,.9) !important;",
      "  outline-offset: 3px;",
      "}",
      "#" + OVERLAY_ID + " {",
      "  position: fixed; z-index: 2147483647; left: 50%; bottom: 24px;",
      "  transform: translateX(-50%);",
      "  display: flex; align-items: center; gap: 14px;",
      "  max-width: min(720px, calc(100vw - 32px));",
      "  padding: 12px 16px; border-radius: 12px;",
      "  background: #14161a; color: #f4f4f5;",
      "  font: 500 14px/1.35 system-ui, -apple-system, 'Segoe UI', sans-serif;",
      "  box-shadow: 0 12px 40px rgba(0,0,0,.55);",
      "}",
      "#" + OVERLAY_ID + " .subswap-count { opacity: .6; white-space: nowrap; }",
      "#" + OVERLAY_ID + " .subswap-name {",
      "  font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;",
      "}",
      "#" + OVERLAY_ID + " button {",
      "  all: unset; cursor: pointer; padding: 6px 12px; border-radius: 8px;",
      "  background: #2a2d33; white-space: nowrap;",
      "}",
      "#" + OVERLAY_ID + " button:hover { background: #3a3e46; }",
    ].join("\n");
    document.documentElement.appendChild(style);
  }

  function buildOverlay(withControls) {
    ensureStyle();
    let overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = OVERLAY_ID;
      overlay.addEventListener("click", (event) => {
        const target = event.target.closest("[data-subswap]");
        if (!target) return;
        window.__subswapSignal = target.getAttribute("data-subswap");
      });
      document.documentElement.appendChild(overlay);
    }
    if (overlay.dataset.controls !== String(Boolean(withControls))) {
      overlay.dataset.controls = String(Boolean(withControls));
      overlay.innerHTML =
        '<span class="subswap-count"></span>' +
        '<span class="subswap-name"></span>' +
        '<span class="subswap-hint" style="opacity:.6"></span>' +
        (withControls
          ? '<button data-subswap="skip">Skip</button><button data-subswap="stop">Stop</button>'
          : "");
    }
    return overlay;
  }

  function clearOverlay() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) overlay.remove();
    for (const el of document.querySelectorAll("." + RING_CLASS)) {
      el.classList.remove(RING_CLASS);
    }
  }

  // ------------------------------------------------------------- actions

  if (action === "probe") {
    return snapshot();
  }

  if (action === "clear") {
    clearOverlay();
    return { cleared: true };
  }

  // Shown when the working window is on screen, so nobody wonders what this
  // window is, closes it, or starts clicking around in it.
  if (action === "notice") {
    const overlay = buildOverlay(false);
    overlay.querySelector(".subswap-count").textContent = opts.position || "";
    overlay.querySelector(".subswap-name").textContent = "SubSwap is working";
    overlay.querySelector(".subswap-hint").textContent =
      opts.text || "Leave this window alone — it closes itself when it's done.";
    return { noticed: true };
  }

  if (action === "highlight") {
    const parts = findParts();
    const overlay = buildOverlay(true);
    overlay.querySelector(".subswap-count").textContent = opts.position || "";
    overlay.querySelector(".subswap-name").textContent = opts.name || "";
    overlay.querySelector(".subswap-hint").textContent = "Click Subscribe →";
    if (parts.button) {
      parts.button.classList.add(RING_CLASS);
      parts.button.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    const state = snapshot();
    if (!state.found) {
      overlay.querySelector(".subswap-hint").textContent =
        "Couldn't find the Subscribe button — Skip or subscribe by hand.";
    }
    return state;
  }

  if (action === "click") {
    const parts = findParts();
    if (!parts.button) return { clicked: false, reason: "button-not-found", state: snapshot() };
    const before = readSubscribed(parts);
    if (before.subscribed === true) {
      return { clicked: false, reason: "already-subscribed", state: snapshot() };
    }
    parts.button.click();
    return { clicked: true, reason: null, state: snapshot() };
  }

  return { error: "unknown-action", action };
}
