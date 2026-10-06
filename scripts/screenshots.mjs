// Store screenshots, captured unattended from the real page.
//
//   npm run screenshots   ->  store/screenshots/*.png  (1280x800)
//
// How it works, and why it works this way:
//
// The manager page is the real thing — this script reads src/manager.html and
// src/manager.css rather than reimplementing them, so a screenshot can never
// show a layout the app doesn't actually have. What it swaps out is the
// `chrome.*` API, replaced with a stub that hands back fabricated demo data.
//
// That matters for a reason beyond convenience: capturing the real UI would
// mean signing into a real YouTube account and subscribing to hundreds of real
// channels to fill the log. Every channel below is invented. No real account
// is touched, no real data can leak into a public store listing.
//
// Nothing appears on screen — this is headless.

import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WIDTH = 1280;
const HEIGHT = 800;

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

function findChrome() {
  for (const path of CHROME_CANDIDATES) {
    try {
      statSync(path);
      return path;
    } catch {
      // next
    }
  }
  throw new Error(`No Chromium browser found. Looked in:\n  ${CHROME_CANDIDATES.join("\n  ")}`);
}

// --- fabricated demo data --------------------------------------------------
//
// Invented channels. Nothing here corresponds to a real YouTube account.

const DEMO_CHANNELS = [
  "The Sourdough Files",
  "Quiet Workshop",
  "Marlow Makes",
  "Pocket Astronomy",
  "Ninety Second History",
  "Harbour Lights Sessions",
  "Cold Brew Coding",
  "The Repair Bench",
  "Foxglove Garden",
  "Analogue Hours",
  "Tidepool",
  "Second Draft",
  "Kestrel Audio",
  "Paper Lantern Kitchen",
  "Long Way Round Cycling",
];

function channel(name, index) {
  return {
    channelId: `UC${String(index).padStart(4, "0")}demoDEMOdemoDEM`.slice(0, 24),
    handle: name.toLowerCase().replace(/[^a-z0-9]+/g, ""),
    title: name,
    avatar: null,
    url: `https://www.youtube.com/@${name.toLowerCase().replace(/[^a-z0-9]+/g, "")}`,
  };
}

const channels = DEMO_CHANNELS.map(channel);

const lists = [
  { id: "list-demo-1", label: "My subscriptions", savedAt: 1754000000000, items: channels },
];

function feedLines(state) {
  const lines = [
    { stamp: "2:58:30 PM", text: "Subscribed to The Sourdough Files", level: "ok" },
    { stamp: "2:58:21 PM", text: "Subscribed to Quiet Workshop", level: "ok" },
    { stamp: "2:58:08 PM", text: "Already following Marlow Makes", level: "" },
    { stamp: "2:57:56 PM", text: "Subscribed to Pocket Astronomy", level: "ok" },
    { stamp: "2:57:41 PM", text: "Subscribed to Ninety Second History", level: "ok" },
    { stamp: "2:57:29 PM", text: "Subscribed to Harbour Lights Sessions", level: "ok" },
  ];
  if (state === "done") {
    lines.unshift({
      stamp: "3:04:11 PM",
      text: "All done — subscribed to 184, skipped 12, 0 didn't work.",
      level: "ok",
    });
  }
  if (state === "break") {
    lines.unshift({
      stamp: "2:58:31 PM",
      text: "Taking a 60 second break to keep your account safe",
      level: "",
    });
  }
  // The app stores its log oldest-first and reverses it at render time so the
  // newest is on top. The lines above are written newest-first because that's
  // how they read here, so flip them — otherwise the screenshots show the feed
  // running the wrong way up.
  return lines.reverse();
}

function runFor(state) {
  if (state === "first" || state === "pick") return null;

  const total = 196;
  const done = state === "done" ? 184 : 126;
  const skipped = state === "done" ? 12 : 4;
  const items = [];
  for (let i = 0; i < total; i++) {
    const source = channels[i % channels.length];
    let status = "pending";
    if (i < done) status = "done";
    else if (i < done + skipped) status = "skipped";
    items.push({ channel: source, status, attempts: status === "done" ? 1 : 0, note: null });
  }

  return {
    createdAt: 1754000000000,
    mode: "auto",
    dryRun: false,
    hideWindow: true,
    pacing: { minDelayMs: 5000, maxDelayMs: 10000, batchSize: 20, batchPauseMs: 60000, dryRunDelayMs: 1200 },
    status: state === "done" ? "finished" : "running",
    pauseReason: null,
    items,
  };
}

