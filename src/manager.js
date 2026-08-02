// The whole app lives here. This page is a normal extension tab, which means —
// unlike the service worker — it doesn't get shut down halfway through a run.
// It owns the queue, drives the YouTube tab, and renders the UI.

import * as Q from "./lib/queue.js";
import { dedupe, diffChannels, displayName } from "./lib/channels.js";
import { parseTakeoutCsv } from "./lib/takeout.js";
import { scrapeSubscriptions } from "./inject/scrape.js";
import { ytAction } from "./inject/yt.js";

const SUBSCRIPTIONS_URL = "https://www.youtube.com/feed/channels";
const MAX_LOG = 500;

const el = (id) => document.getElementById(id);

let lists = [];
let run = null;
let logLines = [];
let workerTabId = null;
let workerWindowId = null;
let windowHidden = false;
let loopToken = 0;

// ---------------------------------------------------------------- timers
//
// Chrome throttles setTimeout in tabs that are hidden or covered up, and during
// a run this tab is usually behind the YouTube window. So all waiting is handed
// to the service worker, which isn't subject to that. Long waits are chunked so
// the traffic keeps the worker alive.

let port = null;
let waitSeq = 0;
const waiters = new Map();

function connectTimer() {
  port = chrome.runtime.connect({ name: "subswap-timer" });
  port.onMessage.addListener((msg) => {
    if (!msg || msg.type !== "wake") return;
    const waiter = waiters.get(msg.id);
    if (waiter) {
      waiters.delete(msg.id);
      waiter.resolve();
    }
  });
  port.onDisconnect.addListener(() => {
    const orphans = [...waiters.values()];
    waiters.clear();
    port = null;
    connectTimer();
    for (const waiter of orphans) armWait(waiter);
  });
}

function armWait(waiter) {
  const id = ++waitSeq;
  waiters.set(id, waiter);
  const remaining = Math.max(0, waiter.until - Date.now());
  try {
    port.postMessage({ type: "sleep", id, ms: remaining });
  } catch {
    // Worker unreachable — fall back to a local timer and accept the throttling.
    setTimeout(() => {
      if (waiters.delete(id)) waiter.resolve();
    }, remaining);
  }
}

function tick(ms) {
  return new Promise((resolve) => armWait({ until: Date.now() + ms, resolve }));
}

// Waits `ms`, in short hops, giving up early if `abort()` goes true.
async function sleep(ms, abort = () => false) {
  let left = ms;
  while (left > 0) {
    if (abort()) return false;
    const chunk = Math.min(left, 1000);
    await tick(chunk);
    left -= chunk;
  }
  return !abort();
}

// ------------------------------------------------------------- worker tab

// Minimised is as close to invisible as an extension can get with someone
// else's site — there's no off-screen tab for third-party pages. It's better
// than a small window, too: the window keeps its size internally, so YouTube's
// layout doesn't change and none of the selectors shift under us.
//
// It can't be used for scanning, though. A minimised window stops painting, and
// YouTube only loads the next batch of subscriptions when the page is actually
// rendering — so a hidden scan quietly returns a fraction of the list.
async function setWindowHidden(hidden) {
  if (workerWindowId == null) return;
  try {
    await chrome.windows.update(workerWindowId, { state: hidden ? "minimized" : "normal" });
    windowHidden = hidden;
  } catch {
    workerWindowId = null;
  }
}

// Navigate the working tab, creating it (in its own window) if need be, and
// wait until the page says it's done.
async function goTo(url, options = {}) {
  const { focus = false, hidden = false } = options;
  let existing = null;
  if (workerTabId != null) {
    try {
      existing = await chrome.tabs.get(workerTabId);
    } catch {
      workerTabId = null;
      workerWindowId = null;
    }
  }

  if (!existing) {
    const win = await chrome.windows.create({
      url,
      focused: !hidden && Boolean(focus),
      width: 1180,
      height: 900,
    });
    workerTabId = win.tabs[0].id;
    workerWindowId = win.id;
    windowHidden = false;
    await waitForLoad(workerTabId, 30000);
    if (hidden) await setWindowHidden(true);
    return workerTabId;
  }

  workerWindowId = existing.windowId;
  if (hidden !== windowHidden) await setWindowHidden(hidden);

  const loaded = waitForLoad(workerTabId, 30000);
  // Re-issuing the URL a tab is already sitting on doesn't reliably produce a
  // load event, so reload instead — otherwise we'd sit here until the timeout.
  if (existing.url === url) {
    await chrome.tabs.reload(workerTabId);
  } else {
    await chrome.tabs.update(workerTabId, { url, active: true });
  }
  if (focus && !hidden) await chrome.windows.update(existing.windowId, { focused: true });
  await loaded;
  return workerTabId;
}

