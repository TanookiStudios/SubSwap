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

import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
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
    { stamp: "2:57:14 PM", text: "Subscribed to Cold Brew Coding", level: "ok" },
    { stamp: "2:57:02 PM", text: "Subscribed to The Repair Bench", level: "ok" },
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
  return lines;
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
// The "now" line is written by the run loop, which isn't running here.
addEventListener("load", () => {
  const now = document.getElementById("now-line");
  if (now) now.textContent = ${JSON.stringify(nowLineFor(state))};
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
const work = mkdtempSync(join(tmpdir(), "subswap-shots-"));
const stage = join(work, "src");
cpSync(srcDir, stage, { recursive: true });

// Served over HTTP rather than opened as a file. ES modules are blocked over
// file:// by CORS — the page loads, the stylesheet applies, and manager.js
// never runs, which yields a screenshot of un-rendered markup that looks
// almost right. Found that the hard way.
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, "http://localhost").pathname).replace(/^\/+/, "");
  const file = join(stage, name);
  if (!file.startsWith(stage)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = readFileSync(file);
    const dot = name.lastIndexOf(".");
    res.writeHead(200, { "content-type": MIME[name.slice(dot)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});

await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
const port = server.address().port;

try {
  for (const [state, config] of Object.entries(STATES)) {
    const stubName = `__demo-stub-${state}.js`;
    const pageName = `__demo-${state}.html`;
    writeFileSync(join(stage, stubName), stubSource(state));
    writeFileSync(
      join(stage, pageName),
      html.replace(
        '<script type="module" src="manager.js"></script>',
        `<script src="${stubName}"></script>\n    <script type="module" src="manager.js"></script>`,
      ),
    );

    const out = join(outDir, `${state}.png`);
    execFileSync(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--hide-scrollbars",
        "--force-color-profile=srgb",
        "--virtual-time-budget=4000",
        `--screenshot=${out}`,
        `--window-size=${WIDTH},${HEIGHT}`,
        `--user-data-dir=${join(work, `profile-${state}`)}`,
        `http://127.0.0.1:${port}/${pageName}`,
      ],
      { stdio: "pipe", timeout: 90000 },
    );

    const bytes = statSync(out).size;
    if (bytes === 0) throw new Error(`${state}.png came out empty`);
    console.log(`${state}.png  ${bytes} bytes  — ${config.note}`);
  }
} finally {
  server.close();
  rmSync(work, { recursive: true, force: true });
}

console.log(`\nwrote ${Object.keys(STATES).length} screenshots to store/screenshots/ at ${WIDTH}x${HEIGHT}`);
console.log("The store wants 1280x800 or 640x400 — these are ready to upload as they are.");