const STATES = {
  first: { lists: [], run: null, note: "before anything is saved" },
  pick: { lists, run: null, note: "a saved list, ready to go" },
  running: { lists, run: runFor("running"), note: "mid-job" },
  break: { lists, run: runFor("break"), note: "mid-job, on a safety break" },
  done: { lists, run: runFor("done"), note: "finished" },
  about: { lists, run: null, view: "about", note: "the About tab" },
  support: { lists, run: null, view: "support", note: "the Support My Work tab" },
};

// --- the chrome.* stub -----------------------------------------------------

function stubSource(state) {
  const config = STATES[state];
  const seed = {
    lists: config.lists,
    run: config.run,
    log: config.run ? feedLines(state) : [],
    stats: { subscribed: state === "done" ? 184 : 126 },
    settings: { mode: "auto", scanFirst: true, dryRun: false, hideWindow: true },
  };

  // Enough of the extension APIs for the page to boot and render. Nothing here
  // touches a browser or a network — every call is inert.
  return `globalThis.chrome = {
  storage: { local: {
    get: async () => (${JSON.stringify(seed)}),
    set: async () => {},
  } },
  runtime: {
    connect: () => ({
      name: "stub",
      postMessage: () => {},
      onMessage: { addListener: () => {} },
      onDisconnect: { addListener: () => {} },
    }),
    getURL: (path) => path,
  },
  tabs: {
    get: async () => ({}), update: async () => ({}), reload: async () => {},
    query: async () => [], create: async () => ({}), remove: async () => {},
    onUpdated: { addListener: () => {}, removeListener: () => {} },
    onRemoved: { addListener: () => {} },
  },
  windows: { create: async () => ({ id: 1, tabs: [{ id: 1 }] }), update: async () => {}, remove: async () => {} },
  scripting: { executeScript: async () => [{ result: null }] },
};
// Chrome writes the PNG whatever happens on the page, so throwing in here would
// be invisible — the shot would just quietly be of the wrong thing. Paint the
// failure across the page instead, where it can't be mistaken for a good one.
function fail(why) {
  const bar = document.createElement("p");
  bar.textContent = "HARNESS FAILED: " + why;
  bar.style.cssText =
    "position:fixed;inset:0;z-index:99999;margin:0;display:flex;align-items:center;" +
    "justify-content:center;background:#b32020;color:#fff;font:700 28px system-ui";
  document.body.appendChild(bar);
}

addEventListener("load", () => {
  // The "now" line is written by the run loop, which isn't running here.
  const now = document.getElementById("now-line");
  if (now) now.textContent = ${JSON.stringify(nowLineFor(state))};

  // A stored "running" job means the tab died mid-run, so the app quite
  // correctly reopens it as Paused / Interrupted. That's the right behaviour
  // and the wrong screenshot — a listing shouldn't advertise a broken run.
  // These three are put back to what a live run actually looks like.
  const live = ${JSON.stringify(state === "running" || state === "break")};
  if (live) {
    document.getElementById("job-title").textContent = "Subscribing…";
    document.getElementById("run-warning").hidden = true;
    const start = document.getElementById("run-start");
    start.textContent = "Subscribe to them all";
    start.disabled = true;
    document.getElementById("run-pause").disabled = false;
    document.getElementById("run-stop").disabled = false;
  }

  // Developer nag about an unset SUPPORT_URL — not product, never in a shot.
  const nag = document.getElementById("tip-missing");
  if (nag) nag.hidden = true;

  // Press the real tab rather than toggling the views by hand, so the shot is
  // of the same code path a person takes. Module scripts finish before the load
  // event, so manager.js's handler is already listening by the time we get here.
  const view = ${JSON.stringify(config.view || null)};
  if (view) {
    const tab = document.querySelector(\`#tabs [aria-controls="view-\${view}"]\`);
    if (!tab) fail("no tab for view " + view);
    else {
      tab.click();
      if (document.getElementById("view-" + view).hidden) fail(view + " tab did not open");
    }
  }
});`;
}

function nowLineFor(state) {
  if (state === "break") return "Taking a 47 second break — going slowly is what keeps your account safe.";
  if (state === "running") return "Subscribing to Foxglove Garden…";
  return "";
}