function waitForLoad(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(ok);
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") finish(true);
    };
    chrome.tabs.onUpdated.addListener(listener);
    tick(timeoutMs).then(() => finish(false));
  });
}

async function inject(tabId, func, args) {
  const frames = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func,
    args,
  });
  return frames && frames[0] ? frames[0].result : null;
}

// The subscribe button can render a beat after the page reports "complete".
async function probeUntilReady(tabId, attempts = 12, gapMs = 600) {
  let last = null;
  for (let i = 0; i < attempts; i++) {
    last = await inject(tabId, ytAction, ["probe", {}]);
    if (last && (last.found || last.missingChannel)) return last;
    await tick(gapMs);
  }
  return last;
}

async function waitForSubscribed(tabId, ms) {
  const deadline = Date.now() + ms;
  let last = null;
  while (Date.now() < deadline) {
    await tick(400);
    last = await inject(tabId, ytAction, ["probe", {}]);
    if (last && last.subscribed === true) return last;
    if (last && last.toast) return last;
  }
  return last;
}

// --------------------------------------------------------------- storage

async function load() {
  const data = await chrome.storage.local.get(["lists", "run", "log", "settings"]);
  lists = data.lists || [];
  run = data.run || null;
  logLines = data.log || [];
  if (run && run.status === "running") {
    run = Q.setStatus(run, "paused", "Interrupted — this tab was closed mid-run. Resume when ready.");
  }
  if (data.settings) applySettings(data.settings);
}

async function save() {
  await chrome.storage.local.set({ lists, run, log: logLines, settings: readSettings() });
}

// ------------------------------------------------------------------- log

function log(text, level = "") {
  const stamp = new Date().toLocaleTimeString();
  logLines.push({ stamp, text, level });
  if (logLines.length > MAX_LOG) logLines = logLines.slice(-MAX_LOG);
  renderLog();
}

// ------------------------------------------------------------- settings

function readSettings() {
  return {
    mode: el("mode").querySelector(".selected").dataset.mode,
    scanFirst: el("scan-first").checked,
    dryRun: el("dry-run").checked,
    hideWindow: el("hide-window").checked,
    pacing: {
      minDelayMs: Math.max(0, Number(el("min-delay").value) * 1000),
      maxDelayMs: Math.max(0, Number(el("max-delay").value) * 1000),
      batchSize: Math.max(0, Number(el("batch-size").value)),
      batchPauseMs: Math.max(0, Number(el("batch-pause").value) * 1000),
    },
  };
}

function applySettings(settings) {
  if (settings.mode) selectMode(settings.mode);
  if (typeof settings.scanFirst === "boolean") el("scan-first").checked = settings.scanFirst;
  if (typeof settings.dryRun === "boolean") el("dry-run").checked = settings.dryRun;
  if (typeof settings.hideWindow === "boolean") el("hide-window").checked = settings.hideWindow;
  const pacing = settings.pacing || {};
  if (pacing.minDelayMs != null) el("min-delay").value = pacing.minDelayMs / 1000;
  if (pacing.maxDelayMs != null) el("max-delay").value = pacing.maxDelayMs / 1000;
  if (pacing.batchSize != null) el("batch-size").value = pacing.batchSize;
  if (pacing.batchPauseMs != null) el("batch-pause").value = pacing.batchPauseMs / 1000;
}

function selectMode(mode) {
  for (const button of el("mode").querySelectorAll("button")) {
    button.classList.toggle("selected", button.dataset.mode === mode);
  }
}

// --------------------------------------------------------------- scanning

async function scanAccount() {
  // Always on screen — see setWindowHidden for why a hidden scan under-reports.
  const tabId = await goTo(SUBSCRIPTIONS_URL, { focus: true, hidden: false });
  await inject(tabId, ytAction, [
    "notice",
    { text: "Reading your subscriptions — leave this window alone, it scrolls itself." },
  ]).catch(() => {});
  const result = await inject(tabId, scrapeSubscriptions, [{}]);
  if (!result) throw new Error("The page didn't respond. Is the YouTube tab still open?");
  if (!result.ok || result.items.length === 0) {
    throw new Error(
      "Found no subscriptions on the page. Are you signed into the account you meant, and did " +
        "the page finish loading?",
    );
  }
  if (result.timedOut) {
    log("Scrolling hit the 90 second ceiling — the list may be incomplete.", "warn");
  }
  return dedupe(result.items);
}

async function doExport() {
  const button = el("export-run");
  button.disabled = true;
  el("export-status").textContent =
    "Working… a YouTube window will open and scroll itself. Leave it be for a few seconds.";
  try {
    const channels = await scanAccount(true);
    const label =
      el("export-label").value.trim() ||
      (lists.length === 0 ? "My subscriptions" : `My subscriptions ${lists.length + 1}`);
    lists.unshift({
      id: `list-${Date.now()}`,
      label,
      savedAt: Date.now(),
      items: channels,
    });
    await save();
    el("export-status").textContent = `Saved “${label}” — ${channels.length} channels.`;
    log(`Exported ${channels.length} channels as “${label}”.`, "ok");
    render();
  } catch (err) {
    el("export-status").textContent = err.message;
    log(`Export failed: ${err.message}`, "bad");
  } finally {
    button.disabled = false;
  }
}

// -------------------------------------------------------------- the run

function abortCheck() {
  return !run || run.status !== "running";
}

async function step(index, clicks) {
  const item = run.items[index];
  const name = displayName(item.channel);
  const counts = Q.progress(run);
  const position = `${counts.processed + 1} of ${counts.total}`;

  // Assist mode needs the window in front — you're the one clicking.
  const assist = run.mode === "assist";
  const hidden = !assist && run.hideWindow !== false;

  let tabId;
  try {
    tabId = await goTo(item.channel.url, { focus: assist, hidden });
  } catch (err) {
    run = Q.markFailed(run, index, `Couldn't open the page: ${err.message}`);
    log(`${name} — couldn't open ${item.channel.url}`, "bad");
    return { clicks, throttled: false };
  }

  const state = await probeUntilReady(tabId);

  if (!state) {
    run = Q.markFailed(run, index, "No response from the page.");
    log(`${name} — page didn't respond`, "bad");
    return { clicks, throttled: false };
  }
  if (state.missingChannel) {
    run = Q.markFailed(run, index, "Channel not found — it may have been deleted or renamed.");
    log(`${name} — channel not found`, "bad");
    return { clicks, throttled: false };
  }
  if (state.subscribed === true) {
    run = Q.markSkipped(run, index, "Already subscribed.");
    log(`${name} — already subscribed, skipped`);
    return { clicks, throttled: false };
  }
  if (!state.found) {
    run = Q.markFailed(run, index, "Couldn't find the Subscribe button on the page.");
    log(`${name} — no Subscribe button found`, "bad");
    return { clicks, throttled: false };
  }

  if (run.dryRun) {
    run = Q.markDone(run, index, "Dry run — would have subscribed.");
    log(`${name} — would subscribe (dry run)`, "ok");
    return { clicks, throttled: false };
  }

  if (assist) {
    return await assistStep(tabId, index, name, position, clicks);
  }
  if (!hidden) {
    await inject(tabId, ytAction, ["notice", { position }]).catch(() => {});
  }
  return await autoStep(tabId, index, name, clicks);
}