// --- capture ---------------------------------------------------------------

const chrome = findChrome();
const outDir = join(root, "store/screenshots");
mkdirSync(outDir, { recursive: true });

const srcDir = join(root, "src");
const html = readFileSync(join(srcDir, "manager.html"), "utf8");
if (!html.includes('<script type="module" src="manager.js"></script>')) {
  throw new Error("manager.html's script tag has changed shape — update this harness");
}

// The whole of src/ is copied to a scratch directory and the demo pages are
// written there. Generating them inside the repo would mean a killed run could
// leave files behind — and package.mjs ships everything in src/, so they'd end
// up in a store upload. Copying keeps the real CSS and the real code (relative
// imports and all) while making that impossible.
// Each capture runs in its own child process. Launching Chrome twice from a
// single Node process reliably kills the second launch on this machine — the
// first image lands and then it falls over, every time. One child per shot
// sidesteps it, and a shot that fails doesn't take the rest of the run with it.
const only = process.argv[2];

if (!only) {
  const states = Object.entries(STATES);
  const failed = [];

  for (const [state, config] of states) {
    process.stdout.write(`${state}.png … `);
    try {
      execFileSync(process.execPath, [fileURLToPath(import.meta.url), state], { stdio: "pipe" });
      console.log(`${statSync(join(outDir, `${state}.png`)).size} bytes — ${config.note}`);
    } catch (err) {
      failed.push(state);
      console.log("FAILED");
      console.error(indent(err.stderr?.toString() || err.message));
    }
  }

  if (failed.length > 0) {
    console.error(`\n${failed.length} of ${states.length} failed: ${failed.join(", ")}`);
    console.error("Rerunning picks up the ones that are missing.");
    process.exit(1);
  }
  console.log(`\nwrote ${states.length} screenshots to store/screenshots/ at ${WIDTH}x${HEIGHT}`);
  console.log("The store wants 1280x800 or 640x400 — these are ready to upload as they are.");
  process.exit(0);
}

function indent(text) {
  return String(text)
    .trim()
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

// --- one state, one Chrome ---------------------------------------------

if (!STATES[only]) {
  throw new Error(`unknown state "${only}" — expected one of ${Object.keys(STATES).join(", ")}`);
}

const work = mkdtempSync(join(tmpdir(), "subswap-shots-"));
const stage = join(work, "src");
cpSync(srcDir, stage, { recursive: true });

try {
  const stubName = `__demo-stub-${only}.js`;
  const pageName = `__demo-${only}.html`;
  writeFileSync(join(stage, stubName), stubSource(only));
  writeFileSync(
    join(stage, pageName),
    html.replace(
      '<script type="module" src="manager.js"></script>',
      `<script src="${stubName}"></script>\n    <script type="module" src="manager.js"></script>`,
    ),
  );

  const out = join(outDir, `${only}.png`);
  rmSync(out, { force: true });

  // Chrome writes the PNG and then, in this setup, doesn't exit — so waiting on
  // the process meant every capture burned the full timeout even though the
  // image had been on disk for seconds. Watch for the file instead and stop
  // Chrome the moment it's finished writing. Fifty minutes became about one.
  const child = spawn(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--force-color-profile=srgb",
      // Without this, file:// is an opaque origin and <script type="module">
      // is refused by CORS — the page renders un-booted markup instead, which
      // looks close enough to right to fool you.
      "--allow-file-access-from-files",
      "--virtual-time-budget=4000",
      `--screenshot=${out}`,
      `--window-size=${WIDTH},${HEIGHT}`,
      `--user-data-dir=${join(work, "profile")}`,
      `file://${join(stage, pageName)}`,
    ],
    { stdio: "ignore" },
  );

  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const deadline = Date.now() + 180000;
  let written = 0;

  while (Date.now() < deadline) {
    await pause(500);
    let size = 0;
    try {
      size = statSync(out).size;
    } catch {
      size = 0;
    }
    // Two identical non-zero readings means it's done writing, not mid-write.
    if (size > 0 && size === written) break;
    written = size;
    if (child.exitCode !== null && size === 0) break;
  }

  child.kill("SIGKILL");

  if (written === 0) {
    throw new Error(
      `Chrome produced no image within 3 minutes.\n` +
        `Page: ${join(stage, pageName)}\n` +
        `If this keeps happening, run that file in a browser by hand and look at the console.`,
    );
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