async function autoStep(tabId, index, name, clicks, isRetry = false) {
  const result = await inject(tabId, ytAction, ["click", {}]);

  if (!result || (!result.clicked && result.reason === "button-not-found")) {
    run = Q.markFailed(run, index, "Subscribe button vanished before the click landed.");
    log(`${name} — Subscribe button vanished`, "bad");
    return { clicks, throttled: false };
  }
  if (!result.clicked && result.reason === "already-subscribed") {
    run = Q.markSkipped(run, index, "Already subscribed.");
    log(`${name} — already subscribed, skipped`);
    return { clicks, throttled: false };
  }

  const confirmed = await waitForSubscribed(tabId, 8000);
  if (confirmed && confirmed.subscribed === true) {
    run = Q.markDone(run, index, null);
    log(`${name} — subscribed`, "ok");
    return { clicks: clicks + 1, throttled: false };
  }

  // A miss while the window is hidden is ambiguous: it could be YouTube
  // rate-limiting, or it could be that this page needed to be on screen. Bring
  // the window up and give it exactly one more go before blaming YouTube —
  // otherwise hiding the window would masquerade as throttling and stop a run
  // that was fine.
  if (!isRetry && windowHidden) {
    log(`${name} — didn't take while hidden, showing the window and retrying once`);
    await setWindowHidden(false);
    await chrome.tabs.reload(tabId);
    await waitForLoad(tabId, 30000);
    const ready = await probeUntilReady(tabId);
    if (ready && ready.subscribed === true) {
      run = Q.markDone(run, index, null);
      log(`${name} — subscribed`, "ok");
      await setWindowHidden(true);
      return { clicks: clicks + 1, throttled: false };
    }
    const retried = await autoStep(tabId, index, name, clicks, true);
    await setWindowHidden(true);
    return retried;
  }

  const reason = (confirmed && confirmed.toast) || "The click didn't take.";
  run = Q.markFailed(run, index, reason);
  log(`${name} — not confirmed: ${reason}`, "warn");
  return { clicks, throttled: true };
}

async function assistStep(tabId, index, name, position, clicks) {
  await inject(tabId, ytAction, ["highlight", { position, name }]);
  const deadline = Date.now() + 5 * 60 * 1000;

  while (Date.now() < deadline) {
    if (abortCheck()) {
      await inject(tabId, ytAction, ["clear", {}]).catch(() => {});
      return { clicks, throttled: false };
    }
    await tick(500);
    let state = null;
    try {
      state = await inject(tabId, ytAction, ["probe", {}]);
    } catch {
      // Tab navigated or closed under us; the outer loop will notice.
      return { clicks, throttled: false };
    }
    if (!state) continue;

    if (state.signal === "stop") {
      await inject(tabId, ytAction, ["clear", {}]).catch(() => {});
      pauseRun("Stopped from the banner on the YouTube page.");
      return { clicks, throttled: false };
    }
    if (state.signal === "skip") {
      await inject(tabId, ytAction, ["clear", {}]).catch(() => {});
      run = Q.markSkipped(run, index, "Skipped by you.");
      log(`${name} — skipped`);
      return { clicks, throttled: false };
    }
    if (state.subscribed === true) {
      await inject(tabId, ytAction, ["clear", {}]).catch(() => {});
      run = Q.markDone(run, index, null);
      log(`${name} — subscribed`, "ok");
      return { clicks: clicks + 1, throttled: false };
    }
  }

  await inject(tabId, ytAction, ["clear", {}]).catch(() => {});
  run = Q.markFailed(run, index, "Waited five minutes with no click.");
  log(`${name} — timed out waiting for a click`, "warn");
  return { clicks, throttled: false };
}

async function loop() {
  const token = ++loopToken;
  let clicks = 0;
  let strikes = 0;

  while (token === loopToken && !abortCheck()) {
    const index = Q.nextPendingIndex(run);
    if (index === -1) break;

    const outcome = await step(index, clicks);
    clicks = outcome.clicks;

    if (outcome.throttled) strikes += 1;
    else if (run.items[index].status === Q.DONE || run.items[index].status === Q.SKIPPED) strikes = 0;

    await save();
    render();

    if (strikes >= 3) {
      pauseRun(
        "Three subscribes in a row didn't go through. That's usually YouTube rate-limiting you — " +
          "leave it a few hours, then hit Resume. Nothing is lost.",
      );
      break;
    }
    if (abortCheck()) break;

    const delay = Q.delayFor(run, clicks, Math.random());
    if (delay > 0) {
      if (delay >= 10000) log(`Taking a ${Math.round(delay / 1000)} second breather…`);
      await sleep(delay, abortCheck);
    }
  }

  if (token !== loopToken) return;

  if (run && Q.isFinished(run)) {
    run = Q.setStatus(run, "finished");
    const counts = Q.progress(run);
    log(
      run.dryRun
        ? `Dry run finished — ${counts.done} would be subscribed, ${counts.skipped} already there, ${counts.failed} problem${counts.failed === 1 ? "" : "s"}.`
        : `Finished — ${counts.done} subscribed, ${counts.skipped} skipped, ${counts.failed} failed.`,
      counts.failed > 0 ? "warn" : "ok",
    );
    await closeWorkerWindow();
  }
  await save();
  render();
}

// Tidy up when the run ends on its own. The notice tells people this window
// closes itself, so it has to actually do that.
async function closeWorkerWindow() {
  const windowId = workerWindowId;
  workerTabId = null;
  workerWindowId = null;
  windowHidden = false;
  if (windowId == null) return;
  try {
    await chrome.windows.remove(windowId);
  } catch {
    // Already gone.
  }
}

function pauseRun(reason) {
  if (!run) return;
  run = Q.setStatus(run, "paused", reason);
  loopToken += 1;
  log(reason, "warn");
  // Never leave a minimised window behind — if something needs looking at,
  // it needs to be visible.
  setWindowHidden(false);
  save();
  render();
}

async function startRun() {
  // Resuming an existing queue rather than building a new one.
  if (run && run.status === "paused" && Q.nextPendingIndex(run) !== -1) {
    run = Q.setStatus(run, "running");
    log("Resuming.");
    await save();
    render();
    loop();
    return;
  }

  const list = lists.find((l) => l.id === el("source-list").value);
  if (!list) {
    log("Pick a list first.", "warn");
    return;
  }

  const settings = readSettings();
  el("run-start").disabled = true;

  try {
    let source = dedupe(list.items);
    if (settings.scanFirst) {
      log("Scanning this account so we can skip anything you already follow…");
      const existing = await scanAccount(true);
      const before = source.length;
      source = diffChannels(source, existing);
      log(`${existing.length} already subscribed here — ${before - source.length} of the list can be skipped.`);
    }

    if (source.length === 0) {
      log("Nothing to do — you're already subscribed to everything on that list.", "ok");
      el("run-start").disabled = false;
      return;
    }

    run = Q.createQueue(source, {
      mode: settings.mode,
      dryRun: settings.dryRun,
      hideWindow: settings.hideWindow,
      pacing: settings.pacing,
      now: Date.now(),
    });
    run = Q.setStatus(run, "running");
    log(
      `${settings.dryRun ? "Dry run" : settings.mode === "assist" ? "Assist run" : "Auto run"} starting — ${source.length} channels.`,
    );
    await save();
    render();
    loop();
  } catch (err) {
    log(`Couldn't start: ${err.message}`, "bad");
    render();
  } finally {
    el("run-start").disabled = false;
  }
}

// ---------------------------------------------------------------- render

function render() {
  renderLists();
  renderRun();
}

function renderLists() {
  const box = el("lists");
  box.textContent = "";
  if (lists.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No lists yet. Scan an account above, or load a file.";
    box.appendChild(empty);
  }
  for (const list of lists) {
    const row = document.createElement("div");
    row.className = "list-item";

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = list.label;

    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = `${list.items.length} channels · ${new Date(list.savedAt).toLocaleDateString()}`;

    const download = document.createElement("button");
    download.textContent = "Download";
    download.addEventListener("click", () => downloadList(list));

    const remove = document.createElement("button");
    remove.textContent = "Delete";
    remove.addEventListener("click", async () => {
      lists = lists.filter((l) => l.id !== list.id);
      await save();
      render();
    });

    row.append(name, meta, download, remove);
    box.appendChild(row);
  }

  const select = el("source-list");
  const previous = select.value;
  select.textContent = "";
  for (const list of lists) {
    const option = document.createElement("option");
    option.value = list.id;
    option.textContent = `${list.label} (${list.items.length})`;
    select.appendChild(option);
  }
  if (previous && lists.some((l) => l.id === previous)) select.value = previous;
  // With one saved list there's nothing to choose, so don't ask.
  el("list-row").hidden = lists.length < 2;
}

function renderRun() {
  const running = Boolean(run && run.status === "running");
  const paused = Boolean(run && run.status === "paused");
  const resumable = paused && Q.nextPendingIndex(run) !== -1;
  const finished = Boolean(run && run.status === "finished");

  el("run-start").textContent = resumable ? "Resume" : "Subscribe to them all";
  el("run-start").disabled = running;
  el("run-pause").disabled = !running;
  el("run-stop").disabled = !running && !paused;

  const failures = run ? Q.progress(run).failed : 0;
  el("run-retry").hidden = !(run && (paused || finished) && failures > 0);
  el("run-reset").hidden = !(finished && run.dryRun);

  const warning = el("run-warning");
  if (run && run.pauseReason) {
    warning.hidden = false;
    warning.textContent = run.pauseReason;
  } else {
    warning.hidden = true;
  }

  const progressBox = el("progress");
  if (!run) {
    progressBox.hidden = true;
    return;
  }
  progressBox.hidden = false;
  const counts = Q.progress(run);
  const pct = counts.total ? Math.round((counts.processed / counts.total) * 100) : 0;
  el("progress-fill").style.width = `${pct}%`;
  el("progress-counts").textContent =
    `${counts.processed} of ${counts.total} · ${counts.done} ${run.dryRun ? "would subscribe" : "subscribed"} · ` +
    `${counts.skipped} skipped · ${counts.failed} failed`;
}

function renderLog() {
  const list = el("log");
  list.textContent = "";
  for (const line of logLines.slice(-MAX_LOG)) {
    const li = document.createElement("li");
    if (line.level) li.className = line.level;
    const time = document.createElement("span");
    time.className = "time";
    time.textContent = line.stamp;
    const text = document.createElement("span");
    text.className = "text";
    text.textContent = line.text;
    li.append(time, text);
    list.appendChild(li);
  }
  list.scrollTop = list.scrollHeight;
}

// ------------------------------------------------------------ file in/out

function downloadList(list) {
  const blob = new Blob([JSON.stringify({ label: list.label, savedAt: list.savedAt, items: list.items }, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `subswap-${list.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function importFile(file) {
  const text = await file.text();
  let raw;
  if (/\.csv$/i.test(file.name)) {
    raw = parseTakeoutCsv(text);
  } else {
    const parsed = JSON.parse(text);
    raw = Array.isArray(parsed) ? parsed : parsed.items || [];
  }
  const channels = dedupe(raw);
  if (channels.length === 0) throw new Error("No usable channels in that file.");
  lists.unshift({
    id: `list-${Date.now()}`,
    label: file.name.replace(/\.(json|csv)$/i, ""),
    savedAt: Date.now(),
    items: channels,
  });
  await save();
  log(`Loaded ${channels.length} channels from ${file.name}.`, "ok");
  render();
}

// ----------------------------------------------------------------- wiring

el("export-run").addEventListener("click", doExport);

el("mode").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-mode]");
  if (!button) return;
  selectMode(button.dataset.mode);
  save();
});

el("import-file").addEventListener("click", () => el("file-input").click());
el("file-input").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    await importFile(file);
  } catch (err) {
    log(`Couldn't read that file: ${err.message}`, "bad");
  }
  event.target.value = "";
});

el("run-start").addEventListener("click", startRun);
el("run-pause").addEventListener("click", () => pauseRun("Paused."));
el("run-stop").addEventListener("click", async () => {
  loopToken += 1;
  run = Q.setStatus(run, "paused", "Stopped. The queue is kept — Resume picks up where you left off.");
  await closeWorkerWindow();
  await save();
  render();
});
el("run-retry").addEventListener("click", async () => {
  run = Q.retryFailed(run);
  run = Q.setStatus(run, "running");
  log("Retrying the failures.");
  await save();
  render();
  loop();
});
el("run-reset").addEventListener("click", async () => {
  run = Q.resetAll(run, { dryRun: false });
  el("dry-run").checked = false;
  run = Q.setStatus(run, "running");
  log("Dry run cleared — going for real now.");
  await save();
  render();
  loop();
});

el("log-clear").addEventListener("click", async () => {
  logLines = [];
  await save();
  renderLog();
});
el("log-copy").addEventListener("click", async () => {
  const text = logLines.map((l) => `${l.stamp}  ${l.text}`).join("\n");
  await navigator.clipboard.writeText(text);
});

for (const id of ["scan-first", "dry-run", "hide-window", "min-delay", "max-delay", "batch-size", "batch-pause"]) {
  el(id).addEventListener("change", save);
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId !== workerTabId) return;
  workerTabId = null;
  workerWindowId = null;
  windowHidden = false;
  if (run && run.status === "running") pauseRun("The YouTube tab was closed. Resume when you're ready.");
});

connectTimer();
await load();
render();
renderLog();
